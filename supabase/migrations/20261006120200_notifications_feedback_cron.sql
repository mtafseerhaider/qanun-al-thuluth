-- supabase/migrations/20261006120200_notifications_feedback_cron.sql
-- 05 ref: 0001 (part: pg_net), 0010 platform (part 3: notifications, notification_preferences),
--         0012 15.9 (handle_new_auth_user, full body), 0013 16.3.8 (part), 0014 17.3 to 17.5 (retention
--         helpers, invoke_edge_function, remaining cron jobs), 0016 (Realtime, part: notifications),
--         0026 (plan-generation-sweeper cron). Plus alpha_feedback (addition, S3-17 / S4-18). Sprint 4.
-- DDL verbatim from 05 sections 13.2, 13.3, 15.9, 16.3.8, 17.3 to 17.5 and 22.12 (26.5), except:
--   * Notification kinds: 01 (FR-NOT) and 02 name 06 section 4.15 as the canonical vocabulary, and 05's
--     13.3 list predates it. The check on notification_preferences.kind (and now also notifications.kind,
--     05: "same vocabulary") is the 06 list incl. trial_ending (17 section 17, 0023). Signup creates one
--     preference row per kind with 06's defaults (off: meal_reminder, meal_log_prompt, journal_prompt,
--     fasting_sunnah_reminder, marketing). Safety kinds growth_alert and allergy_warning cannot be
--     disabled (01 FR-NOT, check notification_preferences_safety_always_on).
--   * Addition: notification_preferences.settings jsonb (per-kind options: shopping weekday for
--     grocery_day (02 section "Shopping day"), reminder offsets, voluntary-fast choices for
--     fasting_sunnah_reminder). The dispatcher owns the keys; the database only checks it is an object.
--   * handle_new_auth_user keeps the Sprint 1 body (email, display name, locale, country, time zone, units)
--     and adds the preference rows (README note for S4). Existing users are back-filled once.
--   * invoke_edge_function sends the Vault cron_secret in both x-internal-secret (what _shared/auth.ts
--     requireInternal checks, 04 section 4.2) and x-cron-secret (05, 10). pg_net and Vault are looked up at
--     call time, and the function returns null with a warning when either is missing (plain-Postgres test
--     cluster, or an environment whose Vault secrets are not created yet). pg_net is created only when
--     available, like pgmq in Sprint 3.
--   * plan-generation-sweeper only calls the worker while some plan is generating (05 calls it every
--     minute unconditionally; the worker exits on an empty queue either way).
--   * Cron jobs whose target lands later are not scheduled here: analytics-rollup and exports-purge-expired
--     (S6 functions), ai-memories-expire (S5 table), account-delete-executor (S6).
--   * Addition: private.job_leases with acquire_job_lease / release_job_lease (service role) so
--     notifications-dispatch can hold its single-run lock across pooled PostgREST connections.
--   * Addition: alpha_feedback (closed alpha feedback from the mobile outbox; S3-17 stub, S4-18 triage).
--     Users insert and read their own rows; triage (status) is service role only.

-- 0001 pg_net (HTTP from pg_cron to Edge Functions); optional, see header ---------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  else
    raise notice 'pg_net is not available: private.invoke_edge_function will skip calls';
  end if;
end $$;

-- Canonical notification kinds (06 section 4.15) -----------------------------------------------------------
create or replace function public.notification_kinds()
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array['daily_plan','meal_reminder','hydration_reminder','meal_log_prompt','journal_prompt','grocery_day',
               'weekly_review','plan_ready','plan_failed','suhoor_reminder','iftar_reminder','fasting_sunnah_reminder',
               'growth_measure_due','growth_alert','allergy_warning','exposure_nudge','coaching_tip','invite_received',
               'invite_accepted','export_ready','trial_ending','billing_issue','marketing']::text[];
$$;
grant execute on function public.notification_kinds() to authenticated, service_role;

-- 13.2 notifications ---------------------------------------------------------------------------------------
create table public.notifications (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  household_id   uuid references public.households(id) on delete cascade,
  channel        public.notification_channel not null default 'push',
  kind           text not null check (kind = any (public.notification_kinds())),   -- same vocabulary as notification_preferences.kind
  title          text not null check (char_length(title) <= 120),
  body           text not null check (char_length(body) <= 500),
  data           jsonb not null default '{}'::jsonb,   -- {"deeplink":"thuluth://today","family_member_id":"..."}
  scheduled_for  timestamptz not null default now(),
  sent_at        timestamptz,
  read_at        timestamptz,
  onesignal_id   text,
  status         text not null default 'pending' check (status in ('pending','sent','failed','cancelled')),  -- Addition
  dedupe_key     text,                     -- Addition: e.g. 'hydration:<member>:2026-10-06T12:30'
  attempts       smallint not null default 0,  -- Addition
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index notifications_due_idx on public.notifications (scheduled_for) where status = 'pending';
create index notifications_user_inbox_idx on public.notifications (user_id, created_at desc) where channel = 'in_app';
create unique index notifications_dedupe_key on public.notifications (user_id, dedupe_key) where dedupe_key is not null;
create index notifications_household_idx on public.notifications (household_id) where household_id is not null;   -- FK index

-- 13.3 notification_preferences -----------------------------------------------------------------------------
create table public.notification_preferences (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  kind         text not null constraint notification_preferences_kind_check check (kind = any (public.notification_kinds())),
  enabled      boolean not null default true,
  quiet_hours  jsonb not null default '{}'::jsonb,   -- {"start":"22:00","end":"06:30","tz":"Asia/Karachi"}
  settings     jsonb not null default '{}'::jsonb,   -- Addition: per-kind options, e.g. {"weekday":"sun"} for grocery_day
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, kind),
  check (jsonb_typeof(quiet_hours) = 'object'),
  check (jsonb_typeof(settings) = 'object'),
  constraint notification_preferences_safety_always_on check (enabled or kind not in ('growth_alert','allergy_warning'))
);

-- Default enabled state per kind (06 section 4.15)
create or replace function public.notification_default_enabled(p_kind text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_kind not in ('meal_reminder','meal_log_prompt','journal_prompt','fasting_sunnah_reminder','marketing');
$$;
grant execute on function public.notification_default_enabled(text) to authenticated, service_role;

-- Addition: alpha_feedback ------------------------------------------------------------------------------------
create table public.alpha_feedback (
  id                 uuid primary key default gen_random_uuid(),   -- client-generated (outbox idempotency key)
  user_id            uuid not null default auth.uid() references public.users(id) on delete cascade,
  household_id       uuid references public.households(id) on delete set null,
  category           text not null check (category in ('bug','idea','content','other')),
  message            text not null check (char_length(btrim(message)) between 1 and 2000),
  screen             text check (char_length(screen) <= 120),
  app_version        text not null check (char_length(app_version) between 1 and 40),
  platform           text check (platform in ('ios','android','web')),
  locale             text check (char_length(locale) <= 16),
  device_info        jsonb not null default '{}'::jsonb check (jsonb_typeof(device_info) = 'object'),
  client_created_at  timestamptz,
  status             text not null default 'new' check (status in ('new','triaged','planned','fixed','wont_fix','duplicate')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index alpha_feedback_user_idx on public.alpha_feedback (user_id, created_at desc);
create index alpha_feedback_household_idx on public.alpha_feedback (household_id) where household_id is not null;   -- FK index
create index alpha_feedback_triage_idx on public.alpha_feedback (status, created_at desc);

-- 15.1 updated_at ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['notifications','notification_preferences','alpha_feedback'] loop
    call private.attach_updated_at(('public.' || t)::regclass);
  end loop;
end $$;

-- 15.9 auth.users -> public.users + default notification preferences ------------------------------------------
create or replace function private.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_meta    jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_tz      text  := nullif(v_meta ->> 'timezone', '');
  v_country text  := upper(nullif(trim(v_meta ->> 'country_code'), ''));
  v_locale  text  := lower(nullif(trim(v_meta ->> 'locale'), ''));
  v_units   text  := lower(nullif(trim(v_meta ->> 'units'), ''));
begin
  if v_tz is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = v_tz) then
    v_tz := 'Asia/Karachi';
  end if;
  if v_country !~ '^[A-Z]{2}$' then
    v_country := null;
  end if;
  if v_locale is null or v_locale not in ('en','ur','ar','fr','tr','ms','id','bn') then
    v_locale := 'en';
  end if;
  if v_units is null or v_units not in ('metric','imperial') then
    v_units := case when v_country = 'US' then 'imperial' else 'metric' end;
  end if;
  insert into public.users (id, email, display_name, locale, timezone, country_code, units)
  values (
    new.id,
    new.email,
    left(coalesce(nullif(v_meta ->> 'display_name',''), nullif(v_meta ->> 'full_name',''), nullif(v_meta ->> 'name',''), ''), 80),
    v_locale,
    v_tz,
    v_country,
    v_units
  )
  on conflict (id) do nothing;

  insert into public.notification_preferences (user_id, kind, enabled)
  select new.id, k, public.notification_default_enabled(k)
  from unnest(public.notification_kinds()) as k
  on conflict (user_id, kind) do nothing;
  return new;
end $$;

-- back-fill users created before Sprint 4
insert into public.notification_preferences (user_id, kind, enabled)
select u.id, k, public.notification_default_enabled(k)
from public.users u cross join unnest(public.notification_kinds()) as k
on conflict (user_id, kind) do nothing;

-- 16.3.8 RLS ----------------------------------------------------------------------------------------------------
alter table public.notifications enable row level security;
create policy notifications_select_own on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke insert, update, delete on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

alter table public.notification_preferences enable row level security;
create policy notification_preferences_own on public.notification_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.alpha_feedback enable row level security;
create policy alpha_feedback_select_own on public.alpha_feedback for select to authenticated
  using (user_id = auth.uid());
create policy alpha_feedback_insert_own on public.alpha_feedback for insert to authenticated
  with check (user_id = auth.uid() and (household_id is null or public.is_household_member(household_id)));
revoke insert, update, delete on public.alpha_feedback from authenticated;
grant insert (id, user_id, household_id, category, message, screen, app_version, platform, locale, device_info,
              client_created_at) on public.alpha_feedback to authenticated;

-- 0016 Realtime (10 section 7.3, part): in-app inbox ---------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;   -- plain Postgres only; Supabase creates it
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- 17.3 retention helpers --------------------------------------------------------------------------------------------
create or replace function private.purge_soft_deleted(p_days integer default 30)
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; v_total integer := 0; v_n integer;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'deleted_at' and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname not in ('users','households',        -- handled by account-delete
                            'recipes','meals')           -- may still be referenced by historical plans
  loop
    begin
      execute format('delete from public.%I where deleted_at < now() - make_interval(days => $1)', r.relname)
        using p_days;
      get diagnostics v_n = row_count;
      v_total := v_total + v_n;
    exception when foreign_key_violation then
      raise warning 'purge_soft_deleted: % skipped (%)', r.relname, sqlerrm;   -- surfaces in cron.job_run_details
    end;
  end loop;
  return v_total;
end $$;

create or replace function private.purge_audit_log(p_years integer default 3)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  perform set_config('app.retention_job', 'on', true);
  delete from public.audit_log where at < now() - make_interval(years => p_years);
  get diagnostics v_n = row_count;
  perform set_config('app.retention_job', 'off', true);
  return v_n;
end $$;

-- 17.4 Edge Function invoker for cron (secrets live in Supabase Vault, never in migrations) -------------------------
-- Vault secrets (created per environment by the vault-bootstrap CI step, locally by seed/local/000_local_vault.sql):
--   project_url  = https://<ref>.supabase.co
--   cron_secret  = random 32-byte hex; equals the functions' INTERNAL_CRON_SECRET
create or replace function private.invoke_edge_function(p_name text, p_body jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text; v_id bigint;
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    raise warning 'invoke_edge_function: pg_net or Vault not available, skipping %', p_name;
    return null;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_url using 'project_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_secret using 'cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'invoke_edge_function: vault secrets missing, skipping %', p_name;
    return null;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := $4)'
    into v_id
    using rtrim(v_url, '/') || '/functions/v1/' || p_name,
          coalesce(p_body, '{}'::jsonb),
          jsonb_build_object('Content-Type', 'application/json', 'x-internal-secret', v_secret, 'x-cron-secret', v_secret),
          15000;
  return v_id;
end $$;
revoke all on function private.invoke_edge_function(text, jsonb) from public;

-- Addition: single-run leases for cron Edge Functions (06 section 4.15 "only one run at a time"). A session
-- advisory lock does not survive PostgREST's pooled connections, so the lock is a row with an expiry.
-- Service role only; the table lives in private (not exposed through PostgREST).
create table private.job_leases (
  name        text primary key check (char_length(name) between 1 and 80),
  holder      uuid not null,
  expires_at  timestamptz not null,
  acquired_at timestamptz not null default now()
);

create or replace function public.acquire_job_lease(p_name text, p_holder uuid, p_ttl_seconds integer default 55)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_ok boolean;
begin
  if p_ttl_seconds is null or p_ttl_seconds not between 1 and 3600 then
    raise exception 'INVALID_TTL' using errcode = '22023', detail = coalesce(p_ttl_seconds::text, 'null');
  end if;
  insert into private.job_leases as l (name, holder, expires_at)
  values (p_name, p_holder, now() + make_interval(secs => p_ttl_seconds))
  on conflict (name) do update
    set holder = excluded.holder, expires_at = excluded.expires_at, acquired_at = now()
    where l.expires_at < now() or l.holder = excluded.holder
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

create or replace function public.release_job_lease(p_name text, p_holder uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.job_leases where name = p_name and holder = p_holder;
$$;
revoke all on function public.acquire_job_lease(text, uuid, integer), public.release_job_lease(text, uuid)
  from public, anon, authenticated;
grant execute on function public.acquire_job_lease(text, uuid, integer), public.release_job_lease(text, uuid) to service_role;

-- 17.5 / 26.5 pg_cron schedule (UTC; Pakistan Standard Time is UTC+5), 10 section 8 ------------------------------------
select cron.schedule('notifications-dispatch', '* * * * *',
  $$select private.invoke_edge_function('notifications-dispatch', jsonb_build_object('triggered_at', now()))$$);
select cron.schedule('prices-refresh', '15 0 * * *',                       -- 05:15 PKT
  $$select private.invoke_edge_function('prices-refresh')$$);
select cron.schedule('plan-generation-sweeper', '* * * * *',               -- crash recovery for the plan_generation queue
  $$select private.invoke_edge_function('ai-generate-plan/worker')
    where exists (select 1 from public.meal_plans where status = 'generating' and deleted_at is null)$$);
select cron.schedule('soft-delete-purge', '40 19 * * *',                   -- 00:40 PKT
  $$select private.purge_soft_deleted(30)$$);
select cron.schedule('notifications-retention', '0 20 * * 0',              -- Sun 01:00 PKT
  $$delete from public.notifications where status in ('sent','cancelled','failed') and created_at < now() - interval '180 days'$$);
select cron.schedule('ai-usage-retention', '0 21 2 * *',
  $$delete from public.ai_usage where created_at < now() - interval '25 months'$$);
select cron.schedule('audit-retention', '0 22 3 * *',
  $$select private.purge_audit_log(3)$$);
select cron.schedule('cron-history-retention', '0 23 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '14 days'$$);
