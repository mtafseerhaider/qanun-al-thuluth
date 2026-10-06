-- supabase/tests/database/rls/010_tenancy_isolation.test.sql
-- Household isolation and the identity/tenancy role matrix for users, households, household_members
-- (21-testing-strategy.md 6.4 and 6.5, 05-database-schema.md section 21 items 2 and 3).
begin;
select plan(29);

-- Household A: owner, caregiver, viewer. Household B: owner, caregiver. Plus an outsider.
select tests.create_user('ownerA@test.thuluth.app')  as owner_a   \gset
select tests.create_user('careA@test.thuluth.app')   as care_a    \gset
select tests.create_user('viewerA@test.thuluth.app') as viewer_a  \gset
select tests.create_user('ownerB@test.thuluth.app')  as owner_b   \gset
select tests.create_user('careB@test.thuluth.app')   as care_b    \gset
select tests.create_user('outsider@test.thuluth.app') as outsider \gset
select tests.create_user('newbie@test.thuluth.app')  as newbie    \gset

select tests.create_household(:'owner_a', 'Household A') as hid_a \gset
select tests.create_household(:'owner_b', 'Household B') as hid_b \gset
select tests.add_member(:'hid_a', :'care_a', 'caregiver');
select tests.add_member(:'hid_a', :'viewer_a', 'viewer');
select tests.add_member(:'hid_b', :'care_b', 'caregiver');

-- ---- cross-household reads, owner of B -------------------------------------------------
select tests.authenticate_as(:'owner_b');
select is((select count(*) from public.households where id = :'hid_a'), 0::bigint,
  'owner of B cannot read household A');
select is((select count(*) from public.household_members where household_id = :'hid_a'), 0::bigint,
  'owner of B cannot read memberships of household A');
select is((select count(*) from public.users where id in (:'owner_a', :'care_a', :'viewer_a')), 0::bigint,
  'owner of B cannot read profiles of household A users');
select is((select count(*) from public.households), 1::bigint,
  'owner of B sees exactly their own household');

-- ---- cross-household writes, owner of B ------------------------------------------------
select is(
  tests.affected_rows(format($q$update public.households set name = 'Hijacked' where id = %L$q$, :'hid_a')),
  0::bigint, 'owner of B cannot update household A');
select throws_ok(
  format($$insert into public.household_members (household_id, user_id, role) values (%L, %L, 'caregiver')$$, :'hid_a', :'owner_b'),
  '42501', null, 'owner of B cannot add themselves to household A');
select is(
  tests.affected_rows(format($q$delete from public.household_members where household_id = %L$q$, :'hid_a')),
  0::bigint, 'owner of B cannot delete memberships of household A');
select throws_ok(
  format($$insert into public.households (owner_user_id, name) values (%L, 'Forged')$$, :'outsider'),
  '42501', null, 'a user cannot create a household owned by someone else');
select tests.clear_authentication();

-- ---- caregiver of B --------------------------------------------------------------------
select tests.authenticate_as(:'care_b');
select is((select count(*) from public.households where id = :'hid_a'), 0::bigint,
  'caregiver of B cannot read household A');
select is((select count(*) from public.household_members where household_id = :'hid_a'), 0::bigint,
  'caregiver of B cannot read memberships of household A');
select is(
  tests.affected_rows(format($q$update public.household_members set role = 'viewer' where household_id = %L$q$, :'hid_a')),
  0::bigint, 'caregiver of B cannot change roles in household A');
select tests.clear_authentication();

-- ---- outsider (no household) -----------------------------------------------------------
select tests.authenticate_as(:'outsider');
select is((select count(*) from public.households), 0::bigint, 'outsider sees no households');
select is((select count(*) from public.household_members), 0::bigint, 'outsider sees no memberships');
select is((select array_agg(id) from public.users), array[:'outsider'::uuid], 'outsider sees only their own profile');
select tests.clear_authentication();

-- ---- inside household A ----------------------------------------------------------------
select tests.authenticate_as(:'viewer_a');
select is((select count(*) from public.households where id = :'hid_a'), 1::bigint, 'viewer reads their household');
select is((select count(*) from public.household_members where household_id = :'hid_a'), 3::bigint,
  'viewer reads all memberships of their household');
select is((select count(*) from public.users where id in (:'owner_a', :'care_a', :'viewer_a')), 3::bigint,
  'co-members can read each other''s profiles');
select throws_ok(
  format($$insert into public.household_members (household_id, user_id, role) values (%L, %L, 'viewer')$$, :'hid_a', :'newbie'),
  '42501', null, 'viewer cannot add members');
select is(
  tests.affected_rows(format($q$update public.households set name = 'Renamed' where id = %L$q$, :'hid_a')),
  0::bigint, 'viewer cannot update the household');
select tests.clear_authentication();

select tests.authenticate_as(:'care_a');
select is(
  tests.affected_rows(format($q$update public.households set name = 'Renamed' where id = %L$q$, :'hid_a')),
  0::bigint, 'caregiver cannot update household settings (owner only)');
select throws_ok(
  format($$insert into public.household_members (household_id, user_id, role) values (%L, %L, 'viewer')$$, :'hid_a', :'newbie'),
  '42501', null, 'caregiver cannot add members (owner only)');
select tests.clear_authentication();

select tests.authenticate_as(:'owner_a');
select is(
  tests.affected_rows(format($q$update public.households set name = 'Renamed' where id = %L$q$, :'hid_a')),
  1::bigint, 'owner updates household settings');
select throws_ok(
  format($$insert into public.household_members (household_id, user_id, role) values (%L, %L, 'viewer')$$, :'hid_a', :'newbie'),
  '42501', null, 'owner cannot insert memberships directly (Sprint 1: only household-invite via accept_household_invitation, 06 section 3.1)');
select throws_ok(
  format($$insert into public.household_members (household_id, user_id, role) values (%L, %L, 'owner')$$, :'hid_a', :'outsider'),
  '42501', null, 'owner cannot add a second owner');
select throws_ok(
  format($$update public.households set family_size = 9 where id = %L$$, :'hid_a'),
  '42501', null, 'family_size is not client-writable (column grants)');

-- users: self update through column grants only
select is(
  tests.affected_rows(format($q$update public.users set display_name = 'Ayesha' where id = %L$q$, :'owner_a')),
  1::bigint, 'user updates their own display_name');
select is(
  tests.affected_rows(format($q$update public.users set display_name = 'Hacked' where id = %L$q$, :'care_a')),
  0::bigint, 'user cannot update a co-member''s profile');
select throws_ok(
  format($$update public.users set email = 'x@y.z' where id = %L$$, :'owner_a'),
  '42501', null, 'users.email is not client-writable');
select throws_ok(
  format($$insert into public.users (id) values (%L)$$, :'newbie'),
  '42501', null, 'clients cannot insert users rows (created by the auth trigger)');
select tests.clear_authentication();

select * from finish();
rollback;
