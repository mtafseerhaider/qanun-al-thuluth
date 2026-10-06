-- supabase/tests/database/functions/020_has_premium.test.sql
-- has_premium(user_id) and household_has_premium(household_id) (05 section 14.2, 00 section 11).
begin;
select plan(11);

select tests.create_user('payer@test.thuluth.app')     as payer     \gset
select tests.create_user('caregiver@test.thuluth.app') as caregiver \gset
select tests.create_household(:'payer', 'Premium home') as hid      \gset
select tests.add_member(:'hid', :'caregiver', 'caregiver');

select ok(not public.has_premium(:'payer'), 'no subscription row means not premium');

insert into public.subscriptions (user_id, tier, status, product_id, store, rc_app_user_id, current_period_end)
values (:'payer', 'free', 'active', 'free', 'promotional', 'free-' || :'payer', now() + interval '30 days');
select ok(not public.has_premium(:'payer'), 'an active free-tier row is not premium');

insert into public.subscriptions (user_id, tier, status, product_id, store, rc_app_user_id, current_period_end)
values (:'payer', 'premium', 'expired', 'thuluth_premium_monthly', 'app_store', :'payer', now() - interval '10 days')
returning id as sub_id \gset
select ok(not public.has_premium(:'payer'), 'an expired premium subscription is not premium');

update public.subscriptions set status = 'active', current_period_end = now() + interval '30 days' where id = :'sub_id';
select ok(public.has_premium(:'payer'), 'an active premium subscription is premium');
select ok(public.household_has_premium(:'hid'), 'the owner''s household has premium');
select ok(not public.has_premium(:'caregiver'), 'the caregiver personally is not premium');

update public.subscriptions set status = 'in_grace' where id = :'sub_id';
select ok(public.has_premium(:'payer'), 'billing grace period keeps premium');

update public.subscriptions set status = 'cancelled', current_period_end = now() + interval '5 days' where id = :'sub_id';
select ok(public.has_premium(:'payer'), 'cancelled but still inside the paid period is premium');

update public.subscriptions set current_period_end = now() - interval '5 days' where id = :'sub_id';
select ok(not public.has_premium(:'payer'), 'cancelled after the paid period is not premium');

select ok(not public.household_has_premium(gen_random_uuid()), 'unknown household has no premium');

select ok(not has_function_privilege('anon', 'public.has_premium(uuid)', 'execute'), 'anon cannot call has_premium');

select * from finish();
rollback;
