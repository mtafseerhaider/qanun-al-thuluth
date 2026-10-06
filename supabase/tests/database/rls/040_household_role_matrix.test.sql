-- supabase/tests/database/rls/040_household_role_matrix.test.sql
-- Role matrix inside one household for the Sprint 1 household tables (21-testing-strategy.md 6.5,
-- 11-authentication.md 10.1, 06 section 3.1): family_members and budget_profiles (owner and
-- caregiver write, viewer read-only, no hard delete), household_invitations (owner and caregiver
-- read, owner writes, acceptance service-only), household_members (insert only through
-- household-invite, role changes by the owner), soft_delete RPC and soft-deleted rows.
begin;
select plan(45);

select tests.create_user('rm-owner@test.thuluth.app')   as owner \gset
select tests.create_user('rm-care@test.thuluth.app')    as care \gset
select tests.create_user('rm-viewer@test.thuluth.app')  as viewer \gset
select tests.create_user('rm-newbie@test.thuluth.app')  as newbie \gset
select tests.seed_household(:'owner', 'Role matrix home') as hid \gset
select tests.add_member(:'hid', :'care', 'caregiver');
select tests.add_member(:'hid', :'viewer', 'viewer');
select id as son from public.family_members where household_id = :'hid' and name = 'Son' \gset

-- ---- family_members ------------------------------------------------------------------------
select tests.authenticate_as(:'viewer');
select is((select count(*) from public.family_members where household_id = :'hid'), 3::bigint, 'viewer reads family members');
select throws_ok(format($$insert into public.family_members (household_id, name) values (%L, 'Viewer kid')$$, :'hid'),
  '42501', null, 'viewer cannot add a family member');
select is(tests.affected_rows(format($q$update public.family_members set name = 'Renamed' where id = %L$q$, :'son')),
  0::bigint, 'viewer cannot update a family member');
select is(tests.affected_rows(format($q$delete from public.family_members where id = %L$q$, :'son')),
  0::bigint, 'viewer cannot hard-delete a family member');
select throws_ok(format($$select public.soft_delete('family_members', %L)$$, :'son'),
  '42501', 'FORBIDDEN', 'viewer cannot soft-delete a family member');
select tests.clear_authentication();

select tests.authenticate_as(:'care');
select is((select count(*) from public.family_members where household_id = :'hid'), 3::bigint, 'caregiver reads family members');
select throws_ok(format($$insert into public.family_members (household_id, name, date_of_birth) values (%L, 'Baby', current_date - 100)$$, :'hid'),
  'P0001', 'CHILD_DATA_CONSENT_REQUIRED', 'caregiver without a child_data consent cannot add a minor (0022)');
insert into public.consents (user_id, household_id, kind, version) values (:'care', :'hid', 'child_data', '2026-10');
select lives_ok(format($$insert into public.family_members (household_id, name, date_of_birth) values (%L, 'Baby', current_date - 100)$$, :'hid'),
  'caregiver adds a family member');
select is(tests.affected_rows(format($q$update public.family_members set height_cm = 125 where id = %L$q$, :'son')),
  1::bigint, 'caregiver updates a family member');
select is(tests.affected_rows(format($q$delete from public.family_members where id = %L$q$, :'son')),
  0::bigint, 'caregiver cannot hard-delete (soft delete only)');
select tests.clear_authentication();

select tests.authenticate_as(:'owner');
select lives_ok(format($$insert into public.family_members (household_id, name) values (%L, 'Grandfather')$$, :'hid'),
  'owner adds a family member');
select is(tests.affected_rows(format($q$update public.family_members set weight_kg = 26 where id = %L$q$, :'son')),
  1::bigint, 'owner updates a family member');
select lives_ok(format($$select public.soft_delete('family_members', %L)$$, :'son'),
  'owner soft-deletes a family member through the RPC');
select is((select count(*) from public.family_members where id = :'son'), 0::bigint,
  'soft-deleted family member is invisible to the owner');
select tests.clear_authentication();
select tests.authenticate_as(:'viewer');
select is((select count(*) from public.family_members where id = :'son'), 0::bigint,
  'soft-deleted family member is invisible to the viewer');
select tests.clear_authentication();

-- ---- budget_profiles -----------------------------------------------------------------------
select tests.authenticate_as(:'viewer');
select is((select count(*) from public.budget_profiles where household_id = :'hid'), 1::bigint, 'viewer reads the budget');
select is(tests.affected_rows(format($q$update public.budget_profiles set monthly_amount_minor = 1 where household_id = %L$q$, :'hid')),
  0::bigint, 'viewer cannot change the budget');
select throws_ok(format($$insert into public.budget_profiles (household_id, monthly_amount_minor, currency, is_active) values (%L, 100, 'PKR', false)$$, :'hid'),
  '42501', null, 'viewer cannot create a budget');
select tests.clear_authentication();

select tests.authenticate_as(:'care');
select is(tests.affected_rows(format($q$update public.budget_profiles set monthly_amount_minor = 7000000 where household_id = %L$q$, :'hid')),
  1::bigint, 'caregiver changes the budget');
select throws_ok(format($$insert into public.budget_profiles (household_id, monthly_amount_minor, currency) values (%L, 100, 'PKR')$$, :'hid'),
  '23505', null, 'only one active budget profile per household');
select is(tests.affected_rows(format($q$delete from public.budget_profiles where household_id = %L$q$, :'hid')),
  0::bigint, 'caregiver cannot hard-delete a budget profile');
select tests.clear_authentication();

-- ---- household_invitations -----------------------------------------------------------------
select tests.authenticate_as(:'viewer');
select is((select count(*) from public.household_invitations where household_id = :'hid'), 0::bigint,
  'viewer cannot read invitations');
select throws_ok(format($$insert into public.household_invitations (household_id, email, role, token_hash, invited_by) values (%L, 'x@test.thuluth.app', 'viewer', 'v1', %L)$$, :'hid', :'viewer'),
  '42501', null, 'viewer cannot create an invitation');
select tests.clear_authentication();

select tests.authenticate_as(:'care');
select is((select count(*) from public.household_invitations where household_id = :'hid'), 1::bigint,
  'caregiver reads invitations (06 section 3.1)');
select throws_ok(format($$insert into public.household_invitations (household_id, email, role, token_hash, invited_by) values (%L, 'c@test.thuluth.app', 'viewer', 'c1', %L)$$, :'hid', :'care'),
  '42501', null, 'caregiver cannot insert invitations directly (household-invite creates them)');
select is(tests.affected_rows(format($q$update public.household_invitations set revoked_at = now() where household_id = %L$q$, :'hid')),
  0::bigint, 'caregiver cannot revoke invitations');
select tests.clear_authentication();

select tests.authenticate_as(:'owner');
select is((select count(*) from public.household_invitations where household_id = :'hid'), 1::bigint, 'owner reads invitations');
select lives_ok(format($$insert into public.household_invitations (household_id, email, role, token_hash, invited_by) values (%L, 'o@test.thuluth.app', 'caregiver', 'o1', %L)$$, :'hid', :'owner'),
  'owner can insert an invitation (admin-console retry path, 05 16.3.1)');
select throws_ok(format($$insert into public.household_invitations (household_id, email, role, token_hash, invited_by) values (%L, 'o2@test.thuluth.app', 'owner', 'o2', %L)$$, :'hid', :'owner'),
  '23514', null, 'an invitation can never grant the owner role');
select is(tests.affected_rows(format($q$update public.household_invitations set revoked_at = now() where household_id = %L and email = 'o@test.thuluth.app'$q$, :'hid')),
  1::bigint, 'owner revokes an invitation');
select throws_ok(format($$update public.household_invitations set accepted_at = now() where household_id = %L$$, :'hid'),
  '42501', null, 'acceptance columns are not client-writable');
select throws_ok(format($$delete from public.household_invitations where household_id = %L$$, :'hid'),
  '42501', null, 'invitations are never hard-deleted by clients');
select tests.clear_authentication();

-- ---- household_members -----------------------------------------------------------------------
select tests.authenticate_as(:'owner');
select throws_ok(format($$insert into public.household_members (household_id, user_id, role) values (%L, %L, 'viewer')$$, :'hid', :'newbie'),
  '42501', null, 'owner cannot insert memberships directly (household-invite only)');
select is(tests.affected_rows(format($q$update public.household_members set role = 'viewer' where household_id = %L and user_id = %L$q$, :'hid', :'care')),
  1::bigint, 'owner changes a member role');
select tests.clear_authentication();
select tests.authenticate_as(:'care');
select throws_ok(format($$insert into public.household_members (household_id, user_id, role) values (%L, %L, 'viewer')$$, :'hid', :'newbie'),
  '42501', null, 'caregiver cannot insert memberships');
select is(tests.affected_rows(format($q$update public.household_members set role = 'caregiver' where household_id = %L and user_id = %L$q$, :'hid', :'viewer')),
  0::bigint, 'a non-owner cannot change roles');
select lives_ok(format($$select public.soft_delete('household_members', (select id from public.household_members where household_id = %L and user_id = %L))$$, :'hid', :'care'),
  'a member can leave the household');
select is((select count(*) from public.household_members where household_id = :'hid'), 0::bigint,
  'after leaving, the former member sees no memberships of that household');
select tests.clear_authentication();
select tests.authenticate_as(:'viewer');
select throws_ok(format($$select public.soft_delete('household_members', (select id from public.household_members where household_id = %L and role = 'owner'))$$, :'hid'),
  '42501', 'OWNER_CANNOT_LEAVE', 'the owner membership cannot be removed through soft_delete');
select tests.clear_authentication();

-- ---- households: entitlement through the client path -------------------------------------------
select tests.authenticate_as(:'owner');
select throws_ok(format($$insert into public.households (owner_user_id, name) values (%L, 'Second home')$$, :'owner'),
  'P0001', 'LIMIT_REACHED:households', 'free owner hits the household limit at the 2nd household');
select tests.clear_authentication();

-- ---- linked member helper ---------------------------------------------------------------------
select id as adult from public.family_members where household_id = :'hid' and name = 'Adult' \gset
select tests.authenticate_as(:'owner');
select ok(public.is_linked_member(:'adult'), 'owner is the linked user of the Adult member');
select ok(not public.is_linked_member((select id from public.family_members where household_id = :'hid' and name = 'Daughter')),
  'owner is not linked to the Daughter member');
select tests.clear_authentication();
select tests.authenticate_as(:'viewer');
select ok(not public.is_linked_member(:'adult'), 'is_linked_member is false for another user');
select ok(public.has_household_role(:'hid', array['viewer']::public.household_role[]), 'has_household_role matches the viewer role');
select ok(not public.has_household_role(:'hid', array['owner','caregiver']::public.household_role[]), 'has_household_role rejects other roles');
select tests.clear_authentication();

select * from finish();
rollback;
