-- supabase/tests/database/functions/140_analytics_storage_cron.test.sql
-- S6-13 analytics rollups (05 22.10: schema analytics, refresh, family insights; admin read views), Sprint 6 cron
-- jobs, and the avatars / exports / recipe-images buckets (10 section 6.4). Storage cases run when the storage schema
-- exists (Supabase, or the plain-mode stub) and are skipped otherwise.
begin;
select plan(25);

select tests.create_user('an-owner@test.thuluth.app')  as owner \gset
select tests.create_user('an-viewer@test.thuluth.app') as viewer \gset
select tests.create_user('an-admin@test.thuluth.app')  as admin \gset
select tests.create_user('an-outsider@test.thuluth.app') as outsider \gset
select tests.seed_household(:'owner', 'Analytics home') as hid \gset
select tests.add_member(:'hid', :'viewer', 'viewer');
insert into public.analytics_events (user_id, household_id, event, occurred_at, platform)
values (:'owner', :'hid', 'app_opened', now() - interval '1 hour', 'android');

-- ---- refresh and grants ---------------------------------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.refresh_analytics_views(text)', 'execute'),
  'clients cannot refresh analytics views');
select is(public.refresh_analytics_views('hourly'), array['mv_user_active_days','mv_dau','mv_paywall_funnel_daily','mv_ai_cost_daily'],
  'the hourly scope refreshes the event-driven views');
select is(cardinality(public.refresh_analytics_views('daily')), 11, 'the daily scope refreshes all eleven views');
select throws_ok($$select public.refresh_analytics_views('weekly')$$, '22023', 'VALIDATION_FAILED', 'unknown scopes are rejected');
select ok((select sum(dau) from analytics.mv_dau) >= 1, 'DAU counts the fixture event');
select ok(public.analytics_maintain_partitions() ?& array['created','detached'], 'partition maintenance reports names');
select ok(not has_schema_privilege('authenticated', 'analytics', 'usage'), 'schema analytics is closed to clients');

-- ---- admin read views ---------------------------------------------------------------------------------------------------------
select tests.authenticate_as(:'owner');
select is((select count(*) from public.v_admin_kpi_daily), 0::bigint, 'a user sees no KPI rows');
select is((select count(*) from public.v_admin_ai_cost_daily), 0::bigint, 'or AI cost rows');
select tests.clear_authentication();
select tests.authenticate_as(:'admin', '{"role":"admin"}');
select ok((select count(*) from public.v_admin_kpi_daily) >= 1, 'an admin reads DAU');
select lives_ok($$select * from public.v_admin_retention_weekly, public.v_admin_plan_completion_weekly, public.v_admin_paywall_funnel_daily, public.v_admin_growth_coverage limit 1$$,
  'an admin reads the other KPI views');
select tests.clear_authentication();

-- ---- get_family_insights ---------------------------------------------------------------------------------------------------------
select tests.authenticate_as(:'outsider');
select throws_ok(format($$select * from public.get_family_insights(%L)$$, :'hid'), '42501', 'FORBIDDEN', 'non-members get FORBIDDEN');
select tests.clear_authentication();
select tests.authenticate_as(:'viewer');
select throws_ok(format($$select * from public.get_family_insights(%L)$$, :'hid'), 'P0001', 'PREMIUM_REQUIRED', 'free households get PREMIUM_REQUIRED');
select tests.clear_authentication();

-- ---- cron -------------------------------------------------------------------------------------------------------------------------
select is((select array_agg(jobname::text order by jobname) from cron.job
            where jobname in ('analytics-rollup','analytics-rollup-daily','exports-purge-expired','storage-orphan-sweep',
                              'account-delete-executor','ai-memories-lapsed','ai-reassess')),
  array['account-delete-executor','ai-memories-lapsed','ai-reassess','analytics-rollup','analytics-rollup-daily',
        'exports-purge-expired','storage-orphan-sweep'], 'Sprint 6 cron jobs are scheduled');
select ok((select bool_and(command like '%private.invoke_edge_function(%') from cron.job
            where jobname in ('analytics-rollup','analytics-rollup-daily','exports-purge-expired','storage-orphan-sweep','ai-reassess')),
  'Edge Function jobs go through invoke_edge_function (Vault project_url and cron_secret)');

-- ---- storage: avatars, exports, recipe-images -------------------------------------------------------------------------------------
select id as son from public.family_members where household_id = :'hid' and name = 'Son' \gset
set local storage.allow_delete_query = 'true';
select set_config('an.hid', :'hid', true), set_config('an.son', :'son', true), set_config('an.owner', :'owner', true),
       set_config('an.viewer', :'viewer', true), set_config('an.outsider', :'outsider', true), set_config('an.admin', :'admin', true);

create function pg_temp.storage_cases() returns setof text language plpgsql as $f$
declare
  hid text := current_setting('an.hid'); son text := current_setting('an.son');
  owner text := current_setting('an.owner'); viewer text := current_setting('an.viewer');
  outsider text := current_setting('an.outsider');
  ins constant text := 'insert into storage.objects (bucket_id, name, owner_id) values (%L, %L, %L)';
begin
  return next is((select array_agg(id || ':' || public order by id) from storage.buckets where id in ('avatars','exports','recipe-images')),
    array['avatars:false','exports:false','recipe-images:true'], 'avatars and exports are private, recipe-images public');

  perform tests.authenticate_as(owner::uuid);
  return next lives_ok(format(ins, 'avatars', hid || '/members/' || son || '.webp', owner), 'avatars: an editor uploads a member avatar');
  return next throws_ok(format(ins, 'avatars', hid || '/members/' || gen_random_uuid() || '.webp', owner), '42501', null,
    'avatars: only for a member of that household');
  perform tests.clear_authentication();
  perform tests.authenticate_as(viewer::uuid);
  return next lives_ok(format(ins, 'avatars', 'users/' || viewer || '/avatar2.webp', viewer), 'avatars: a user uploads their own avatar');
  return next throws_ok(format(ins, 'avatars', hid || '/members/' || son || '-2.webp', viewer), '42501', null,
    'avatars: a viewer cannot upload member avatars');
  perform tests.clear_authentication();
  perform tests.authenticate_as(outsider::uuid);
  return next is((select count(*) from storage.objects where bucket_id = 'avatars'), 0::bigint, 'avatars: outsiders read nothing');
  perform tests.clear_authentication();

  -- exports objects are written by the service role (postgres here)
  insert into storage.objects (bucket_id, name) values ('exports', hid || '/' || gen_random_uuid() || '.pdf'),
                                                     ('exports', 'account/' || outsider || '/x.zip');
  perform tests.authenticate_as(owner::uuid);
  return next is((select count(*) from storage.objects where bucket_id = 'exports'), 1::bigint, 'exports: editors read household files only');
  return next throws_ok(format(ins, 'exports', hid || '/forged.pdf', owner), '42501', null, 'exports: clients cannot upload');
  perform tests.clear_authentication();
  perform tests.authenticate_as(outsider::uuid);
  return next is((select count(*) from storage.objects where bucket_id = 'exports'), 1::bigint, 'exports: a user reads their account export');
  perform tests.clear_authentication();
  perform tests.authenticate_as(owner::uuid);
  return next throws_ok(format(ins, 'recipe-images', 'catalog/x/hero.webp', owner), '42501', null, 'recipe-images: users cannot write');
  perform tests.clear_authentication();
end $f$;

select * from pg_temp.storage_cases() where to_regclass('storage.objects') is not null
union all
select skip('storage schema not present (plain Postgres without the stub)', 10) where to_regclass('storage.objects') is null;

select * from finish();
rollback;
