-- supabase/tests/database/functions/010_is_household_member.test.sql
-- Membership and role helpers (05-database-schema.md section 14.1).
begin;
select plan(14);

select tests.create_user('owner@test.thuluth.app')     as owner     \gset
select tests.create_user('caregiver@test.thuluth.app') as caregiver \gset
select tests.create_user('viewer@test.thuluth.app')    as viewer    \gset
select tests.create_user('coach@test.thuluth.app')     as coach     \gset
select tests.create_user('other@test.thuluth.app')     as other     \gset
select tests.create_household(:'owner', 'Home')        as hid       \gset
select tests.create_household(:'other', 'Elsewhere')   as hid_other \gset
select tests.add_member(:'hid', :'caregiver', 'caregiver');
select tests.add_member(:'hid', :'viewer', 'viewer') as viewer_membership \gset
select tests.add_member(:'hid', :'coach', 'coach');

select tests.authenticate_as(:'owner');
select ok(public.is_household_member(:'hid'), 'owner is a member of their household');
select ok(not public.is_household_member(:'hid_other'), 'owner is not a member of another household');
select is(public.household_role_of(:'hid'), 'owner'::public.household_role, 'household_role_of returns owner');
select is((select array_agg(x) from public.my_household_ids() x), array[:'hid'::uuid], 'my_household_ids lists only own households');
select ok(public.shares_household_with(:'viewer'), 'owner shares a household with the viewer');
select ok(not public.shares_household_with(:'other'), 'owner does not share a household with an outsider');
select tests.clear_authentication();

select tests.authenticate_as(:'caregiver');
select ok(public.can_edit_household(:'hid'), 'caregiver can edit household data');
select tests.clear_authentication();

select tests.authenticate_as(:'viewer');
select ok(public.is_household_member(:'hid'), 'viewer is a member');
select ok(not public.can_edit_household(:'hid'), 'viewer cannot edit household data');
select ok(not public.can_author_plans(:'hid'), 'viewer cannot author plans');
select tests.clear_authentication();

select tests.authenticate_as(:'coach');
select ok(public.can_author_plans(:'hid') and not public.can_edit_household(:'hid'),
  'coach can author plans but not edit family data');
select tests.clear_authentication();

-- no JWT at all
select ok(not public.is_household_member(:'hid'), 'no authenticated user means no membership');

-- a soft-deleted membership no longer counts
update public.household_members set deleted_at = now() where id = :'viewer_membership';
select tests.authenticate_as(:'viewer');
select ok(not public.is_household_member(:'hid'), 'soft-deleted membership is not a membership');
select is(public.household_role_of(:'hid'), null::public.household_role, 'soft-deleted member has no role');
select tests.clear_authentication();

select * from finish();
rollback;
