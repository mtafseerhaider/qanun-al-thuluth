-- supabase/tests/database/rls/100_meal_plans.test.sql
-- S3-02 plans (05 sections 11.2 to 11.4, 11.8, 15.6, 22.12; 06 section 3.3): role matrix and column
-- grants, the free-tier plan limit, activation and versioning, write_plan_week, the queue wrappers,
-- Realtime publication membership and the free swap RPC (S3-13).
begin;
select plan(44);

select tests.create_user('mp-owner@test.thuluth.app')    as owner \gset
select tests.create_user('mp-care@test.thuluth.app')     as care \gset
select tests.create_user('mp-viewer@test.thuluth.app')   as viewer \gset
select tests.create_user('mp-outsider@test.thuluth.app') as outsider \gset
select tests.seed_household(:'owner', 'Plan home') as hid \gset
select tests.add_member(:'hid', :'care', 'caregiver');
select tests.add_member(:'hid', :'viewer', 'viewer');
select id as fixture_plan from public.meal_plans where household_id = :'hid' \gset
select id as serving from public.daily_meal_servings where household_id = :'hid' \gset
select id as fixture_dm from public.daily_meals where household_id = :'hid' \gset
select id as d001 from public.meals where code = 'D001' \gset
select id as d001a from public.meals where code = 'D001-A' \gset
select id as adult_fm from public.family_members where household_id = :'hid' and name = 'Adult' \gset
select id as son_fm from public.family_members where household_id = :'hid' and name = 'Son' \gset

-- ---- structure -----------------------------------------------------------------------------------------
select has_column('public', 'meal_plans', 'generation_progress', 'meal_plans.generation_progress exists (0026)');
select has_column('public', 'daily_meals', 'batch_multiplier', 'daily_meals.batch_multiplier exists (0020b)');
select has_column('public', 'meal_plans', 'weekly_themes', 'meal_plans.weekly_themes exists (0020b)');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meal_plans'),
  'meal_plans is in the supabase_realtime publication');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'daily_meal_servings'),
  'daily_meal_servings is in the supabase_realtime publication');

-- ---- role matrix and column grants (06 section 3.3) ----------------------------------------------------
select tests.authenticate_as(:'viewer');
select is((select count(*) from public.meal_plans where household_id = :'hid'), 1::bigint, 'a viewer reads the household plan');
select is((select count(*) from public.daily_meal_servings where household_id = :'hid'), 1::bigint, 'and its servings');
select throws_ok(format($$insert into public.meal_plans (household_id, start_date, end_date) values (%L, current_date, current_date + 6)$$, :'hid'),
  '42501', null, 'a viewer cannot create a plan');
select is(tests.affected_rows(format($$update public.daily_meal_servings set status = 'eaten', logged_at = now() where id = %L$$, :'serving')),
  0::bigint, 'a viewer cannot log a serving');
select tests.clear_authentication();

select tests.authenticate_as(:'outsider');
select is((select count(*) from public.meal_plans where household_id = :'hid'), 0::bigint, 'an outsider sees no plans of the household');
select tests.clear_authentication();

select tests.authenticate_as(:'care');
select is(tests.affected_rows(format($$update public.daily_meal_servings set status = 'eaten', acceptance = '5_ate_well', logged_at = now() where id = %L$$, :'serving')),
  1::bigint, 'a caregiver logs a serving (status, acceptance, logged_at)');
select throws_ok(format($$update public.daily_meals set meal_id = %L where id = %L$$, :'d001', :'fixture_dm'),
  '42501', null, 'clients cannot change daily_meals.meal_id directly');
select is(tests.affected_rows(format($$update public.daily_meals set notes = 'less chilli' where id = %L$$, :'fixture_dm')),
  1::bigint, 'a caregiver edits daily_meals.notes');
select throws_ok(format($$update public.meal_plans set rationale = 'x' where id = %L$$, :'fixture_plan'),
  '42501', null, 'clients cannot edit meal_plans.rationale');
select tests.clear_authentication();

-- ---- activation, plan limit and versioning ---------------------------------------------------------------
select tests.authenticate_as(:'viewer');
select throws_ok(format($$select public.activate_meal_plan(%L)$$, :'fixture_plan'), 'P0002', null,
  'a viewer cannot activate a plan');
select tests.clear_authentication();

select tests.authenticate_as(:'owner');
select is((select status from public.activate_meal_plan(:'fixture_plan')), 'active'::public.plan_status,
  'the owner activates the draft plan');
select throws_ok(format($$select public.activate_meal_plan(%L)$$, :'fixture_plan'), 'P0001', 'CONFLICT',
  'an active plan cannot be activated again');
select throws_ok(format($$insert into public.meal_plans (household_id, status, start_date, end_date) values (%L, 'generating', current_date + 7, current_date + 13)$$, :'hid'),
  'P0001', 'PLAN_ALREADY_ACTIVE', 'free tier: a second active or generating plan raises PLAN_ALREADY_ACTIVE');
select throws_ok(format($$insert into public.meal_plans (household_id, status, start_date, end_date, week_count) values (%L, 'generating', current_date, current_date + 13, 2)$$, :'hid'),
  'P0001', 'PREMIUM_REQUIRED', 'free tier: a multi-week plan raises PREMIUM_REQUIRED');
select lives_ok(format($$insert into public.meal_plans (household_id, status, start_date, end_date) values (%L, 'draft', current_date + 7, current_date + 13)$$, :'hid'),
  'free tier: drafts do not count against the limit');
select lives_ok(format($$insert into public.meal_plans (household_id, status, start_date, end_date, version, parent_plan_id) values (%L, 'generating', current_date, current_date + 6, 2, %L)$$, :'hid', :'fixture_plan'),
  'an adjustment (child version) of the active plan is allowed while the parent is active');
select throws_ok(format($$insert into public.meal_plans (household_id, status, start_date, end_date, version, parent_plan_id) values (%L, 'draft', current_date, current_date + 6, 2, %L)$$, :'hid', :'fixture_plan'),
  '23505', null, 'a second live child of the same parent is rejected (linear history)');
select id as v2 from public.meal_plans where parent_plan_id = :'fixture_plan' \gset
update public.meal_plans set status = 'draft' where id = :'v2';
select is((select status from public.activate_meal_plan(:'v2')), 'active'::public.plan_status, 'version 2 activates');
select is((select status from public.meal_plans where id = :'fixture_plan'), 'archived'::public.plan_status,
  'activating version 2 archives version 1');
select is((select count(*) from public.meal_plans where household_id = :'hid' and status = 'active'), 1::bigint,
  'exactly one active plan remains');
select tests.clear_authentication();

-- premium households are not limited
select tests.create_user('mp-premium@test.thuluth.app') as payer \gset
select tests.create_household(:'payer', 'Premium plan home') as phid \gset
insert into public.subscriptions (user_id, tier, status, product_id, store, rc_app_user_id, current_period_end)
values (:'payer', 'premium', 'active', 'thuluth_premium_monthly', 'app_store', :'payer', now() + interval '30 days');
select tests.authenticate_as(:'payer');
select lives_ok(format($$insert into public.meal_plans (household_id, status, start_date, end_date, week_count) values (%1$L, 'generating', current_date, current_date + 27, 4), (%1$L, 'generating', current_date + 28, current_date + 34, 1)$$, :'phid'),
  'premium: several multi-week generating plans are allowed');
select tests.clear_authentication();

-- ---- write_plan_week (service role) -------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.write_plan_week(uuid, jsonb)', 'execute'),
  'authenticated cannot call write_plan_week');
select ok(not has_function_privilege('authenticated', 'public.plan_generation_enqueue(uuid, integer, integer)', 'execute')
          and has_function_privilege('service_role', 'public.plan_generation_enqueue(uuid, integer, integer)', 'execute'),
  'queue wrappers are service-role only');
select id as gen_plan from public.meal_plans where household_id = :'phid' and week_count = 4 \gset
insert into public.family_members (household_id, name, date_of_birth, sex_at_birth)
values (:'phid', 'Payer', current_date - interval '40 years', 'male') returning id as payer_fm \gset
select id as d001_adult from public.portions where meal_id = :'d001' and life_stage = 'adult' and tier = 'standard' \gset
select json_build_object('week', 1,
  'days', json_build_array(json_build_object('plan_date', current_date, 'meals', json_build_array(json_build_object(
    'meal_type', 'dinner', 'slot', 1, 'meal_id', :'d001', 'scheduled_time', '19:45',
    'servings', json_build_array(json_build_object('family_member_id', :'payer_fm', 'portion_id', :'d001_adult', 'adaptation', 'none')))))),
  'recommendations', json_build_array(json_build_object('recommendation_id', (select id from public.recommendations order by id limit 1)))
  )::text as week \gset
set local role service_role;
select is(public.write_plan_week(:'gen_plan', :'week'::jsonb), 1, 'write_plan_week writes the slot');
select is(public.write_plan_week(:'gen_plan', :'week'::jsonb), 1, 'and is idempotent on retry');
reset role;
select is((select count(*) from public.daily_meals where meal_plan_id = :'gen_plan'), 1::bigint, 'one slot after the retry');
select is((select count(*) from public.daily_meal_servings s join public.daily_meals d on d.id = s.daily_meal_id where d.meal_plan_id = :'gen_plan'),
  1::bigint, 'one serving after the retry');
select is((select count(*) from public.plan_recommendations where meal_plan_id = :'gen_plan'), 1::bigint, 'one plan recommendation after the retry');
select is((select generation_progress ->> 'phase' from public.meal_plans where id = :'gen_plan'), 'writing', 'generation_progress is updated');
select throws_ok(format($$select public.write_plan_week(%L, '{"days":[{"plan_date":"2000-01-01","meals":[]}]}')$$, :'gen_plan'),
  '22023', 'PLAN_DATE_OUT_OF_RANGE', 'dates outside the plan are rejected');
select throws_ok(format($$select public.write_plan_week(%L, '{}')$$, :'v2'), 'P0001', 'CONFLICT',
  'only generating plans accept weeks');
select case when to_regnamespace('pgmq') is null
  then throws_ok(format($$select public.plan_generation_enqueue(%L)$$, :'gen_plan'), 'P0001', 'QUEUE_UNAVAILABLE', 'without pgmq the wrappers raise QUEUE_UNAVAILABLE')
  else ok(public.plan_generation_enqueue(:'gen_plan') > 0, 'plan_generation_enqueue returns a message id') end;

-- ---- free swap (S3-13) ----------------------------------------------------------------------------------------
-- a dinner slot on the active version 2 plan with the global meal D001, a planned adult serving and a
-- child serving with an autism adaptation
insert into public.daily_meals (meal_plan_id, household_id, plan_date, meal_type, meal_id)
values (:'v2', :'hid', current_date, 'dinner', :'d001') returning id as swap_dm \gset
insert into public.daily_meal_servings (daily_meal_id, household_id, family_member_id, portion_id, adaptation, adapted_meal_id)
values (:'swap_dm', :'hid', :'adult_fm', :'d001_adult', 'none', null),
       (:'swap_dm', :'hid', :'son_fm', null, 'autism', :'d001a');
select tests.authenticate_as(:'owner');
select throws_ok(format($$select public.swap_daily_meal(%L, %L)$$, :'swap_dm', :'d001a'), 'P0001', 'SWAP_NOT_ALLOWED',
  'in-review alternatives cannot be swapped to while the alpha flag is off');
select tests.clear_authentication();
update public.feature_flags set enabled = true where key = 'catalog.include_in_review';
select set_config('app.environment', 'test', true);   -- the gate opens only in a named non-production environment
select tests.authenticate_as(:'viewer');
select throws_ok(format($$select public.swap_daily_meal(%L, %L)$$, :'swap_dm', :'d001a'), '42501', null,
  'a viewer cannot swap');
select tests.clear_authentication();
select tests.authenticate_as(:'owner');
select is((select swapped_from_meal_id from public.swap_daily_meal(:'swap_dm', :'d001a')), :'d001'::uuid,
  'the owner swaps D001 to its alternative; the original meal is kept');
select tests.clear_authentication();
select is((select p.meal_id from public.daily_meal_servings s join public.portions p on p.id = s.portion_id
            where s.daily_meal_id = :'swap_dm' and s.family_member_id = :'adult_fm'), :'d001a'::uuid,
  'the adult serving moves to the new meal''s portion');
select tests.authenticate_as(:'owner');
select throws_ok(format($$select public.swap_daily_meal(%L, %L)$$, :'swap_dm', :'d001'), 'P0001', 'SWAP_NOT_ALLOWED',
  'no alternative row in the reverse direction: swap refused');
select tests.clear_authentication();
-- an allergy-adapted serving never falls back to the family meal
select id as d001p from public.meals where code = 'D001-P' \gset
insert into public.daily_meals (meal_plan_id, household_id, plan_date, meal_type, meal_id)
values (:'v2', :'hid', current_date + 1, 'dinner', :'d001') returning id as swap_dm2 \gset
insert into public.daily_meal_servings (daily_meal_id, household_id, family_member_id, adaptation)
values (:'swap_dm2', :'hid', :'son_fm', 'allergy');
select tests.authenticate_as(:'owner');
select throws_ok(format($$select public.swap_daily_meal(%L, %L)$$, :'swap_dm2', :'d001p'), 'P0001', 'SWAP_NOT_ALLOWED',
  'a swap that would drop an allergy adaptation is refused');
select tests.clear_authentication();
select is((select meal_id from public.daily_meals where id = :'swap_dm2'), :'d001'::uuid, 'and the slot is unchanged');

select * from finish();
rollback;
