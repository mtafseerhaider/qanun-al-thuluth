-- supabase/tests/database/functions/030_accept_household_invitation.test.sql
-- public.accept_household_invitation(uuid, uuid) (Addition beyond 00-foundations, S1-12): atomic
-- acceptance used by the household-invite Edge Function with the service role.
begin;
select plan(12);

select tests.create_user('inv-owner@test.thuluth.app')   as owner \gset
select tests.create_user('inv-invitee@test.thuluth.app') as invitee \gset
select tests.create_user('inv-late@test.thuluth.app')    as late \gset
select tests.create_household(:'owner', 'Invite home') as hid \gset

insert into public.household_invitations (id, household_id, email, role, token_hash, invited_by)
values ('aaaaaaaa-0000-4000-8000-000000000001', :'hid', 'inv-invitee@test.thuluth.app', 'caregiver', 't1', :'owner'),
       ('aaaaaaaa-0000-4000-8000-000000000003', :'hid', 'inv-revoked@test.thuluth.app', 'viewer', 't3', :'owner');
insert into public.household_invitations (id, household_id, email, role, token_hash, invited_by, created_at, expires_at)
values ('aaaaaaaa-0000-4000-8000-000000000002', :'hid', 'inv-late@test.thuluth.app', 'viewer', 't2', :'owner',
        now() - interval '8 days', now() - interval '1 day');
update public.household_invitations set revoked_at = now() where id = 'aaaaaaaa-0000-4000-8000-000000000003';

-- not callable by clients
select ok(not has_function_privilege('authenticated', 'public.accept_household_invitation(uuid, uuid)', 'execute'),
  'authenticated cannot execute accept_household_invitation');
select ok(not has_function_privilege('anon', 'public.accept_household_invitation(uuid, uuid)', 'execute'),
  'anon cannot execute accept_household_invitation');
select ok(has_function_privilege('service_role', 'public.accept_household_invitation(uuid, uuid)', 'execute'),
  'service_role can execute accept_household_invitation');
select tests.authenticate_as(:'invitee');
select throws_ok(format($$select public.accept_household_invitation('aaaaaaaa-0000-4000-8000-000000000001', %L)$$, :'invitee'),
  '42501', null, 'a signed-in user cannot accept through the RPC directly');
select tests.clear_authentication();

-- happy path, as the service role
set local role service_role;
select lives_ok(format($$select public.accept_household_invitation('aaaaaaaa-0000-4000-8000-000000000001', %L)$$, :'invitee'),
  'service role accepts an open invitation');
reset role;
select results_eq(
  format($$select role::text, invited_by from public.household_members where household_id = %L and user_id = %L and deleted_at is null$$, :'hid', :'invitee'),
  format($$values ('caregiver', %L::uuid)$$, :'owner'),
  'the membership carries the invited role and inviter');
select results_eq(
  $$select accepted_at is not null, accepted_by from public.household_invitations where id = 'aaaaaaaa-0000-4000-8000-000000000001'$$,
  format($$values (true, %L::uuid)$$, :'invitee'),
  'the invitation is marked accepted by the user');

set local role service_role;
select throws_ok(format($$select public.accept_household_invitation('aaaaaaaa-0000-4000-8000-000000000001', %L)$$, :'invitee'),
  'P0001', 'INVITE_ALREADY_ACCEPTED', 'an accepted invitation cannot be accepted again');
select throws_ok(format($$select public.accept_household_invitation('aaaaaaaa-0000-4000-8000-000000000002', %L)$$, :'late'),
  'P0001', 'INVITE_EXPIRED', 'an expired invitation is rejected');
select throws_ok(format($$select public.accept_household_invitation('aaaaaaaa-0000-4000-8000-000000000003', %L)$$, :'late'),
  'P0001', 'INVITE_INVALID', 'a revoked invitation is rejected');
select throws_ok(format($$select public.accept_household_invitation(gen_random_uuid(), %L)$$, :'late'),
  'P0001', 'INVITE_INVALID', 'an unknown invitation is rejected');
reset role;
select is((select count(*) from public.household_members where household_id = :'hid' and user_id = :'late'), 0::bigint,
  'failed acceptances create no membership');

select * from finish();
rollback;
