-- supabase/seed/local/900_dev_fixtures.sql
-- LOCAL AND CI ONLY (never staging or prod). 10-supabase-structure.md section 13.4.
-- Sprint 0 subset: the four test users, household "Lahore Family" with owner/caregiver/viewer
-- memberships, the free user's own household, a promotional premium subscription for the owner,
-- and local-only flag overrides. Family members, plans and grocery lists are added to this file
-- by the sprints that create those tables.
--
-- Local password for every fixture user: thuluth-local-dev (password sign-in is for the local
-- stack only; end users sign in with email OTP).
set app.bypass_entitlements = 'on';

do $$
declare
  u record;
  v_pw text := extensions.crypt('thuluth-local-dev', extensions.gen_salt('bf'));
begin
  for u in
    select * from (values
      ('00000000-0000-4000-a000-000000000001'::uuid, 'owner@thuluth.test',     'Ayesha (owner)'),
      ('00000000-0000-4000-a000-000000000002'::uuid, 'caregiver@thuluth.test', 'Usman (caregiver)'),
      ('00000000-0000-4000-a000-000000000003'::uuid, 'viewer@thuluth.test',    'Nani (viewer)'),
      ('00000000-0000-4000-a000-000000000004'::uuid, 'free@thuluth.test',      'Bilal (free)')
    ) as v(id, email, display_name)
  loop
    if not exists (select 1 from auth.users where id = u.id) then
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
        confirmation_token, recovery_token, email_change_token_new, email_change)
      values (
        '00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email, v_pw, now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('display_name', u.display_name, 'locale', 'en', 'timezone', 'Asia/Karachi', 'country_code', 'PK'),
        now(), now(), '', '', '', '');
      insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      values (u.id::text, u.id, jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
              'email', now(), now(), now());
    end if;
  end loop;
end $$;

-- Household "Lahore Family" (owner row created by the bootstrap trigger)
insert into public.households (id, owner_user_id, name, country_code, region, city, timezone, currency)
values ('00000000-0000-4000-b000-000000000001', '00000000-0000-4000-a000-000000000001',
        'Lahore Family', 'PK', 'PB', 'Lahore', 'Asia/Karachi', 'PKR')
on conflict (id) do nothing;

insert into public.household_members (household_id, user_id, role, invited_by)
select '00000000-0000-4000-b000-000000000001', v.user_id, v.role::public.household_role, '00000000-0000-4000-a000-000000000001'
from (values
  ('00000000-0000-4000-a000-000000000002'::uuid, 'caregiver'),
  ('00000000-0000-4000-a000-000000000003'::uuid, 'viewer')
) as v(user_id, role)
where not exists (
  select 1 from public.household_members hm
  where hm.household_id = '00000000-0000-4000-b000-000000000001' and hm.user_id = v.user_id and hm.deleted_at is null);

-- The free user's own household (entitlement tests)
insert into public.households (id, owner_user_id, name, country_code, city, timezone, currency)
values ('00000000-0000-4000-b000-000000000002', '00000000-0000-4000-a000-000000000004',
        'Bilal Household', 'PK', 'Karachi', 'Asia/Karachi', 'PKR')
on conflict (id) do nothing;

-- Owner premium via a promotional subscription
insert into public.subscriptions (user_id, tier, status, product_id, store, rc_app_user_id, current_period_end, will_renew)
values ('00000000-0000-4000-a000-000000000001', 'premium', 'active', 'thuluth_premium_annual', 'promotional',
        '00000000-0000-4000-a000-000000000001', now() + interval '1 year', false)
on conflict (rc_app_user_id, product_id, store) do update
  set status = excluded.status, current_period_end = excluded.current_period_end;

-- Local-only flag overrides
update public.feature_flags set enabled = true where key in ('debug_menu', 'allow_sandbox_premium');

reset app.bypass_entitlements;
