-- supabase/tests/database/triggers/020_identity_bootstrap.test.sql
-- auth.users -> public.users, household owner bootstrap, free-tier household limit, owner row
-- protection, ownership transfer, time zone validation (05 section 15).
begin;
select plan(15);

-- auth bootstrap
insert into auth.users (id, instance_id, email, aud, role, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000', 'meta@test.thuluth.app',
        'authenticated', 'authenticated',
        '{"full_name":"Fatima Khan","locale":"ur","timezone":"Not/AZone","country_code":"PK"}', '{}', now(), now());
select results_eq(
  $$select display_name, locale, timezone, country_code::text, email::text from public.users where id = '11111111-1111-4111-8111-111111111111'$$,
  $$values ('Fatima Khan', 'ur', 'Asia/Karachi', 'PK', 'meta@test.thuluth.app')$$,
  'signup creates public.users from metadata, falling back to Asia/Karachi for an unknown time zone');

update auth.users set email = 'renamed@test.thuluth.app' where id = '11111111-1111-4111-8111-111111111111';
select is((select email::text from public.users where id = '11111111-1111-4111-8111-111111111111'),
  'renamed@test.thuluth.app', 'auth email changes sync to public.users');

select tests.create_user('free-owner@test.thuluth.app') as owner \gset
select tests.create_user('helper@test.thuluth.app')     as helper \gset

-- household bootstrap and entitlement, through the client path
select tests.authenticate_as(:'owner');
select throws_ok(
  format($$insert into public.households (owner_user_id, name, timezone) values (%L, 'Bad tz', 'Mars/Base')$$, :'owner'),
  '22023', 'INVALID_TIMEZONE', 'unknown IANA time zone is rejected');
select lives_ok(
  format($$insert into public.households (id, owner_user_id, name) values ('22222222-2222-4222-8222-222222222222', %L, 'First')$$, :'owner'),
  'free user creates their first household');
select is((select role from public.household_members where household_id = '22222222-2222-4222-8222-222222222222' and user_id = :'owner'),
  'owner'::public.household_role, 'the creator gets an owner membership');
select throws_ok(
  format($$insert into public.households (owner_user_id, name) values (%L, 'Second')$$, :'owner'),
  'P0001', 'ENTITLEMENT_HOUSEHOLD_LIMIT', 'free owner cannot create a second household');
select tests.clear_authentication();

insert into public.subscriptions (user_id, tier, status, product_id, store, rc_app_user_id, current_period_end)
values (:'owner', 'premium', 'active', 'thuluth_premium_monthly', 'app_store', :'owner', now() + interval '30 days');
select tests.authenticate_as(:'owner');
select lives_ok(
  format($$insert into public.households (owner_user_id, name) values (%L, 'Second')$$, :'owner'),
  'premium owner can create a second household');
select tests.clear_authentication();

-- owner row protection
select tests.add_member('22222222-2222-4222-8222-222222222222', :'helper', 'caregiver');
select throws_ok(
  $$update public.household_members set role = 'caregiver' where household_id = '22222222-2222-4222-8222-222222222222' and role = 'owner'$$,
  '42501', 'OWNER_ROW_PROTECTED', 'the owner row cannot be demoted directly');
select throws_ok(
  $$update public.household_members set deleted_at = now() where household_id = '22222222-2222-4222-8222-222222222222' and role = 'owner'$$,
  '42501', 'OWNER_ROW_PROTECTED', 'the owner row cannot be soft-deleted');
select throws_ok(
  $$delete from public.household_members where household_id = '22222222-2222-4222-8222-222222222222' and role = 'owner'$$,
  '42501', 'OWNER_ROW_PROTECTED', 'the owner row cannot be deleted while the household exists');
select throws_ok(
  format($$update public.household_members set user_id = %L where household_id = '22222222-2222-4222-8222-222222222222' and role = 'caregiver'$$, :'owner'),
  '42501', 'MEMBERSHIP_IMMUTABLE', 'a membership cannot be moved to another user');

-- soft_delete RPC: owner cannot leave, member can be removed
select tests.authenticate_as(:'owner');
select throws_ok(
  format($$select public.soft_delete('household_members', (select id from public.household_members where household_id = '22222222-2222-4222-8222-222222222222' and user_id = %L))$$, :'owner'),
  '42501', 'OWNER_CANNOT_LEAVE', 'owner cannot leave via soft_delete');

-- ownership transfer
select lives_ok(
  format($$select public.transfer_household_ownership('22222222-2222-4222-8222-222222222222', %L)$$, :'helper'),
  'owner transfers ownership to a caregiver');
select tests.clear_authentication();
select results_eq(
  $$select user_id, role from public.household_members where household_id = '22222222-2222-4222-8222-222222222222' and deleted_at is null order by role$$,
  format($$values (%L::uuid, 'owner'::public.household_role), (%L::uuid, 'caregiver'::public.household_role)$$, :'helper', :'owner'),
  'roles are swapped after the transfer');
select is((select owner_user_id from public.households where id = '22222222-2222-4222-8222-222222222222'), :'helper'::uuid,
  'households.owner_user_id follows the transfer');

select * from finish();
rollback;
