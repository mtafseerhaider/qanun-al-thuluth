-- supabase/migrations/20261001001400_analytics_cron.sql
-- 0014 Analytics partitions and cron (05-database-schema.md section 17), Sprint 0 subset (S0-13):
--   17.1 analytics_events monthly partitions (verbatim) and their two pg_cron jobs.
-- Deferred: materialized views (mv_ingredient_prices needs the food catalog; the analytics
-- views are superseded by schema "analytics" in 0024), retention helpers, the Edge Function
-- invoker (needs pg_net + Vault secrets) and the remaining cron jobs. See migrations/README.md.

-- 17.1 analytics_events monthly partitions -----------------------------------------------
create or replace function private.ensure_analytics_partitions(p_months_ahead integer default 3)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_start date; v_end date; v_name text; v_created integer := 0;
begin
  for i in 0..p_months_ahead loop
    v_start := (date_trunc('month', now() at time zone 'UTC') + make_interval(months => i))::date;
    v_end   := (v_start + interval '1 month')::date;
    v_name  := format('analytics_events_y%sm%s', to_char(v_start, 'YYYY'), to_char(v_start, 'MM'));
    if to_regclass('public.' || v_name) is null then
      execute format(
        'create table public.%I partition of public.analytics_events for values from (%L) to (%L)',
        v_name, v_start::timestamptz, v_end::timestamptz);
      -- partitions are reachable directly by name; lock them down (parent RLS does not apply to direct access)
      execute format('alter table public.%I enable row level security', v_name);
      execute format('revoke all on table public.%I from anon, authenticated', v_name);
      v_created := v_created + 1;
    end if;
  end loop;
  return v_created;
end $$;

create or replace function private.drop_old_analytics_partitions(p_keep_months integer default 13)
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; v_month date; v_dropped integer := 0;
begin
  for r in
    select c.relname
    from pg_inherits i join pg_class c on c.oid = i.inhrelid
    where i.inhparent = 'public.analytics_events'::regclass
      and c.relname ~ '^analytics_events_y\d{4}m\d{2}$'
  loop
    v_month := to_date(regexp_replace(r.relname, '^analytics_events_y(\d{4})m(\d{2})$', '\1\2'), 'YYYYMM');
    if v_month < (date_trunc('month', now()) - make_interval(months => p_keep_months))::date then
      execute format('drop table public.%I', r.relname);
      v_dropped := v_dropped + 1;
    end if;
  end loop;
  return v_dropped;
end $$;

alter table public.analytics_events_default enable row level security;
revoke all on table public.analytics_events_default from anon, authenticated;
select private.ensure_analytics_partitions(3);

-- 17.5 pg_cron schedule (UTC), Sprint 0 subset: partition maintenance only.
select cron.schedule('analytics-partitions', '0 3 20 * *',
  $$select private.ensure_analytics_partitions(3)$$);
select cron.schedule('analytics-retention', '30 3 1 * *',
  $$select private.drop_old_analytics_partitions(13)$$);
