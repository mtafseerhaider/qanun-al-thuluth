-- supabase/migrations/20261006150000_analytics_ingestion.sql
-- 05 ref: 0024 analytics (part: 24.2 event catalog and ingestion RPCs). Sprint 7: S7-12 (the Sprint 6 leftover).
-- DDL from 05 section 22.10 24.2 and 18 section 10, except:
--   * Catalog rows are not in this file. They are generated from packages/shared/src/analytics/events.ts by
--     tooling/scripts/gen-analytics-catalog.ts into supabase/seed/catalog/170_analytics_event_catalog.sql
--     (idempotent upsert), so adding an event needs no migration. `owner = 'app'` marks generated rows.
--   * track_events hardening beyond 05: malformed event_id / session_id / household_id / occurred_at values are
--     treated as missing instead of failing the whole batch (private.try_uuid, private.try_timestamptz); the
--     18 section 10 limit of 600 accepted events per user per hour (consume_rate_limit, key 'track_events:<uid>');
--     x-platform is kept only for ios/android/web ('server' is reserved for Edge Functions); the count returned is
--     the number of events accepted (catalogued, allowed by the rate limit), including duplicates ignored by
--     ON CONFLICT, so a client that retries a batch sees the same number.
--   * The Sprint 0 direct-insert policy (analytics_events_insert_own) stays so app builds that predate the RPC keep
--     working. Revoke it in a later migration once app.min_supported_version is at or above the first build that
--     calls track_events (docs/ops/analytics-launch-dashboard.md, "Client migration").
--   * Addition: public.ops_health() for the health Edge Function (S7-06 status checks), service role only.

-- 24.2 catalog -------------------------------------------------------------------------------------------------------------
create table public.analytics_event_catalog (
  id             uuid primary key default gen_random_uuid(),
  event          text not null unique check (event ~ '^[a-z][a-z0-9_.]{2,63}$'),
  allowed_props  text[] not null default '{}',
  enabled        boolean not null default true,
  owner          text,
  added_in       text,              -- app version
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
call private.attach_updated_at('public.analytics_event_catalog');
call private.apply_catalog_rls('public.analytics_event_catalog');

-- lenient casts (null on bad input) ---------------------------------------------------------------------------------------
create or replace function private.try_uuid(p text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case when p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p::uuid end;
$$;

create or replace function private.try_timestamptz(p text)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  return p::timestamptz;
exception when others then
  return null;
end $$;

-- keeps allowlisted keys with scalar values; strings truncated to 40 characters (05 24.2 verbatim)
create or replace function public.analytics_filter_props(p_event text, p_props jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(p.key,
           case when jsonb_typeof(p.value) = 'string' then to_jsonb(left(p.value #>> '{}', 40)) else p.value end), '{}'::jsonb)
  from jsonb_each(case when jsonb_typeof(p_props) = 'object' then p_props else '{}'::jsonb end) as p
  join public.analytics_event_catalog c on c.event = p_event and p.key = any (c.allowed_props)
  where jsonb_typeof(p.value) in ('string','number','boolean');
$$;

create or replace function public.track_events(p_events jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  e          jsonb;
  n          integer := 0;
  v_user     public.users;
  v_headers  jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_platform text;
  v_version  text;
  v_hh       uuid;
  v_at       timestamptz;
  v_allowed  boolean;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 50 then
    raise exception 'TOO_MANY_EVENTS' using errcode = '22023',
      detail = json_build_object('max', 50)::text;
  end if;
  select * into v_user from public.users u where u.id = auth.uid() and u.deleted_at is null;
  if not found or v_user.analytics_opt_out or v_user.processing_restricted then
    return 0;
  end if;
  v_platform := case when v_headers ->> 'x-platform' in ('ios','android','web') then v_headers ->> 'x-platform' end;
  v_version  := left(v_headers ->> 'x-app-version', 32);

  for e in select value from jsonb_array_elements(p_events) loop
    continue when jsonb_typeof(e) <> 'object';
    continue when not exists (select 1 from public.analytics_event_catalog c where c.event = e ->> 'event' and c.enabled);
    v_hh := private.try_uuid(e ->> 'household_id');
    continue when v_hh is not null and not public.is_household_member(v_hh);
    select r.allowed into v_allowed
      from public.consume_rate_limit('track_events:' || v_user.id::text, 600, 3600) r;
    exit when not v_allowed;
    v_at := least(greatest(coalesce(private.try_timestamptz(e ->> 'occurred_at'), now()), now() - interval '7 days'), now());
    insert into public.analytics_events (event_id, user_id, household_id, session_id, event, props, occurred_at,
                                         app_version, platform, locale, country_code)
    values (coalesce(private.try_uuid(e ->> 'event_id'), gen_random_uuid()), v_user.id, v_hh,
            private.try_uuid(e ->> 'session_id'), e ->> 'event',
            public.analytics_filter_props(e ->> 'event', coalesce(e -> 'props', '{}'::jsonb)),
            v_at, v_version, v_platform, v_user.locale, v_user.country_code)
    on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.track_events(jsonb) from public, anon;
grant execute on function public.track_events(jsonb) to authenticated, service_role;
revoke all on function public.analytics_filter_props(text, jsonb) from public, anon, authenticated;
grant execute on function public.analytics_filter_props(text, jsonb) to service_role;
revoke all on function private.try_uuid(text), private.try_timestamptz(text) from public, anon, authenticated;

-- Addition: ops_health() for the health Edge Function -----------------------------------------------------------------------
-- Coarse, non-personal signals only. cron_failures_1h reads cron.job_run_details when pg_cron is present.
create or replace function public.ops_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_maintenance boolean;
  v_flags       integer;
  v_cron_failed integer := null;
  v_stale_push  integer;
begin
  select count(*) into v_flags from public.feature_flags;
  select coalesce(bool_or(f.enabled), false) into v_maintenance from public.feature_flags f where f.key = 'app.maintenance';
  select count(*) into v_stale_push from public.notifications n
   where n.status = 'pending' and n.channel = 'push' and n.scheduled_for < now() - interval '10 minutes';
  if to_regclass('cron.job_run_details') is not null then
    execute $q$select count(*)::int from cron.job_run_details
               where status = 'failed' and start_time > now() - interval '1 hour'$q$ into v_cron_failed;
  end if;
  return jsonb_build_object('feature_flags', v_flags, 'maintenance', v_maintenance,
                            'stale_pushes', v_stale_push, 'cron_failures_1h', v_cron_failed);
end $$;
revoke all on function public.ops_health() from public, anon, authenticated;
grant execute on function public.ops_health() to service_role;
