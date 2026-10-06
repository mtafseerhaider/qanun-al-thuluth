-- supabase/migrations/20261006150100_launch_kpis.sql
-- 05 ref: 0024 analytics (part: launch dashboard). Sprint 7: S7-12 (FR-ANL-03; 22 section 8 success gates).
-- Additions beyond 05 / 18 (recorded in docs/ops/analytics-launch-dashboard.md):
--   * Event-name alignment. The S6 views use the 18 section 9 names (signup_completed, serving_logged, meal_logged,
--     paywall_viewed, paywall_purchase_succeeded), but the app registry (packages/shared/src/analytics/events.ts)
--     emits meal_serving_logged, meal_log_saved, paywall_shown and purchase_completed, and no signup event at all.
--     mv_dau and mv_paywall_funnel_daily are recreated to accept both spellings, and mv_retention_weekly takes its
--     cohort from users.created_at (a domain fact, 18 section 8 "outcome metrics from domain tables") instead of an
--     event nobody sends. Their admin views are recreated unchanged. refresh_analytics_views() refreshes by name, so
--     it needs no change.
--   * Launch dashboard admin views (owner rights, rows only for public.is_admin(), aggregates only, like S6):
--       v_admin_activation_funnel_weekly       G-UX-1 onboarding completion, G-UX-2 time to first plan,
--                                              G-ENG-1 households active on 3+ days in their first week
--       v_admin_ai_cost_per_active_user_weekly G-COST-1 (all users and premium) ; v_admin_ai_cost_per_mau_monthly
--       v_admin_notification_on_time_daily     G-OPS-1 (sent within 2 minutes of scheduled_for), p95 lag
--       v_admin_plan_generation_daily          G-QUAL-2 (plan.generate AI calls without fallback; failed plans)
--       v_admin_launch_kpis                    one row per KPI for the last 7 days with its gate threshold
--     These are plain views over domain tables (launch scale: thousands of users); none is refreshed by cron.
--   * public.launch_kpis(p_since, p_until) returns the KPI values as jsonb; service role and admins (FORBIDDEN otherwise). analytics-rollup
--     calls it to raise KPI alerts and writes daily rows into analytics.metric_snapshots (metric 'kpi.<name>') through
--     public.save_kpi_snapshots(jsonb) (service role; schema analytics is not exposed through PostgREST).
--   * Crash-free sessions (G-QUAL-1) live in Sentry release health, not in Postgres (docs/ops/sentry-alerts.md).

-- ---- event-name alignment: mv_dau, mv_paywall_funnel_daily, mv_retention_weekly ------------------------------------------
drop view if exists public.v_admin_kpi_daily, public.v_admin_retention_weekly, public.v_admin_paywall_funnel_daily;
drop materialized view if exists analytics.mv_dau, analytics.mv_paywall_funnel_daily, analytics.mv_retention_weekly;

create materialized view analytics.mv_dau as
select (ae.occurred_at at time zone coalesce(u.timezone, 'UTC'))::date as day,
       coalesce(u.country_code, 'ZZ')                                   as country_code,
       count(distinct ae.user_id)                                       as dau,
       count(distinct ae.user_id) filter (where ae.platform = 'ios')     as dau_ios,
       count(distinct ae.user_id) filter (where ae.platform = 'android') as dau_android
from public.analytics_events ae
join public.users u on u.id = ae.user_id and not u.is_internal
where ae.event in ('app_opened','serving_logged','meal_serving_logged','meal_logged','meal_log_saved','hydration_logged',
                   'chat_message_sent','fast_logged','plan_viewed')
  and ae.occurred_at >= now() - interval '400 days'
group by 1, 2;
create unique index on analytics.mv_dau (day, country_code);

create materialized view analytics.mv_paywall_funnel_daily as
select (v.occurred_at at time zone 'UTC')::date     as day,
       coalesce(v.props ->> 'trigger', 'unknown')    as trigger,
       coalesce(v.country_code, 'ZZ')                as country_code,
       count(distinct v.session_id)                  as views,
       count(distinct p.session_id)                  as purchases
from public.analytics_events v
left join public.analytics_events p
  on p.session_id = v.session_id and p.event in ('paywall_purchase_succeeded','purchase_completed')
 and p.occurred_at between v.occurred_at and v.occurred_at + interval '30 minutes'
where v.event in ('paywall_viewed','paywall_shown') and v.occurred_at >= now() - interval '400 days'
group by 1, 2, 3;
create unique index on analytics.mv_paywall_funnel_daily (day, trigger, country_code);

create materialized view analytics.mv_retention_weekly as
with cohort as (
  select u.id as user_id, date_trunc('week', u.created_at)::date as cohort_week
  from public.users u
  where not u.is_internal and u.created_at >= now() - interval '400 days'
), activity as (
  select distinct user_id, date_trunc('week', day)::date as active_week from analytics.mv_user_active_days
)
select c.cohort_week,
       ((a.active_week - c.cohort_week) / 7)                                        as week_n,
       count(distinct a.user_id)                                                    as retained,
       (select count(*) from cohort c2 where c2.cohort_week = c.cohort_week)        as cohort_size
from cohort c join activity a on a.user_id = c.user_id and a.active_week >= c.cohort_week
group by 1, 2;
create unique index on analytics.mv_retention_weekly (cohort_week, week_n);

revoke all on analytics.mv_dau, analytics.mv_paywall_funnel_daily, analytics.mv_retention_weekly from public, anon, authenticated;
grant select on analytics.mv_dau, analytics.mv_paywall_funnel_daily, analytics.mv_retention_weekly to service_role;

create view public.v_admin_kpi_daily with (security_barrier = true) as
select d.day, d.country_code, d.dau, d.dau_ios, d.dau_android
from analytics.mv_dau d
where public.is_admin();

create view public.v_admin_retention_weekly with (security_barrier = true) as
select r.cohort_week, r.week_n, r.retained, r.cohort_size,
       round(r.retained::numeric / nullif(r.cohort_size, 0), 4) as retention_rate
from analytics.mv_retention_weekly r
where public.is_admin();

create view public.v_admin_paywall_funnel_daily with (security_barrier = true) as
select f.day, f.trigger, f.country_code, f.views, f.purchases,
       round(f.purchases::numeric / nullif(f.views, 0), 4) as conversion
from analytics.mv_paywall_funnel_daily f
where public.is_admin();

-- ---- activity days per household (meal servings, meal logs, hydration), household local date ----------------------------
create or replace function private.household_activity_days(p_household uuid, p_from timestamptz, p_to timestamptz)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(distinct d)::int from (
    select (s.logged_at at time zone h.timezone)::date as d
      from public.daily_meal_servings s join public.households h on h.id = s.household_id
     where s.household_id = p_household and s.logged_at >= p_from and s.logged_at < p_to
    union all
    select (m.created_at at time zone h.timezone)::date
      from public.meal_logs m join public.households h on h.id = m.household_id
     where m.household_id = p_household and m.deleted_at is null and m.created_at >= p_from and m.created_at < p_to
    union all
    select (l.logged_at at time zone h.timezone)::date
      from public.hydration_logs l join public.households h on h.id = l.household_id
     where l.household_id = p_household and l.logged_at >= p_from and l.logged_at < p_to
  ) x;
$$;
revoke all on function private.household_activity_days(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- ---- activation funnel by signup week (G-UX-1, G-UX-2, G-ENG-1) ------------------------------------------------------------
create view public.v_admin_activation_funnel_weekly with (security_barrier = true) as
with signups as (
  select u.id, u.created_at, u.onboarding_completed_at, date_trunc('week', u.created_at)::date as cohort_week
  from public.users u
  where not u.is_internal and u.created_at >= now() - interval '400 days'
), owned as (
  select s.*, h.id as household_id, h.created_at as household_created_at,
         (select min(mp.created_at) from public.meal_plans mp
           where mp.household_id = h.id and mp.parent_plan_id is null and mp.deleted_at is null
             and mp.status in ('draft','active','completed','archived')) as first_plan_at,
         -- distinct local days with a serving, meal or hydration log in the household's first 7 days
         -- (inlined: views call functions with the caller's rights, and schema private is closed to clients)
         (select count(distinct d) from (
            select (x.logged_at at time zone h.timezone)::date as d from public.daily_meal_servings x
             where x.household_id = h.id and x.logged_at >= h.created_at and x.logged_at < h.created_at + interval '7 days'
            union all
            select (x.created_at at time zone h.timezone)::date from public.meal_logs x
             where x.household_id = h.id and x.deleted_at is null
               and x.created_at >= h.created_at and x.created_at < h.created_at + interval '7 days'
            union all
            select (x.logged_at at time zone h.timezone)::date from public.hydration_logs x
             where x.household_id = h.id and x.logged_at >= h.created_at and x.logged_at < h.created_at + interval '7 days'
          ) days) as week1_active_days
  from signups s
  left join lateral (select h.* from public.households h
                      where h.owner_user_id = s.id and h.deleted_at is null
                      order by h.created_at limit 1) h on true
)
select o.cohort_week,
       count(*)                                                         as signups,
       count(o.household_id)                                            as households_created,
       count(o.onboarding_completed_at)                                 as onboarding_completed,
       count(o.first_plan_at)                                           as first_plan,
       count(*) filter (where o.household_id is not null and o.household_created_at <= now() - interval '7 days'
                          and o.week1_active_days >= 3)                 as activated_3d_week1,
       count(*) filter (where o.household_id is not null and o.household_created_at <= now() - interval '7 days')
                                                                        as households_past_week1,
       round(count(o.onboarding_completed_at)::numeric / nullif(count(*), 0), 4) as onboarding_completion_rate,
       round((percentile_cont(0.5) within group (
               order by extract(epoch from (o.first_plan_at - o.created_at)) / 60.0))::numeric, 1)
                                                                        as median_minutes_to_first_plan
from owned o
where public.is_admin()
group by o.cohort_week;

-- ---- AI cost per active user (G-COST-1) and per MAU ---------------------------------------------------------------------------
create view public.v_admin_ai_cost_per_active_user_weekly with (security_barrier = true) as
with cost as (
  select date_trunc('week', a.created_at)::date as week, a.user_id, sum(a.cost_usd_micros) as micros
  from public.ai_usage a
  join public.users u on u.id = a.user_id and not u.is_internal
  where a.created_at >= now() - interval '400 days'
  group by 1, 2
), active as (
  select date_trunc('week', d.day)::date as week, d.user_id from analytics.mv_user_active_days d
  union
  select week, user_id from cost
), tiered as (
  select ac.week, ac.user_id, public.has_premium(ac.user_id) as premium, coalesce(c.micros, 0) as micros
  from active ac left join cost c on c.week = ac.week and c.user_id = ac.user_id
)
select t.week,
       count(*)                                                                  as active_users,
       count(*) filter (where t.premium)                                         as active_premium_users,
       round(sum(t.micros) / 1e6, 4)                                             as ai_cost_usd,
       round(sum(t.micros) / 1e6 / nullif(count(*), 0), 4)                       as cost_per_active_user_usd,
       round(sum(t.micros) filter (where t.premium) / 1e6
             / nullif(count(*) filter (where t.premium), 0), 4)                  as cost_per_active_premium_user_usd
from tiered t
where public.is_admin()
group by t.week;

create view public.v_admin_ai_cost_per_mau_monthly with (security_barrier = true) as
with cost as (
  select date_trunc('month', c.day)::date as month, sum(c.cost_usd_micros) as micros
  from analytics.mv_ai_cost_daily c group by 1
), mau as (
  select date_trunc('month', d.day)::date as month, count(distinct d.user_id) as mau
  from analytics.mv_user_active_days d group by 1
)
select coalesce(m.month, c.month) as month, coalesce(m.mau, 0) as mau,
       round(coalesce(c.micros, 0) / 1e6, 2) as ai_cost_usd,
       round(coalesce(c.micros, 0) / 1e6 / nullif(m.mau, 0), 4) as cost_per_mau_usd
from mau m full join cost c on c.month = m.month
where public.is_admin();

-- ---- notification on-time rate (G-OPS-1: sent within 2 minutes; 01 section 9) ---------------------------------------------
create view public.v_admin_notification_on_time_daily with (security_barrier = true) as
select (n.scheduled_for at time zone 'UTC')::date                                       as day,
       n.kind,
       count(*)                                                                         as due,
       count(*) filter (where n.status = 'sent')                                        as sent,
       count(*) filter (where n.status = 'failed')                                      as failed,
       count(*) filter (where n.status = 'sent' and n.sent_at <= n.scheduled_for + interval '2 minutes') as on_time,
       round(count(*) filter (where n.status = 'sent' and n.sent_at <= n.scheduled_for + interval '2 minutes')::numeric
             / nullif(count(*), 0), 4)                                                  as on_time_rate,
       round((percentile_cont(0.95) within group (
               order by extract(epoch from (n.sent_at - n.scheduled_for))) filter (where n.status = 'sent'))::numeric, 1)
                                                                                        as p95_lag_seconds
from public.notifications n
where n.channel = 'push' and n.status <> 'cancelled'
  and n.scheduled_for >= now() - interval '90 days' and n.scheduled_for <= now() - interval '2 minutes'
  and public.is_admin()
group by 1, 2;

-- ---- plan generation (G-QUAL-2) ----------------------------------------------------------------------------------------------
create view public.v_admin_plan_generation_daily with (security_barrier = true) as
with calls as (
  select (a.created_at at time zone 'UTC')::date as day,
         count(*) as ai_calls,
         count(*) filter (where a.status = 'ok')       as ai_ok,
         count(*) filter (where a.status = 'fallback') as ai_fallback,
         count(*) filter (where a.status = 'error')    as ai_error
  from public.ai_usage a
  where a.route_key = 'plan.generate' and a.created_at >= now() - interval '90 days'
  group by 1
), plans as (
  select (mp.created_at at time zone 'UTC')::date as day,
         count(*)                                       as plans,
         count(*) filter (where mp.status = 'failed')     as plans_failed,
         count(*) filter (where mp.status = 'generating') as plans_generating
  from public.meal_plans mp
  where mp.parent_plan_id is null and mp.created_at >= now() - interval '90 days'
  group by 1
)
select coalesce(c.day, p.day) as day,
       coalesce(p.plans, 0) as plans, coalesce(p.plans_failed, 0) as plans_failed,
       coalesce(p.plans_generating, 0) as plans_generating,
       coalesce(c.ai_calls, 0) as ai_calls, coalesce(c.ai_ok, 0) as ai_ok,
       coalesce(c.ai_fallback, 0) as ai_fallback, coalesce(c.ai_error, 0) as ai_error,
       round(c.ai_ok::numeric / nullif(c.ai_calls, 0), 4) as success_without_fallback_rate
from calls c full join plans p on p.day = c.day
where public.is_admin();

-- ---- launch_kpis(): KPI values for a window, for alerts and snapshots ---------------------------------------------------------
create or replace function public.launch_kpis(p_since timestamptz, p_until timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days      numeric := greatest(extract(epoch from (p_until - p_since)) / 86400.0, 1.0 / 24);
  v_out       jsonb := '{}'::jsonb;
  v_n         bigint;
  v_k         bigint;
  v_val       numeric;
  v_active    bigint;
  v_premium   bigint;
  v_cost      numeric;
  v_cost_p    numeric;
begin
  -- Service role, direct connections and admins only (v_admin_launch_kpis calls this with the caller's rights).
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'service_role') <> 'service_role'
     and not public.is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_until <= p_since then
    raise exception 'VALIDATION_FAILED' using errcode = '22023', detail = json_build_object('field', 'p_since')::text;
  end if;

  -- G-OPS-1 notification on-time rate (push, due inside the window)
  select count(*), count(*) filter (where n.status = 'sent' and n.sent_at <= n.scheduled_for + interval '2 minutes')
    into v_n, v_k
    from public.notifications n
   where n.channel = 'push' and n.status <> 'cancelled'
     and n.scheduled_for >= p_since and n.scheduled_for < least(p_until, now() - interval '2 minutes');
  v_out := v_out || jsonb_build_object('notifications_due', v_n,
                                       'notification_on_time_rate', round(v_k::numeric / nullif(v_n, 0), 4));

  -- G-QUAL-2 plan generation without fallback
  select count(*), count(*) filter (where a.status = 'ok') into v_n, v_k
    from public.ai_usage a
   where a.route_key = 'plan.generate' and a.created_at >= p_since and a.created_at < p_until;
  v_out := v_out || jsonb_build_object('plan_generation_calls', v_n,
                                       'plan_generation_success_rate', round(v_k::numeric / nullif(v_n, 0), 4));

  -- G-UX-1 onboarding completion and G-UX-2 median minutes to first plan (users who signed up in the window)
  select count(*), count(u.onboarding_completed_at) into v_n, v_k
    from public.users u
   where not u.is_internal and u.created_at >= p_since and u.created_at < p_until;
  select percentile_cont(0.5) within group (order by extract(epoch from (fp.at - u.created_at)) / 60.0) into v_val
    from public.users u
    join lateral (select min(mp.created_at) as at from public.meal_plans mp
                    join public.households h on h.id = mp.household_id and h.owner_user_id = u.id
                   where mp.parent_plan_id is null and mp.status in ('draft','active','completed','archived')) fp
      on fp.at is not null
   where not u.is_internal and u.created_at >= p_since and u.created_at < p_until;
  v_out := v_out || jsonb_build_object('signups', v_n,
                                       'onboarding_completion_rate', round(v_k::numeric / nullif(v_n, 0), 4),
                                       'median_minutes_to_first_plan', round(v_val, 1));

  -- G-ENG-1 households whose first week ended inside the window, active on 3+ days of it
  select count(*), count(*) filter (where private.household_activity_days(h.id, h.created_at, h.created_at + interval '7 days') >= 3)
    into v_n, v_k
    from public.households h
    join public.users u on u.id = h.owner_user_id and not u.is_internal
   where h.deleted_at is null
     and h.created_at + interval '7 days' >= p_since and h.created_at + interval '7 days' < least(p_until, now());
  v_out := v_out || jsonb_build_object('households_past_week1', v_n,
                                       'activation_rate', round(v_k::numeric / nullif(v_n, 0), 4));

  -- G-COST-1 AI cost per active user per week (all, premium); active = any event or any AI call in the window
  with active as (
    select distinct ae.user_id from public.analytics_events ae
     where ae.occurred_at >= p_since and ae.occurred_at < p_until and ae.user_id is not null
    union
    select distinct a.user_id from public.ai_usage a where a.created_at >= p_since and a.created_at < p_until
  ), scoped as (
    select ac.user_id, public.has_premium(ac.user_id) as premium,
           coalesce((select sum(a.cost_usd_micros) from public.ai_usage a
                      where a.user_id = ac.user_id and a.created_at >= p_since and a.created_at < p_until), 0) as micros
      from active ac join public.users u on u.id = ac.user_id and not u.is_internal
  )
  select count(*), count(*) filter (where premium), sum(micros) / 1e6, sum(micros) filter (where premium) / 1e6
    into v_active, v_premium, v_cost, v_cost_p
    from scoped;
  v_out := v_out || jsonb_build_object(
    'active_users', v_active,
    'ai_cost_usd', round(coalesce(v_cost, 0), 4),
    'ai_cost_per_active_user_week_usd', round(v_cost / nullif(v_active, 0) * 7 / v_days, 4),
    'ai_cost_per_active_premium_user_week_usd', round(v_cost_p / nullif(v_premium, 0) * 7 / v_days, 4));
  return v_out;
end $$;
revoke all on function public.launch_kpis(timestamptz, timestamptz) from public, anon;
-- authenticated may execute so the admin view works; the body refuses non-admins with FORBIDDEN.
grant execute on function public.launch_kpis(timestamptz, timestamptz) to authenticated, service_role;

-- Daily KPI rows for trend charts (analytics-rollup daily). Non-personal aggregates; service role only.
create or replace function public.save_kpi_snapshots(p_rows jsonb)
returns integer
language sql
security definer
set search_path = ''
as $$
  with ins as (
    insert into analytics.metric_snapshots (metric, period_start, period_end, dimensions, value)
    select r ->> 'metric', (r ->> 'period_start')::date, (r ->> 'period_end')::date, '{}'::jsonb, (r ->> 'value')::numeric
      from jsonb_array_elements(p_rows) r
     where r ->> 'metric' like 'kpi.%'
    on conflict (metric, period_start, dimensions) do update
      set period_end = excluded.period_end, value = excluded.value
    returning 1
  )
  select count(*)::int from ins;
$$;
revoke all on function public.save_kpi_snapshots(jsonb) from public, anon, authenticated;
grant execute on function public.save_kpi_snapshots(jsonb) to service_role;

-- One row per KPI for the last 7 days with the 22 section 8 gate (admin dashboard landing tile).
create view public.v_admin_launch_kpis with (security_barrier = true) as
with k as (select public.launch_kpis(now() - interval '7 days', now()) as j where public.is_admin())
select g.gate, g.metric, (k.j ->> g.metric)::numeric as value, g.comparator, g.threshold,
       case when k.j ->> g.metric is null then 'no_data'
            when g.comparator = '>=' and (k.j ->> g.metric)::numeric >= g.threshold then 'green'
            when g.comparator = '<=' and (k.j ->> g.metric)::numeric <= g.threshold then 'green'
            when g.comparator = '>=' and (k.j ->> g.metric)::numeric >= g.threshold * 0.8 then 'amber'
            when g.comparator = '<=' and (k.j ->> g.metric)::numeric <= g.threshold * 1.2 then 'amber'
            else 'red' end as status
from k cross join (values
  ('G-UX-1',   'onboarding_completion_rate',               '>=', 0.60),
  ('G-UX-2',   'median_minutes_to_first_plan',             '<=', 8.0),
  ('G-ENG-1',  'activation_rate',                          '>=', 0.40),
  ('G-COST-1', 'ai_cost_per_active_premium_user_week_usd', '<=', 0.35),
  ('G-OPS-1',  'notification_on_time_rate',                '>=', 0.99),
  ('G-QUAL-2', 'plan_generation_success_rate',             '>=', 0.95)
) as g(gate, metric, comparator, threshold)
where public.is_admin();

revoke all on public.v_admin_kpi_daily, public.v_admin_retention_weekly, public.v_admin_paywall_funnel_daily,
  public.v_admin_activation_funnel_weekly, public.v_admin_ai_cost_per_active_user_weekly,
  public.v_admin_ai_cost_per_mau_monthly, public.v_admin_notification_on_time_daily,
  public.v_admin_plan_generation_daily, public.v_admin_launch_kpis
  from anon, authenticated;
grant select on public.v_admin_kpi_daily, public.v_admin_retention_weekly, public.v_admin_paywall_funnel_daily,
  public.v_admin_activation_funnel_weekly, public.v_admin_ai_cost_per_active_user_weekly,
  public.v_admin_ai_cost_per_mau_monthly, public.v_admin_notification_on_time_daily,
  public.v_admin_plan_generation_daily, public.v_admin_launch_kpis
  to authenticated, service_role;
