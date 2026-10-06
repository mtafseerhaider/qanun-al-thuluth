-- supabase/migrations/20261006090000_identity_households_platform.sql
-- 05 ref: 0003 identity (part 2: household_invitations, family_members), 0008 (part: budget_profiles),
--         0010 platform (part 2: devices, consents, audit_log), 0011 (is_linked_member),
--         0012 triggers (part 2), 0013 RLS (part 2), 0014 cron (part 2). Sprint 1: S1-02, S1-03, S1-10.
--
-- DDL is verbatim from 05-database-schema.md except where a comment says otherwise. Deviations:
--   * Tier limit errors use the 06 section 2.3 / 04 / 16 / 17 contract `LIMIT_REACHED:<resource>`
--     (P0001) instead of 05's ENTITLEMENT_HOUSEHOLD_LIMIT / ENTITLEMENT_MEMBER_LIMIT, because
--     supabase/functions/_shared/errors.ts and the mobile client map that prefix. The household
--     trigger and transfer_household_ownership from 0012 are replaced accordingly.
--   * household_members: no client INSERT policy (06 section 3.1: insert only via household-invite,
--     which calls accept_household_invitation below as service role). 05 / 11 section 10.2 allowed the
--     owner to insert directly, which let an owner attach any user id to a household without consent.
--   * household_invitations: SELECT for owner and caregiver (06 section 3.1; caregivers may invite
--     viewers, 06 section 4.11). 05 had owner only. Writes stay owner-only as in 05.
--   * handle_new_auth_user (S1-03): also sets users.units ('imperial' for country US, Q-12 in 01) and
--     accepts every locale users.locale allows. notification_preferences rows from 05 15.9 arrive in S4.

-- 6.4 household_invitations ---------------------------------------------------------------------
create table public.household_invitations (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  email         extensions.citext not null,
  role          public.household_role not null check (role <> 'owner'),
  token_hash    text not null unique,      -- sha256 hex of the opaque token; raw token only in the email link
  invited_by    uuid not null references public.users(id) on delete cascade,
  expires_at    timestamptz not null default now() + interval '7 days',
  accepted_at   timestamptz,
  accepted_by   uuid references public.users(id) on delete set null,   -- Addition
  revoked_at    timestamptz,                                             -- Addition
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (expires_at > created_at)
);
create index household_invitations_household_idx on public.household_invitations (household_id);
create unique index household_invitations_one_pending
  on public.household_invitations (household_id, email)
  where accepted_at is null and revoked_at is null;
create index household_invitations_invited_by_idx on public.household_invitations (invited_by);   -- FK index (10 section 16 rule 3)

-- 6.5 family_members: a person being planned for (may have no app account) -----------------------
create table public.family_members (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households(id) on delete cascade,
  linked_user_id   uuid references public.users(id) on delete set null,
  name             text not null check (char_length(name) between 1 and 60),
  date_of_birth    date check (date_of_birth > date '1900-01-01'),   -- "not in the future" enforced by trigger (CHECK must be immutable)
  sex_at_birth     public.sex_at_birth not null default 'unspecified',
  height_cm        numeric(5,1) check (height_cm between 30 and 260),
  weight_kg        numeric(5,2) check (weight_kg between 1 and 400),
  blood_group      public.blood_group not null default 'unknown',
  activity_level   public.activity_level not null default 'moderate',
  life_stage       public.life_stage not null default 'adult',   -- set by trigger from date_of_birth
  work_schedule    jsonb not null default '{}'::jsonb,           -- {"days":["mon",...],"start":"09:00","end":"17:00","shift":"day"}
  sleep_schedule   jsonb not null default '{}'::jsonb,           -- {"bed":"22:00","wake":"05:30","nap":"14:00-15:00"}
  special_modules  public.special_module[] not null default '{}',
  avatar_path      text,                                         -- bucket "avatars": {household_id}/members/{id}.webp
  sort_order       smallint not null default 0,                  -- Addition: display order
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  unique (id, household_id),
  check (jsonb_typeof(work_schedule) = 'object'),
  check (jsonb_typeof(sleep_schedule) = 'object')
);
create index family_members_household_idx on public.family_members (household_id, sort_order) where deleted_at is null;
create index family_members_linked_user_idx on public.family_members (linked_user_id) where linked_user_id is not null;
create index family_members_modules_gin on public.family_members using gin (special_modules);
create unique index family_members_one_link_per_household
  on public.family_members (household_id, linked_user_id) where linked_user_id is not null and deleted_at is null;

-- 11.1 budget_profiles (onboarding step 3 optional budget, S1-10) ---------------------------------
create table public.budget_profiles (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references public.households(id) on delete cascade,
  monthly_amount_minor  bigint not null check (monthly_amount_minor > 0),
  currency              char(3) not null check (currency ~ '^[A-Z]{3}$'),
  strictness            text not null default 'target' check (strictness in ('flexible','target','hard_cap')),
  category_split        jsonb not null default '{}'::jsonb,
                        -- {"staples":0.18,"protein_animal":0.30,"dairy":0.15,"produce_veg":0.12,...}; values sum to 1 +/- 0.02 (validated in Edge Function)
  is_active             boolean not null default true,     -- Addition: one active profile per household
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  unique (id, household_id),
  check (jsonb_typeof(category_split) = 'object')
);
create unique index budget_profiles_one_active on public.budget_profiles (household_id) where is_active and deleted_at is null;

-- 13.4 devices ------------------------------------------------------------------------------------
create table public.devices (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references public.users(id) on delete cascade,
  platform                   text not null check (platform in ('ios','android','web')),
  onesignal_subscription_id  text unique,
  app_version                text not null,
  last_seen_at               timestamptz not null default now(),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
create index devices_user_idx on public.devices (user_id, last_seen_at desc);

-- 13.5 consents (append-only history; withdrawal sets withdrawn_at) -------------------------------
create table public.consents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  household_id  uuid references public.households(id) on delete cascade,  -- Addition: scope for 'child_data'
  kind          text not null check (kind in ('terms','privacy','health_data','child_data','ai_processing','marketing')),
  version       text not null,           -- document version, e.g. '2026-09-01'
  granted_at    timestamptz not null default now(),
  withdrawn_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (withdrawn_at is null or withdrawn_at >= granted_at),
  check (kind <> 'child_data' or household_id is not null)
);
create index consents_user_kind_idx on public.consents (user_id, kind, granted_at desc);
create unique index consents_one_live on public.consents (user_id, kind, coalesce(household_id, '00000000-0000-0000-0000-000000000000'::uuid), version)
  where withdrawn_at is null;
create index consents_household_idx on public.consents (household_id) where household_id is not null;   -- FK index

-- 13.6 audit_log (append-only) ----------------------------------------------------------------------
create table public.audit_log (
  id             uuid primary key default gen_random_uuid(),
  actor_user_id  uuid references public.users(id) on delete set null,
  household_id   uuid references public.households(id) on delete set null,
  action         text not null check (action in ('insert','update','delete','soft_delete','restore','role_change','export','login','erasure')),
  entity         text not null,           -- table name
  entity_id      uuid,
  diff           jsonb not null default '{}'::jsonb,
  ip_hash        text,
  at             timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index audit_log_household_at_idx on public.audit_log (household_id, at desc);
create index audit_log_actor_at_idx on public.audit_log (actor_user_id, at desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);
create index audit_log_at_brin on public.audit_log using brin (at);

-- 14.1 is_linked_member (deferred from 0011: needs family_members) ---------------------------------
-- Addition: the caller is the linked app user of this family member (self-logging teen or adult)
create or replace function public.is_linked_member(p_family_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.family_members fm
    where fm.id = p_family_member_id
      and fm.linked_user_id = auth.uid()
      and fm.deleted_at is null
      and public.is_household_member(fm.household_id)
  );
$$;

-- 15.1 updated_at on the tables created here ----------------------------------------------------------
create trigger trg_household_invitations_updated_at before update on public.household_invitations
  for each row execute function public.set_updated_at();
create trigger trg_family_members_updated_at before update on public.family_members
  for each row execute function public.set_updated_at();
create trigger trg_budget_profiles_updated_at before update on public.budget_profiles
  for each row execute function public.set_updated_at();
create trigger trg_devices_updated_at before update on public.devices
  for each row execute function public.set_updated_at();
create trigger trg_consents_updated_at before update on public.consents
  for each row execute function public.set_updated_at();
create trigger trg_audit_log_updated_at before update on public.audit_log
  for each row execute function public.set_updated_at();

-- 15.3 family_members derived fields --------------------------------------------------------------------
create or replace function private.family_members_derive()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.date_of_birth is not null and new.date_of_birth > current_date then
    raise exception 'DOB_IN_FUTURE' using errcode = '22007';
  end if;
  new.life_stage := public.life_stage_for_dob(new.date_of_birth);
  if new.special_modules && array['pregnancy','breastfeeding']::public.special_module[]
     and (new.sex_at_birth = 'male' or new.life_stage in ('infant','toddler','child')) then
    raise exception 'MODULE_NOT_APPLICABLE' using errcode = '23514', detail = 'pregnancy/breastfeeding';
  end if;
  return new;
end $$;
-- life_stage is added to 05's column list so a client write to life_stage is re-derived, not stored
create trigger trg_family_members_derive
  before insert or update of date_of_birth, sex_at_birth, special_modules, life_stage on public.family_members
  for each row execute function private.family_members_derive();

-- nightly refresh for birthdays (scheduled below)
create or replace function private.refresh_life_stages()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  update public.family_members fm
     set life_stage = public.life_stage_for_dob(fm.date_of_birth)
   where fm.deleted_at is null
     and fm.date_of_birth is not null
     and fm.life_stage is distinct from public.life_stage_for_dob(fm.date_of_birth);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- 15.4 households.family_size -----------------------------------------------------------------------------
create or replace function private.family_size_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_household uuid := coalesce(new.household_id, old.household_id);
begin
  update public.households h
     set family_size = (select count(*) from public.family_members fm
                        where fm.household_id = v_household and fm.deleted_at is null)
   where h.id = v_household;
  return null;
end $$;
create trigger trg_family_members_family_size
  after insert or delete or update of deleted_at on public.family_members
  for each row execute function private.family_size_sync();

-- 15.6 entitlements (00-foundations section 8). Messages follow 06 section 2.3: LIMIT_REACHED:<resource>.
create or replace function private.enforce_household_entitlement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if coalesce(current_setting('app.bypass_entitlements', true), '') = 'on' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('households:' || new.owner_user_id::text, 0));
  select count(*) into v_count
    from public.households h
   where h.owner_user_id = new.owner_user_id and h.deleted_at is null and h.id <> new.id;
  if v_count >= 1 and not public.has_premium(new.owner_user_id) then
    raise exception 'LIMIT_REACHED:households' using errcode = 'P0001',
      detail = json_build_object('resource','households','tier','free','limit',1,'current',v_count)::text,
      hint = 'upgrade_required';
  end if;
  return new;
end $$;

create or replace function private.enforce_member_entitlement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_count integer; v_limit integer;
begin
  if coalesce(current_setting('app.bypass_entitlements', true), '') = 'on' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('family_members:' || new.household_id::text, 0));
  v_limit := case when public.household_has_premium(new.household_id) then 20 else 6 end;
  select count(*) into v_count
    from public.family_members fm
   where fm.household_id = new.household_id and fm.deleted_at is null and fm.id <> new.id;
  if v_count >= v_limit then
    raise exception 'LIMIT_REACHED:family_members' using errcode = 'P0001',
      detail = json_build_object('resource','family_members','limit',v_limit,'current',v_count)::text,
      hint = case when v_limit = 6 then 'upgrade_required' else 'hard_limit' end;
  end if;
  return new;
end $$;
create trigger trg_family_members_entitlement before insert on public.family_members
  for each row execute function private.enforce_member_entitlement();
create trigger trg_family_members_entitlement_restore before update of deleted_at on public.family_members
  for each row when (old.deleted_at is not null and new.deleted_at is null)
  execute function private.enforce_member_entitlement();

-- transfer_household_ownership (0012) with the LIMIT_REACHED message
create or replace function public.transfer_household_ownership(p_household_id uuid, p_new_owner uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old_owner uuid;
begin
  select owner_user_id into v_old_owner from public.households where id = p_household_id and deleted_at is null for update;
  if v_old_owner is null or v_old_owner <> auth.uid() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (select 1 from public.household_members where household_id = p_household_id
                 and user_id = p_new_owner and deleted_at is null and role in ('caregiver','viewer')) then
    raise exception 'NEW_OWNER_NOT_MEMBER' using errcode = '23514';
  end if;
  if exists (select 1 from public.households where owner_user_id = p_new_owner and deleted_at is null)
     and not public.has_premium(p_new_owner) then
    raise exception 'LIMIT_REACHED:households' using errcode = 'P0001', hint = 'new_owner_upgrade_required';
  end if;
  perform set_config('app.allow_owner_change', 'on', true);
  update public.household_members set role = 'caregiver'
   where household_id = p_household_id and user_id = v_old_owner and deleted_at is null;
  update public.household_members set role = 'owner'
   where household_id = p_household_id and user_id = p_new_owner and deleted_at is null;
  update public.households set owner_user_id = p_new_owner where id = p_household_id;
  perform set_config('app.allow_owner_change', 'off', true);
end $$;

-- Addition beyond 00-foundations: atomic invitation acceptance for the household-invite Edge Function
-- (S1-12). The function has already checked the token, the signed-in email and existing membership;
-- this locks the invitation, re-checks that it is still open, creates the membership and marks the
-- invitation accepted in one transaction, so two concurrent accepts cannot both succeed.
-- Service role only.
create or replace function public.accept_household_invitation(p_invitation_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_inv public.household_invitations;
begin
  select * into v_inv from public.household_invitations where id = p_invitation_id for update;
  if not found or v_inv.revoked_at is not null then
    raise exception 'INVITE_INVALID' using errcode = 'P0001';
  end if;
  if v_inv.accepted_at is not null then
    raise exception 'INVITE_ALREADY_ACCEPTED' using errcode = 'P0001';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'INVITE_EXPIRED' using errcode = 'P0001';
  end if;
  insert into public.household_members (household_id, user_id, role, invited_by)
  values (v_inv.household_id, p_user_id, v_inv.role, v_inv.invited_by);   -- 23505 if already a live member
  update public.household_invitations
     set accepted_at = now(), accepted_by = p_user_id
   where id = p_invitation_id;
end $$;
revoke all on function public.accept_household_invitation(uuid, uuid) from public, anon, authenticated;
grant execute on function public.accept_household_invitation(uuid, uuid) to service_role;

-- 15.8 audit ------------------------------------------------------------------------------------------------
create or replace function private.request_ip_hash()
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_ip text; v_salt text;
begin
  v_ip := split_part(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1);
  if v_ip = '' then
    return null;
  end if;
  select decrypted_secret into v_salt from vault.decrypted_secrets where name = 'audit_ip_salt';
  return encode(extensions.digest(trim(v_ip) || coalesce(v_salt, ''), 'sha256'), 'hex');
end $$;

-- tg_argv[0] = 'full' (store old/new values) or 'keys_only' (store changed column names only; used for health data)
create or replace function private.audit_row_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_mode   text := coalesce(tg_argv[0], 'full');
  v_redact constant text[] := array['token_hash','raw_event','embedding','updated_at'];
  v_old    jsonb;
  v_new    jsonb;
  v_row    jsonb;
  v_diff   jsonb := '{}'::jsonb;
  v_action text := lower(tg_op);
  v_household uuid;
  k        text;
begin
  if tg_op in ('UPDATE','DELETE') then v_old := to_jsonb(old) - v_redact; end if;
  if tg_op in ('INSERT','UPDATE') then v_new := to_jsonb(new) - v_redact; end if;
  v_row := coalesce(v_new, v_old);

  if tg_op = 'UPDATE' then
    if v_old ->> 'deleted_at' is null and v_new ->> 'deleted_at' is not null then
      v_action := 'soft_delete';
    elsif v_old ->> 'deleted_at' is not null and v_new ->> 'deleted_at' is null then
      v_action := 'restore';
    elsif tg_table_name = 'household_members' and (v_old ->> 'role') is distinct from (v_new ->> 'role') then
      v_action := 'role_change';
    end if;
    for k in select jsonb_object_keys(v_new) loop
      if (v_new -> k) is distinct from (v_old -> k) then
        v_diff := v_diff || jsonb_build_object(k,
          case when v_mode = 'keys_only' then to_jsonb('changed'::text)
               else jsonb_build_object('old', v_old -> k, 'new', v_new -> k) end);
      end if;
    end loop;
    if v_diff = '{}'::jsonb then
      return null;   -- no-op update
    end if;
  elsif tg_op = 'INSERT' then
    v_diff := case when v_mode = 'keys_only'
                   then jsonb_build_object('keys', (select jsonb_agg(x) from jsonb_object_keys(v_new) x))
                   else jsonb_build_object('new', v_new) end;
  else
    v_diff := case when v_mode = 'keys_only' then '{}'::jsonb else jsonb_build_object('old', v_old) end;
  end if;

  v_household := case when tg_table_name = 'households' then (v_row ->> 'id')::uuid
                      else (v_row ->> 'household_id')::uuid end;
  -- during erasure cascades the household is already gone; keep the entry but drop the FK value
  if v_household is not null and not exists (select 1 from public.households h where h.id = v_household) then
    v_household := null;
  end if;

  insert into public.audit_log (actor_user_id, household_id, action, entity, entity_id, diff, ip_hash)
  values (
    -- the actor may be the user being erased in this very transaction
    (select u.id from public.users u where u.id = auth.uid()),
    v_household,
    v_action,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    v_diff,
    private.request_ip_hash()
  );
  return null;
end $$;

-- 05 15.8 audit list, restricted to the tables that exist after Sprint 1 base DDL (Islamic tables are
-- attached in the knowledge migration; health, tracking and export tables in their sprints).
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('households','full'), ('household_members','full'), ('household_invitations','full'),
      ('family_members','keys_only'), ('subscriptions','full'), ('consents','full'),
      ('ai_model_routes','full'), ('prompt_templates','full'), ('feature_flags','full')
    ) as v(tbl, mode)
  loop
    execute format(
      'create trigger trg_%s_audit after insert or update or delete on public.%I for each row execute function private.audit_row_change(%L)',
      t.tbl, t.tbl, t.mode);
  end loop;
end $$;

create or replace function private.audit_log_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('app.retention_job', true), '') = 'on' then
    return old;
  end if;
  -- allow the FK "on delete set null" actions fired by erasure (users / households deleted);
  -- nothing else about the row may change
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - array['actor_user_id','household_id','updated_at'])
         = (to_jsonb(old) - array['actor_user_id','household_id','updated_at'])
     and (new.actor_user_id is null or new.actor_user_id = old.actor_user_id)
     and (new.household_id is null or new.household_id = old.household_id) then
    return new;
  end if;
  raise exception 'AUDIT_LOG_IMMUTABLE' using errcode = '42501';
end $$;
create trigger trg_audit_log_immutable before update or delete on public.audit_log
  for each row execute function private.audit_log_immutable();

-- 15.9 auth.users -> public.users (S1-03). Replaces the Sprint 0 body. Metadata keys
-- (10 section 5, 11 sections 3.2 and 9): display_name | full_name | name, locale, timezone,
-- country_code, units. Unknown or malformed values fall back to the column defaults.
-- units: explicit metadata wins; otherwise 'imperial' when country_code is US (01 Q-12), else metric.
-- S4 replaces this function again to add default notification_preferences (keep this body).
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
  return new;
end $$;

-- 0013 RLS ------------------------------------------------------------------------------------------
drop policy household_members_insert_owner on public.household_members;
revoke insert on public.household_members from authenticated;

alter table public.household_invitations enable row level security;
create policy household_invitations_select_editors on public.household_invitations for select to authenticated
  using (public.can_edit_household(household_id));
create policy household_invitations_insert_owner on public.household_invitations for insert to authenticated
  with check (public.household_role_of(household_id) = 'owner' and invited_by = auth.uid());
create policy household_invitations_update_owner on public.household_invitations for update to authenticated
  using (public.household_role_of(household_id) = 'owner')
  with check (public.household_role_of(household_id) = 'owner');
revoke update, delete on public.household_invitations from authenticated;
grant update (revoked_at) on public.household_invitations to authenticated;   -- owner may revoke; acceptance is service-only

call private.apply_household_rls('public.family_members', 'edit');
call private.apply_household_rls('public.budget_profiles', 'edit');

alter table public.devices enable row level security;
create policy devices_own on public.devices for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.consents enable row level security;
create policy consents_select_own on public.consents for select to authenticated
  using (user_id = auth.uid());
create policy consents_insert_own on public.consents for insert to authenticated
  with check (user_id = auth.uid() and withdrawn_at is null
              and (household_id is null or public.can_edit_household(household_id)));
create policy consents_withdraw_own on public.consents for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update, delete on public.consents from authenticated;
grant update (withdrawn_at) on public.consents to authenticated;

alter table public.audit_log enable row level security;
create policy audit_log_select on public.audit_log for select to authenticated
  using (actor_user_id = auth.uid()
         or (household_id is not null and public.household_role_of(household_id) = 'owner'));
revoke insert, update, delete on public.audit_log from authenticated;

-- 0014 cron (UTC; PKT = UTC+5) -------------------------------------------------------------------------
select cron.schedule('refresh-life-stages', '5 19 * * *',                  -- 00:05 PKT
  $$select private.refresh_life_stages()$$);
select cron.schedule('invitations-cleanup', '50 19 * * *',
  $$delete from public.household_invitations where accepted_at is null and expires_at < now() - interval '30 days'$$);
