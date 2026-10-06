-- supabase/migrations/20261006140100_account_rights_ai_jobs.sql
-- 05 ref: 0018b (ai_jobs), 0022d (data_subject_requests, deleted_user_ledger, erasure executor and
--         account-delete-executor cron), 17 section 10.3 (12-month AI memory deletion after downgrade). Sprint 6: S6-10
--         (DB side) and Sprint 5 leftovers.
-- DDL verbatim from 05 sections 22.4 (18.1) and 22.8 (22.2, 22.6), except:
--   * Grace period (S6-01 contract, FR-SET-05): 30 days, not 06's 7. Immediate deletion only with reason 'under_age'
--     (age gate declined, 11 section 13.1).
--   * Additions on users: deletion_requested_at, deletion_reason (06 AccountDeleteReason). Clients read them on their
--     own row (users_select policy) but cannot write them; only the service-role RPCs below do.
--   * data_subject_requests.status adds 'cancelled' (a user cancelling inside the grace period).
--   * Addition: service-role RPCs used by account-delete and account-export (06 sections 4.12, 4.13):
--       account_deletion_blockers(user)          -> {blocked, households}: owned households with other live members
--       request_account_deletion(user, reason, immediate) -> scheduled_for; raises ACCOUNT_DELETION_PENDING,
--                                                  OWNERSHIP_TRANSFER_REQUIRED, VALIDATION_FAILED (P0001)
--       cancel_account_deletion(user)            -> true; raises ACCOUNT_DELETION_NOT_PENDING
--       execute_account_erasure(user)            -> {deleted_household_ids, left_household_ids, storage_prefixes}:
--                                                  hard-deletes the user's sole-owner households (all household
--                                                  rows cascade), removes their other memberships, deletes their
--                                                  analytics_events, writes deleted_user_ledger and an 'erasure'
--                                                  audit tombstone. auth.users is deleted afterwards by the Edge
--                                                  Function (auth.admin.deleteUser), which cascades public.users and
--                                                  every user-keyed row; storage objects are removed through the
--                                                  Storage API from the returned prefixes (10 section 6.3).
--       account_export_user_data(user)           -> jsonb of the user's own non-household rows for the zip.
--     Hashes (ledger, DSR email) are sha256 salted with the Vault secret audit_ip_salt when Vault is present.
--   * account-delete-executor fires only while a deletion is due (05 22.6 body).
--   * 17 section 10.3: households record premium_lapsed_at; ai_memory_notice_at is set 11 months after the lapse
--     (the notice itself is sent by notifications-dispatch, which reads households.ai_memory_notice_at) and the
--     household's memories are hard-deleted at 12 months, never sooner than 30 days after the notice. Re-subscribing
--     clears both. Cron ai-memories-lapsed (daily).
--   * ai_jobs (0018b) verbatim, plus FK indexes. Cron ai-reassess (AI lane, S6-15) daily.

-- users: deletion request details ---------------------------------------------------------------------------------------
alter table public.users
  add column deletion_requested_at timestamptz,
  add column deletion_reason       text check (deletion_reason in ('privacy','not_useful','too_expensive','other','under_age'));

-- 22.2 data_subject_requests and deleted_user_ledger -------------------------------------------------------------------------
create table public.data_subject_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.users(id) on delete set null,
  email_hash    text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  kind          text not null check (kind in ('access','portability','rectification','erasure','restriction','objection','withdraw_consent')),
  status        text not null default 'received' check (status in ('received','in_progress','completed','rejected','cancelled')),
  received_at   timestamptz not null default now(),
  due_at        timestamptz not null default now() + interval '30 days',
  completed_at  timestamptz,
  handled_by    uuid references public.users(id) on delete set null,
  notes         text check (char_length(notes) <= 4000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (status <> 'completed' or completed_at is not null)
);
create index data_subject_requests_open_idx on public.data_subject_requests (due_at) where status in ('received','in_progress');
create index data_subject_requests_user_idx on public.data_subject_requests (user_id) where user_id is not null;
create index data_subject_requests_handled_by_idx on public.data_subject_requests (handled_by) where handled_by is not null;  -- FK index
call private.attach_updated_at('public.data_subject_requests');
call private.attach_audit('public.data_subject_requests', 'full');
alter table public.data_subject_requests enable row level security;
create policy data_subject_requests_select_own on public.data_subject_requests for select to authenticated
  using (user_id = auth.uid());
create policy data_subject_requests_admin on public.data_subject_requests for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create table public.deleted_user_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id_hash  text not null unique check (user_id_hash ~ '^[0-9a-f]{64}$'),
  email_hash    text check (email_hash ~ '^[0-9a-f]{64}$'),
  erased_at     timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
call private.attach_updated_at('public.deleted_user_ledger');
alter table public.deleted_user_ledger enable row level security;
revoke all on public.deleted_user_ledger from authenticated;
create policy deleted_user_ledger_admin_read on public.deleted_user_ledger for select to authenticated
  using (public.is_admin());

-- Salted hash helper (Vault audit_ip_salt when available) --------------------------------------------------------------------
create or replace function private.privacy_hash(p_value text)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_salt text;
begin
  if to_regclass('vault.decrypted_secrets') is not null then
    execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_salt using 'audit_ip_salt';
  end if;
  return encode(extensions.digest(coalesce(p_value, '') || coalesce(v_salt, ''), 'sha256'), 'hex');
end $$;
revoke all on function private.privacy_hash(text) from public;

-- Account deletion RPCs (service role only) ----------------------------------------------------------------------------------
create or replace function public.account_deletion_blockers(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'blocked', count(*) > 0,
    'households', coalesce(jsonb_agg(h.id order by h.created_at), '[]'::jsonb))
  from public.households h
  where h.owner_user_id = p_user_id and h.deleted_at is null
    and exists (select 1 from public.household_members hm
                 where hm.household_id = h.id and hm.user_id <> p_user_id and hm.deleted_at is null);
$$;

create or replace function public.request_account_deletion(p_user_id uuid, p_reason text default null,
                                                           p_immediate boolean default false)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare v_user public.users; v_blockers jsonb; v_due timestamptz;
begin
  select * into v_user from public.users u where u.id = p_user_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_user.deletion_scheduled_for is not null then
    raise exception 'ACCOUNT_DELETION_PENDING' using errcode = 'P0001',
      detail = json_build_object('scheduled_for', v_user.deletion_scheduled_for)::text;
  end if;
  if p_reason is not null and p_reason not in ('privacy','not_useful','too_expensive','other','under_age') then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001', detail = json_build_object('field', 'reason')::text;
  end if;
  if coalesce(p_immediate, false) and p_reason is distinct from 'under_age' then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001',
      detail = json_build_object('field', 'immediate', 'rule', 'only_under_age_skips_grace')::text;
  end if;
  v_blockers := public.account_deletion_blockers(p_user_id);
  if (v_blockers ->> 'blocked')::boolean then
    raise exception 'OWNERSHIP_TRANSFER_REQUIRED' using errcode = 'P0001', detail = v_blockers::text;
  end if;

  v_due := case when coalesce(p_immediate, false) then now() else now() + interval '30 days' end;
  update public.users
     set deletion_scheduled_for = v_due, deletion_requested_at = now(), deletion_reason = p_reason
   where id = p_user_id;
  insert into public.data_subject_requests (user_id, email_hash, kind, status, due_at, notes)
  values (p_user_id, private.privacy_hash(lower(coalesce(v_user.email::text, p_user_id::text))), 'erasure', 'received',
          v_due, 'account-delete request' || coalesce(' (' || p_reason || ')', ''));
  insert into public.audit_log (actor_user_id, action, entity, entity_id, diff, ip_hash)
  values (p_user_id, 'erasure', 'users', p_user_id,
          jsonb_build_object('stage', 'requested', 'scheduled_for', v_due, 'reason', p_reason),
          private.request_ip_hash());
  return v_due;
end $$;

create or replace function public.cancel_account_deletion(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_due timestamptz;
begin
  select u.deletion_scheduled_for into v_due from public.users u where u.id = p_user_id for update;
  if v_due is null then
    raise exception 'ACCOUNT_DELETION_NOT_PENDING' using errcode = 'P0001';
  end if;
  if v_due <= now() then
    raise exception 'ACCOUNT_DELETION_IN_PROGRESS' using errcode = 'P0001',
      detail = json_build_object('scheduled_for', v_due)::text;
  end if;
  update public.users
     set deletion_scheduled_for = null, deletion_requested_at = null, deletion_reason = null
   where id = p_user_id;
  update public.data_subject_requests
     set status = 'cancelled', notes = coalesce(notes || '; ', '') || 'cancelled by the user within the grace period'
   where user_id = p_user_id and kind = 'erasure' and status in ('received','in_progress');
  insert into public.audit_log (actor_user_id, action, entity, entity_id, diff, ip_hash)
  values (p_user_id, 'erasure', 'users', p_user_id, jsonb_build_object('stage', 'cancelled'), private.request_ip_hash());
  return true;
end $$;

create or replace function public.execute_account_erasure(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user      public.users;
  v_blockers  jsonb;
  v_owned     uuid[];
  v_left      uuid[];
  v_prefixes  jsonb := '[]'::jsonb;
  v_events    bigint;
  v_hh        uuid;
  b           text;
begin
  select * into v_user from public.users u where u.id = p_user_id for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_user.deletion_scheduled_for is null or v_user.deletion_scheduled_for > now() then
    raise exception 'ACCOUNT_DELETION_NOT_DUE' using errcode = 'P0001',
      detail = json_build_object('scheduled_for', v_user.deletion_scheduled_for)::text;
  end if;
  v_blockers := public.account_deletion_blockers(p_user_id);
  if (v_blockers ->> 'blocked')::boolean then
    raise exception 'OWNERSHIP_TRANSFER_REQUIRED' using errcode = 'P0001', detail = v_blockers::text;
  end if;

  select coalesce(array_agg(h.id order by h.id), '{}') into v_owned
    from public.households h where h.owner_user_id = p_user_id;
  select coalesce(array_agg(distinct hm.household_id), '{}') into v_left
    from public.household_members hm
   where hm.user_id = p_user_id and not (hm.household_id = any (v_owned));

  -- storage prefixes to remove through the Storage API (10 section 6.3)
  foreach v_hh in array v_owned loop
    foreach b in array array['avatars','meal-photos','chat-attachments','voice-notes','exports'] loop
      v_prefixes := v_prefixes || jsonb_build_object('bucket', b, 'prefix', v_hh::text || '/');
    end loop;
  end loop;
  v_prefixes := v_prefixes
    || jsonb_build_object('bucket', 'avatars', 'prefix', 'users/' || p_user_id::text || '/')
    || jsonb_build_object('bucket', 'exports', 'prefix', 'account/' || p_user_id::text || '/');
  select v_prefixes || coalesce(jsonb_agg(jsonb_build_object('bucket', 'chat-attachments',
                                                             'prefix', s.household_id::text || '/' || s.id::text || '/')), '[]'::jsonb)
    into v_prefixes
    from public.chat_sessions s where s.user_id = p_user_id and s.household_id = any (v_left);

  perform set_config('app.allow_owner_change', 'on', true);
  delete from public.households h where h.id = any (v_owned);             -- every household row cascades
  delete from public.household_members hm where hm.user_id = p_user_id;    -- memberships elsewhere
  perform set_config('app.allow_owner_change', 'off', true);
  delete from public.analytics_events ae where ae.user_id = p_user_id;     -- no FK cascade (05 13.8 note)
  get diagnostics v_events = row_count;

  insert into public.deleted_user_ledger (user_id_hash, email_hash)
  values (private.privacy_hash(p_user_id::text),
          case when v_user.email is not null then private.privacy_hash(lower(v_user.email::text)) end)
  on conflict (user_id_hash) do update set erased_at = now();
  update public.data_subject_requests
     set status = 'completed', completed_at = now()
   where user_id = p_user_id and kind = 'erasure' and status in ('received','in_progress');
  insert into public.audit_log (actor_user_id, action, entity, entity_id, diff)
  values (null, 'erasure', 'users', null,
          jsonb_build_object('stage', 'executed', 'households_deleted', cardinality(v_owned),
                             'households_left', cardinality(v_left), 'analytics_events_deleted', v_events));

  return jsonb_build_object(
    'deleted_household_ids', to_jsonb(v_owned),
    'left_household_ids', to_jsonb(v_left),
    'storage_prefixes', v_prefixes);
end $$;

-- The user's own non-household rows for account-export (household tables are read under the user's RLS) -------------------
create or replace function public.account_export_user_data(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out    jsonb;
  v_rows   jsonb;
  v_redact constant text[] := array['raw_event','token_hash','embedding','onesignal_subscription_id','ip_hash'];
  t        text;
begin
  select to_jsonb(u) into v_out from public.users u where u.id = p_user_id;
  if v_out is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  v_out := jsonb_build_object('user', v_out);
  foreach t in array array['household_members','consents','devices','notification_preferences','notifications',
                           'chat_sessions','ai_usage','alpha_feedback','subscriptions','promo_redemptions',
                           'data_subject_requests','source_reports','exports'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select coalesce(jsonb_agg(to_jsonb(x) - $2 order by x.created_at), ''[]''::jsonb) from public.%I x where x.user_id = $1', t)
        into v_rows using p_user_id, v_redact;
      v_out := v_out || jsonb_build_object(t, v_rows);
    end if;
  end loop;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at), '[]'::jsonb) into v_rows
    from public.chat_messages m join public.chat_sessions s on s.id = m.session_id
   where s.user_id = p_user_id;
  return v_out || jsonb_build_object('chat_messages', v_rows, 'exported_at', now());
end $$;

revoke all on function public.account_deletion_blockers(uuid), public.request_account_deletion(uuid, text, boolean),
  public.cancel_account_deletion(uuid), public.execute_account_erasure(uuid), public.account_export_user_data(uuid)
  from public, anon, authenticated;
grant execute on function public.account_deletion_blockers(uuid), public.request_account_deletion(uuid, text, boolean),
  public.cancel_account_deletion(uuid), public.execute_account_erasure(uuid), public.account_export_user_data(uuid)
  to service_role;

-- 18.1 ai_jobs (0018b) -------------------------------------------------------------------------------------------------------
create table public.ai_jobs (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  user_id       uuid references public.users(id) on delete set null,
  kind          text not null check (kind in ('plan_generate','plan_adjust','ramadan_generate','assessment')),
  subject_id    uuid,                                   -- meal_plans.id, ramadan_plans.id or ai_assessments.id
  status        text not null default 'queued'
                  check (status in ('queued','running','succeeded','failed','blocked_red_flag','cancelled')),
  stage         text not null default 's0_queued',
  attempts      integer not null default 0 check (attempts >= 0),
  state         jsonb not null default '{}'::jsonb,
  error         jsonb,
  request_id    uuid not null default gen_random_uuid(),
  heartbeat_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index ai_jobs_household_idx on public.ai_jobs (household_id, created_at desc);
create index ai_jobs_resume_idx on public.ai_jobs (status, heartbeat_at) where status in ('queued','running');
create index ai_jobs_subject_idx on public.ai_jobs (subject_id) where subject_id is not null;
create index ai_jobs_user_idx on public.ai_jobs (user_id) where user_id is not null;   -- FK index
call private.attach_updated_at('public.ai_jobs');
call private.apply_household_rls('public.ai_jobs', 'service');   -- members read; writes by service role only
revoke insert, update, delete on public.ai_jobs from authenticated;

-- 17 section 10.3: AI memories deleted after 12 months without premium, with notice ------------------------------------------
alter table public.households
  add column premium_lapsed_at   timestamptz,     -- set by ai_memory_retention while the household has no premium
  add column ai_memory_notice_at timestamptz;     -- notice due/sent (11 months); read by notifications-dispatch

create or replace function private.ai_memory_retention()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_noticed integer; v_deleted integer;
begin
  update public.households h
     set premium_lapsed_at = null, ai_memory_notice_at = null
   where h.premium_lapsed_at is not null and public.household_has_premium(h.id);
  update public.households h
     set premium_lapsed_at = now()
   where h.premium_lapsed_at is null and h.deleted_at is null
     and exists (select 1 from public.ai_memories m where m.household_id = h.id)
     and not public.household_has_premium(h.id);
  update public.households h
     set ai_memory_notice_at = now()
   where h.ai_memory_notice_at is null and h.premium_lapsed_at <= now() - interval '11 months'
     and exists (select 1 from public.ai_memories m where m.household_id = h.id);
  get diagnostics v_noticed = row_count;
  delete from public.ai_memories m
   using public.households h
   where h.id = m.household_id
     and h.premium_lapsed_at <= now() - interval '12 months'
     and h.ai_memory_notice_at <= now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('noticed', v_noticed, 'deleted', v_deleted);
end $$;
revoke all on function private.ai_memory_retention() from public;

-- Cron (UTC; PKT = UTC+5) -----------------------------------------------------------------------------------------------------
select cron.schedule('account-delete-executor', '0 * * * *',
  $$select private.invoke_edge_function('account-delete/execute') where exists (
      select 1 from public.users where deletion_scheduled_for <= now())$$);
select cron.schedule('ai-memories-lapsed', '35 19 * * *',                   -- 00:35 PKT
  $$select private.ai_memory_retention()$$);
select cron.schedule('ai-reassess', '30 21 * * *',                          -- 02:30 PKT, S6-15
  $$select private.invoke_edge_function('ai-reassess')$$);
