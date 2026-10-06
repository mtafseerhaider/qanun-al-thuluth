-- supabase/tests/database/rls/150_meal_logs_ramadan.test.sql
-- S5-02 meal_logs and ramadan_plans (05 sections 12.1, 12.5, 16.3.7, 22.7, 22.11; 06 sections 3.4 and 4.9;
-- 00 section 10; 15 sections 5.1 and 5.9): HE+self meal logs with photo rule and linked-member soft delete;
-- Ramadan plans editable by owner and caregiver only, one live plan per Hijri year, at most 31 days, no
-- fasting participation under 7, members from the household only; v_qada_balance on ramadan_plans with the
-- hijri_date fallback; prayer_times_cache is service role only. Cross-household isolation is in 030.
begin;
select plan(28);

select tests.create_user('mr-owner@test.thuluth.app')  as owner \gset
select tests.create_user('mr-care@test.thuluth.app')   as care \gset
select tests.create_user('mr-linked@test.thuluth.app') as linked \gset
select tests.create_user('mr-viewer@test.thuluth.app') as viewer \gset
select tests.seed_household(:'owner', 'Ramadan home') as hid \gset
select tests.seed_household(tests.create_user('mr-otherowner@test.thuluth.app'), 'Other home') as other_hid \gset
select tests.add_member(:'hid', :'care', 'caregiver');
select tests.add_member(:'hid', :'linked', 'viewer');
select tests.add_member(:'hid', :'viewer', 'viewer');
select id as adult from public.family_members where household_id = :'hid' and name = 'Adult' \gset
select id as son from public.family_members where household_id = :'hid' and name = 'Son' \gset
select id as daughter from public.family_members where household_id = :'hid' and name = 'Daughter' \gset
select id as other_son from public.family_members where household_id = :'other_hid' and name = 'Son' \gset
select id as plan_1448 from public.ramadan_plans where household_id = :'hid' \gset
set local app.bypass_entitlements = 'on';
insert into public.family_members (household_id, linked_user_id, name, date_of_birth, sex_at_birth)
values (:'hid', :'linked', 'Uncle', current_date - interval '40 years', 'male') returning id as uncle \gset
set local app.bypass_entitlements = 'off';

-- ---- meal_logs: HE+self ------------------------------------------------------------------------------------------
select tests.authenticate_as(:'linked');
select lives_ok(format($$insert into public.meal_logs (household_id, family_member_id, meal_type, description) values (%L, %L, 'dinner', 'Karahi and roti') returning id$$, :'hid', :'uncle'),
  'a linked viewer logs their own meal');
select is((select logged_by_user_id from public.meal_logs where family_member_id = :'uncle'), :'linked'::uuid,
  'logged_by_user_id defaults to the caller');
select throws_ok(format($$insert into public.meal_logs (household_id, family_member_id, meal_type) values (%L, %L, 'lunch')$$, :'hid', :'son'),
  '42501', null, 'but not a meal for another member');
select lives_ok(format($$select public.soft_delete('meal_logs', (select id from public.meal_logs where family_member_id = %L))$$, :'uncle'),
  'and soft-deletes their own log');
select throws_ok(format($$select public.soft_delete('meal_logs', (select id from public.meal_logs where family_member_id = %L))$$, :'adult'),
  '42501', 'FORBIDDEN', 'but not another member''s log');
select tests.clear_authentication();

select tests.authenticate_as(:'viewer');
select throws_ok(format($$insert into public.meal_logs (household_id, family_member_id, meal_type) values (%L, %L, 'lunch')$$, :'hid', :'adult'),
  '42501', null, 'an unlinked viewer cannot log meals');
select is((select count(*) from public.meal_logs where household_id = :'hid'), 1::bigint, 'but reads the household''s live logs');
select tests.clear_authentication();

select tests.authenticate_as(:'care');
select throws_ok(format($$insert into public.meal_logs (household_id, family_member_id, meal_type, source) values (%L, %L, 'lunch', 'photo_ai')$$, :'hid', :'son'),
  '23514', null, 'a photo_ai log needs a photo_path');
select lives_ok(format($$insert into public.meal_logs (household_id, family_member_id, meal_type, source, photo_path, fullness_after) values (%L, %L, 'lunch', 'photo_ai', %L, 6)$$,
                       :'hid', :'son', :'hid' || '/' || :'son' || '/2026/10/' || gen_random_uuid() || '.jpg'),
  'a caregiver saves a photo log for a child');
select throws_ok(format($$insert into public.meal_logs (household_id, family_member_id, meal_type, fullness_before) values (%L, %L, 'lunch', 11)$$, :'hid', :'son'),
  '23514', null, 'fullness is 0 to 10');
select throws_ok(format($$insert into public.meal_logs (household_id, family_member_id, meal_type) values (%L, %L, 'lunch')$$, :'hid', :'other_son'),
  '23503', null, 'a member of another household cannot be logged here (composite FK)');

-- ---- ramadan_plans ----------------------------------------------------------------------------------------------------
select throws_ok(format($$insert into public.ramadan_plans (household_id, hijri_year, start_date, end_date) values (%L, 1448, date '2027-02-09', date '2027-03-10')$$, :'hid'),
  '23505', null, 'one live Ramadan plan per household and Hijri year');
select throws_ok(format($$insert into public.ramadan_plans (household_id, hijri_year, start_date, end_date) values (%L, 1449, date '2028-01-28', date '2028-03-01')$$, :'hid'),
  '23514', null, 'a Ramadan plan spans at most 31 days');
select throws_ok(format($$insert into public.ramadan_plans (household_id, hijri_year, start_date, end_date) values (%L, 1449, date '2028-01-28', date '2028-01-20')$$, :'hid'),
  '23514', null, 'end_date is not before start_date');
select lives_ok(format($$insert into public.ramadan_plans (household_id, hijri_year, start_date, end_date, suhoor_time_strategy, city_prayer_times_source, child_participation) values (%L, 1449, date '2028-01-28', date '2028-02-26', 'just_before_fajr', 'karachi', %L::jsonb)$$,
                       :'hid', json_build_object(:'son', json_build_object('mode', 'practice_half_day', 'days', json_build_array('sat','sun')), :'daughter', json_build_object('mode', 'none'))),
  'a caregiver creates a plan with the 06 suhoor strategy and a practice fast for a 7-year-old');
select throws_ok(format($$update public.ramadan_plans set child_participation = %L::jsonb where hijri_year = 1449 and household_id = %L$$,
                        json_build_object(:'daughter', json_build_object('mode', 'practice_half_day')), :'hid'),
  'P0001', 'CHILD_RULE:fasting_under_7', 'no fasting participation for a 4-year-old (00 section 10)');
select throws_ok(format($$update public.ramadan_plans set child_participation = %L::jsonb where hijri_year = 1449 and household_id = %L$$,
                        json_build_object(:'other_son', json_build_object('mode', 'none')), :'hid'),
  '22023', 'VALIDATION_FAILED', 'participation keys must be members of the household');
select throws_ok(format($$update public.ramadan_plans set suhoor_time_strategy = 'midnight' where hijri_year = 1449 and household_id = %L$$, :'hid'),
  '23514', null, 'suhoor_time_strategy is a closed set');
select lives_ok(format($$update public.ramadan_plans set calc_params = '{"method":"Karachi","madhab":"hanafi"}' where id = %L$$, :'plan_1448'),
  'calc_params is writable');
select throws_ok(format($$update public.ramadan_plans set calc_params = '[]' where id = %L$$, :'plan_1448'),
  '23514', null, 'calc_params must be an object');
select tests.clear_authentication();

select tests.authenticate_as(:'viewer');
select is(tests.affected_rows(format($$update public.ramadan_plans set suhoor_time_strategy = 'early' where id = %L$$, :'plan_1448')),
  0::bigint, 'a viewer cannot edit a Ramadan plan');
select throws_ok(format($$select public.soft_delete('ramadan_plans', %L)$$, :'plan_1448'), '42501', 'FORBIDDEN', 'or delete it');
select is((select count(*) from public.ramadan_plans where household_id = :'hid'), 2::bigint, 'but reads the household''s plans');
select tests.clear_authentication();

-- ---- v_qada_balance on ramadan_plans (05 22.7), with the S4 hijri_date fallback ------------------------------------
insert into public.fasting_logs (household_id, family_member_id, fast_date, kind, completed, exemption_reason)
values (:'hid', :'adult', date '2027-02-10', 'ramadan', false, 'travel'),
       (:'hid', :'adult', date '2027-02-11', 'ramadan', true, null),
       (:'hid', :'adult', date '2027-02-12', 'ramadan', false, 'illness');
insert into public.fasting_logs (household_id, family_member_id, fast_date, kind, completed, hijri_date)
values (:'hid', :'adult', date '2026-02-20', 'ramadan', false, '1447-09-03');
insert into public.fasting_logs (household_id, family_member_id, fast_date, kind, completed, qada_for_hijri_year)
values (:'hid', :'adult', date '2027-04-05', 'qada', true, 1448);
select results_eq(format($$select hijri_year::int, missed::int, made_up::int from public.v_qada_balance where family_member_id = %L order by 1$$, :'adult'),
  $$values (1447, 1, 0), (1448, 2, 1)$$,
  'v_qada_balance takes the Hijri year from the live Ramadan plan, and from hijri_date outside every plan');
select tests.authenticate_as(:'owner');
select lives_ok(format($$select public.soft_delete('ramadan_plans', %L)$$, :'plan_1448'), 'the owner soft-deletes the 1448 plan');
select tests.clear_authentication();
select is((select count(*) from public.v_qada_balance where family_member_id = :'adult' and hijri_year = 1448), 0::bigint,
  'fasts inside a deleted plan without a hijri_date drop out of the balance');

-- ---- prayer_times_cache: service role only -----------------------------------------------------------------------------
insert into public.prayer_times_cache (country_code, city, method, school, year, month, timings)
values ('PK', 'Lahore', 1, 1, 2027, 2, '[{"date":"2027-02-08","fajr":"05:31","maghrib":"17:55"}]');
select throws_ok($$insert into public.prayer_times_cache (country_code, city, method, school, year, month, timings) values ('PK', 'lahore', 1, 1, 2027, 2, '[]')$$,
  '23505', null, 'one cache row per country, city (case-insensitive), method, school and month');
select tests.authenticate_as(:'owner');
select throws_ok($$select count(*) from public.prayer_times_cache$$, '42501', null, 'clients cannot read prayer_times_cache');
select tests.clear_authentication();

select * from finish();
rollback;
