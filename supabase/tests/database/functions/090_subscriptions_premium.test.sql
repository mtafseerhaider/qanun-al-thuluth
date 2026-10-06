-- supabase/tests/database/functions/090_subscriptions_premium.test.sql
-- S5-02 / S5-14 (DB side): has_premium lifecycle states (17 sections 7.3, 8, 10.2; AC-SUB4, AC-SUB5, AC-SUB7),
-- sandbox gating, shared household premium (FR-HH-06), premium_for and get_my_entitlements, downgrade to
-- read-only households without deleting data (FR-SUB-06, 17 section 10.3), the webhook idempotency table and
-- promo table access (05 section 22.9).
begin;
select plan(44);

select tests.create_user('sp-payer@test.thuluth.app')  as payer \gset
select tests.create_user('sp-care@test.thuluth.app')   as care \gset
select tests.create_user('sp-viewer@test.thuluth.app') as viewer \gset
select tests.create_user('sp-free@test.thuluth.app')   as free_user \gset
select tests.seed_household(:'payer', 'Payer home') as hid \gset
select tests.add_member(:'hid', :'care', 'caregiver');
select tests.add_member(:'hid', :'viewer', 'viewer');
select tests.create_household(:'care', 'Caregiver own home') as care_hid \gset

insert into public.subscriptions (user_id, tier, status, product_id, store, rc_app_user_id, current_period_end, will_renew, period_type)
values (:'payer', 'premium', 'active', 'thuluth_premium_annual', 'app_store', :'payer', now() + interval '300 days', true, 'normal')
returning id as sub \gset

-- ---- lifecycle states ------------------------------------------------------------------------------------------
select ok(public.has_premium(:'payer'), 'active within the period: premium');
update public.subscriptions set current_period_end = now() - interval '1 day' where id = :'sub';
select ok(public.has_premium(:'payer'), 'active one day past period end (webhook lag tolerance, 05): premium');
update public.subscriptions set current_period_end = now() - interval '4 days' where id = :'sub';
select ok(not public.has_premium(:'payer'), 'active but four days past period end: not premium');
update public.subscriptions set status = 'cancelled', will_renew = false, current_period_end = now() + interval '5 days' where id = :'sub';
select ok(public.has_premium(:'payer'), 'cancelled inside the paid period: premium until it ends');
update public.subscriptions set current_period_end = now() - interval '1 hour' where id = :'sub';
select ok(not public.has_premium(:'payer'), 'cancelled after the paid period: not premium');
update public.subscriptions set status = 'in_grace', current_period_end = now() - interval '5 days',
                                grace_period_expires_at = now() + interval '11 days' where id = :'sub';
select ok(public.has_premium(:'payer'), 'in_grace with grace running past the period end: premium (AC-SUB7)');
update public.subscriptions set grace_period_expires_at = now() - interval '1 minute' where id = :'sub';
select ok(not public.has_premium(:'payer'), 'in_grace after the grace period: not premium');
update public.subscriptions set status = 'in_billing_retry', grace_period_expires_at = null, current_period_end = now() + interval '20 days' where id = :'sub';
select ok(not public.has_premium(:'payer'), 'in_billing_retry: not premium (AC-SUB7)');
update public.subscriptions set status = 'paused' where id = :'sub';
select ok(not public.has_premium(:'payer'), 'paused: not premium');
update public.subscriptions set status = 'expired', current_period_end = now() - interval '1 day' where id = :'sub';
select ok(not public.has_premium(:'payer'), 'expired: not premium');
update public.subscriptions set status = 'active', current_period_end = now() + interval '30 days', refunded_at = now() where id = :'sub';
select ok(not public.has_premium(:'payer'), 'refunded: not premium immediately (AC-SUB4)');
update public.subscriptions set refunded_at = null, entitlement = 'coach' where id = :'sub';
select ok(not public.has_premium(:'payer'), 'a coach-only entitlement is not consumer premium');
update public.subscriptions set entitlement = 'premium', tier = 'free' where id = :'sub';
select ok(not public.has_premium(:'payer'), 'a free-tier row is not premium');
update public.subscriptions set tier = 'premium', environment = 'sandbox' where id = :'sub';

-- ---- sandbox gating ---------------------------------------------------------------------------------------------
select set_config('app.environment', 'production', true);
update public.feature_flags set enabled = true where key = 'allow_sandbox_premium';
select ok(not public.has_premium(:'payer'), 'sandbox in production: never premium, even with the flag');
select set_config('app.environment', 'staging', true);
update public.feature_flags set enabled = false where key = 'allow_sandbox_premium';
select ok(not public.has_premium(:'payer'), 'sandbox in staging without allow_sandbox_premium: not premium');
update public.feature_flags set enabled = true where key = 'allow_sandbox_premium';
select ok(public.has_premium(:'payer'), 'sandbox in staging with allow_sandbox_premium: premium');
select set_config('app.environment', '', true);
select ok(not public.has_premium(:'payer'), 'sandbox with app.environment unset: fails closed');
update public.subscriptions set environment = 'production' where id = :'sub';
select ok(public.has_premium(:'payer'), 'back to a production purchase: premium');

-- ---- upsert key used by revenuecat-webhook --------------------------------------------------------------------------
select lives_ok(format($$insert into public.subscriptions (user_id, tier, status, product_id, store, rc_app_user_id, current_period_end)
  values (%L, 'premium', 'active', 'thuluth_premium_monthly', 'app_store', %L, now() + interval '30 days')
  on conflict (user_id, store, entitlement) do update set product_id = excluded.product_id$$, :'payer', :'payer'),
  'subscriptions upsert on (user_id, store, entitlement) updates the row (product change)');
select is((select count(*) from public.subscriptions where user_id = :'payer'), 1::bigint, 'still one row per store and entitlement');

-- ---- shared household premium (FR-HH-06, AC-SUB5) ---------------------------------------------------------------------
select ok(public.household_has_premium(:'hid'), 'the payer''s household is premium');
select ok(not public.has_premium(:'care'), 'the caregiver is not personally premium (chat quota follows the user)');
select ok(not public.household_has_premium(:'care_hid'), 'the caregiver''s own household is not premium');
select tests.authenticate_as(:'care');
select ok(public.premium_for(:'hid'), 'premium_for: the caregiver has premium in the payer''s household');
select ok(not public.premium_for(:'care_hid'), 'but not in their own household');
select ok(not public.premium_for(null), 'and not without a household context');
select is(public.get_my_entitlements(:'hid') -> 'householdPremium', 'true'::jsonb, 'get_my_entitlements reports household premium');
select is(public.get_my_entitlements(:'hid') -> 'personalPremium', 'false'::jsonb, 'and no personal premium');
select tests.clear_authentication();
select tests.authenticate_as(:'free_user');
select ok(not public.premium_for(:'hid'), 'a non-member gains nothing from another household''s premium');
select is(public.get_my_entitlements(:'hid') -> 'householdPremium', 'false'::jsonb, 'and get_my_entitlements says so');
select tests.clear_authentication();
select tests.authenticate_as(:'payer');
select is(public.get_my_entitlements(:'hid') ->> 'status', 'active', 'the payer sees their own status');
select is((select count(*) from public.subscriptions), 1::bigint, 'and reads only their own subscription rows');
select is(tests.affected_rows(format($$update public.subscriptions set status = 'active' where user_id = %L$$, :'payer')),
  0::bigint, 'subscriptions are read-only to users (server truth)');
select tests.clear_authentication();

-- ---- downgrade: data kept, extra households read-only (FR-SUB-06) ---------------------------------------------------
select tests.create_household(:'payer', 'Second home') as second_hid \gset
update public.households set created_at = now() + interval '1 day' where id = :'second_hid';   -- created later
select ok(not public.household_is_read_only(:'second_hid'), 'while premium, no household is read-only');
update public.subscriptions set status = 'expired', current_period_end = now() - interval '10 days' where user_id = :'payer';
select ok(not public.household_is_read_only(:'hid') and public.household_is_read_only(:'second_hid'),
  'after expiry the oldest household stays writable and the second is read-only');
select throws_ok(format($$insert into public.meal_plans (household_id, status, start_date, end_date) values (%L, 'generating', current_date, current_date + 6)$$, :'second_hid'),
  'P0001', 'PREMIUM_REQUIRED', 'no new plan in a read-only household');
select lives_ok(format($$insert into public.hydration_logs (household_id, family_member_id, volume_ml) select %L, id, 250 from public.family_members where household_id = %L and name = 'Adult'$$, :'hid', :'hid'),
  'safety logging still works after downgrade (AC-SUB10)');
select tests.authenticate_as(:'payer');
select lives_ok(format($$select public.keep_household_on_downgrade(%L)$$, :'second_hid'), 'the owner chooses which household to keep');
select is(public.get_my_entitlements(:'hid') -> 'householdReadOnly', 'true'::jsonb, 'the other household is now read-only');
select tests.clear_authentication();
select tests.authenticate_as(:'care');
select throws_ok(format($$select public.keep_household_on_downgrade(%L)$$, :'hid'), '42501', 'FORBIDDEN', 'only the owner chooses');
select tests.clear_authentication();
select is((select count(*) from public.meal_plans where household_id = :'hid'), 1::bigint, 'nothing was deleted on downgrade');

-- ---- revenuecat_events and promo tables ---------------------------------------------------------------------------------
insert into public.revenuecat_events (event_id, type, app_user_id, event_timestamp, environment, payload)
values ('evt_1', 'INITIAL_PURCHASE', :'payer', now(), 'PRODUCTION', '{}');
select throws_ok($$insert into public.revenuecat_events (event_id, type, app_user_id, event_timestamp, environment, payload) values ('evt_1', 'INITIAL_PURCHASE', 'x', now(), 'PRODUCTION', '{}')$$,
  '23505', null, 'a replayed RevenueCat event id is rejected (AC-SUB2)');
select tests.authenticate_as(:'payer');
select throws_ok($$select count(*) from public.revenuecat_events$$, '42501', null, 'users cannot read the webhook log');
select is((select count(*) from public.promo_codes), 0::bigint, 'users see no promo codes');
select tests.clear_authentication();

select * from finish();
rollback;
