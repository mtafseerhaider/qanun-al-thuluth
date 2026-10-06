-- supabase/migrations/20261001000300_identity_tenancy.sql
-- 0003 Identity and tenancy (05-database-schema.md section 6), Sprint 0 subset:
-- users, households, household_members (verbatim DDL).
-- household_invitations and family_members are Sprint 1 (S1-02); see migrations/README.md.

-- 6.1 users: profile row 1:1 with auth.users. Created by trigger on auth.users (0012).
create table public.users (
  id                       uuid primary key references auth.users(id) on delete cascade,
  display_name             text not null default '' check (char_length(display_name) <= 80),
  email                    extensions.citext,                 -- Addition: copy of auth email for invitation matching
  avatar_path              text,                               -- Addition: Storage path in bucket "avatars"
  locale                   text not null default 'en'
                             check (locale in ('en','ur','ar','fr','tr','ms','id','bn')),
  country_code             char(2) check (country_code ~ '^[A-Z]{2}$'),
  timezone                 text not null default 'Asia/Karachi',
  tradition_preference     public.source_tradition not null default 'shared',
  units                    text not null default 'metric' check (units in ('metric','imperial')),
  onboarding_completed_at  timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  deleted_at               timestamptz
);
create unique index users_email_key on public.users (email) where deleted_at is null;

-- 6.2 households
create table public.households (
  id              uuid primary key default gen_random_uuid(),
  owner_user_id   uuid not null references public.users(id) on delete cascade,
  name            text not null check (char_length(name) between 1 and 80),
  country_code    char(2) not null default 'PK' check (country_code ~ '^[A-Z]{2}$'),
  region          text,                         -- region_code matching regions.region_code, e.g. 'PB'
  region_id       uuid,                         -- Addition: FK to regions added in 0004
  city            text,
  timezone        text not null default 'Asia/Karachi',
  currency        char(3) not null default 'PKR' check (currency ~ '^[A-Z]{3}$'),
  family_size     smallint not null default 0 check (family_size between 0 and 50), -- maintained by trigger
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index households_owner_idx on public.households (owner_user_id) where deleted_at is null;

-- 6.3 household_members: app users with access to a household
create table public.household_members (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  role          public.household_role not null,
  invited_by    uuid references public.users(id) on delete set null,  -- Addition
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
-- one live membership per (household, user); hot path for every RLS check
create unique index household_members_unique_live
  on public.household_members (household_id, user_id) where deleted_at is null;
create index household_members_user_idx
  on public.household_members (user_id, household_id) include (role) where deleted_at is null;
-- exactly one owner row per household
create unique index household_members_one_owner
  on public.household_members (household_id) where role = 'owner' and deleted_at is null;
