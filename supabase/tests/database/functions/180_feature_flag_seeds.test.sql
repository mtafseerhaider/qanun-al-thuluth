-- supabase/tests/database/functions/180_feature_flag_seeds.test.sql
-- seed/catalog/160_feature_flags.sql: every kill switch an Edge Function reads is seeded ON (a missing row also
-- counts as on, but admins can only flip a row that exists), autism.food_chaining is seeded OFF until the
-- dietitian texture review, and the debug_menu recipe in its description (user_ids + percent 0 + enabled)
-- turns it on for the listed tester only (the seeded rules are {"percent":0,"user_ids":[]}).
begin;
select plan(6);

select is(
  (select array_agg(key order by key) from public.feature_flags
    where key in ('ramadan.generate.enabled','grocery.generate.enabled','growth.compute.enabled','exports.pdf.enabled')
      and enabled and rules = '{}'::jsonb),
  array['exports.pdf.enabled','grocery.generate.enabled','growth.compute.enabled','ramadan.generate.enabled']::text[],
  'the server kill switches are seeded on');
select is((select enabled from public.feature_flags where key = 'autism.food_chaining'), false,
  'food chaining is seeded off until the dietitian review');
-- seed/local/900_dev_fixtures.sql turns debug_menu on for everyone locally, so assert the catalog row shape only.
update public.feature_flags set enabled = false, rules = '{"percent":0,"user_ids":[]}' where key = 'debug_menu';
select ok((select description like '%keep rules.percent at 0%' from public.feature_flags where key = 'debug_menu'),
  'the debug_menu description gives the per-tester recipe');

select tests.create_user('ff-tester@test.thuluth.app') as tester \gset
select tests.create_user('ff-other@test.thuluth.app') as other \gset
update public.feature_flags set enabled = true, rules = jsonb_build_object('percent', 0, 'user_ids', jsonb_build_array(:'tester'))
 where key = 'debug_menu';

select tests.authenticate_as(:'tester');
select is((public.evaluate_feature_flags() ->> 'debug_menu')::boolean, true, 'debug_menu: a listed tester gets it');
select tests.authenticate_as(:'other');
select is((public.evaluate_feature_flags() ->> 'debug_menu')::boolean, false, 'debug_menu: everyone else stays off (percent 0)');
select tests.clear_authentication();

-- The trap the description warns about: enabled with user_ids but no percent rule is on for everyone.
update public.feature_flags set rules = jsonb_build_object('user_ids', jsonb_build_array(:'tester')) where key = 'debug_menu';
select tests.authenticate_as(:'other');
select is((public.evaluate_feature_flags() ->> 'debug_menu')::boolean, true,
  'without percent 0, enabled + user_ids turns the flag on for everyone');
select tests.clear_authentication();

select * from finish();
rollback;
