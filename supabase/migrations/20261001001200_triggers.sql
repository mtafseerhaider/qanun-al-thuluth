-- supabase/migrations/20261001001200_triggers.sql
-- 0012 Triggers (05-database-schema.md section 15), Sprint 0 subset. Verbatim from 05 except
-- where noted. Included:
--   15.1  set_updated_at on every table that exists now (the loop only sees tables created so far;
--         later sprints attach the trigger per table, see migrations/README.md)
--   15.2  private.validate_timezone on users and households
--   15.5  private.household_bootstrap (owner household_members row)
--   15.6  private.enforce_household_entitlement (free tier: 1 owned household)
--   15.7  private.protect_owner_membership and public.transfer_household_ownership
--   15.9  private.handle_new_auth_user and private.sync_auth_email (auth.users -> public.users)
-- Deferred (their tables are not in Sprint 0): family_members derive/size/entitlement,
-- plan entitlement, audit (needs audit_log, S1-02), measurements, child safety, chat, recipe
-- nutrition, Islamic sources, price moderation, budget currency.

-- 15.1 updated_at on every table that has the column (partition children inherit from the parent trigger)
do $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'updated_at' and not a.attisdropped
    where n.nspname = 'public' and c.relkind in ('r','p') and not c.relispartition
  loop
    execute format(
      'create trigger trg_%s_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      r.relname, r.relname);
  end loop;
end $$;

-- 15.2 time zone validation
create or replace function private.validate_timezone()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'INVALID_TIMEZONE' using errcode = '22023', detail = new.timezone;
  end if;
  return new;
end $$;
create trigger trg_users_timezone before insert or update of timezone on public.users
  for each row execute function private.validate_timezone();
create trigger trg_households_timezone before insert or update of timezone on public.households
  for each row execute function private.validate_timezone();

-- 15.5 owner membership bootstrap
create or replace function private.household_bootstrap()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.household_members (household_id, user_id, role)
  values (new.id, new.owner_user_id, 'owner');
  return null;
end $$;
create trigger trg_households_bootstrap after insert on public.households
  for each row execute function private.household_bootstrap();

-- 15.6 entitlements (00-foundations section 8). Household limit only; the member and plan
-- limits arrive with family_members (Sprint 1) and meal_plans (Sprint 3).
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
    raise exception 'ENTITLEMENT_HOUSEHOLD_LIMIT' using errcode = 'P0001',
      detail = json_build_object('tier','free','limit',1,'current',v_count)::text,
      hint = 'upgrade_required';
  end if;
  return new;
end $$;
create trigger trg_households_entitlement before insert on public.households
  for each row execute function private.enforce_household_entitlement();
create trigger trg_households_entitlement_restore before update of deleted_at on public.households
  for each row when (old.deleted_at is not null and new.deleted_at is null)
  execute function private.enforce_household_entitlement();

-- 15.7 owner row protection and ownership transfer
create or replace function private.protect_owner_membership()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.allow_owner_change', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    -- allow cascades from a deleted household or user (erasure)
    if old.role = 'owner' and exists (select 1 from public.households h where h.id = old.household_id) then
      raise exception 'OWNER_ROW_PROTECTED' using errcode = '42501';
    end if;
    return old;
  end if;
  if new.household_id <> old.household_id or new.user_id <> old.user_id then
    raise exception 'MEMBERSHIP_IMMUTABLE' using errcode = '42501';
  end if;
  if (old.role = 'owner' or new.role = 'owner') and old.role is distinct from new.role then
    raise exception 'OWNER_ROW_PROTECTED' using errcode = '42501';
  end if;
  if old.role = 'owner' and new.deleted_at is not null then
    raise exception 'OWNER_ROW_PROTECTED' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_household_members_protect_owner before update or delete on public.household_members
  for each row execute function private.protect_owner_membership();

-- Addition beyond 00-foundations: ownership transfer RPC
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
    raise exception 'ENTITLEMENT_HOUSEHOLD_LIMIT' using errcode = 'P0001', hint = 'new_owner_upgrade_required';
  end if;
  perform set_config('app.allow_owner_change', 'on', true);
  update public.household_members set role = 'caregiver'
   where household_id = p_household_id and user_id = v_old_owner and deleted_at is null;
  update public.household_members set role = 'owner'
   where household_id = p_household_id and user_id = p_new_owner and deleted_at is null;
  update public.households set owner_user_id = p_new_owner where id = p_household_id;
  perform set_config('app.allow_owner_change', 'off', true);
end $$;
revoke execute on function public.transfer_household_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_household_ownership(uuid, uuid) to authenticated;

-- 15.9 auth.users -> public.users
-- Sprint 0 variant: creates the public.users profile only. The default notification_preferences
-- rows in 05 section 15.9 are added when that table ships (Sprint 4); that migration replaces
-- this function with the full 05 body via `create or replace`.
create or replace function private.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_tz   text  := nullif(v_meta ->> 'timezone', '');
begin
  if v_tz is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = v_tz) then
    v_tz := 'Asia/Karachi';
  end if;
  insert into public.users (id, email, display_name, locale, timezone, country_code)
  values (
    new.id,
    new.email,
    left(coalesce(nullif(v_meta ->> 'display_name',''), nullif(v_meta ->> 'full_name',''), nullif(v_meta ->> 'name',''), ''), 80),
    case when v_meta ->> 'locale' in ('en','ur','ar') then v_meta ->> 'locale' else 'en' end,
    v_tz,
    case when (v_meta ->> 'country_code') ~ '^[A-Z]{2}$' then v_meta ->> 'country_code' end
  )
  on conflict (id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_auth_user();

create or replace function private.sync_auth_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.users set email = new.email where id = new.id;
  return new;
end $$;
create trigger on_auth_user_email_updated after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.sync_auth_email();
