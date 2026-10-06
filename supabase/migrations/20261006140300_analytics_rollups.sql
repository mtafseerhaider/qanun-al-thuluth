-- supabase/migrations/20261006140300_analytics_rollups.sql
-- 05 ref: 0024 analytics (part: 24.1 columns, 24.3 schema analytics, materialized views and metric_snapshots, 24.4
--         refresh, 24.5 get_family_insights), 0014 (analytics-rollup cron). Sprint 6: S6-13 (DB side).
-- DDL from 05 section 22.10, except:
--   * Not in this file: analytics_event_catalog, analytics_filter_props() and track_events() (24.2, the ingestion
--     allow-list). The catalog must be generated from packages/shared events.ts, which this lane does not own; the
--     client keeps the S0-13 direct-insert contract until that lands (README "Analytics client contract").
--   * mv_family_weekly_summary.new_foods_accepted counts 'completed' ladders (05 base ladder statuses; the 0021d
--     'accepted' value was not applied, S6-01 decision).
--   * Addition (06 section 4.17): analytics.mv_ai_cost_daily (AI cost per day, route and tier, from ai_usage).
--   * refresh_analytics_views(p_scope text default 'hourly') returns text[] (the views refreshed) instead of void
--     (backend lane contract, AnalyticsRollupResponse.refreshed). 'hourly' refreshes the event-driven views (DAU, active
--     days, paywall funnel, AI cost); 'daily' refreshes all ten plus the AI cost view. Service role only.
--     0014's public.mv_daily_active_users and mv_feature_usage_daily were never created (README Sprint 0: superseded by
--     schema analytics), so the 05 body's first two lines are dropped.
--   * Addition: analytics_maintain_partitions() (service role) wraps the 0014 partition helpers and reports names.
--   * Addition (S6-13 "admin read views"): public views v_admin_kpi_daily, v_admin_retention_weekly,
--     v_admin_plan_completion_weekly, v_admin_paywall_funnel_daily, v_admin_ai_cost_daily and
--     v_admin_growth_coverage. They run with the owner's rights (schema analytics is not exposed through PostgREST) and
--     return rows only when public.is_admin(). Aggregates only: no user ids, and household-level views are rolled up.
--   * Cron: analytics-rollup hourly (05 17.5) and analytics-rollup-daily at 02:00 UTC call the analytics-rollup Edge
--     Function with scope hourly / daily.

-- 24.1 analytics_events columns -------------------------------------------------------------------------------------------
alter table public.analytics_events
  add column event_id      uuid not null default gen_random_uuid(),   -- client-generated for dedupe
  add column session_id    uuid,
  add column received_at   timestamptz not null default now(),
  add column locale        text,
  add column country_code  char(2) check (country_code ~ '^[A-Z]{2}$');
create unique index analytics_events_dedupe on public.analytics_events (event_id, occurred_at);
create index analytics_events_session_idx on public.analytics_events (session_id, occurred_at) where session_id is not null;

-- 24.3 analytics schema (service role; not in the PostgREST exposed schemas) ------------------------------------------------
create schema if not exists analytics;
revoke all on schema analytics from public, anon, authenticated;
grant usage on schema analytics to service_role;

create materialized view analytics.mv_user_active_days as
select distinct ae.user_id,
       (ae.occurred_at at time zone coalesce(u.timezone, 'UTC'))::date as day
from public.analytics_events ae
join public.users u on u.id = ae.user_id and not u.is_internal
where ae.occurred_at >= now() - interval '400 days';
create unique index on analytics.mv_user_active_days (user_id, day);

create materialized view analytics.mv_dau as
select (ae.occurred_at at time zone coalesce(u.timezone, 'UTC'))::date as day,
       coalesce(u.country_code, 'ZZ')                                   as country_code,
       count(distinct ae.user_id)                                       as dau,
       count(distinct ae.user_id) filter (where ae.platform = 'ios')     as dau_ios,
       count(distinct ae.user_id) filter (where ae.platform = 'android') as dau_android
from public.analytics_events ae
join public.users u on u.id = ae.user_id and not u.is_internal
where ae.event in ('app_opened','serving_logged','meal_logged','hydration_logged','chat_message_sent','fast_logged','plan_viewed')
  and ae.occurred_at >= now() - interval '400 days'
group by 1, 2;
create unique index on analytics.mv_dau (day, country_code);

create materialized view analytics.mv_meal_adherence_daily as
select dm.household_id, dm.plan_date as day, fm.life_stage,
       count(*)                                                   as planned,
       count(*) filter (where dms.status <> 'planned')            as logged,
       sum(case dms.status when 'eaten' then 1 when 'partly_eaten' then 0.5 when 'swapped' then 1 else 0 end) as adhered
from public.daily_meal_servings dms
join public.daily_meals dm on dm.id = dms.daily_meal_id
join public.family_members fm on fm.id = dms.family_member_id
where dm.plan_date < current_date and dm.plan_date >= current_date - 400
group by 1, 2, 3;
create unique index on analytics.mv_meal_adherence_daily (household_id, day, life_stage);

create materialized view analytics.mv_plan_completion as
select mp.id as meal_plan_id, mp.household_id, mp.kind, mp.start_date, mp.end_date,
       (mp.end_date - mp.start_date + 1)                                         as days,
       count(distinct a.day) filter (where a.logged > 0)                         as days_logged,
       sum(a.adhered) / nullif(sum(a.planned), 0)                                as adherence,
       (count(distinct a.day) filter (where a.logged > 0))::numeric / (mp.end_date - mp.start_date + 1) >= 0.7 as completed,
       coalesce(sum(a.adhered) / nullif(sum(a.planned), 0), 0) >= 0.6            as engaged_complete
from public.meal_plans mp
left join analytics.mv_meal_adherence_daily a
  on a.household_id = mp.household_id and a.day between mp.start_date and mp.end_date
where mp.end_date < current_date and mp.status in ('active','completed') and mp.parent_plan_id is null
group by mp.id;
create unique index on analytics.mv_plan_completion (meal_plan_id);

create materialized view analytics.mv_retention_weekly as
with cohort as (
  select user_id, date_trunc('week', min(occurred_at))::date as cohort_week
  from public.analytics_events where event = 'signup_completed' and user_id is not null group by user_id
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

create materialized view analytics.mv_food_acceptance_weekly as
with scored as (
  select dms.household_id, dms.family_member_id, date_trunc('week', dm.plan_date)::date as week, dms.acceptance
  from public.daily_meal_servings dms
  join public.daily_meals dm on dm.id = dms.daily_meal_id
  where dms.acceptance is not null
)
select sc.household_id, sc.family_member_id, sc.week,
       avg(array_position(enum_range(null::public.acceptance_score), sc.acceptance) - 1) as mean_acceptance,
       count(*) filter (where sc.acceptance >= '4_ate_some')                             as servings_accepted,
       count(*)                                                                          as servings_scored,
       (select count(*) from public.food_exposures fe
         where fe.family_member_id = sc.family_member_id
           and fe.exposed_on >= sc.week and fe.exposed_on < sc.week + 7)                  as exposures
from scored sc
group by sc.household_id, sc.family_member_id, sc.week;
create unique index on analytics.mv_food_acceptance_weekly (family_member_id, week);

create materialized view analytics.mv_hydration_daily as
select hl.household_id, hl.family_member_id,
       (hl.logged_at at time zone h.timezone)::date                                   as day,
       sum(case when hl.beverage = 'tea' then hl.volume_ml * 0.8 else hl.volume_ml end) as volume_ml,
       max(ht.daily_ml)                                                               as target_ml,
       count(*) filter (where hl.timing = 'pre_meal')                                 as pre_meal_logs
from public.hydration_logs hl
join public.households h on h.id = hl.household_id
join public.hydration_targets ht on ht.family_member_id = hl.family_member_id and ht.daily_ml > 0 and ht.deleted_at is null
where hl.logged_at >= now() - interval '400 days'
group by 1, 2, 3;
create unique index on analytics.mv_hydration_daily (family_member_id, day);

create materialized view analytics.mv_growth_coverage_monthly as
select date_trunc('month', current_date)::date as month, fm.household_id,
       count(*) as children,
       count(*) filter (where g.last_measured_on >= current_date - (case
           when age(current_date, fm.date_of_birth) < interval '1 year'  then 31
           when age(current_date, fm.date_of_birth) < interval '2 years' then 62
           when age(current_date, fm.date_of_birth) < interval '5 years' then 92
           else 183 end)) as covered
from public.family_members fm
left join lateral (select max(gt.measured_on) as last_measured_on from public.growth_tracking gt
                   where gt.family_member_id = fm.id) g on true
where fm.deleted_at is null and fm.date_of_birth > current_date - interval '18 years'
group by fm.household_id;
create unique index on analytics.mv_growth_coverage_monthly (month, household_id);

create materialized view analytics.mv_paywall_funnel_daily as
select (v.occurred_at at time zone 'UTC')::date     as day,
       coalesce(v.props ->> 'trigger', 'unknown')    as trigger,
       coalesce(v.country_code, 'ZZ')                as country_code,
       count(distinct v.session_id)                  as views,
       count(distinct p.session_id)                  as purchases
from public.analytics_events v
left join public.analytics_events p
  on p.session_id = v.session_id and p.event = 'paywall_purchase_succeeded'
 and p.occurred_at between v.occurred_at and v.occurred_at + interval '30 minutes'
where v.event = 'paywall_viewed' and v.occurred_at >= now() - interval '400 days'
group by 1, 2, 3;
create unique index on analytics.mv_paywall_funnel_daily (day, trigger, country_code);

create materialized view analytics.mv_family_weekly_summary as
with weekly as (
  select a.household_id, date_trunc('week', a.day)::date as week,
         sum(a.adhered) / nullif(sum(a.planned), 0) as meal_adherence
  from analytics.mv_meal_adherence_daily a
  group by a.household_id, date_trunc('week', a.day)
)
select w.household_id, w.week, w.meal_adherence,
       (select avg(least(1, h.volume_ml / nullif(h.target_ml, 0))) from analytics.mv_hydration_daily h
         where h.household_id = w.household_id and h.day >= w.week and h.day < w.week + 7) as hydration_ratio,
       (select avg(nj.thuluth_adherence) from public.nutrition_journal nj
         join public.family_members fm on fm.id = nj.family_member_id and fm.life_stage in ('adult','older_adult')
         where nj.household_id = w.household_id and nj.journal_date >= w.week and nj.journal_date < w.week + 7) as adult_thuluth_avg,
       (select count(*) from public.exposure_ladders el
         where el.household_id = w.household_id and el.status = 'completed' and el.deleted_at is null
           and el.updated_at >= w.week and el.updated_at < w.week + 7) as new_foods_accepted
from weekly w;
create unique index on analytics.mv_family_weekly_summary (household_id, week);

-- Addition: AI cost per day, route and tier (06 section 4.17 mv_ai_cost_daily) ---------------------------------------------------
create materialized view analytics.mv_ai_cost_daily as
select (a.created_at at time zone 'UTC')::date                         as day,
       a.route_key,
       case when public.has_premium(a.user_id) then 'premium' else 'free' end as tier,
       count(*)                                                         as calls,
       count(distinct a.user_id)                                        as users,
       sum(a.cost_usd_micros)                                           as cost_usd_micros
from public.ai_usage a
left join public.users u on u.id = a.user_id
where a.created_at >= now() - interval '400 days' and not coalesce(u.is_internal, false)
group by 1, 2, 3;
create unique index on analytics.mv_ai_cost_daily (day, route_key, tier);

revoke all on all tables in schema analytics from public, anon, authenticated;
grant select on all tables in schema analytics to service_role;

-- Non-personal monthly aggregates kept after raw events age out
create table analytics.metric_snapshots (
  id            uuid primary key default gen_random_uuid(),
  metric        text not null,
  period_start  date not null,
  period_end    date not null,
  dimensions    jsonb not null default '{}'::jsonb,   -- {"country_code":"PK","platform":"android"}; never user ids
  value         numeric not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (metric, period_start, dimensions),
  check (period_end >= period_start)
);
call private.attach_updated_at('analytics.metric_snapshots');
alter table analytics.metric_snapshots enable row level security;
create policy metric_snapshots_admin_read on analytics.metric_snapshots for select to authenticated
  using (public.is_admin());
grant select, insert, update, delete on analytics.metric_snapshots to service_role;

-- 24.4 refresh (see header) ------------------------------------------------------------------------------------------------------
create or replace function public.refresh_analytics_views(p_scope text default 'hourly')
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hourly constant text[] := array['mv_user_active_days','mv_dau','mv_paywall_funnel_daily','mv_ai_cost_daily'];
  -- dependency order: mv_retention_weekly reads mv_user_active_days; plan completion and the family summary read
  -- mv_meal_adherence_daily and mv_hydration_daily
  v_daily  constant text[] := array['mv_user_active_days','mv_dau','mv_meal_adherence_daily','mv_plan_completion',
                                    'mv_retention_weekly','mv_food_acceptance_weekly','mv_hydration_daily',
                                    'mv_growth_coverage_monthly','mv_paywall_funnel_daily','mv_family_weekly_summary',
                                    'mv_ai_cost_daily'];
  v_views  text[];
  v        text;
begin
  if p_scope not in ('hourly','daily') then
    raise exception 'VALIDATION_FAILED' using errcode = '22023', detail = json_build_object('field', 'scope')::text;
  end if;
  v_views := case p_scope when 'daily' then v_daily else v_hourly end;
  foreach v in array v_views loop
    execute format('refresh materialized view concurrently analytics.%I', v);
  end loop;
  return v_views;
end $$;

-- Addition: partition maintenance with names, for AnalyticsRollupResponse --------------------------------------------------------
create or replace function public.analytics_maintain_partitions()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_before text[]; v_after text[];
begin
  select coalesce(array_agg(c.relname::text), '{}') into v_before
    from pg_inherits i join pg_class c on c.oid = i.inhrelid where i.inhparent = 'public.analytics_events'::regclass;
  perform private.ensure_analytics_partitions(3);
  perform private.drop_old_analytics_partitions(13);
  select coalesce(array_agg(c.relname::text), '{}') into v_after
    from pg_inherits i join pg_class c on c.oid = i.inhrelid where i.inhparent = 'public.analytics_events'::regclass;
  return jsonb_build_object(
    'created',  to_jsonb(array(select x from unnest(v_after) x where not x = any (v_before) order by 1)),
    'detached', to_jsonb(array(select x from unnest(v_before) x where not x = any (v_after) order by 1)));
end $$;

revoke all on function public.refresh_analytics_views(text), public.analytics_maintain_partitions()
  from public, anon, authenticated;
grant execute on function public.refresh_analytics_views(text), public.analytics_maintain_partitions() to service_role;

-- 24.5 premium family insights (the only client path into schema analytics) ------------------------------------------------------
create or replace function public.get_family_insights(p_household uuid, p_weeks integer default 8)
returns setof analytics.mv_family_weekly_summary
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_household_member(p_household) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if not public.premium_for(p_household) then
    raise exception 'PREMIUM_REQUIRED' using errcode = 'P0001';
  end if;
  return query
    select s.* from analytics.mv_family_weekly_summary s
    where s.household_id = p_household
      and s.week >= date_trunc('week', current_date) - make_interval(weeks => p_weeks)
    order by s.week;
end $$;
revoke all on function public.get_family_insights(uuid, integer) from public, anon;
grant execute on function public.get_family_insights(uuid, integer) to authenticated, service_role;

-- Addition: admin read views (owner rights, admin-only rows; see header) ----------------------------------------------------------
create view public.v_admin_kpi_daily with (security_barrier = true) as
select d.day, d.country_code, d.dau, d.dau_ios, d.dau_android
from analytics.mv_dau d
where public.is_admin();

create view public.v_admin_retention_weekly with (security_barrier = true) as
select r.cohort_week, r.week_n, r.retained, r.cohort_size,
       round(r.retained::numeric / nullif(r.cohort_size, 0), 4) as retention_rate
from analytics.mv_retention_weekly r
where public.is_admin();

create view public.v_admin_plan_completion_weekly with (security_barrier = true) as
select date_trunc('week', p.end_date)::date                                  as week,
       p.kind,
       count(*)                                                              as plans,
       count(*) filter (where p.completed)                                   as completed,
       count(*) filter (where p.engaged_complete)                            as engaged_complete,
       round(avg(p.adherence), 4)                                            as mean_adherence
from analytics.mv_plan_completion p
where public.is_admin()
group by 1, 2;

create view public.v_admin_paywall_funnel_daily with (security_barrier = true) as
select f.day, f.trigger, f.country_code, f.views, f.purchases,
       round(f.purchases::numeric / nullif(f.views, 0), 4) as conversion
from analytics.mv_paywall_funnel_daily f
where public.is_admin();

create view public.v_admin_ai_cost_daily with (security_barrier = true) as
select c.day, c.route_key, c.tier, c.calls, c.users, c.cost_usd_micros
from analytics.mv_ai_cost_daily c
where public.is_admin();

create view public.v_admin_growth_coverage with (security_barrier = true) as
select g.month, count(*) as households, sum(g.children) as children, sum(g.covered) as covered,
       round(sum(g.covered)::numeric / nullif(sum(g.children), 0), 4) as coverage
from analytics.mv_growth_coverage_monthly g
where public.is_admin()
group by g.month;

revoke all on public.v_admin_kpi_daily, public.v_admin_retention_weekly, public.v_admin_plan_completion_weekly,
  public.v_admin_paywall_funnel_daily, public.v_admin_ai_cost_daily, public.v_admin_growth_coverage
  from anon, authenticated;
grant select on public.v_admin_kpi_daily, public.v_admin_retention_weekly, public.v_admin_plan_completion_weekly,
  public.v_admin_paywall_funnel_daily, public.v_admin_ai_cost_daily, public.v_admin_growth_coverage
  to authenticated, service_role;

-- 0014 cron (UTC) ---------------------------------------------------------------------------------------------------------------
select cron.schedule('analytics-rollup', '10 * * * *',
  $$select private.invoke_edge_function('analytics-rollup', '{"scope":"hourly"}'::jsonb)$$);
select cron.schedule('analytics-rollup-daily', '0 2 * * *',                 -- 07:00 PKT
  $$select private.invoke_edge_function('analytics-rollup', '{"scope":"daily"}'::jsonb)$$);
