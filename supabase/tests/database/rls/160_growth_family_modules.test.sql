-- supabase/tests/database/rls/160_growth_family_modules.test.sql
-- S6-02 growth, picky-eater and autism tables (05 sections 12.6, 12.7, 12.10 to 12.12, 15.10, 16.3; 22.7 21.1 and 21.2;
-- 06 section 4.8; 00 section 10): growth_tracking HE with server-only computed columns, age_days, the adult and
-- before-birth rules, reset of computed values, latest-measurement sync and growth_dashboard; food_exposures HE+self;
-- exposure ladders and steps HE (ladders soft-deleted); growth_reference_lms is a readable catalog.
-- Cross-household isolation for these tables is in 030.
begin;
select plan(40);

select tests.create_user('gr-owner@test.thuluth.app')  as owner \gset
select tests.create_user('gr-care@test.thuluth.app')   as care \gset
select tests.create_user('gr-linked@test.thuluth.app') as linked \gset
select tests.create_user('gr-viewer@test.thuluth.app') as viewer \gset
select tests.seed_household(:'owner', 'Growth home') as hid \gset
select tests.add_member(:'hid', :'care', 'caregiver');
select tests.add_member(:'hid', :'linked', 'viewer');
select tests.add_member(:'hid', :'viewer', 'viewer');
select id as son from public.family_members where household_id = :'hid' and name = 'Son' \gset
select id as daughter from public.family_members where household_id = :'hid' and name = 'Daughter' \gset
select id as adult from public.family_members where household_id = :'hid' and name = 'Adult' \gset
select id as onion from public.ingredients where name = 'Onion' \gset
select id as ladder from public.exposure_ladders where household_id = :'hid' \gset
set local app.bypass_entitlements = 'on';
insert into public.family_members (household_id, linked_user_id, name, date_of_birth, sex_at_birth)
values (:'hid', :'linked', 'Teen', current_date - interval '15 years', 'male') returning id as teen \gset
insert into public.family_members (household_id, name, life_stage) values (:'hid', 'Grandma', 'older_adult') returning id as grandma \gset
set local app.bypass_entitlements = 'off';

-- ---- growth_reference_lms: catalog read, admin write ---------------------------------------------------------------
select tests.authenticate_as(:'viewer');
select ok((select count(*) from public.growth_reference_lms) > 0, 'any signed-in user reads the growth reference');
select throws_ok($$insert into public.growth_reference_lms (reference, indicator, sex, age_months, l, m, s) values ('cdc_2000','wfa','male',24,1,12,0.1)$$,
  '42501', null, 'but cannot write it');
select tests.clear_authentication();

-- ---- growth_tracking: HE role matrix ------------------------------------------------------------------------------
select tests.authenticate_as(:'viewer');
select is((select count(*) from public.growth_tracking where household_id = :'hid'), 1::bigint, 'a viewer reads measurements');
select throws_ok(format($$insert into public.growth_tracking (household_id, family_member_id, measured_on, weight_kg) values (%L, %L, current_date - 30, 22)$$, :'hid', :'son'),
  '42501', null, 'a viewer cannot log a measurement');
select tests.clear_authentication();

select tests.authenticate_as(:'care');
select lives_ok(format($$insert into public.growth_tracking (household_id, family_member_id, measured_on, height_cm, weight_kg, measurement_position) values (%L, %L, current_date - 60, 120.5, 22.8, 'standing')$$, :'hid', :'son'),
  'a caregiver logs a child measurement');
select is((select age_days from public.growth_tracking where family_member_id = :'son' and measured_on = current_date - 60),
  (current_date - 60) - (current_date - interval '7 years')::date, 'age_days comes from the date of birth');
select is((select entered_by from public.growth_tracking where family_member_id = :'son' and measured_on = current_date - 60),
  :'care'::uuid, 'entered_by defaults to the caller');
select throws_ok(format($$insert into public.growth_tracking (household_id, family_member_id, measured_on, weight_kg, weight_for_age_z) values (%L, %L, current_date - 90, 22, 0.5)$$, :'hid', :'son'),
  '42501', null, 'z-scores are not client-writable');
select throws_ok(format($$update public.growth_tracking set flags = '{}' where family_member_id = %L$$, :'son'),
  '42501', null, 'safety flags are not client-writable');
select throws_ok(format($$insert into public.growth_tracking (household_id, family_member_id, measured_on, weight_kg) values (%L, %L, current_date - interval '8 years', 3)$$, :'hid', :'son'),
  '23514', 'MEASUREMENT_BEFORE_BIRTH', 'a measurement before birth is rejected');
select throws_ok(format($$insert into public.growth_tracking (household_id, family_member_id, measured_on, weight_kg) values (%L, %L, current_date, 70)$$, :'hid', :'adult'),
  'P0001', 'GROWTH_RULE:adult_member', 'adults are not growth-tracked (weight_tracking instead)');
select throws_ok(format($$insert into public.growth_tracking (household_id, family_member_id, measured_on, weight_kg) values (%L, %L, current_date, 60)$$, :'hid', :'grandma'),
  'P0001', 'GROWTH_RULE:adult_member', 'an adult life stage without a date of birth is rejected too');
select lives_ok(format($$insert into public.growth_tracking (household_id, family_member_id, measured_on, height_cm) values (%L, %L, current_date, 168)$$, :'hid', :'teen'),
  'a 15-year-old is growth-tracked');
select throws_ok(format($$insert into public.growth_tracking (household_id, family_member_id, measured_on) values (%L, %L, current_date - 5)$$, :'hid', :'son'),
  '23514', null, 'at least one measurement value is required');
select throws_ok(format($$insert into public.growth_tracking (household_id, family_member_id, measured_on, weight_kg) values (%L, %L, current_date, 23)$$, :'hid', :'son'),
  '23505', null, 'one measurement per member and day');
select tests.clear_authentication();

-- computed columns: server writes, raw edits reset them
update public.growth_tracking
   set weight_for_age_z = -2.10, weight_for_age_percentile = 1.8, flags = '{red_flag.wfa_below_p3}', computed_at = now(),
       age_months = 84.0, reference = 'who_2007'
 where family_member_id = :'son' and measured_on = current_date;
select is((select bmi from public.growth_tracking where family_member_id = :'son' and measured_on = current_date),
  public.compute_bmi(23.5, 122.0), 'bmi is generated from weight and height');
select is((select height_cm from public.family_members where id = :'son'), 122.0::numeric(5,1),
  'the latest measurement is copied to the member');
select tests.authenticate_as(:'care');
select is(tests.affected_rows(format($$update public.growth_tracking set weight_kg = 24 where family_member_id = %L and measured_on = current_date$$, :'son')),
  1::bigint, 'a caregiver corrects a raw value');
select tests.clear_authentication();
select results_eq(format($$select weight_for_age_z, cardinality(flags), computed_at from public.growth_tracking where family_member_id = %L and measured_on = current_date$$, :'son'),
  $$values (null::numeric, 0, null::timestamptz)$$, 'a raw edit clears z-scores, flags and computed_at');
select is((select weight_kg from public.family_members where id = :'son'), 24.00::numeric(5,2), 'and re-syncs the member weight');
select is((select height_cm from public.family_members where id = :'son' ), 122.0::numeric(5,1),
  'an older measurement (60 days ago) did not overwrite the latest height');
-- Every row in this transaction shares one `at`, so check all update rows rather than picking one.
select ok(exists(select 1 from public.audit_log where entity = 'growth_tracking' and action = 'update' and diff ? 'weight_kg'),
  'growth edits are audited keys-only');

-- growth_dashboard: free tier sees the latest measurement only, flags on every tier
update public.growth_tracking set flags = '{red_flag.wfa_below_p3}', computed_at = now()
 where family_member_id = :'son' and measured_on = current_date - 60;
select tests.authenticate_as(:'viewer');
select is(jsonb_array_length(public.growth_dashboard(:'son') -> 'measurements'), 1, 'free tier: only the latest measurement');
select is(public.growth_dashboard(:'son') -> 'openFlags', '["red_flag.wfa_below_p3"]'::jsonb, 'safety flags show on the free tier');
select is((public.growth_dashboard(:'son') ->> 'premium')::boolean, false, 'the dashboard reports the tier');
select tests.clear_authentication();
select tests.authenticate_as(tests.create_user('gr-outsider@test.thuluth.app'));
select is(public.growth_dashboard(:'son'), null::jsonb, 'an outsider gets nothing');
select tests.clear_authentication();

select tests.authenticate_as(:'care');
select is(tests.affected_rows(format($$delete from public.growth_tracking where family_member_id = %L and measured_on = current_date - 60$$, :'son')),
  1::bigint, 'editors may hard-delete a measurement (quick undo)');
select tests.clear_authentication();

-- ---- food_exposures: HE+self ------------------------------------------------------------------------------------------
select tests.authenticate_as(:'linked');
select lives_ok(format($$insert into public.food_exposures (household_id, family_member_id, ingredient_id, stage, acceptance, context) values (%L, %L, %L, 'taste', '3_tasted', 'snack')$$, :'hid', :'teen', :'onion'),
  'a linked teen logs their own exposure');
select throws_ok(format($$insert into public.food_exposures (household_id, family_member_id, ingredient_id, stage, acceptance) values (%L, %L, %L, 'look', '1_tolerated')$$, :'hid', :'son', :'onion'),
  '42501', null, 'but not another member''s');
select tests.clear_authentication();
select tests.authenticate_as(:'care');
select lives_ok(format($$insert into public.food_exposures (household_id, family_member_id, ingredient_id, stage, acceptance, context, ladder_step_id) values (%L, %L, %L, 'touch', '2_touched', 'play', (select id from public.exposure_ladder_steps where ladder_id = %L))$$, :'hid', :'daughter', :'onion', :'ladder'),
  'a caregiver logs a ladder exposure');
select throws_ok(format($$insert into public.food_exposures (household_id, family_member_id, ingredient_id, stage, acceptance, context) values (%L, %L, %L, 'look', '1_tolerated', 'distress')$$, :'hid', :'son', :'onion'),
  '23514', null, 'contexts are the 05 base values');
select tests.clear_authentication();
select results_eq(format($$select exposures from public.picky_acceptance_summary(%L, 30)$$, :'daughter'),
  $$values (2)$$, 'picky_acceptance_summary counts recent exposures');

-- ---- exposure ladders and steps: HE, ladders soft-deleted -----------------------------------------------------------
select tests.authenticate_as(:'viewer');
select is((select count(*) from public.exposure_ladder_steps where ladder_id = :'ladder'), 1::bigint, 'a viewer reads ladder steps');
select is(tests.affected_rows(format($$update public.exposure_ladders set status = 'paused' where id = %L$$, :'ladder')), 0::bigint,
  'a viewer cannot change a ladder');
select tests.clear_authentication();
select tests.authenticate_as(:'care');
select lives_ok(format($$insert into public.exposure_ladder_steps (ladder_id, household_id, step_no, stage, food_label, criteria, bridge_from_ingredient_id) values (%L, %L, 2, 'touch', 'Soft onion slice', 'Touches it twice calmly', %L)$$, :'ladder', :'hid', :'onion'),
  'a caregiver adds a food-chaining step');
select throws_ok(format($$insert into public.exposure_ladders (household_id, family_member_id, target_ingredient_id, strategy) values (%L, %L, %L, 'exposure_ladder')$$, :'hid', :'daughter', :'onion'),
  '23505', null, 'one active ladder per member and target food');
select throws_ok(format($$update public.exposure_ladders set status = 'accepted' where id = %L$$, :'ladder'),
  '23514', null, 'ladder statuses are the 05 base values');
select is(tests.affected_rows(format($$delete from public.exposure_ladders where id = %L$$, :'ladder')), 0::bigint,
  'ladders are not hard-deleted by clients');
select lives_ok(format($$select public.soft_delete('exposure_ladders', %L)$$, :'ladder'), 'ladders are soft-deleted through the RPC');
select is((select count(*) from public.exposure_ladders where id = :'ladder'), 0::bigint, 'a soft-deleted ladder is hidden');
select tests.clear_authentication();

select * from finish();
rollback;
