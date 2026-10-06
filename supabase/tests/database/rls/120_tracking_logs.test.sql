-- supabase/tests/database/rls/120_tracking_logs.test.sql
-- S4-02 tracking logs (05 sections 12.3, 12.4, 12.8, 12.9, 15.10, 15.11, 16.3.7, 22.7, 22.8; 06 section 3.4;
-- 00 section 10; 15 section 5): HE+self RLS (a viewer linked to a family member logs their own rows only),
-- fasting uniqueness and safety rules, weight logs adults only with BMI and latest-weight sync, the
-- exemption-reason view, the qada balance and the Hijri offset. Cross-household isolation is in 030.
begin;
select plan(45);

select tests.create_user('tl-owner@test.thuluth.app')   as owner \gset
select tests.create_user('tl-care@test.thuluth.app')    as care \gset
select tests.create_user('tl-linked@test.thuluth.app')  as linked \gset
select tests.create_user('tl-viewer@test.thuluth.app')  as viewer \gset
select tests.seed_household(:'owner', 'Tracking home') as hid \gset
select tests.add_member(:'hid', :'care', 'caregiver');
select tests.add_member(:'hid', :'linked', 'viewer');
select tests.add_member(:'hid', :'viewer', 'viewer');
select id as adult from public.family_members where household_id = :'hid' and name = 'Adult' \gset
select id as son from public.family_members where household_id = :'hid' and name = 'Son' \gset
select id as daughter from public.family_members where household_id = :'hid' and name = 'Daughter' \gset
set local app.bypass_entitlements = 'on';
insert into public.family_members (household_id, linked_user_id, name, date_of_birth, sex_at_birth, height_cm)
values (:'hid', :'linked', 'Uncle', current_date - interval '40 years', 'male', 175.0) returning id as uncle \gset
insert into public.family_members (household_id, name, date_of_birth, sex_at_birth)
values (:'hid', 'Teen', current_date - interval '16 years', 'female') returning id as teen \gset
set local app.bypass_entitlements = 'off';
select id as adult_log from public.hydration_logs where family_member_id = :'adult' \gset

-- ---- HE+self: the linked viewer logs for themself only (06 section 3.4) -----------------------------------
select tests.authenticate_as(:'linked');
select lives_ok(format($$insert into public.hydration_logs (household_id, family_member_id, volume_ml, timing) values (%L, %L, 250, 'pre_meal')$$, :'hid', :'uncle'),
  'a linked viewer logs their own water');
select throws_ok(format($$insert into public.hydration_logs (household_id, family_member_id, volume_ml) values (%L, %L, 150)$$, :'hid', :'son'),
  '42501', null, 'but not water for another member');
select lives_ok(format($$insert into public.fasting_logs (household_id, family_member_id, fast_date, kind, started_at, ended_at, completed) values (%L, %L, current_date - 3, 'sunnah_monday_thursday', now() - interval '3 days 14 hours', now() - interval '3 days', true)$$, :'hid', :'uncle'),
  'their own fast');
select lives_ok(format($$insert into public.weight_tracking (household_id, family_member_id, measured_on, weight_kg) values (%L, %L, current_date, 80)$$, :'hid', :'uncle'),
  'their own weight');
select lives_ok(format($$insert into public.nutrition_journal (household_id, family_member_id, journal_date, mood, energy) values (%L, %L, current_date, 4, 3)$$, :'hid', :'uncle'),
  'their own journal');
select is(tests.affected_rows(format($$update public.hydration_logs set volume_ml = 300 where family_member_id = %L$$, :'uncle')),
  1::bigint, 'edits their own log');
select is(tests.affected_rows(format($$update public.hydration_logs set volume_ml = 300 where id = %L$$, :'adult_log')),
  0::bigint, 'cannot edit another member''s log');
select throws_ok(format($$update public.hydration_logs set family_member_id = %L where family_member_id = %L$$, :'son', :'uncle'),
  '42501', null, 'cannot move their log onto another member');
select is(tests.affected_rows(format($$delete from public.hydration_logs where family_member_id = %L$$, :'uncle')),
  1::bigint, 'deletes their own log (quick undo)');
select is((select count(*) from public.hydration_logs where household_id = :'hid'), 1::bigint, 'still reads the household''s logs');
select tests.clear_authentication();

select tests.authenticate_as(:'viewer');
select throws_ok(format($$insert into public.hydration_logs (household_id, family_member_id, volume_ml) values (%L, %L, 250)$$, :'hid', :'adult'),
  '42501', null, 'an unlinked viewer cannot log');
select is(tests.affected_rows(format($$delete from public.hydration_logs where id = %L$$, :'adult_log')), 0::bigint, 'or delete logs');
select tests.clear_authentication();

select tests.authenticate_as(:'care');
select lives_ok(format($$insert into public.hydration_logs (household_id, family_member_id, volume_ml, beverage) values (%L, %L, 150, 'milk')$$, :'hid', :'son'),
  'a caregiver logs for a child');
select throws_ok(format($$insert into public.hydration_logs (household_id, family_member_id, volume_ml) values (%L, %L, 5000)$$, :'hid', :'son'),
  '23514', null, 'volume is bounded (10 to 3000 ml)');

-- ---- fasting: uniqueness (05 12.4: member + date + kind) ------------------------------------------------------
select throws_ok(format($$insert into public.fasting_logs (household_id, family_member_id, fast_date, kind) values (%L, %L, current_date - 1, 'nafl')$$, :'hid', :'adult'),
  '23505', null, 'one log per member, date and kind');
select lives_ok(format($$insert into public.fasting_logs (household_id, family_member_id, fast_date, kind, exemption_reason) values (%L, %L, current_date - 1, 'qada', 'travel')$$, :'hid', :'adult'),
  'another kind on the same date is allowed');

-- ---- fasting safety (00 section 10, 15 section 5) ----------------------------------------------------------------
select throws_ok(format($$insert into public.fasting_logs (household_id, family_member_id, fast_date, kind, completed) values (%L, %L, current_date, 'intermittent', true)$$, :'hid', :'teen'),
  'P0001', 'CHILD_RULE:intermittent_fasting', 'no intermittent fasting for a 16-year-old');
select throws_ok(format($$insert into public.fasting_logs (household_id, family_member_id, fast_date, kind, completed) values (%L, %L, current_date, 'ramadan', true)$$, :'hid', :'daughter'),
  'P0001', 'CHILD_RULE:fasting_under_7', 'no completed fast for a 4-year-old');
select throws_ok(format($$insert into public.fasting_logs (household_id, family_member_id, fast_date, kind, started_at) values (%L, %L, current_date, 'nafl', now())$$, :'hid', :'daughter'),
  'P0001', 'CHILD_RULE:fasting_under_7', 'no started fast for a 4-year-old');
select throws_ok(format($$insert into public.fasting_logs (household_id, family_member_id, fast_date, kind, is_practice_fast) values (%L, %L, current_date, 'nafl', true)$$, :'hid', :'daughter'),
  'P0001', 'CHILD_RULE:fasting_under_7', 'no practice fast under 7');
select lives_ok(format($$insert into public.fasting_logs (household_id, family_member_id, fast_date, kind, exemption_reason) values (%L, %L, current_date, 'ramadan', 'age')$$, :'hid', :'daughter'),
  'an under-7 may be recorded as exempt (age)');
select lives_ok(format($$insert into public.fasting_logs (household_id, family_member_id, fast_date, kind, is_practice_fast, completed, notes) values (%L, %L, current_date, 'nafl', true, true, 'practice_until_dhuhr')$$, :'hid', :'son'),
  'a 7-year-old logs a practice fast');
select is((select is_practice_fast from public.fasting_logs where family_member_id = :'son'), true, 'and it stays a practice fast');
select lives_ok(format($$insert into public.fasting_logs (household_id, family_member_id, fast_date, kind, is_practice_fast, completed) values (%L, %L, current_date, 'nafl', true, true)$$, :'hid', :'teen'),
  'a 16-year-old may log a full fast');
insert into public.fasting_logs (household_id, family_member_id, fast_date, kind, is_practice_fast, completed)
values (:'hid', :'uncle', current_date, 'nafl', true, true);
select is((select is_practice_fast from public.fasting_logs where family_member_id = :'uncle' and kind = 'nafl'), false,
  'is_practice_fast is cleared for an adult');
select throws_ok(format($$insert into public.fasting_logs (household_id, family_member_id, fast_date, kind, completed) values (%L, %L, current_date, 'intermittent', true)$$, :'hid', :'adult'),
  'P0001', 'FASTING_RULE:intermittent_not_allowed', 'no intermittent fasting while pregnant');
select lives_ok(format($$insert into public.fasting_logs (household_id, family_member_id, fast_date, kind, started_at, ended_at, completed) values (%L, %L, current_date - 5, 'intermittent', now() - interval '5 days 16 hours', now() - interval '5 days', true)$$, :'hid', :'uncle'),
  'an adult logs a 16-hour intermittent fast');
select throws_ok(format($$insert into public.fasting_logs (household_id, family_member_id, fast_date, kind, started_at, ended_at) values (%L, %L, current_date - 6, 'intermittent', now() - interval '6 days 25 hours', now() - interval '6 days')$$, :'hid', :'uncle'),
  '23514', null, 'a logged fast window is at most 24 hours');
select throws_ok(format($$insert into public.fasting_logs (household_id, family_member_id, fast_date, kind, qada_for_hijri_year) values (%L, %L, current_date - 7, 'nafl', 1447)$$, :'hid', :'uncle'),
  '23514', null, 'qada_for_hijri_year only on qada fasts');
select throws_ok(format($$insert into public.fasting_logs (household_id, family_member_id, fast_date, kind, completed, exemption_reason) values (%L, %L, current_date - 8, 'nafl', true, 'illness')$$, :'hid', :'uncle'),
  '23514', null, 'a completed fast has no exemption');

-- ---- weight: adults only, BMI, latest weight ---------------------------------------------------------------------
select throws_ok(format($$insert into public.weight_tracking (household_id, family_member_id, measured_on, weight_kg) values (%L, %L, current_date, 25)$$, :'hid', :'son'),
  'P0001', 'CHILD_RULE:weight_log', 'no weight log for a child');
select throws_ok(format($$insert into public.weight_tracking (household_id, family_member_id, measured_on, weight_kg) values (%L, %L, current_date, 55)$$, :'hid', :'teen'),
  'P0001', 'CHILD_RULE:weight_log', 'or for a 16-year-old');
select throws_ok(format($$insert into public.weight_tracking (household_id, family_member_id, measured_on, weight_kg) values (%L, %L, current_date, 79)$$, :'hid', :'uncle'),
  '23505', null, 'one weight per member per day');
select tests.clear_authentication();

select is((select bmi from public.weight_tracking where family_member_id = :'uncle'), public.compute_bmi(80, 175.0),
  'weight_tracking.bmi comes from the member height');
select is((select weight_kg from public.family_members where id = :'uncle'), 80.00::numeric(5,2), 'the latest weight is copied to the member');
insert into public.weight_tracking (household_id, family_member_id, measured_on, weight_kg) values (:'hid', :'uncle', current_date - 30, 83);
select is((select weight_kg from public.family_members where id = :'uncle'), 80.00::numeric(5,2), 'an older measurement does not overwrite it');
update public.weight_tracking set weight_kg = 78 where family_member_id = :'uncle' and measured_on = current_date;
select results_eq(format($$select weight_kg, bmi from public.weight_tracking where family_member_id = %L and measured_on = current_date$$, :'uncle'),
  format($$values (78.00::numeric(5,2), %s::numeric(5,2))$$, public.compute_bmi(78, 175.0)),
  'an edit recomputes BMI');
select is((select diff from public.audit_log where entity = 'weight_tracking' and action = 'update' order by at desc limit 1),
  '{"bmi": "changed", "weight_kg": "changed"}'::jsonb, 'weight edits are audited with keys only');

-- ---- exemption reason visibility (05 22.4) ---------------------------------------------------------------------
insert into public.fasting_logs (household_id, family_member_id, fast_date, kind, exemption_reason, hijri_date)
values (:'hid', :'adult', date '2026-02-20', 'ramadan', 'menstruation', '1447-09-03'),
       (:'hid', :'adult', date '2026-02-21', 'ramadan', 'menstruation', '1447-09-04'),
       (:'hid', :'adult', date '2026-02-22', 'ramadan', null, '1447-09-05');
update public.fasting_logs set completed = true where family_member_id = :'adult' and hijri_date = '1447-09-05';
insert into public.fasting_logs (household_id, family_member_id, fast_date, kind, completed, qada_for_hijri_year)
values (:'hid', :'adult', date '2026-05-04', 'qada', true, 1447);
select tests.authenticate_as(:'care');
select is((select count(exemption_reason) from public.fasting_logs_visible where family_member_id = :'adult' and kind = 'ramadan'),
  0::bigint, 'a caregiver does not see another member''s exemption reasons');
select tests.clear_authentication();
select tests.authenticate_as(:'owner');
select is((select count(exemption_reason) from public.fasting_logs_visible where family_member_id = :'adult' and kind = 'ramadan'),
  2::bigint, 'the owner (also the linked member) sees them');
select results_eq(format($$select hijri_year::int, missed::int, made_up::int from public.v_qada_balance where family_member_id = %L$$, :'adult'),
  $$values (1447, 2, 1)$$, 'v_qada_balance: two missed Ramadan days, one made up');
select is(tests.affected_rows(format($$update public.households set hijri_offset_days = 1 where id = %L$$, :'hid')), 1::bigint,
  'the owner sets the Hijri offset');
select throws_ok(format($$update public.households set hijri_offset_days = 3 where id = %L$$, :'hid'), '23514', null,
  'the offset stays within plus or minus 2 days');
select tests.clear_authentication();
select tests.authenticate_as(:'linked');
select is((select count(exemption_reason) from public.fasting_logs_visible where family_member_id = :'adult'),
  0::bigint, 'a linked viewer does not see the owner''s reasons');
select is((select count(*) from public.v_qada_balance where family_member_id = :'adult'), 1::bigint,
  'but reads the household qada balance (counts only)');
select tests.clear_authentication();

select * from finish();
rollback;
