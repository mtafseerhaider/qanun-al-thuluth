-- supabase/tests/database/functions/120_growth_lms_coaching_tips.test.sql
-- S6-02 growth reference seed (05 section 19 order 6: WHO 2006 and WHO 2007 LMS, spot values from the published
-- tables) and S6-07 coaching tips (40 tips, evidence-linked, hidden until verified; publish gate; child content rule).
begin;
select plan(24);

-- ---- growth_reference_lms seed -------------------------------------------------------------------------------------
select results_eq($$select reference, count(*)::int from public.growth_reference_lms group by 1 order by 1$$,
  $$values ('who_2006', 14616), ('who_2007', 792)$$, 'WHO 2006 daily and WHO 2007 monthly rows are seeded (CDC pending)');
select results_eq($$select l, m, s from public.growth_reference_lms where reference = 'who_2006' and indicator = 'wfa' and sex = 'male' and age_days = 0$$,
  $$values (0.3487::numeric, 3.3464::numeric, 0.14602::numeric)$$, 'WHO 2006 boys weight-for-age at birth: L 0.3487, M 3.3464, S 0.14602 (05 section 19)');
select results_eq($$select l, m, s from public.growth_reference_lms where reference = 'who_2006' and indicator = 'lhfa' and sex = 'male' and age_days = 1826$$,
  $$values (1::numeric, 109.9593::numeric, 0.04214::numeric)$$, 'WHO 2006 boys height-for-age at 1826 days');
select results_eq($$select l, m, s from public.growth_reference_lms where reference = 'who_2007' and indicator = 'lhfa' and sex = 'male' and age_months = 61$$,
  $$values (1::numeric, 110.2647::numeric, 0.04164::numeric)$$, 'WHO 2007 boys height-for-age at 61 months');
select results_eq($$select min(age_months), max(age_months) from public.growth_reference_lms where reference = 'who_2007' and indicator = 'wfa'$$,
  $$values (61.00::numeric, 120.00::numeric)$$, 'WHO 2007 weight-for-age stops at 120 months');
select results_eq($$select min(age_months), max(age_months) from public.growth_reference_lms where reference = 'who_2007' and indicator = 'bmifa'$$,
  $$values (61.00::numeric, 228.00::numeric)$$, 'WHO 2007 BMI-for-age runs 61 to 228 months');
select is((select count(distinct (indicator, sex)) from public.growth_reference_lms where reference = 'who_2006')::int, 8,
  'WHO 2006 has wfa, lhfa, bmifa and hcfa for both sexes');
select is((select count(*) from public.growth_reference_lms where reference = 'who_2006' and age_days is null), 0::bigint,
  'every WHO 2006 row is keyed by age in days');
select throws_ok($$insert into public.growth_reference_lms (reference, indicator, sex, age_months, l, m, s) values ('who_2006','wfa','unspecified',1,1,1,0.1)$$,
  '23514', null, 'reference rows are female or male');

-- ---- coaching tips seed (S6-07) ---------------------------------------------------------------------------------------
select results_eq($$select module, count(*)::int from public.coaching_tips group by 1 order by 1$$,
  $$values ('autism', 10), ('general', 10), ('picky', 12), ('ramadan', 8)$$, '40 tips across the four modules');
select is((select count(*) from public.coaching_tips where review_status <> 'unverified'), 0::bigint, 'every seeded tip is unverified');
select is((select count(*) from public.coaching_tips where evidence_id is null), 0::bigint, 'every tip links an existing evidence row');
select is((select count(*) from public.coaching_tips t where not (t.body_i18n ? 'en') or t.body_i18n ? 'ur'), 0::bigint,
  'English only; Urdu pending');
select is((select count(*) from public.coaching_tips where module = 'ramadan' and age_min_months < 84 and body_i18n ->> 'en' !~* 'do not fast'),
  0::bigint, 'Ramadan tips that reach under-7s say they do not fast');

select tests.create_user('tip-user@test.thuluth.app') as uid \gset
select tests.create_user('tip-editor@test.thuluth.app') as editor \gset
select tests.authenticate_as(:'uid');
select is((select count(*) from public.coaching_tips), 0::bigint, 'users see no unverified tips');
select tests.clear_authentication();
select tests.authenticate_as(:'editor', '{"role":"content_editor"}');
select is((select count(*) from public.coaching_tips), 40::bigint, 'content editors see the drafts');
select throws_ok($$update public.coaching_tips set review_status = 'verified', body_i18n = body_i18n || '{"ur":"test"}' where code = 'tip.picky.no_pressure'$$,
  '42501', null, 'a content editor cannot publish (content_admin only)');
select tests.clear_authentication();

-- publish gate and child rule
select throws_ok($$update public.coaching_tips set review_status = 'verified' where code = 'tip.picky.no_pressure'$$,
  '23514', 'COACHING_TIP_MISSING_TEXT', 'publishing needs Urdu text');
select throws_ok($$update public.coaching_tips set review_status = 'verified', body_i18n = body_i18n || '{"ur":"test"}', evidence_id = null where code = 'tip.picky.no_pressure'$$,
  '23514', 'COACHING_TIP_MISSING_EVIDENCE', 'publishing needs evidence');
select lives_ok($$update public.coaching_tips set review_status = 'verified', body_i18n = body_i18n || '{"ur":"test"}' where code = 'tip.picky.no_pressure'$$,
  'a tip with en, ur and evidence can be verified');
select tests.authenticate_as(:'uid');
select is((select array_agg(code) from public.coaching_tips), array['tip.picky.no_pressure'], 'users see verified active tips');
select tests.clear_authentication();
update public.coaching_tips set is_active = false where code = 'tip.picky.no_pressure';
select tests.authenticate_as(:'uid');
select is((select count(*) from public.coaching_tips), 0::bigint, 'and not inactive ones');
select tests.clear_authentication();
select throws_ok($$insert into public.coaching_tips (code, module, age_min_months, age_max_months, body_i18n) values ('tip.test.kcal', 'picky', 24, 120, '{"en":"Aim for 1200 kcal a day"}')$$,
  'P0001', 'CHILD_RULE:calorie_content', 'tips reaching children cannot talk about calories');
select lives_ok($$insert into public.coaching_tips (code, module, age_min_months, age_max_months, body_i18n) values ('tip.test.adult_kcal', 'general', 216, 1200, '{"en":"Adult energy needs are about 2000 calories"}')$$,
  'adult-only tips may');

select * from finish();
rollback;
