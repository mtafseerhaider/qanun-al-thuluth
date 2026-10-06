-- supabase/tests/database/functions/130_account_rights.test.sql
-- S6-10 DB side (06 sections 4.12 and 4.13, 16 sections 7.4 and 12, FR-SET-05/06): deletion request with a 30-day grace
-- period, cancel, blockers (ownership transfer), erasure executor (sole-owner households deleted, memberships elsewhere
-- removed, analytics events deleted, ledger and tombstone written), account-data export, service-role only grants and
-- the executor cron; plus the 12-month AI memory deletion after a premium lapse (17 section 10.3).
begin;
select plan(34);

select tests.create_user('ar-solo@test.thuluth.app')   as solo \gset
select tests.create_user('ar-shared@test.thuluth.app') as shared_owner \gset
select tests.create_user('ar-care@test.thuluth.app')   as care \gset
select tests.seed_household(:'solo', 'Solo home') as solo_hid \gset
select tests.seed_household(:'shared_owner', 'Shared home') as shared_hid \gset
select tests.add_member(:'shared_hid', :'care', 'caregiver');
select tests.add_member(:'shared_hid', :'solo', 'viewer');

-- ---- grants ---------------------------------------------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.request_account_deletion(uuid, text, boolean)', 'execute')
          and not has_function_privilege('authenticated', 'public.execute_account_erasure(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.cancel_account_deletion(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.account_export_user_data(uuid)', 'execute'),
  'deletion and export RPCs are not callable by clients');
select ok(has_function_privilege('service_role', 'public.execute_account_erasure(uuid)', 'execute'), 'service role runs the executor');
select ok(exists (select 1 from cron.job where jobname = 'account-delete-executor' and command like '%deletion_scheduled_for <= now()%'),
  'account-delete-executor is scheduled and only fires while a deletion is due');

-- ---- blockers and request ---------------------------------------------------------------------------------------------------
select is(public.account_deletion_blockers(:'shared_owner'), jsonb_build_object('blocked', true, 'households', jsonb_build_array(:'shared_hid'::uuid)),
  'an owner with other members is blocked');
select throws_ok(format($$select public.request_account_deletion(%L)$$, :'shared_owner'),
  'P0001', 'OWNERSHIP_TRANSFER_REQUIRED', 'and cannot request deletion until ownership is transferred');
select is((public.account_deletion_blockers(:'solo') ->> 'blocked')::boolean, false, 'a sole owner is not blocked');
select throws_ok(format($$select public.request_account_deletion(%L, 'privacy', true)$$, :'solo'),
  'P0001', 'VALIDATION_FAILED', 'only an under-age decline skips the grace period');
select is(date_trunc('minute', public.request_account_deletion(:'solo', 'privacy')), date_trunc('minute', now() + interval '30 days'),
  'deletion is scheduled 30 days ahead');
select results_eq(format($$select deletion_reason, deletion_requested_at is not null from public.users where id = %L$$, :'solo'),
  $$values ('privacy'::text, true)$$, 'the reason and request time are recorded');
select results_eq(format($$select kind, status from public.data_subject_requests where user_id = %L$$, :'solo'),
  $$values ('erasure'::text, 'received'::text)$$, 'an erasure DSR is opened');
select ok(exists (select 1 from public.audit_log where entity = 'users' and entity_id = :'solo' and action = 'erasure' and diff ->> 'stage' = 'requested'),
  'the request is audited');
select throws_ok(format($$select public.request_account_deletion(%L)$$, :'solo'),
  'P0001', 'ACCOUNT_DELETION_PENDING', 'a second request is refused');
select tests.authenticate_as(:'solo');
select is((select deletion_scheduled_for is not null from public.users where id = :'solo'), true, 'the user reads their scheduled deletion');
select throws_ok(format($$update public.users set deletion_scheduled_for = null where id = %L$$, :'solo'),
  '42501', null, 'but cannot clear it directly');
select tests.clear_authentication();
select throws_ok(format($$select public.execute_account_erasure(%L)$$, :'solo'),
  'P0001', 'ACCOUNT_DELETION_NOT_DUE', 'the executor refuses a deletion still in its grace period');

-- ---- cancel ---------------------------------------------------------------------------------------------------------------------
select is(public.cancel_account_deletion(:'solo'), true, 'the user cancels inside the grace period');
select results_eq(format($$select deletion_scheduled_for, deletion_reason from public.users where id = %L$$, :'solo'),
  $$values (null::timestamptz, null::text)$$, 'cancelling clears the schedule');
select is((select status from public.data_subject_requests where user_id = :'solo'), 'cancelled', 'and closes the DSR as cancelled');
select throws_ok(format($$select public.cancel_account_deletion(%L)$$, :'solo'),
  'P0001', 'ACCOUNT_DELETION_NOT_PENDING', 'nothing left to cancel');

-- ---- account-data export -------------------------------------------------------------------------------------------------------------
select ok(public.account_export_user_data(:'solo') ?& array['user','consents','household_members','chat_sessions','chat_messages','notifications'],
  'the export carries the user''s own rows');
select is(jsonb_array_length(public.account_export_user_data(:'solo') -> 'household_members'), 2, 'including both memberships');

-- ---- immediate under-age deletion and execution -------------------------------------------------------------------------------------------
insert into public.analytics_events (user_id, event, occurred_at) values (:'solo', 'app_opened', now());
select lives_ok(format($$select public.request_account_deletion(%L, 'under_age', true)$$, :'solo'), 'an under-age decline is due at once');
select lives_ok(format($$select public.execute_account_erasure(%L)$$, :'solo'), 'the executor runs');
select is((select count(*) from public.households where id = :'solo_hid'), 0::bigint, 'the sole-owner household is deleted');
select is((select count(*) from public.family_members where household_id = :'solo_hid'), 0::bigint, 'with every household row');
select is((select count(*) from public.household_members where user_id = :'solo'), 0::bigint, 'memberships elsewhere are removed');
select is((select count(*) from public.households where id = :'shared_hid'), 1::bigint, 'other households stay');
select is((select count(*) from public.analytics_events where user_id = :'solo'), 0::bigint, 'analytics events are deleted');
select is((select count(*) from public.deleted_user_ledger), 1::bigint, 'the deletion ledger records a hash');
select ok((select user_id_hash <> :'solo' and user_id_hash ~ '^[0-9a-f]{64}$' from public.deleted_user_ledger), 'only a hash, never the id');
select ok(exists (select 1 from public.audit_log where action = 'erasure' and diff ->> 'stage' = 'executed' and actor_user_id is null),
  'a tombstone without an actor is audited');
select is((select status from public.data_subject_requests where user_id = :'solo' and status <> 'cancelled'), 'completed',
  'the erasure DSR is completed');

-- ---- AI memories: 12 months after the premium lapse, with notice -----------------------------------------------------------------------------
update public.households set premium_lapsed_at = now() - interval '13 months', ai_memory_notice_at = now() - interval '40 days'
 where id = :'shared_hid';
select is(private.ai_memory_retention() ->> 'deleted', '1', 'memories are deleted 12 months after the lapse and 30+ days after the notice');
insert into public.ai_memories (household_id, fact, embedding)
values (:'shared_hid', 'Prefers chai after dinner', array_fill(0.01::real, array[1536])::extensions.vector);
update public.households set premium_lapsed_at = now() - interval '11 months 2 days', ai_memory_notice_at = null where id = :'shared_hid';
select results_eq($$select (r ->> 'noticed')::int, (r ->> 'deleted')::int from (select private.ai_memory_retention() as r) x$$,
  $$values (1, 0)$$, 'at 11 months the notice is due and nothing is deleted');

select * from finish();
rollback;
