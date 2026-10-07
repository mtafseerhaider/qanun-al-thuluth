-- supabase/migrations/20261006160200_auth_signup_guard.sql
-- 05 ref: addition (11-authentication.md section 3.1.1, 00-foundations.md section 11 "Store reviewer access",
-- docs/store/demo-account.md). Launch follow-up.
--
-- Users sign in with email OTP, Google or Apple only. The single password account is the store reviewer
-- `reviewer@thuluth.app`, whose password an admin sets in the thuluth-prod dashboard. Two pieces enforce that:
--
--   public.hook_before_user_created(event jsonb) -> jsonb
--     Supabase "before user created" Auth hook (config.toml [auth.hook.before_user_created],
--     uri pg-functions://postgres/public/hook_before_user_created). Contract: `event` is
--     {metadata: {uuid, time, name, ip_address}, user: {id, email, phone, app_metadata, user_metadata, ...}};
--     returning {} allows the sign-up, {"error": {"http_code", "message"}} rejects it before the row exists.
--     Rule: the sign-up's provider (user.app_metadata.provider) must be `email` (OTP), `google` or `apple`;
--     phone, anonymous and any other provider are refused (403).
--     Hosted projects: config.toml applies only to the local stack and `supabase config push`; enable the hook
--     in the dashboard (Authentication > Hooks > Before User Created > Postgres function
--     public.hook_before_user_created) on thuluth-dev, thuluth-staging and thuluth-prod.
--
--   private.guard_password_auth_user() trigger on auth.users (before insert, before update of
--   encrypted_password and email)
--     The hook payload carries no password field (GoTrue never serialises the hash), so an OTP sign-up and a
--     password sign-up through the public /signup endpoint look the same to the hook. The password rule is
--     therefore a trigger: when GoTrue (role supabase_auth_admin) creates a user with a password, adds a
--     password to a passwordless user (updateUser({password})), or moves a password account to another
--     address, and the address is not reviewer@thuluth.app, the write fails (42501 PASSWORD_SIGNIN_DISABLED;
--     GoTrue answers 500 "Database error saving new user" / "updating user"). Changing an existing password
--     (rotation, hash upgrades) is untouched. Rows written directly by the migration role (seed fixtures in
--     seed/local/900_dev_fixtures.sql, tests) are not GoTrue and are not checked.
--     The reviewer exception applies in every environment; dev and staging simply never create that account
--     (11 section 3.1.1).
--
-- Security: the hook is security invoker (Auth runs it as supabase_auth_admin), touches no table, and only
-- supabase_auth_admin may execute it. The trigger function only reads NEW/OLD.

create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user     jsonb := coalesce(event -> 'user', '{}'::jsonb);
  v_provider text  := coalesce(v_user -> 'app_metadata' ->> 'provider', '');
begin
  if coalesce((v_user ->> 'is_anonymous')::boolean, false) or v_provider not in ('email', 'google', 'apple') then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'Sign up with an email code, Google or Apple.'));
  end if;
  return '{}'::jsonb;
end $$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;

create or replace function private.guard_password_auth_user()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user <> 'supabase_auth_admin'
     or coalesce(new.encrypted_password, '') = ''
     or lower(coalesce(new.email, '')) = 'reviewer@thuluth.app' then
    return new;
  end if;
  if tg_op = 'UPDATE' and coalesce(old.encrypted_password, '') <> ''
     and lower(coalesce(old.email, '')) = lower(coalesce(new.email, '')) then
    return new;  -- an existing password account changing its password (only fixtures and the reviewer have one)
  end if;
  raise exception 'PASSWORD_SIGNIN_DISABLED' using errcode = '42501',
    detail = jsonb_build_object('rule', 'password_reviewer_only')::text,
    hint = 'Only the store reviewer account may have a password (11-authentication.md section 3.1.1).';
end $$;
revoke execute on function private.guard_password_auth_user() from public, anon, authenticated;

drop trigger if exists guard_password_auth_user on auth.users;
create trigger guard_password_auth_user
  before insert or update of encrypted_password, email on auth.users
  for each row execute function private.guard_password_auth_user();
