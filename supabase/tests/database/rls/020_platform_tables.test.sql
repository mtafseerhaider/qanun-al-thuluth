-- supabase/tests/database/rls/020_platform_tables.test.sql
-- feature_flags (catalog: read-only to users), ai_usage (own rows only), ai_model_routes and
-- prompt_templates (admin only), subscriptions (own, read-only), analytics_events (insert own, no read).
begin;
select plan(26);

select tests.create_user('alice@test.thuluth.app') as alice \gset
select tests.create_user('bob@test.thuluth.app')   as bob   \gset
select tests.create_household(:'alice', 'Alice household') as hid_alice \gset
select tests.create_household(:'bob', 'Bob household')     as hid_bob   \gset

select count(*) as flag_count  from public.feature_flags   \gset
select count(*) as route_count from public.ai_model_routes \gset
insert into public.prompt_templates (key, version, body, is_active) values ('chat.system', 1, 'You are Thuluth.', true);

insert into public.ai_usage (user_id, household_id, route_key, provider, model, tokens_in, tokens_out, cost_usd_micros)
values (:'alice', :'hid_alice', 'chat.free', 'anthropic', 'claude-haiku-4-5-20251001', 100, 50, 120),
       (:'bob',   :'hid_bob',   'chat.default', 'anthropic', 'claude-sonnet-5-5', 300, 200, 4000);

insert into public.subscriptions (user_id, tier, status, product_id, store, rc_app_user_id, current_period_end)
values (:'bob', 'premium', 'active', 'thuluth_premium_monthly', 'app_store', :'bob', now() + interval '30 days');

-- ---- feature_flags ---------------------------------------------------------------------
select ok(:flag_count > 0, 'feature flags are seeded');
select tests.authenticate_as(:'alice');
select is((select count(*) from public.feature_flags), :flag_count::bigint, 'authenticated reads every feature flag');
select throws_ok($$insert into public.feature_flags (key, enabled) values ('sneaky.flag', true)$$,
  '42501', null, 'authenticated cannot insert feature flags');
select is(tests.affected_rows($q$update public.feature_flags set enabled = not enabled$q$),
  0::bigint, 'authenticated cannot update feature flags');
select is(tests.affected_rows($q$delete from public.feature_flags$q$),
  0::bigint, 'authenticated cannot delete feature flags');
select tests.clear_authentication();

select tests.authenticate_as(:'alice', '{"role":"admin"}');
select is(tests.affected_rows($q$update public.feature_flags set description = 'x' where key = 'debug_menu'$q$),
  1::bigint, 'platform admin can update feature flags');
select tests.clear_authentication();

set local role anon;
select throws_ok($$select * from public.feature_flags$$, '42501', null, 'anon cannot read feature flags');
reset role;

-- ---- ai_usage ---------------------------------------------------------------------------
select tests.authenticate_as(:'alice');
select is((select count(*) from public.ai_usage), 1::bigint, 'user sees only their own ai_usage rows');
select is((select count(*) from public.ai_usage where user_id = :'bob'), 0::bigint, 'user cannot read another user''s ai_usage');
select throws_ok(
  format($$insert into public.ai_usage (user_id, route_key, provider, model) values (%L, 'chat.default', 'anthropic', 'x')$$, :'alice'),
  '42501', null, 'clients cannot write ai_usage (service role only)');
select is(tests.affected_rows($q$update public.ai_usage set tokens_in = 0$q$),
  0::bigint, 'clients cannot update ai_usage');
select tests.clear_authentication();

-- ---- ai_model_routes / prompt_templates --------------------------------------------------
select ok(exists (select 1 from public.ai_model_routes where route_key = 'chat.free' and priority = 1
                  and provider = 'anthropic' and model = 'claude-haiku-4-5-20251001' and enabled),
  'chat.free routes free-tier chat to the cheapest model');
select is(
  (select array_agg(distinct route_key order by route_key) from public.ai_model_routes where priority = 1),
  array['chat.default','chat.free','chat.summarize','classify.intent','classify.safety','embed.knowledge',
        'eval.judge','plan.adjust','plan.generate','speech.transcribe','vision.meal_analysis'],
  'every route key has a primary (priority 1) route');
select tests.authenticate_as(:'alice');
select is((select count(*) from public.ai_model_routes), 0::bigint, 'non-admin users cannot read model routes');
select is((select count(*) from public.prompt_templates), 0::bigint, 'non-admin users cannot read prompt templates');
select throws_ok($$insert into public.prompt_templates (key, version, body) values ('x', 1, 'y')$$,
  '42501', null, 'non-admin users cannot write prompt templates');
select tests.clear_authentication();
select tests.authenticate_as(:'alice', '{"role":"admin"}');
select is((select count(*) from public.ai_model_routes), :route_count::bigint, 'platform admin reads model routes');
select tests.clear_authentication();

-- ---- subscriptions ---------------------------------------------------------------------
select tests.authenticate_as(:'bob');
select is((select count(*) from public.subscriptions), 1::bigint, 'user reads their own subscription');
select throws_ok(
  format($$insert into public.subscriptions (user_id, tier, status, product_id, store, rc_app_user_id) values (%L, 'premium', 'active', 'p', 'promotional', 'x')$$, :'bob'),
  '42501', null, 'clients cannot grant themselves premium');
select tests.clear_authentication();
select tests.authenticate_as(:'alice');
select is((select count(*) from public.subscriptions), 0::bigint, 'user cannot read another user''s subscription');
select tests.clear_authentication();

-- ---- analytics_events --------------------------------------------------------------------
select tests.authenticate_as(:'alice');
select lives_ok(
  format($$insert into public.analytics_events (user_id, household_id, event, props, occurred_at, platform)
           values (%L, %L, 'app.opened', '{}', now(), 'ios')$$, :'alice', :'hid_alice'),
  'user inserts their own analytics event');
select throws_ok(
  format($$insert into public.analytics_events (user_id, event, occurred_at) values (%L, 'app.opened', now())$$, :'bob'),
  '42501', null, 'user cannot insert an event for another user');
select throws_ok(
  format($$insert into public.analytics_events (user_id, household_id, event, occurred_at) values (%L, %L, 'app.opened', now())$$, :'alice', :'hid_bob'),
  '42501', null, 'user cannot tag an event with a household they do not belong to');
select throws_ok(
  format($$insert into public.analytics_events (user_id, event, occurred_at) values (%L, 'app.opened', now() - interval '30 days')$$, :'alice'),
  '42501', null, 'events older than 7 days are rejected');
select throws_ok($$select count(*) from public.analytics_events$$, '42501', null, 'users cannot read analytics events');
select tests.clear_authentication();

select is(
  (select tableoid::regclass::text from public.analytics_events where user_id = :'alice'),
  format('analytics_events_y%sm%s', to_char(now() at time zone 'UTC', 'YYYY'), to_char(now() at time zone 'UTC', 'MM')),
  'the event is routed to the current monthly partition');

select * from finish();
rollback;
