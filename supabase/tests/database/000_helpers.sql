-- supabase/tests/database/000_helpers.sql
-- Runs first (pg_prove sorts files; "000_" precedes the suite folders) and is NOT rolled back,
-- so the helpers exist for every later test file. Each test file runs in its own transaction.
-- Shape follows 21-testing-strategy.md section 6.2. tests.seed_household() and
-- tests.rls_fixture_coverage (Sprint 1) give every household-scoped table one fixture row, and the
-- invariant test fails when a new household-scoped table is not covered.
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
  update public.users set age_attested_at = now() where id = v_id;   -- adult account holder (11 section 13.1)
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

-- Registry of household-scoped tables that tests.seed_household() gives a fixture row
-- (21-testing-strategy.md section 6.2). Every public base table with a household_id column must be listed.
create table if not exists tests.rls_fixture_coverage (table_name text primary key);

-- Creates a household owned by p_owner with three family members (the owner as a linked adult,
-- a 7-year-old with picky_eater, a 4-year-old with autism) and one row in every household-scoped
-- table. Runs as postgres with entitlements bypassed. Returns the household id.
create or replace function tests.seed_household(p_owner uuid, p_name text default 'Fixture household')
returns uuid
language plpgsql security definer set search_path = public as $$
declare v_hid uuid;
begin
  v_hid := tests.create_household(p_owner, p_name);
  perform set_config('app.bypass_entitlements', 'on', true);
  insert into public.family_members (household_id, linked_user_id, name, date_of_birth, sex_at_birth, sort_order)
  values (v_hid, p_owner, 'Adult', current_date - interval '35 years', 'female', 0),
         (v_hid, null, 'Son', current_date - interval '7 years', 'male', 1),
         (v_hid, null, 'Daughter', current_date - interval '4 years', 'female', 2);
  update public.family_members set special_modules = '{picky_eater}' where household_id = v_hid and name = 'Son';
  update public.family_members set special_modules = '{autism}' where household_id = v_hid and name = 'Daughter';
  insert into public.household_invitations (household_id, email, role, token_hash, invited_by)
  values (v_hid, 'invitee-' || v_hid || '@test.thuluth.app', 'viewer', encode(extensions.digest(v_hid::text, 'sha256'), 'hex'), p_owner);
  insert into public.budget_profiles (household_id, monthly_amount_minor, currency)
  values (v_hid, 6000000, 'PKR');
  insert into public.consents (user_id, household_id, kind, version)
  values (p_owner, v_hid, 'child_data', '2026-10');
  insert into public.consents (user_id, kind, version)
  select p_owner, 'health_data', '2026-10'
  where not exists (select 1 from public.consents c where c.user_id = p_owner and c.kind = 'health_data' and c.withdrawn_at is null);
  -- Sprint 2 health profile, assessment and safety rows (S2-02, 0018a)
  insert into public.medical_conditions (household_id, family_member_id, label)
  select v_hid, fm.id, 'Fixture condition' from public.family_members fm where fm.household_id = v_hid and fm.name = 'Adult';
  insert into public.allergies (household_id, family_member_id, allergen_id, severity)
  select v_hid, fm.id, a.id, 'moderate' from public.family_members fm, public.allergens a
   where fm.household_id = v_hid and fm.name = 'Son' and a.code = 'peanuts';
  insert into public.medications (household_id, family_member_id, name)
  select v_hid, fm.id, 'Fixture medication' from public.family_members fm where fm.household_id = v_hid and fm.name = 'Adult';
  insert into public.supplements (household_id, family_member_id, name)
  select v_hid, fm.id, 'Vitamin D' from public.family_members fm where fm.household_id = v_hid and fm.name = 'Adult';
  insert into public.food_preferences (household_id, family_member_id, label, is_safe_food)
  select v_hid, fm.id, 'Plain rice', true from public.family_members fm where fm.household_id = v_hid and fm.name = 'Daughter';
  insert into public.food_dislikes (household_id, family_member_id, label)
  select v_hid, fm.id, 'Karela' from public.family_members fm where fm.household_id = v_hid and fm.name = 'Son';
  insert into public.nutrition_goals (household_id, family_member_id, goal_type, is_primary)
  select v_hid, fm.id, case when fm.name = 'Adult' then 'maintain' else 'child_growth' end::public.goal_type, true
    from public.family_members fm where fm.household_id = v_hid;
  insert into public.pregnancy_profiles (household_id, family_member_id, trimester)
  select v_hid, fm.id, 2 from public.family_members fm where fm.household_id = v_hid and fm.name = 'Adult';
  insert into public.sensory_profiles (household_id, family_member_id, texture_likes, texture_avoids)
  select v_hid, fm.id, '{smooth}', '{lumpy}' from public.family_members fm where fm.household_id = v_hid and fm.name = 'Daughter';
  insert into public.hydration_targets (household_id, family_member_id, daily_ml)
  select v_hid, fm.id, 2300 from public.family_members fm where fm.household_id = v_hid and fm.name = 'Adult';
  insert into public.ai_assessments (household_id, family_member_id, kind, summary, model_route, prompt_version)
  select v_hid, fm.id, 'intake', 'Fixture assessment', 'plan.generate', 'intake_assess@1'
    from public.family_members fm where fm.household_id = v_hid and fm.name = 'Adult';
  insert into public.safety_events (household_id, source, category, urgency)
  values (v_hid, 'intake', 'fixture', 'routine');
  -- Sprint 2 household-private catalog rows (S2-16)
  insert into public.recipes (household_id, created_by_user_id, title, meal_types, servings, source)
  values (v_hid, p_owner, 'Fixture family daal', '{lunch}', 4, 'user');
  insert into public.meals (household_id, source, title, meal_type, components)
  values (v_hid, 'user', 'Fixture meal', 'lunch', '[{"label":"Daal","role":"main"}]');
  insert into public.portions (household_id, meal_id, life_stage, grams, household_measure)
  select v_hid, m.id, 'adult', 300, '1 katori' from public.meals m where m.household_id = v_hid;
  insert into public.ai_usage (user_id, household_id, route_key, provider, model)
  values (p_owner, v_hid, 'chat.free', 'anthropic', 'claude-haiku-4-5-20251001');
  insert into public.analytics_events (user_id, household_id, event, occurred_at)
  values (p_owner, v_hid, 'household.created', now());
  -- audit_log rows are written by the audit triggers above
  perform set_config('app.bypass_entitlements', 'off', true);
  insert into tests.rls_fixture_coverage (table_name)
  select t from unnest(array['household_members','household_invitations','family_members','budget_profiles',
                             'consents','audit_log','ai_usage','analytics_events',
                             'medical_conditions','allergies','medications','supplements','food_preferences',
                             'food_dislikes','nutrition_goals','pregnancy_profiles','sensory_profiles',
                             'hydration_targets','ai_assessments','safety_events','recipes','meals','portions']) t
  on conflict do nothing;
  return v_hid;
end $$;

grant usage on schema tests to authenticated, anon, service_role;
grant select on tests.rls_fixture_coverage to authenticated, anon, service_role;
grant execute on all functions in schema tests to authenticated, anon, service_role;

select plan(1);
select has_function('tests', 'create_user', array['text','jsonb'], 'test helpers installed');
select * from finish();
