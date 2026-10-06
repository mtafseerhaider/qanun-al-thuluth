-- supabase/tests/database/functions/040_platform_helpers.test.sql
-- 0025a and 0017 helpers (S1-15 abuse controls and S1 platform): consume_rate_limit (the single
-- rate-limit mechanism, 06 section 2.7), idempotency_keys / rate_limit_buckets lockdown,
-- evaluate_feature_flags (11 section 9 step 8), has_content_role.
begin;
select plan(17);

select tests.create_user('pf-user@test.thuluth.app') as uid \gset

-- ---- consume_rate_limit ---------------------------------------------------------------------------
set local role service_role;
select results_eq($$select allowed, remaining from public.consume_rate_limit('test:otp:a', 2, 3600)$$,
  $$values (true, 1)$$, 'first call in the window is allowed');
select results_eq($$select allowed, remaining from public.consume_rate_limit('test:otp:a', 2, 3600)$$,
  $$values (true, 0)$$, 'second call uses the last slot');
select results_eq($$select allowed, remaining from public.consume_rate_limit('test:otp:a', 2, 3600)$$,
  $$values (false, 0)$$, 'third call in the window is refused');
select results_eq($$select allowed from public.consume_rate_limit('test:otp:b', 2, 3600)$$,
  $$values (true)$$, 'buckets are independent per key');
select ok((select reset_at > now() from public.consume_rate_limit('test:otp:c', 5, 60)), 'reset_at is in the future');
select throws_ok($$select * from public.consume_rate_limit('test:bad', 1, 0)$$, '22023', 'INVALID_RATE_LIMIT',
  'a non-positive window is rejected');
reset role;
select is((select count from public.rate_limit_buckets where bucket_key = 'test:otp:a'), 3, 'the bucket counted three calls');

update public.rate_limit_buckets set window_start = window_start - interval '2 hours' where bucket_key = 'test:otp:a';
set local role service_role;
select results_eq($$select allowed, remaining from public.consume_rate_limit('test:otp:a', 2, 3600)$$,
  $$values (true, 1)$$, 'a new window resets the count');
reset role;

select ok(not has_function_privilege('authenticated', 'public.consume_rate_limit(text, integer, integer)', 'execute'),
  'clients cannot consume rate limits directly');
select tests.authenticate_as(:'uid');
select throws_ok($$select count(*) from public.rate_limit_buckets$$, '42501', null, 'clients cannot read rate_limit_buckets');
select throws_ok($$select count(*) from public.idempotency_keys$$, '42501', null, 'clients cannot read idempotency_keys');
select tests.clear_authentication();
select ok(exists (select 1 from cron.job where jobname = 'rate-limit-gc') and exists (select 1 from cron.job where jobname = 'idempotency-gc'),
  'rate-limit-gc and idempotency-gc are scheduled');

-- ---- evaluate_feature_flags ---------------------------------------------------------------------------
insert into public.feature_flags (key, enabled, rules) values
  ('test.on', true, '{}'), ('test.off', false, '{}'),
  ('test.premium_only', true, '{"tiers":["premium"]}'),
  ('test.us_only', true, '{"countries":["US"]}');
update public.users set country_code = 'PK' where id = :'uid';
select tests.authenticate_as(:'uid');
select results_eq(
  $$select (f ->> 'test.on')::boolean, (f ->> 'test.off')::boolean, (f ->> 'test.premium_only')::boolean, (f ->> 'test.us_only')::boolean
    from public.evaluate_feature_flags() f$$,
  $$values (true, false, false, false)$$,
  'flags evaluate against tier and country for the caller');
select tests.clear_authentication();
select ok(not has_function_privilege('anon', 'public.evaluate_feature_flags()', 'execute'), 'anon cannot evaluate flags');

-- ---- has_content_role -------------------------------------------------------------------------------------
select tests.authenticate_as(:'uid', '{"roles":["scholar_reviewer"]}');
select ok(public.has_content_role('scholar_reviewer'), 'has_content_role reads app_metadata.roles');
select ok(not public.has_content_role('content_admin'), 'has_content_role rejects roles the user lacks');
select tests.clear_authentication();
select tests.authenticate_as(:'uid', '{"role":"admin"}');
select ok(public.has_content_role('content_admin'), 'platform admins pass every content role check');
select tests.clear_authentication();

select * from finish();
rollback;
