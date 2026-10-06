-- supabase/tests/database/rls/170_exports_source_reports.test.sql
-- S6-02 exports (05 13.8, 16.3 "requester and household editors read; service writes", 0025c account_data, S6-01
-- status vocabulary) and S6-14 report-a-source (01 FR-ISL-10: own reports, admin queue, three independent reports
-- send a verified source back to review), plus ai_jobs (0018b: members read, service role writes).
begin;
select plan(27);

select tests.create_user('ex-owner@test.thuluth.app')  as owner \gset
select tests.create_user('ex-care@test.thuluth.app')   as care \gset
select tests.create_user('ex-viewer@test.thuluth.app') as viewer \gset
select tests.create_user('ex-other@test.thuluth.app')  as other \gset
select tests.seed_household(:'owner', 'Export home') as hid \gset
select tests.add_member(:'hid', :'care', 'caregiver');
select tests.add_member(:'hid', :'viewer', 'viewer');
insert into public.exports (household_id, user_id, kind, status, storage_path)
values (:'hid', :'viewer', 'meal_plan', 'ready', :'hid' || '/viewer-export.pdf');
insert into public.exports (household_id, user_id, kind) values (null, :'other', 'account_data');

-- ---- exports ----------------------------------------------------------------------------------------------------------
select tests.authenticate_as(:'care');
select is((select count(*) from public.exports where household_id = :'hid'), 2::bigint, 'a caregiver reads every household export');
select throws_ok(format($$insert into public.exports (household_id, user_id, kind) values (%L, %L, 'meal_plan')$$, :'hid', :'care'),
  '42501', null, 'clients cannot create export rows (export-pdf does)');
select throws_ok(format($$update public.exports set status = 'expired' where household_id = %L$$, :'hid'),
  '42501', null, 'or change them');
select tests.clear_authentication();
select tests.authenticate_as(:'viewer');
select is((select count(*) from public.exports where household_id = :'hid'), 1::bigint, 'a viewer reads only their own export');
select tests.clear_authentication();
select tests.authenticate_as(:'other');
select is((select count(*) from public.exports), 1::bigint, 'an account-data export is visible to its requester only');
select tests.clear_authentication();
select tests.authenticate_as(:'owner');
select is((select count(*) from public.exports where kind = 'account_data'), 0::bigint, 'not to anyone else');
select tests.clear_authentication();

select throws_ok(format($$insert into public.exports (household_id, user_id, kind, status) values (%L, %L, 'meal_plan', 'queued')$$, :'hid', :'owner'),
  '23514', null, 'status uses the 06 vocabulary (processing, ready, failed, expired)');
select throws_ok(format($$insert into public.exports (household_id, user_id, kind, status) values (%L, %L, 'meal_plan', 'ready')$$, :'hid', :'owner'),
  '23514', null, 'a ready export has a storage path');
select throws_ok(format($$insert into public.exports (household_id, user_id, kind) values (null, %L, 'meal_plan')$$, :'owner'),
  '23514', null, 'household exports need a household');
select throws_ok(format($$insert into public.exports (household_id, user_id, kind) values (%L, %L, 'account_data')$$, :'hid', :'owner'),
  '23514', null, 'account-data exports have none');
select is((select status || ':' || (expires_at - created_at)::text from public.exports where user_id = :'other'),
  'processing:7 days', 'new exports start processing and expire after 7 days');

-- ---- ai_jobs ----------------------------------------------------------------------------------------------------------
select tests.authenticate_as(:'viewer');
select is((select count(*) from public.ai_jobs where household_id = :'hid'), 1::bigint, 'household members read AI jobs');
select throws_ok(format($$insert into public.ai_jobs (household_id, kind) values (%L, 'plan_adjust')$$, :'hid'),
  '42501', null, 'clients cannot create AI jobs');
select tests.clear_authentication();
select tests.authenticate_as(:'owner');
select throws_ok(format($$update public.ai_jobs set status = 'cancelled' where household_id = %L$$, :'hid'), '42501', null,
  'even the owner cannot change an AI job');
select tests.clear_authentication();

-- ---- source_reports -----------------------------------------------------------------------------------------------------
select id as src from public.islamic_sources where kind = 'quran' order by code limit 1 \gset
insert into public.source_verifications (islamic_source_id, status, action, reviewer_name, reviewer_credentials, method)
values (:'src', 'verified', 'approve', 'Reviewer A', 'x', 'takhrij'),
       (:'src', 'verified', 'approve', 'Reviewer B', 'x', 'cross_reference');
select is((select verification_status::text from public.islamic_sources where id = :'src'), 'verified', 'fixture: the source is verified');

select tests.authenticate_as(:'care');
select lives_ok(format($$insert into public.source_reports (islamic_source_id, reason, note) values (%L, 'wrong_translation', 'Second clause is missing')$$, :'src'),
  'a user reports a source');
select is((select user_id from public.source_reports where islamic_source_id = :'src'), :'care'::uuid, 'the reporter defaults to the caller');
select throws_ok(format($$insert into public.source_reports (islamic_source_id, reason) values (%L, 'wrong_grade')$$, :'src'),
  '23505', null, 'one open report per user and source');
select throws_ok(format($$insert into public.source_reports (islamic_source_id, reason, user_id) values (%L, 'other', %L)$$, :'src', :'owner'),
  '42501', null, 'a user cannot report on someone else''s behalf');
select is(tests.affected_rows(format($$update public.source_reports set status = 'resolved', resolved_at = now() where islamic_source_id = %L$$, :'src')),
  0::bigint, 'a reporter cannot triage');
select tests.clear_authentication();
select tests.authenticate_as(:'viewer');
select is((select count(*) from public.source_reports), 0::bigint, 'users see only their own reports');
select lives_ok(format($$insert into public.source_reports (islamic_source_id, reason) values (%L, 'wrong_citation')$$, :'src'),
  'a second user reports the source');
select tests.clear_authentication();
select is((select verification_status::text from public.islamic_sources where id = :'src'), 'verified', 'two reports do not change the source');
select tests.authenticate_as(:'owner');
select lives_ok(format($$insert into public.source_reports (islamic_source_id, reason) values (%L, 'wrong_grade')$$, :'src'),
  'a third independent report');
select tests.clear_authentication();
select is((select verification_status::text from public.islamic_sources where id = :'src'), 'in_review',
  'three independent reports send the source back to review (FR-ISL-10)');

select tests.authenticate_as(:'owner');
select is((select count(*) from public.v_source_report_queue), 0::bigint, 'the queue view is empty for users');
select tests.clear_authentication();
select tests.authenticate_as(:'other', '{"role":"admin"}');
select results_eq($$select target_kind, open_reports::int, distinct_reporters::int from public.v_source_report_queue$$,
  $$values ('islamic_source', 3, 3)$$, 'admins see the queue grouped by target');
select tests.clear_authentication();

select * from finish();
rollback;
