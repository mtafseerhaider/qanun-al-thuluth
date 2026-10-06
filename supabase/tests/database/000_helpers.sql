-- supabase/tests/database/000_helpers.sql
-- Runs first (pg_prove sorts files; "000_" precedes the suite folders) and is NOT rolled back,
-- so the helpers exist for every later test file. Each test file runs in its own transaction.
-- Shape follows 21-testing-strategy.md section 6.2. Sprint 0 differences:
--   * users.age_attested_at does not exist yet (migration 0017), so create_user does not set it.
--   * tests.seed_household() / rls_fixture_coverage arrive with family_members (Sprint 1).
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

-- Creates an auth user; public.users is created by the on_auth_user_created trigger.
create or replace function tests.create_user(p_email text, p_app_meta jsonb default '{}'::jsonb)
returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, email, aud, role, email_confirmed_at,
                          raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', p_email, 'authenticated', 'authenticated', now(),
          '{"locale":"en"}', '{"provider":"email"}'::jsonb || p_app_meta, now(), now());
  return v_id;
end $$;

-- Switches the session to the authenticated role with the user's JWT claims.
-- p_app_meta lets a test add app_metadata, e.g. '{"role":"admin"}' for is_admin().
create or replace function tests.authenticate_as(p_user uuid, p_app_meta jsonb default '{}'::jsonb)
returns void
language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aud', 'authenticated',
      'app_metadata', p_app_meta,
      'amr', json_build_array(json_build_object('method','otp','timestamp', extract(epoch from now())::int)))::text, true);
end $$;

create or replace function tests.clear_authentication()
returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Creates a household owned by p_owner (as postgres, bypassing RLS and entitlements);
-- the bootstrap trigger adds the owner membership.
create or replace function tests.create_household(p_owner uuid, p_name text default 'Test household')
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform set_config('app.bypass_entitlements', 'on', true);
  insert into public.households (owner_user_id, name) values (p_owner, p_name) returning id into v_id;
  perform set_config('app.bypass_entitlements', 'off', true);
  return v_id;
end $$;

create or replace function tests.add_member(p_household uuid, p_user uuid, p_role public.household_role)
returns uuid
language sql security definer set search_path = public as $$
  insert into public.household_members (household_id, user_id, role) values (p_household, p_user, p_role) returning id;
$$;

-- Number of rows a DML statement affected, run as the CURRENT role (so RLS applies).
-- Postgres forbids data-modifying CTEs inside sub-selects, hence dynamic SQL.
create or replace function tests.affected_rows(p_sql text)
returns bigint
language plpgsql as $$
declare v_n bigint;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

grant usage on schema tests to authenticated, anon, service_role;
grant execute on all functions in schema tests to authenticated, anon, service_role;

select plan(1);
select has_function('tests', 'create_user', array['text','jsonb'], 'test helpers installed');
select * from finish();
