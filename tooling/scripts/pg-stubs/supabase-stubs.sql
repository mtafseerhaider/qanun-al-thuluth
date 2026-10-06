-- tooling/scripts/pg-stubs/supabase-stubs.sql
--
-- Minimal stand-in for the objects a Supabase Postgres image provides before any
-- project migration runs. Used ONLY by tooling/scripts/db-test.sh in "plain" mode
-- (a throwaway vanilla PostgreSQL cluster) when the Supabase CLI / Docker images
-- are unavailable. Never applied to a real Supabase project.
--
-- Mirrors, as closely as is useful for migrations and pgTAP:
--   * roles anon, authenticated, service_role (bypassrls), authenticator, supabase_admin
--   * schemas extensions, auth (+ auth.users, auth.identities), vault (empty shell)
--   * auth.uid(), auth.role(), auth.jwt(), auth.email() reading request.jwt.claim(s)
--   * Supabase default privileges on schema public (anon/authenticated/service_role get
--     table/function/sequence grants; RLS is what actually gates access)

-- Roles ---------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin login superuser;
  end if;
end $$;

grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;

-- Schemas -------------------------------------------------------------------------------
create schema if not exists extensions;
grant usage on schema extensions to public, anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create schema if not exists vault;   -- empty shell; Supabase Vault is not emulated

-- public schema privileges as on Supabase
grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to postgres, service_role;
alter default privileges for role postgres in schema public grant all on tables    to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;

-- auth.users (subset of GoTrue columns that migrations, seeds and tests touch) -----------
create table if not exists auth.users (
  instance_id          uuid,
  id                   uuid primary key,
  aud                  varchar(255),
  role                 varchar(255),
  email                varchar(255),
  encrypted_password   varchar(255),
  email_confirmed_at   timestamptz,
  invited_at           timestamptz,
  confirmation_token   varchar(255),
  confirmation_sent_at timestamptz,
  recovery_token       varchar(255),
  recovery_sent_at     timestamptz,
  email_change_token_new varchar(255),
  email_change         varchar(255),
  email_change_sent_at timestamptz,
  last_sign_in_at      timestamptz,
  raw_app_meta_data    jsonb,
  raw_user_meta_data   jsonb,
  is_super_admin       boolean,
  created_at           timestamptz,
  updated_at           timestamptz,
  phone                text unique,
  phone_confirmed_at   timestamptz,
  confirmed_at         timestamptz,
  banned_until         timestamptz,
  deleted_at           timestamptz,
  is_sso_user          boolean not null default false,
  is_anonymous         boolean not null default false
);

create table if not exists auth.identities (
  provider_id      text not null,
  user_id          uuid not null references auth.users(id) on delete cascade,
  identity_data    jsonb not null,
  provider         text not null,
  last_sign_in_at  timestamptz,
  created_at       timestamptz,
  updated_at       timestamptz,
  email            text generated always as (lower(identity_data ->> 'email')) stored,
  id               uuid not null default gen_random_uuid() primary key,
  unique (provider_id, provider)
);

-- JWT accessors, same definitions as Supabase's auth schema -------------------------------
create or replace function auth.jwt()
returns jsonb
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

create or replace function auth.uid()
returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

create or replace function auth.role()
returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;

create or replace function auth.email()
returns text
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;

grant execute on function auth.jwt(), auth.uid(), auth.role(), auth.email() to anon, authenticated, service_role;
grant all on auth.users, auth.identities to service_role;
