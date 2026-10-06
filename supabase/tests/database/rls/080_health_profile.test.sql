-- supabase/tests/database/rls/080_health_profile.test.sql
-- S2-02 health tables (05 sections 8, 10.1, 12.2, 16.3.2; 0018a; 0022): role matrix inside one
-- household (owner and caregiver write, viewer reads only, nobody hard-deletes), health-data consent
-- on the sensitive tables, ai_assessments written by the service role only, safety_events resolvable
-- by editors only, set_hydration_target keeps one live row, households.preferences and
-- family_members.lifestyle are object columns. Cross-household isolation is in 030.
begin;
select plan(25);

select tests.create_user('hp-owner@test.thuluth.app')   as owner \gset
select tests.create_user('hp-care@test.thuluth.app')    as care \gset
select tests.create_user('hp-viewer@test.thuluth.app')  as viewer \gset
select tests.seed_household(:'owner', 'Health home') as hid \gset
select tests.add_member(:'hid', :'care', 'caregiver');
select tests.add_member(:'hid', :'viewer', 'viewer');
select id as adult from public.family_members where household_id = :'hid' and name = 'Adult' \gset
select id as son from public.family_members where household_id = :'hid' and name = 'Son' \gset
select id as peanut from public.allergens where code = 'peanuts' \gset
select id as sesame from public.allergens where code = 'sesame' \gset

-- ---- viewer: read only --------------------------------------------------------------------------------
select tests.authenticate_as(:'viewer');
select is((select count(*) from public.allergies where household_id = :'hid'), 1::bigint, 'viewer reads allergies');
select is((select count(*) from public.medical_conditions where household_id = :'hid'), 1::bigint, 'viewer reads medical conditions');
select is((select count(*) from public.ai_assessments where household_id = :'hid'), 1::bigint, 'viewer reads assessments');
select throws_ok(format($$insert into public.food_dislikes (household_id, family_member_id, label) values (%L, %L, 'Tinda')$$, :'hid', :'son'),
  '42501', null, 'viewer cannot add a dislike');
select is(tests.affected_rows(format($q$update public.allergies set severity = 'mild' where household_id = %L$q$, :'hid')),
  0::bigint, 'viewer cannot edit allergies');
select tests.clear_authentication();

-- ---- caregiver: health-data consent gates the sensitive tables ----------------------------------------------
select tests.authenticate_as(:'care');
select throws_ok(format($$insert into public.allergies (household_id, family_member_id, allergen_id, severity) values (%L, %L, %L, 'mild')$$, :'hid', :'son', :'sesame'),
  'P0001', 'CONSENT_REQUIRED', 'a caregiver without health_data consent cannot add an allergy');
select throws_ok(format($$insert into public.medical_conditions (household_id, family_member_id, label) values (%L, %L, 'Asthma')$$, :'hid', :'son'),
  'P0001', 'CONSENT_REQUIRED', 'or a medical condition');
select lives_ok(format($$insert into public.food_dislikes (household_id, family_member_id, label) values (%L, %L, 'Tinda')$$, :'hid', :'son'),
  'food dislikes need no health consent');
insert into public.consents (user_id, kind, version) values (:'care', 'health_data', '2026-10');
select lives_ok(format($$insert into public.allergies (household_id, family_member_id, allergen_id, severity) values (%L, %L, %L, 'mild')$$, :'hid', :'son', :'sesame'),
  'with consent the caregiver adds an allergy');
select lives_ok(format($$insert into public.medications (household_id, family_member_id, name) values (%L, %L, 'Inhaler')$$, :'hid', :'son'),
  'and a medication');
select throws_ok(format($$insert into public.allergies (household_id, family_member_id, allergen_id, severity) values (%L, %L, %L, 'severe')$$, :'hid', :'son', :'peanut'),
  '23505', null, 'one row per member and allergen');
select is(tests.affected_rows(format($q$delete from public.allergies where household_id = %L$q$, :'hid')),
  0::bigint, 'no hard delete of health rows');
select throws_ok(format($$insert into public.ai_assessments (household_id, family_member_id, kind, summary, model_route, prompt_version) values (%L, %L, 'intake', 'x', 'x', 'x')$$, :'hid', :'son'),
  '42501', null, 'assessments are written by the service role only');
select throws_ok(format($$select public.set_hydration_target(%L, %L, 1500)$$, :'hid', :'son'),
  '42501', null, 'set_hydration_target is service-role only');
select tests.clear_authentication();

-- withdrawn consent blocks again
select tests.authenticate_as(:'owner');
update public.consents set withdrawn_at = now() where user_id = :'owner' and kind = 'health_data';
select throws_ok(format($$insert into public.pregnancy_profiles (household_id, family_member_id, trimester) values (%L, %L, 1)$$, :'hid', :'adult'),
  'P0001', 'CONSENT_REQUIRED', 'withdrawn health consent blocks new pregnancy profiles');
select tests.clear_authentication();

-- ---- safety_events -------------------------------------------------------------------------------------------
select id as ev from public.safety_events where household_id = :'hid' \gset
select tests.authenticate_as(:'viewer');
select is(tests.affected_rows(format($q$update public.safety_events set resolved_at = now(), resolved_by = %L where id = %L$q$, :'viewer', :'ev')),
  0::bigint, 'a viewer cannot resolve a safety event');
select tests.clear_authentication();
select tests.authenticate_as(:'care');
select throws_ok(format($$insert into public.safety_events (household_id, source, category, urgency) values (%L, 'chat', 'x', 'routine')$$, :'hid'),
  '42501', null, 'users cannot create safety events');
select throws_ok(format($$update public.safety_events set category = 'changed' where id = %L$$, :'ev'),
  '42501', null, 'users cannot rewrite a safety event');
select throws_ok(format($$update public.safety_events set resolved_at = now(), resolved_by = %L where id = %L$$, :'owner', :'ev'),
  '42501', null, 'resolved_by must be the resolving user');
select is(tests.affected_rows(format($q$update public.safety_events set resolved_at = now(), resolved_by = %L, resolved_note = 'Called the GP' where id = %L$q$, :'care', :'ev')),
  1::bigint, 'a caregiver resolves a safety event');
select tests.clear_authentication();

-- ---- set_hydration_target (service role) ------------------------------------------------------------------------
set local role service_role;
select lives_ok(format($$select public.set_hydration_target(%L, %L, 1800, '[{"at":"07:00","ml":250}]', '{"method":"ml_per_kg"}')$$, :'hid', :'adult'),
  'service role replaces a live hydration target');
select lives_ok(format($$select public.set_hydration_target(%L, %L, 1200)$$, :'hid', :'son'),
  'and creates one where none exists');
reset role;
select results_eq(format($$select fm.name, h.daily_ml from public.hydration_targets h join public.family_members fm on fm.id = h.family_member_id
                           where h.household_id = %L and h.deleted_at is null order by fm.name$$, :'hid'),
  $$values ('Adult'::text, 1800), ('Son'::text, 1200)$$, 'one live target per member, updated in place');

-- ---- preferences and lifestyle ------------------------------------------------------------------------------------
select tests.authenticate_as(:'owner');
select is(tests.affected_rows(format($q$update public.households set preferences = '{"cuisine":["pakistani"],"spice_level":"medium"}' where id = %L$q$, :'hid')),
  1::bigint, 'the owner sets household preferences');
select throws_ok(format($$update public.family_members set lifestyle = '[]' where id = %L$$, :'adult'),
  '23514', null, 'family_members.lifestyle must be an object');
select tests.clear_authentication();

select * from finish();
rollback;
