-- supabase/tests/database/triggers/030_family_members.test.sql
-- family_members triggers (05 15.3, 15.4, 15.6; 05 section 21 items 5 and 10; 00-foundations 8):
-- life_stage derivation, date of birth not in the future, module sanity, households.family_size,
-- tier limits (free: 6 members, premium: 20; free: 1 household) raised as LIMIT_REACHED:<resource>,
-- restore re-checks the limit, refresh_life_stages and its cron job.
begin;
select plan(24);

select tests.create_user('fm-owner@test.thuluth.app') as owner \gset
select tests.create_household(:'owner', 'Family home') as hid \gset
-- the owner's child_data consent for this household (0022 trigger CHILD_DATA_CONSENT_REQUIRED)
insert into public.consents (user_id, household_id, kind, version) values (:'owner', :'hid', 'child_data', '2026-10');

select tests.authenticate_as(:'owner');
-- derivation
insert into public.family_members (id, household_id, name, date_of_birth, life_stage)
values ('99999999-9999-4999-8999-000000000001', :'hid', 'Toddler', current_date - interval '20 months', 'adult');
select is((select life_stage from public.family_members where id = '99999999-9999-4999-8999-000000000001'),
  'toddler'::public.life_stage, 'life_stage is derived (toddler at 20 months), ignoring the client value');
insert into public.family_members (household_id, name, date_of_birth) values (:'hid', 'Infant', current_date - interval '3 months');
select is((select life_stage from public.family_members where name = 'Infant'), 'infant'::public.life_stage, 'infant under 12 months');
insert into public.family_members (household_id, name, date_of_birth) values (:'hid', 'Teen', current_date - interval '15 years');
select is((select life_stage from public.family_members where name = 'Teen'), 'teen'::public.life_stage, 'teen at 15');
insert into public.family_members (household_id, name) values (:'hid', 'No DOB');
select is((select life_stage from public.family_members where name = 'No DOB'), 'adult'::public.life_stage, 'no date of birth defaults to adult');
update public.family_members set date_of_birth = current_date - interval '70 years' where name = 'No DOB';
select is((select life_stage from public.family_members where name = 'No DOB'), 'older_adult'::public.life_stage, 'life_stage follows a DOB update');
update public.family_members set life_stage = 'infant' where name = 'Teen';
select is((select life_stage from public.family_members where name = 'Teen'), 'teen'::public.life_stage, 'a direct life_stage write is re-derived');

select throws_ok(format($$insert into public.family_members (household_id, name, date_of_birth) values (%L, 'Future', current_date + 1)$$, :'hid'),
  '22007', 'DOB_IN_FUTURE', 'date of birth in the future is rejected');
select throws_ok(format($$insert into public.family_members (household_id, name, date_of_birth, sex_at_birth, special_modules) values (%L, 'Kid', current_date - interval '6 years', 'female', '{pregnancy}')$$, :'hid'),
  '23514', 'MODULE_NOT_APPLICABLE', 'pregnancy module is rejected for a child');
select throws_ok(format($$insert into public.family_members (household_id, name, date_of_birth) values (%L, 'Old', '1899-12-31')$$, :'hid'),
  '23514', null, 'date of birth before 1900 is rejected');

-- family_size
select is((select family_size from public.households where id = :'hid'), 4::smallint, 'family_size counts live members');

-- free tier: 6 members
insert into public.family_members (household_id, name) values (:'hid', 'Fifth'), (:'hid', 'Sixth');
select is((select family_size from public.households where id = :'hid'), 6::smallint, 'six members on the free tier');
select throws_ok(format($$insert into public.family_members (household_id, name) values (%L, 'Seventh')$$, :'hid'),
  'P0001', 'LIMIT_REACHED:family_members', 'the 7th member is rejected on the free tier');

select lives_ok(format($$select public.soft_delete('family_members', (select id from public.family_members where household_id = %L and name = 'Sixth'))$$, :'hid'),
  'soft delete frees a slot');
select is((select family_size from public.households where id = :'hid'), 5::smallint, 'family_size drops after a soft delete');
select lives_ok(format($$insert into public.family_members (household_id, name) values (%L, 'Replacement')$$, :'hid'),
  'a new member fits after the soft delete');
select tests.clear_authentication();

-- restoring a soft-deleted member re-checks the limit
select throws_ok(format($$update public.family_members set deleted_at = null where household_id = %L and name = 'Sixth'$$, :'hid'),
  'P0001', 'LIMIT_REACHED:family_members', 'restoring a member over the limit is rejected');

-- premium: 20 members, through the owner's subscription (household_has_premium)
insert into public.subscriptions (user_id, tier, status, product_id, store, rc_app_user_id, current_period_end)
values (:'owner', 'premium', 'active', 'thuluth_premium_monthly', 'app_store', :'owner', now() + interval '30 days');
select tests.authenticate_as(:'owner');
select lives_ok(format($$insert into public.family_members (household_id, name) select %L, 'P' || g from generate_series(1, 14) g$$, :'hid'),
  'premium household grows to 20 members');
select is((select family_size from public.households where id = :'hid'), 20::smallint, 'family_size is 20');
select throws_ok(format($$insert into public.family_members (household_id, name) values (%L, 'Twenty-first')$$, :'hid'),
  'P0001', 'LIMIT_REACHED:family_members', 'the 21st member is rejected on premium');
select lives_ok(format($$insert into public.households (owner_user_id, name) values (%L, 'Second home')$$, :'owner'),
  'premium owner creates a second household');
select tests.clear_authentication();

-- error detail carries the resource and limit for the client upsell
create temp table err_detail (msg text, detail text);
do $$
declare v_msg text; v_detail text;
begin
  insert into public.family_members (household_id, name)
  select h.id, 'Overflow' from public.households h where h.name = 'Family home';
exception when others then
  get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
  insert into err_detail values (v_msg, v_detail);
end $$;
select is((select detail::jsonb from err_detail), '{"resource":"family_members","limit":20,"current":20}'::jsonb,
  'the limit error detail carries resource, limit and current count');

-- refresh_life_stages fixes stale stages (birthdays)
alter table public.family_members disable trigger trg_family_members_derive;
update public.family_members set life_stage = 'adult' where name = 'Infant';
alter table public.family_members enable trigger trg_family_members_derive;
select ok(private.refresh_life_stages() >= 1, 'refresh_life_stages updates stale rows');
select is((select life_stage from public.family_members where name = 'Infant'), 'infant'::public.life_stage, 'the stale stage is corrected');
select ok(exists (select 1 from cron.job where jobname = 'refresh-life-stages')
          and exists (select 1 from cron.job where jobname = 'invitations-cleanup'),
  'refresh-life-stages and invitations-cleanup cron jobs are scheduled');

select * from finish();
rollback;
