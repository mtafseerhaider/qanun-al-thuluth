-- supabase/tests/database/functions/150_analytics_ingestion_launch_kpis.test.sql
-- S7-12: analytics ingestion (05 22.10 24.2: analytics_event_catalog, analytics_filter_props, track_events), the
-- launch KPI views and launch_kpis(), the event-name aligned S6 views, and ops_health() (S7-06).
begin;
select plan(36);

select tests.create_user('ti-owner@test.thuluth.app')    as owner \gset
select tests.create_user('ti-outsider@test.thuluth.app') as outsider \gset
select tests.create_user('ti-optout@test.thuluth.app')   as optout \gset
select tests.create_user('ti-admin@test.thuluth.app')    as admin \gset
select tests.seed_household(:'owner', 'Ingest home') as hid \gset
select tests.seed_household(:'outsider', 'Other home') as other_hid \gset
update public.users set analytics_opt_out = true where id = :'optout';

-- ---- catalog ----------------------------------------------------------------------------------------------------------------
select ok((select count(*) from public.analytics_event_catalog where enabled and owner = 'app') >= 100,
  'the generated catalog seed is loaded');
select is((select allowed_props from public.analytics_event_catalog where event = 'app_opened'), array['cold_start'],
  'app_opened allows only cold_start');
select tests.authenticate_as(:'owner');
select ok((select count(*) from public.analytics_event_catalog) >= 100, 'users read the catalog');
select throws_ok($$insert into public.analytics_event_catalog (event) values ('forged_event')$$, '42501', null,
  'users cannot add catalog events');
select tests.clear_authentication();

-- ---- grants ---------------------------------------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.track_events(jsonb)', 'execute'), 'anon cannot track');
select ok(has_function_privilege('authenticated', 'public.track_events(jsonb)', 'execute'), 'users can track');
select ok(not has_function_privilege('authenticated', 'public.analytics_filter_props(text, jsonb)', 'execute'),
  'analytics_filter_props is service only');
select ok(not has_function_privilege('anon', 'public.launch_kpis(timestamptz, timestamptz)', 'execute'),
  'anon cannot read launch KPIs');
select ok(not has_function_privilege('authenticated', 'public.ops_health()', 'execute'), 'ops_health is service only');

-- ---- track_events -------------------------------------------------------------------------------------------------------------
select set_config('ti.hid', :'hid', true), set_config('ti.other', :'other_hid', true);
select tests.authenticate_as(:'owner');
select set_config('request.headers', '{"x-platform":"ios","x-app-version":"1.0.0"}', true);
select is(public.track_events(jsonb_build_array(
    jsonb_build_object('event_id', '11111111-1111-4111-8111-111111111111', 'event', 'app_opened',
                       'props', jsonb_build_object('cold_start', true, 'email', 'x@y.z', 'nested', jsonb_build_object('a', 1)),
                       'occurred_at', now() - interval '1 minute', 'session_id', '22222222-2222-4222-8222-222222222222',
                       'household_id', current_setting('ti.hid')),
    jsonb_build_object('event_id', '11111111-1111-4111-8111-111111111112', 'event', 'not_in_catalog', 'props', '{}'::jsonb),
    jsonb_build_object('event_id', '11111111-1111-4111-8111-111111111113', 'event', 'app_opened',
                       'props', jsonb_build_object('cold_start', false), 'household_id', current_setting('ti.other')),
    jsonb_build_object('event_id', 'not-a-uuid', 'event', 'help_article_viewed',
                       'props', jsonb_build_object('slug', repeat('a', 60)), 'occurred_at', 'garbage'),
    jsonb_build_object('event_id', '11111111-1111-4111-8111-111111111114', 'event', 'paywall_shown',
                       'props', jsonb_build_object('trigger', 'chat_quota', 'has_offering', true),
                       'session_id', '22222222-2222-4222-8222-222222222222'),
    jsonb_build_object('event_id', '11111111-1111-4111-8111-111111111115', 'event', 'purchase_completed',
                       'props', jsonb_build_object('trigger', 'chat_quota', 'period', 'annual', 'pending', false),
                       'session_id', '22222222-2222-4222-8222-222222222222')
  )), 4, 'catalogued events are accepted; uncatalogued and foreign-household events are skipped');
select is(public.track_events(jsonb_build_array(
    jsonb_build_object('event_id', '11111111-1111-4111-8111-111111111111', 'event', 'app_opened',
                       'props', jsonb_build_object('cold_start', true), 'occurred_at', now() - interval '1 minute'))),
  1, 'a retried event is accepted');
select throws_ok($$select * from public.analytics_events$$, '42501', null, 'users still cannot read events');
select throws_ok(format('select public.track_events(%L::jsonb)',
                        (select jsonb_agg(jsonb_build_object('event', 'app_opened')) from generate_series(1, 51))),
  '22023', 'TOO_MANY_EVENTS', 'batches above 50 are rejected');
select tests.clear_authentication();

select is((select props from public.analytics_events where event_id = '11111111-1111-4111-8111-111111111111'),
  '{"cold_start": true}'::jsonb, 'props outside the allow-list and non-scalar values are dropped');
select is((select count(*) from public.analytics_events where event_id = '11111111-1111-4111-8111-111111111111'), 1::bigint,
  'duplicate event ids are stored once');
select is((select platform || '/' || app_version || '/' || household_id::text from public.analytics_events
            where event_id = '11111111-1111-4111-8111-111111111111'),
  'ios/1.0.0/' || :'hid', 'platform and version come from request headers, household is kept for members');
select is((select length(props ->> 'slug') from public.analytics_events where event = 'help_article_viewed' and user_id = :'owner'),
  40, 'strings are cut to 40 characters; a bad event_id and timestamp do not fail the batch');
select is((select count(*) from public.analytics_events where user_id = :'owner' and event = 'not_in_catalog'), 0::bigint,
  'uncatalogued events are not stored');

select tests.authenticate_as(:'optout');
select is(public.track_events('[{"event":"app_opened","props":{"cold_start":true}}]'::jsonb), 0, 'opted-out users store nothing');
select tests.clear_authentication();
select is((select count(*) from public.analytics_events where user_id = :'optout'), 0::bigint, 'and nothing is stored');

-- ---- aligned S6 views (app event names) ------------------------------------------------------------------------------------------
select lives_ok($$select public.refresh_analytics_views('daily')$$, 'the recreated views refresh');
select is((select sum(purchases) from analytics.mv_paywall_funnel_daily where trigger = 'chat_quota'), 1::numeric,
  'paywall_shown -> purchase_completed counts as a purchase');
select ok((select sum(cohort_size) from analytics.mv_retention_weekly) >= 1, 'retention cohorts come from users.created_at');

-- ---- launch KPIs ------------------------------------------------------------------------------------------------------------------
insert into public.notifications (user_id, household_id, kind, channel, title, body, scheduled_for, sent_at, status) values
  (:'owner', :'hid', 'daily_plan', 'push', 't', 'b', now() - interval '3 hours', now() - interval '3 hours' + interval '30 seconds', 'sent'),
  (:'owner', :'hid', 'daily_plan', 'push', 't', 'b', now() - interval '2 hours', now() - interval '2 hours' + interval '90 seconds', 'sent'),
  (:'owner', :'hid', 'grocery_day', 'push', 't', 'b', now() - interval '1 hour', now() - interval '50 minutes', 'sent'),
  (:'owner', :'hid', 'grocery_day', 'push', 't', 'b', now() - interval '1 hour', null, 'cancelled');
select is((public.launch_kpis(now() - interval '1 day') ->> 'notification_on_time_rate')::numeric, 0.6667,
  'on-time rate: sent within 2 minutes over due (cancelled excluded)');
select is((public.launch_kpis(now() - interval '1 day') ->> 'notifications_due')::int, 3, 'three pushes were due');
select ok(public.launch_kpis(now() - interval '7 days') ?& array['onboarding_completion_rate','activation_rate',
            'median_minutes_to_first_plan','ai_cost_per_active_user_week_usd','ai_cost_per_active_premium_user_week_usd',
            'plan_generation_success_rate'],
  'launch_kpis reports every gate metric');
select throws_ok($$select public.launch_kpis(now(), now() - interval '1 day')$$, '22023', 'VALIDATION_FAILED',
  'an empty window is rejected');

select tests.authenticate_as(:'owner');
select is((select count(*) from public.v_admin_launch_kpis), 0::bigint, 'users see no launch KPI rows');
select is((select count(*) from public.v_admin_notification_on_time_daily), 0::bigint, 'or notification rows');
select throws_ok($$select public.launch_kpis(now() - interval '1 day')$$, '42501', 'FORBIDDEN', 'and cannot call launch_kpis');
select tests.clear_authentication();
select tests.authenticate_as(:'admin', '{"role":"admin"}');
select is((select count(*) from public.v_admin_launch_kpis), 6::bigint, 'admins see one row per launch gate');
select is((select status from public.v_admin_launch_kpis where gate = 'G-OPS-1'), 'red', 'a 67 percent on-time rate is red');
select lives_ok($$select * from public.v_admin_activation_funnel_weekly, public.v_admin_ai_cost_per_active_user_weekly,
                  public.v_admin_ai_cost_per_mau_monthly, public.v_admin_plan_generation_daily,
                  public.v_admin_kpi_daily, public.v_admin_retention_weekly, public.v_admin_paywall_funnel_daily limit 1$$,
  'admins read the dashboard views');
select tests.clear_authentication();

select is(public.save_kpi_snapshots('[{"metric":"kpi.activation_rate","period_start":"2027-01-01","period_end":"2027-01-07","value":0.41},
                                      {"metric":"user.email","period_start":"2027-01-01","period_end":"2027-01-07","value":1}]'::jsonb), 1,
  'KPI snapshots are stored; non-KPI metrics are ignored');
select ok(not has_function_privilege('authenticated', 'public.save_kpi_snapshots(jsonb)', 'execute'), 'snapshots are service only');

-- ---- ops_health ---------------------------------------------------------------------------------------------------------------------
select ok(public.ops_health() ?& array['feature_flags','maintenance','stale_pushes','cron_failures_1h'],
  'ops_health reports its signals');

select * from finish();
rollback;
