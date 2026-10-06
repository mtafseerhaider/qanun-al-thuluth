-- supabase/tests/database/functions/160_due_reassessments.test.sql
-- due_reassessments (launch follow-up to S6-15, FR-AI-11): latest intake/periodic assessment per live member, due
-- when created at or before p_before, oldest first, capped by p_limit; household filter; soft-deleted members and
-- households skipped; argument validation; service role only.
begin;
select plan(14);

select tests.create_user('dr-one@test.thuluth.app') as one \gset
select tests.create_user('dr-two@test.thuluth.app') as two \gset
select tests.seed_household(:'one', 'Reassess one') as h1 \gset
select tests.seed_household(:'two', 'Reassess two') as h2 \gset
select id as h1_adult from public.family_members where household_id = :'h1' and name = 'Adult' \gset
select id as h1_son from public.family_members where household_id = :'h1' and name = 'Son' \gset
select id as h1_daughter from public.family_members where household_id = :'h1' and name = 'Daughter' \gset
select id as h2_adult from public.family_members where household_id = :'h2' and name = 'Adult' \gset
select id as h2_daughter from public.family_members where household_id = :'h2' and name = 'Daughter' \gset

-- The fixture gives each Adult an intake now(); age them. Son: an old intake superseded by a recent periodic run.
-- Daughter (h1): only a plan_rationale row, which never counts. Daughter (h2): an old intake, then soft-deleted.
update public.ai_assessments set created_at = now() - interval '40 days' where family_member_id = :'h1_adult';
update public.ai_assessments set created_at = now() - interval '30 days' where family_member_id = :'h2_adult';
insert into public.ai_assessments (household_id, family_member_id, kind, summary, model_route, prompt_version, created_at)
values (:'h1', :'h1_son', 'intake', 'Son intake', 'deterministic', 'intake_assess@1', now() - interval '60 days'),
       (:'h1', :'h1_son', 'periodic', 'Son periodic', 'deterministic', 'reassess@1', now() - interval '10 days'),
       (:'h1', :'h1_daughter', 'plan_rationale', 'Plan note', 'plan.generate', 'plan@1', now() - interval '50 days'),
       (:'h2', :'h2_daughter', 'intake', 'Daughter intake', 'deterministic', 'intake_assess@1', now() - interval '90 days');
update public.family_members set deleted_at = now() where id = :'h2_daughter';

-- ---- grants ---------------------------------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.due_reassessments(timestamptz, int, uuid[])', 'execute')
          and not has_function_privilege('authenticated', 'public.due_reassessments(timestamptz, int, uuid[])', 'execute'),
  'due_reassessments is not callable by clients');
select ok(has_function_privilege('service_role', 'public.due_reassessments(timestamptz, int, uuid[])', 'execute'),
  'the service role runs due_reassessments');
select ok(not (select prosecdef from pg_proc where oid = 'public.due_reassessments(timestamptz, int, uuid[])'::regprocedure)
          and (select proconfig from pg_proc where oid = 'public.due_reassessments(timestamptz, int, uuid[])'::regprocedure)
              = array['search_path=""'],
  'security invoker with search_path pinned to the empty path');

select tests.authenticate_as(:'one');
select throws_ok(format($$select * from public.due_reassessments(now(), 10, array[%L]::uuid[])$$, :'h1'),
  '42501', null, 'a household owner cannot call it');
select tests.clear_authentication();

set local role service_role;

-- ---- due selection ---------------------------------------------------------------------------------------------------------
select is(
  (select array_agg(family_member_id order by ord)
   from public.due_reassessments(now() - interval '28 days', 100, array[:'h1', :'h2']::uuid[]) with ordinality as t(id, household_id, family_member_id, kind, created_at, energy_targets, macro_targets, hydration_targets, risk_flags, input_snapshot, ord)),
  array[:'h1_adult', :'h2_adult']::uuid[],
  'members whose latest intake/periodic run is 28+ days old, oldest first (recent periodic, plan_rationale and deleted members skipped)');
select is(
  (select count(*) from public.due_reassessments(now() - interval '28 days', 1, array[:'h1', :'h2']::uuid[])),
  1::bigint, 'p_limit caps the result');
select is(
  (select family_member_id from public.due_reassessments(now() - interval '28 days', 1, array[:'h1', :'h2']::uuid[])),
  :'h1_adult'::uuid, 'the cap keeps the longest-waiting member');
select is(
  (select array_agg(family_member_id) from public.due_reassessments(now() - interval '28 days', 100, array[:'h2']::uuid[])),
  array[:'h2_adult']::uuid[], 'p_household_ids filters households');
select is(
  (select kind from public.due_reassessments(now(), 100, array[:'h1']::uuid[]) where family_member_id = :'h1_son'),
  'periodic', 'a forced run (p_before = now) returns each member''s latest row');
select is(
  (select count(*) from public.due_reassessments(now(), 100, array[:'h1']::uuid[])),
  2::bigint, 'a forced run returns every live member with an intake or periodic row');
select ok(
  (select count(*) from public.due_reassessments(now() - interval '28 days', 1000) where household_id in (:'h1', :'h2')) = 2,
  'no household filter covers every household');

-- ---- validation -------------------------------------------------------------------------------------------------------------
select throws_ok($$select * from public.due_reassessments(now(), 0)$$, 'P0001', 'VALIDATION_FAILED', 'p_limit below 1 is rejected');
select throws_ok($$select * from public.due_reassessments(now(), 1001)$$, 'P0001', 'VALIDATION_FAILED', 'p_limit above 1000 is rejected');

reset role;
update public.households set deleted_at = now() where id = :'h2';
set local role service_role;
select is(
  (select count(*) from public.due_reassessments(now(), 100, array[:'h2']::uuid[])),
  0::bigint, 'soft-deleted households are skipped');
reset role;

select * from finish();
rollback;
