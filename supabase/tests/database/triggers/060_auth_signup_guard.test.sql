-- supabase/tests/database/triggers/060_auth_signup_guard.test.sql
-- 11 section 3.1.1: the before-user-created Auth hook admits only email OTP, Google and Apple sign-ups, and
-- the auth.users guard lets GoTrue (supabase_auth_admin) give a password only to reviewer@thuluth.app.
-- Migration 20261006160200_auth_signup_guard.sql.
begin;
select plan(16);

create function pg_temp.event(p_provider text, p_anon boolean default false) returns jsonb language sql as $$
  select jsonb_build_object(
    'metadata', jsonb_build_object('name', 'before-user-created', 'ip_address', '127.0.0.1'),
    'user', jsonb_build_object('email', 'x@test.thuluth.app', 'is_anonymous', p_anon,
      'app_metadata', case when p_provider is null then '{}'::jsonb
                           else jsonb_build_object('provider', p_provider, 'providers', jsonb_build_array(p_provider)) end))
$$;

-- ---- hook ---------------------------------------------------------------------------------------------------------------
select is(public.hook_before_user_created(pg_temp.event('email')), '{}'::jsonb, 'email (OTP) sign-up is allowed');
select is(public.hook_before_user_created(pg_temp.event('google')), '{}'::jsonb, 'Google sign-up is allowed');
select is(public.hook_before_user_created(pg_temp.event('apple')), '{}'::jsonb, 'Apple sign-up is allowed');
select is((public.hook_before_user_created(pg_temp.event('phone')) -> 'error' ->> 'http_code')::int, 403,
  'phone sign-up is rejected with 403');
select ok(public.hook_before_user_created(pg_temp.event('email', true)) ? 'error', 'anonymous sign-up is rejected');
select ok(public.hook_before_user_created(pg_temp.event(null)) ? 'error', 'a sign-up without a provider is rejected');

select ok(has_function_privilege('supabase_auth_admin', 'public.hook_before_user_created(jsonb)', 'execute'),
  'supabase_auth_admin executes the hook');
select ok(not has_function_privilege('anon', 'public.hook_before_user_created(jsonb)', 'execute')
      and not has_function_privilege('authenticated', 'public.hook_before_user_created(jsonb)', 'execute'),
  'anon and authenticated cannot execute the hook');

-- ---- password guard -----------------------------------------------------------------------------------------------------
create function pg_temp.add_user(p_id uuid, p_email text, p_password text) returns void language sql as $$
  insert into auth.users (id, instance_id, email, encrypted_password, aud, role, raw_user_meta_data, raw_app_meta_data,
                          created_at, updated_at)
  values (p_id, '00000000-0000-0000-0000-000000000000', p_email, p_password, 'authenticated', 'authenticated',
          '{}', '{"provider":"email"}', now(), now())
$$;

-- Not GoTrue (migration role, seed fixtures): never checked.
select lives_ok($$select pg_temp.add_user('00000000-0000-4000-a000-0000000060f1', 'fixture@test.thuluth.app', '$2a$06$hash')$$,
  'the migration role may seed password fixtures');

select pg_has_role('supabase_auth_admin', 'member') as can_auth \gset
\if :can_auth
set local role supabase_auth_admin;
select throws_ok($$select pg_temp.add_user('00000000-0000-4000-a000-0000000060a1', 'someone@test.thuluth.app', '$2a$10$hash')$$,
  '42501', 'PASSWORD_SIGNIN_DISABLED', 'GoTrue cannot create a password user for any other address');
select lives_ok($$select pg_temp.add_user('00000000-0000-4000-a000-0000000060a2', 'Reviewer@Thuluth.app', '$2a$10$hash')$$,
  'GoTrue may create the reviewer with a password (address compared case-insensitively)');
select lives_ok($$select pg_temp.add_user('00000000-0000-4000-a000-0000000060a3', 'otp@test.thuluth.app', '')$$,
  'GoTrue creates OTP users (no password)');
select throws_ok($$update auth.users set encrypted_password = '$2a$10$hash' where id = '00000000-0000-4000-a000-0000000060a3'$$,
  '42501', 'PASSWORD_SIGNIN_DISABLED', 'an OTP user cannot add a password (updateUser)');
select lives_ok($$update auth.users set encrypted_password = '$2a$10$other' where id = '00000000-0000-4000-a000-0000000060a2'$$,
  'the reviewer password can be rotated');
select throws_ok($$update auth.users set email = 'moved@test.thuluth.app' where id = '00000000-0000-4000-a000-0000000060a2'$$,
  '42501', 'PASSWORD_SIGNIN_DISABLED', 'the reviewer account cannot move its password to another address');
select lives_ok($$update auth.users set email = 'otp2@test.thuluth.app' where id = '00000000-0000-4000-a000-0000000060a3'$$,
  'a passwordless user can change email');
reset role;
\else
select skip('this connection cannot assume supabase_auth_admin', 7);
\endif

select * from finish();
rollback;
