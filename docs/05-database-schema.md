# 05 · Database Schema

> **Status:** Draft v1 for implementation · **Owner:** Backend / Data · **Deliverable:** 4 (Database Schema)
>
> **Related docs:** `00-foundations.md` (canonical names, enums, table catalog), `04-system-architecture.md`, `06-api-specification.md`, `10-supabase-structure.md` (directory layout, Storage, cron wiring, local workflow), `11-authentication.md`, `12-ai-agent-architecture.md`, `13-islamic-knowledge-module.md`, `14-meal-planning-and-grocery.md`, `15-family-health-modules.md`, `16-security-architecture.md`, `17-subscription-architecture.md`, `18-exports-and-analytics.md`, `21-testing-strategy.md`.
>
> This document is the reference DDL. Every SQL block headed by a migration file name is meant to be copied verbatim into `supabase/migrations/`. Anything not in `00-foundations.md` is marked **Addition beyond 00-foundations** and listed in [section 20](#20-additions-beyond-00-foundations).

## Table of contents

1. [Design principles](#1-design-principles)
2. [Migration plan](#2-migration-plan)
3. [Entity relationship diagrams](#3-entity-relationship-diagrams)
4. [0001 Extensions and enums](#4-0001-extensions-and-enums)
5. [0002 Core helper functions](#5-0002-core-helper-functions)
6. [0003 Identity and tenancy](#6-0003-identity-and-tenancy)
7. [0004 Food catalog](#7-0004-food-catalog)
8. [0005 Health profile](#8-0005-health-profile)
9. [0006 Islamic knowledge and evidence](#9-0006-islamic-knowledge-and-evidence)
10. [0007 AI](#10-0007-ai)
11. [0008 Plans, grocery and budget](#11-0008-plans-grocery-and-budget)
12. [0009 Tracking and family modules](#12-0009-tracking-and-family-modules)
13. [0010 Platform](#13-0010-platform)
14. [0011 Access helper functions](#14-0011-access-helper-functions)
15. [0012 Triggers](#15-0012-triggers)
16. [0013 Row Level Security](#16-0013-row-level-security)
17. [0014 Analytics partitions, materialized views and cron](#17-0014-analytics-partitions-materialized-views-and-cron)
18. [Data retention](#18-data-retention)
19. [Seed strategy](#19-seed-strategy)
20. [Additions beyond 00-foundations](#20-additions-beyond-00-foundations)
21. [Acceptance criteria and test hooks](#21-acceptance-criteria-and-test-hooks)

---

## 1. Design principles

| Principle | Rule in this schema |
|---|---|
| Naming | `snake_case`, plural tables, `id uuid primary key default gen_random_uuid()`. |
| Timestamps | Every table has `created_at` and `updated_at`, both `timestamptz not null default now()`, with `updated_at` maintained by the `set_updated_at()` trigger attached in migration 0012 by a loop over all public tables. |
| Soft delete | User-owned tables carry `deleted_at timestamptz`. RLS `select` policies filter `deleted_at is null`. Hard deletes happen only through `account-delete` and retention jobs running as `service_role`. |
| Tenancy | Every family-scoped row carries `household_id uuid not null references households(id)`. RLS uses a single indexed predicate `is_household_member(household_id)`. Every `household_id` column has a btree index (usually composite with the most common filter). |
| Integrity of denormalised `household_id` | Child rows also carry the parent's `household_id`. A composite foreign key `(parent_id, household_id) references parent(id, household_id)` guarantees the copy can never drift. Each parent therefore has `unique (id, household_id)`. |
| Units | Metric only: `weight_kg numeric(5,2)`, `height_cm numeric(5,1)`, `*_ml integer`, `kcal numeric(7,1)`, `_g`, `_mg`, `_mcg` suffixes. Conversion to imperial is a client concern (`users.units`). |
| Money | `amount_minor bigint` + `currency char(3)`. PKR uses 2 minor digits (paisa) per ISO 4217, so Rs 120 is stored as `12000`. |
| Enums | Only the enums in `00-foundations.md` section 5 are Postgres enums. Small closed sets from the table catalog (for example `kind ('allergy'|'intolerance')`) are `text` with a `check` constraint so values can be added in a migration without enum gymnastics. |
| ON DELETE | Household-scoped children `on delete cascade` from `households` and `family_members` (a household is only hard-deleted by erasure). References into the global catalog use `on delete restrict` (catalog rows are retired, never deleted). Optional links (`linked_user_id`, `reporter_user_id`, `source_message_id`) use `on delete set null`. |
| Security definer | Helper functions used inside RLS are `security definer`, `stable`, `set search_path = ''`, fully schema-qualified, so they cannot recurse into RLS and cannot be hijacked by `search_path`. |
| Extensions schema | Extensions live in schema `extensions` (Supabase default). Vector columns are typed `extensions.vector(1536)`. |

## 2. Migration plan

File names follow the Supabase CLI convention `<UTC timestamp>_<name>.sql`. The short number (0001 to 0014) is used in this document for readability. Storage bucket creation and seed files are specified in `10-supabase-structure.md`.

| # | File | Contents |
|---|---|---|
| 0001 | `20261001000100_extensions_enums.sql` | Extensions, all canonical enums |
| 0002 | `20261001000200_core_helpers.sql` | `set_updated_at`, `life_stage_for_dob`, `compute_bmi`, `is_admin` |
| 0003 | `20261001000300_identity_tenancy.sql` | `users`, `households`, `household_members`, `household_invitations`, `family_members` |
| 0004 | `20261001000400_food_catalog.sql` | `allergens`, `budget_categories`, `regions`, `ingredients`, `ingredient_allergens`, `recipes`, `recipe_ingredients`, `meals`, `portions`, `meal_alternatives`, `seasonal_produce`, `price_profiles`, `price_observations` |
| 0005 | `20261001000500_health_profile.sql` | `medical_conditions`, `allergies`, `medications`, `supplements`, `food_preferences`, `food_dislikes`, `nutrition_goals`, `pregnancy_profiles`, `sensory_profiles` |
| 0006 | `20261001000600_islamic_knowledge.sql` | `quran_references`, `hadith_references`, `imam_narrations`, `islamic_sources`, `source_verifications`, `foods_in_narrations`, `scientific_evidence`, `recommendations`, `recommendation_evidence`, `coaching_tips` |
| 0007 | `20261001000700_ai.sql` | `ai_assessments`, `chat_sessions`, `chat_messages`, `ai_memories`, `ai_usage`, `ai_model_routes`, `prompt_templates` |
| 0008 | `20261001000800_plans_grocery_budget.sql` | `budget_profiles`, `meal_plans`, `daily_meals`, `daily_meal_servings`, `grocery_lists`, `shopping_items`, `budget_entries`, `plan_recommendations` |
| 0009 | `20261001000900_tracking_modules.sql` | `meal_logs`, `hydration_targets`, `hydration_logs`, `fasting_logs`, `ramadan_plans`, `growth_reference_lms`, `growth_tracking`, `weight_tracking`, `nutrition_journal`, `food_exposures`, `exposure_ladders`, `exposure_ladder_steps` |
| 0010 | `20261001001000_platform.sql` | `subscriptions`, `notifications`, `notification_preferences`, `devices`, `consents`, `audit_log`, `analytics_events` (partitioned), `exports`, `feature_flags` |
| 0011 | `20261001001100_access_helpers.sql` | `is_household_member`, `household_role_of`, `can_edit_household`, `can_author_plans`, `shares_household_with`, `has_premium`, `household_has_premium` |
| 0012 | `20261001001200_triggers.sql` | `updated_at` loop, derived columns, entitlement limits, audit, auth profile creation, membership bootstrap |
| 0013 | `20261001001300_rls.sql` | `enable row level security` on every table and all policies |
| 0014 | `20261001001400_analytics_cron.sql` | Partition maintenance, materialized views, all `pg_cron` jobs |

Rules for future migrations are in `10-supabase-structure.md` section "Migration rules". The short version: forward-only, additive enum changes only, every new table ships with RLS policies and a pgTAP test in the same pull request.

## 3. Entity relationship diagrams

The ERD is split by domain. Columns shown are the keys and the most important attributes only; the DDL is authoritative.

### 3.1 Identity, tenancy and health profile

```mermaid
erDiagram
    AUTH_USERS ||--|| users : "1:1 (id)"
    users ||--o{ households : owns
    users ||--o{ household_members : "is member"
    households ||--o{ household_members : has
    households ||--o{ household_invitations : issues
    households ||--o{ family_members : plans_for
    users |o--o{ family_members : "linked_user_id"
    family_members ||--o{ medical_conditions : has
    family_members ||--o{ allergies : has
    allergens ||--o{ allergies : "allergen_id"
    family_members ||--o{ medications : takes
    family_members ||--o{ supplements : takes
    family_members ||--o{ food_preferences : likes
    family_members ||--o{ food_dislikes : dislikes
    family_members ||--o{ nutrition_goals : pursues
    family_members ||--o| pregnancy_profiles : "0..1 active"
    family_members ||--o| sensory_profiles : "0..1"

    households {
        uuid id PK
        uuid owner_user_id FK
        text timezone
        char currency
    }
    household_members {
        uuid household_id FK
        uuid user_id FK
        household_role role
    }
    family_members {
        uuid id PK
        uuid household_id FK
        date date_of_birth
        life_stage life_stage
        special_module_arr special_modules
    }
```

### 3.2 Food catalog and pricing

```mermaid
erDiagram
    budget_categories ||--o{ ingredients : groups
    ingredients ||--o{ ingredient_allergens : contains
    allergens ||--o{ ingredient_allergens : flagged_by
    recipes ||--o{ recipe_ingredients : uses
    ingredients ||--o{ recipe_ingredients : in
    meals ||--o{ portions : "portion per life_stage"
    recipes ||--o{ portions : "portion per life_stage"
    meals ||--o{ meal_alternatives : "has alternative"
    regions ||--o{ seasonal_produce : grows
    ingredients ||--o{ seasonal_produce : seasonal
    regions ||--o{ price_profiles : priced_in
    price_profiles ||--o{ price_observations : contains
    ingredients ||--o{ price_observations : priced

    recipes {
        uuid id PK
        uuid household_id "null = global"
        meal_type_arr meal_types
        verification_status review_status
    }
    meals {
        uuid id PK
        uuid household_id "null = global"
        jsonb components
        jsonb plate_split
    }
```

### 3.3 Plans, grocery, budget and tracking

```mermaid
erDiagram
    households ||--o{ meal_plans : has
    ai_assessments |o--o{ meal_plans : generated_by
    budget_profiles |o--o{ meal_plans : constrains
    meal_plans |o--o{ meal_plans : "parent_plan_id"
    meal_plans ||--o{ daily_meals : contains
    meals ||--o{ daily_meals : scheduled
    daily_meals ||--o{ daily_meal_servings : "per member"
    family_members ||--o{ daily_meal_servings : eats
    portions |o--o{ daily_meal_servings : sized_by
    meal_plans |o--o{ grocery_lists : derives
    grocery_lists ||--o{ shopping_items : lists
    budget_profiles ||--o{ budget_entries : tracks
    grocery_lists |o--o{ budget_entries : paid_for
    meal_plans |o--o| ramadan_plans : "ramadan schedule"
    family_members ||--o{ meal_logs : logs
    family_members ||--o| hydration_targets : has
    family_members ||--o{ hydration_logs : drinks
    family_members ||--o{ fasting_logs : fasts
    family_members ||--o{ growth_tracking : measured
    family_members ||--o{ weight_tracking : weighed
    family_members ||--o{ nutrition_journal : reflects
    family_members ||--o{ food_exposures : exposed
    family_members ||--o{ exposure_ladders : climbs
    exposure_ladders ||--o{ exposure_ladder_steps : steps
```

### 3.4 AI, Islamic knowledge and evidence

```mermaid
erDiagram
    households ||--o{ ai_assessments : assessed
    households ||--o{ chat_sessions : chats
    users ||--o{ chat_sessions : owns
    chat_sessions ||--o{ chat_messages : contains
    chat_messages |o--o{ ai_memories : "source_message_id"
    households ||--o{ ai_memories : remembers
    quran_references ||--o| islamic_sources : indexed_as
    hadith_references ||--o| islamic_sources : indexed_as
    imam_narrations ||--o| islamic_sources : indexed_as
    islamic_sources ||--o{ source_verifications : reviewed
    islamic_sources ||--o{ foods_in_narrations : mentions
    recommendations ||--o{ recommendation_evidence : backed_by
    islamic_sources |o--o{ recommendation_evidence : cites
    scientific_evidence |o--o{ recommendation_evidence : cites
    recommendations ||--o{ plan_recommendations : shown_as
    meal_plans |o--o{ plan_recommendations : in
    chat_messages |o--o{ plan_recommendations : in
    scientific_evidence |o--o{ coaching_tips : supports
```

### 3.5 Platform

```mermaid
erDiagram
    users ||--o{ subscriptions : pays
    users ||--o{ notifications : receives
    users ||--o{ notification_preferences : sets
    users ||--o{ devices : uses
    users ||--o{ consents : grants
    users ||--o{ exports : requests
    households ||--o{ exports : about
    users |o--o{ audit_log : actor
    users |o--o{ analytics_events : emits
    users ||--o{ ai_usage : metered
```

---

## 4. 0001 Extensions and enums

```sql
-- supabase/migrations/20261001000100_extensions_enums.sql
-- Extensions. Supabase installs extensions into schema "extensions".
create extension if not exists pgcrypto  with schema extensions;
create extension if not exists citext    with schema extensions;
create extension if not exists pg_trgm   with schema extensions;
create extension if not exists vector    with schema extensions;   -- pgvector
create extension if not exists pg_cron;                            -- installs into schema "cron"
create extension if not exists pg_net    with schema extensions;   -- Addition beyond 00-foundations: HTTP calls from pg_cron to Edge Functions
-- Supabase Vault (schema "vault") is enabled by default on hosted projects and used for cron secrets.

-- Canonical enums, copied verbatim from 00-foundations section 5. Additive changes only.
create type public.household_role        as enum ('owner','caregiver','viewer','coach');
create type public.sex_at_birth          as enum ('female','male','unspecified');
create type public.blood_group           as enum ('A+','A-','B+','B-','AB+','AB-','O+','O-','unknown');
create type public.activity_level        as enum ('sedentary','light','moderate','active','very_active');
create type public.life_stage            as enum ('infant','toddler','child','teen','adult','older_adult');
create type public.goal_type             as enum ('weight_loss','weight_gain','maintain','child_growth','energy','digestive_health','pregnancy_support','breastfeeding_support','blood_sugar','heart_health');
create type public.special_module        as enum ('pregnancy','breastfeeding','autism','adhd','picky_eater');
create type public.meal_type             as enum ('suhoor','breakfast','lunch','snack','dinner','iftar');
create type public.meal_status           as enum ('planned','eaten','partly_eaten','skipped','swapped');
create type public.plan_status           as enum ('draft','generating','active','completed','archived','failed');
create type public.plan_kind             as enum ('standard','ramadan','growth','weight_management','custom');
create type public.severity              as enum ('mild','moderate','severe','anaphylactic');
create type public.evidence_grade_hadith as enum ('sahih','hasan','daif','mawdu','sahih_shia','muwaththaq','hasan_shia','daif_shia','ungraded');
create type public.evidence_grade_science as enum ('high','moderate','low','very_low','expert_opinion');
create type public.source_tradition      as enum ('shared','sunni','shia');
create type public.source_kind           as enum ('quran','hadith','imam_narration','scholarly');
create type public.verification_status   as enum ('unverified','in_review','verified','rejected');
create type public.subscription_tier     as enum ('free','premium');
create type public.subscription_status   as enum ('active','in_grace','in_billing_retry','cancelled','expired','paused');
create type public.chat_role             as enum ('user','assistant','system','tool');
create type public.notification_channel  as enum ('push','in_app','email');
create type public.texture               as enum ('smooth','soft','crunchy','chewy','crispy','mixed','lumpy','wet','dry');
create type public.exposure_stage        as enum ('tolerate_on_table','look','touch','smell','lick','taste','chew_spit','eat_small','eat_portion');
create type public.acceptance_score      as enum ('0_refused','1_tolerated','2_touched','3_tasted','4_ate_some','5_ate_well');
create type public.fast_kind             as enum ('ramadan','sunnah_monday_thursday','ayyam_al_bid','arafah','ashura','qada','nafl','intermittent');
create type public.price_source          as enum ('seed','user_report','admin','partner_feed');
```

> `pg_net` is an **Addition beyond 00-foundations**. It is a standard Supabase extension and is the only supported way for `pg_cron` to invoke Edge Functions (`notifications-dispatch`, `prices-refresh`, `analytics-rollup`).

## 5. 0002 Core helper functions

```sql
-- supabase/migrations/20261001000200_core_helpers.sql

-- 5.1 updated_at maintenance (attached to every table in 0012)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 5.2 Life stage from date of birth.
-- infant < 12 months, toddler 12-35 months, child 3-12 years, teen 13-17,
-- adult 18-64, older_adult >= 65. Boundaries match 15-family-health-modules.md.
create or replace function public.life_stage_for_dob(p_dob date, p_on date default current_date)
returns public.life_stage
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_dob is null then 'adult'::public.life_stage
    when (extract(year from age(p_on, p_dob)) * 12 + extract(month from age(p_on, p_dob))) < 12 then 'infant'
    when extract(year from age(p_on, p_dob)) < 3  then 'toddler'
    when extract(year from age(p_on, p_dob)) < 13 then 'child'
    when extract(year from age(p_on, p_dob)) < 18 then 'teen'
    when extract(year from age(p_on, p_dob)) < 65 then 'adult'
    else 'older_adult'
  end::public.life_stage;
$$;

-- Age in whole months, used by growth-compute and coaching_tips filtering.
create or replace function public.age_in_months(p_dob date, p_on date default current_date)
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select (extract(year from age(p_on, p_dob)) * 12 + extract(month from age(p_on, p_dob)))::integer;
$$;

-- Convenience: is this person a minor on a given date (drives "children are never restricted").
create or replace function public.is_minor(p_dob date, p_on date default current_date)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_dob is not null and age(p_on, p_dob) < interval '18 years';
$$;

-- 5.3 BMI = kg / m^2, rounded to 2 dp. Null-safe, rejects nonsense heights.
create or replace function public.compute_bmi(p_weight_kg numeric, p_height_cm numeric)
returns numeric(5,2)
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_weight_kg is null or p_height_cm is null or p_height_cm < 30 then null
    else round(p_weight_kg / ((p_height_cm / 100.0) ^ 2), 2)
  end::numeric(5,2);
$$;

-- 5.4 Platform admin check (Addition beyond 00-foundations).
-- Admins are users whose auth.users.raw_app_meta_data has {"role":"admin"}; this is
-- set only with the service role (see 16-security-architecture.md). Used by RLS on
-- curated catalog tables so the internal admin console can write through PostgREST.
create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;
```

> `age_in_months`, `is_minor` and `is_admin` are **Additions beyond 00-foundations**.

## 6. 0003 Identity and tenancy

```sql
-- supabase/migrations/20261001000300_identity_tenancy.sql

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

-- 6.4 household_invitations
create table public.household_invitations (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  email         extensions.citext not null,
  role          public.household_role not null check (role <> 'owner'),
  token_hash    text not null unique,      -- sha256 hex of the opaque token; raw token only in the email link
  invited_by    uuid not null references public.users(id) on delete cascade,
  expires_at    timestamptz not null default now() + interval '7 days',
  accepted_at   timestamptz,
  accepted_by   uuid references public.users(id) on delete set null,   -- Addition
  revoked_at    timestamptz,                                             -- Addition
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (expires_at > created_at)
);
create index household_invitations_household_idx on public.household_invitations (household_id);
create unique index household_invitations_one_pending
  on public.household_invitations (household_id, email)
  where accepted_at is null and revoked_at is null;

-- 6.5 family_members: a person being planned for (may have no app account)
create table public.family_members (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid not null references public.households(id) on delete cascade,
  linked_user_id   uuid references public.users(id) on delete set null,
  name             text not null check (char_length(name) between 1 and 60),
  date_of_birth    date check (date_of_birth > date '1900-01-01'),   -- "not in the future" enforced by trigger (CHECK must be immutable)
  sex_at_birth     public.sex_at_birth not null default 'unspecified',
  height_cm        numeric(5,1) check (height_cm between 30 and 260),
  weight_kg        numeric(5,2) check (weight_kg between 1 and 400),
  blood_group      public.blood_group not null default 'unknown',
  activity_level   public.activity_level not null default 'moderate',
  life_stage       public.life_stage not null default 'adult',   -- set by trigger from date_of_birth
  work_schedule    jsonb not null default '{}'::jsonb,           -- {"days":["mon",...],"start":"09:00","end":"17:00","shift":"day"}
  sleep_schedule   jsonb not null default '{}'::jsonb,           -- {"bed":"22:00","wake":"05:30","nap":"14:00-15:00"}
  special_modules  public.special_module[] not null default '{}',
  avatar_path      text,                                         -- bucket "avatars": {household_id}/members/{id}.webp
  sort_order       smallint not null default 0,                  -- Addition: display order
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  unique (id, household_id),
  check (jsonb_typeof(work_schedule) = 'object'),
  check (jsonb_typeof(sleep_schedule) = 'object')
);
create index family_members_household_idx on public.family_members (household_id, sort_order) where deleted_at is null;
create index family_members_linked_user_idx on public.family_members (linked_user_id) where linked_user_id is not null;
create index family_members_modules_gin on public.family_members using gin (special_modules);
create unique index family_members_one_link_per_household
  on public.family_members (household_id, linked_user_id) where linked_user_id is not null and deleted_at is null;
```

Notes:
- `households.family_size` counts live `family_members` rows and is maintained by trigger `trg_family_members_family_size` (0012). Clients never write it.
- `household_members` is distinct from `family_members`. A grandmother who uses the app as caregiver is a `household_members` row; she may also be a `family_members` row (with `linked_user_id`) if the household plans her meals.

## 7. 0004 Food catalog

The catalog is global and admin-managed. Two catalog tables (`recipes`, `meals`) also hold household-private rows (user recipes and AI-composed meals for a specific plan); those rows carry a non-null `household_id` and are protected by household RLS. Global rows have `household_id is null`.

```sql
-- supabase/migrations/20261001000400_food_catalog.sql

-- 7.1 allergens: EU-14 + US Big-9 superset
create table public.allergens (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[a-z_]+$'),
  name_i18n   jsonb not null check (name_i18n ? 'en'),
  eu14        boolean not null default false,   -- Addition: regulatory flags
  us_big9     boolean not null default false,   -- Addition
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 7.2 budget_categories
create table public.budget_categories (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code in (
                'staples','protein_animal','protein_plant','dairy','produce_veg',
                'produce_fruit','oils_fats','spices','beverages','snacks')),
  name_i18n   jsonb not null check (name_i18n ? 'en'),
  sort_order  smallint not null default 0,      -- Addition
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 7.3 regions
create table public.regions (
  id                uuid primary key default gen_random_uuid(),
  country_code      char(2) not null check (country_code ~ '^[A-Z]{2}$'),
  region_code       text not null,               -- ISO 3166-2 subdivision suffix, e.g. 'PB' for Punjab
  name              text not null,
  climate_zone      text not null check (climate_zone in (
                      'hot_arid','hot_semi_arid','humid_subtropical','tropical',
                      'mediterranean','temperate_oceanic','continental','subarctic')),
  default_currency  char(3) not null check (default_currency ~ '^[A-Z]{3}$'),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (country_code, region_code)
);

alter table public.households
  add constraint households_region_id_fkey foreign key (region_id)
  references public.regions(id) on delete set null;
create index households_region_idx on public.households (region_id);

-- 7.4 ingredients (nutrients per 100 g edible portion)
create table public.ingredients (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  name_i18n            jsonb not null default '{}'::jsonb,   -- {"en":"Bottle gourd","ur":"لوکی"}
  category             text not null check (category in (
                         'vegetable','fruit','grain','legume','meat','poultry','fish','egg',
                         'dairy','nut_seed','oil_fat','spice_herb','sweetener','beverage',
                         'condiment','prepared')),
  budget_category_id   uuid not null references public.budget_categories(id) on delete restrict,
  default_unit         text not null default 'g' check (default_unit in (
                         'g','kg','ml','l','piece','dozen','bunch','tsp','tbsp','cup','katori','lot')),
  grams_per_unit       numeric(8,2),                 -- Addition: e.g. 1 dozen eggs = 600 g, 1 roti = 40 g
  kcal                 numeric(7,1) check (kcal >= 0),
  protein_g            numeric(6,2) check (protein_g >= 0),
  carbs_g              numeric(6,2) check (carbs_g >= 0),
  fiber_g              numeric(6,2) check (fiber_g >= 0),
  sugar_g              numeric(6,2) check (sugar_g >= 0),
  fat_g                numeric(6,2) check (fat_g >= 0),
  sat_fat_g            numeric(6,2) check (sat_fat_g >= 0),
  sodium_mg            numeric(8,2) check (sodium_mg >= 0),
  iron_mg              numeric(7,2) check (iron_mg >= 0),
  calcium_mg           numeric(8,2) check (calcium_mg >= 0),
  zinc_mg              numeric(7,2) check (zinc_mg >= 0),
  vitamin_a_mcg        numeric(8,2) check (vitamin_a_mcg >= 0),
  vitamin_c_mg         numeric(7,2) check (vitamin_c_mg >= 0),
  vitamin_d_mcg        numeric(7,2) check (vitamin_d_mcg >= 0),
  b12_mcg              numeric(7,2) check (b12_mcg >= 0),
  folate_mcg           numeric(8,2) check (folate_mcg >= 0),
  potassium_mg         numeric(8,2) check (potassium_mg >= 0),
  omega3_g             numeric(6,3) check (omega3_g >= 0),
  halal_status         text not null default 'halal' check (halal_status in ('halal','haram','mashbooh','depends_on_source')),
  is_sunnah_food       boolean not null default false,
  fdc_id               integer unique,               -- USDA FoodData Central id
  textures             public.texture[] not null default '{}',
  color                text check (color in ('red','orange','yellow','green','purple','blue','white','beige','brown','black','mixed')),
  is_active            boolean not null default true, -- Addition: retire instead of delete
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (sat_fat_g is null or fat_g is null or sat_fat_g <= fat_g),
  check (sugar_g is null or carbs_g is null or sugar_g <= carbs_g)
);
create unique index ingredients_name_key on public.ingredients (lower(name));
create index ingredients_name_trgm on public.ingredients using gin (name extensions.gin_trgm_ops);
create index ingredients_name_i18n_gin on public.ingredients using gin (name_i18n jsonb_path_ops);
create index ingredients_budget_category_idx on public.ingredients (budget_category_id);
create index ingredients_sunnah_idx on public.ingredients (id) where is_sunnah_food;

-- 7.5 ingredient_allergens
create table public.ingredient_allergens (
  id             uuid primary key default gen_random_uuid(),
  ingredient_id  uuid not null references public.ingredients(id) on delete cascade,
  allergen_id    uuid not null references public.allergens(id) on delete restrict,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (ingredient_id, allergen_id)
);
create index ingredient_allergens_allergen_idx on public.ingredient_allergens (allergen_id);

-- 7.6 recipes
create table public.recipes (
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid references public.households(id) on delete cascade,  -- Addition: null = global catalog
  created_by_user_id     uuid references public.users(id) on delete set null,       -- Addition
  title                  text not null check (char_length(title) between 1 and 120),
  title_i18n             jsonb not null default '{}'::jsonb,
  cuisine                text not null default 'pakistani',
  region_tags            text[] not null default '{}',        -- e.g. {'PK-PB','PK','south_asia'}
  meal_types             public.meal_type[] not null check (cardinality(meal_types) > 0),
  servings               smallint not null check (servings between 1 and 50),
  prep_min               smallint not null default 0 check (prep_min between 0 and 1440),
  cook_min               smallint not null default 0 check (cook_min between 0 and 1440),
  steps                  jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
                         -- [{"n":1,"text_i18n":{"en":"..."},"timer_min":10}]
  texture_profile        public.texture[] not null default '{}',
  colors                 text[] not null default '{}',
  kid_friendly           boolean not null default false,
  autism_friendly        boolean not null default false,
  ramadan_suitable       boolean not null default false,
  cost_tier              smallint not null default 2 check (cost_tier between 1 and 3),
  per_serving_nutrition  jsonb not null default '{}'::jsonb,  -- computed by trigger from recipe_ingredients
  image_path             text,                                -- bucket "recipe-images"
  source                 text not null default 'curated' check (source in ('curated','ai_generated','user')),
  review_status          public.verification_status not null default 'unverified',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  -- global rows are curated or AI drafts awaiting review; user rows always belong to a household
  check (source <> 'user' or household_id is not null),
  unique (id, household_id)
);
create index recipes_household_idx on public.recipes (household_id) where household_id is not null and deleted_at is null;
create index recipes_catalog_idx on public.recipes (review_status, cost_tier) where household_id is null and deleted_at is null;
create index recipes_meal_types_gin on public.recipes using gin (meal_types);
create index recipes_region_tags_gin on public.recipes using gin (region_tags);
create index recipes_title_trgm on public.recipes using gin (title extensions.gin_trgm_ops);
create index recipes_flags_idx on public.recipes (kid_friendly, autism_friendly, ramadan_suitable) where deleted_at is null;

-- 7.7 recipe_ingredients
create table public.recipe_ingredients (
  id             uuid primary key default gen_random_uuid(),
  recipe_id      uuid not null references public.recipes(id) on delete cascade,
  ingredient_id  uuid not null references public.ingredients(id) on delete restrict,
  quantity       numeric(8,2) not null check (quantity > 0),
  unit           text not null,                  -- as written: 'katori', 'tbsp', 'g'
  grams          numeric(8,2) not null check (grams > 0),  -- normalized, used for nutrition
  optional       boolean not null default false,
  prep_note      text,
  sort_order     smallint not null default 0,    -- Addition
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index recipe_ingredients_recipe_idx on public.recipe_ingredients (recipe_id, sort_order);
create index recipe_ingredients_ingredient_idx on public.recipe_ingredients (ingredient_id);

-- 7.8 meals: composed meal usable in plans
create table public.meals (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid references public.households(id) on delete cascade,  -- Addition: null = global template
  source        text not null default 'curated' check (source in ('curated','ai_generated','user')), -- Addition
  title         text not null check (char_length(title) between 1 and 160),
  title_i18n    jsonb not null default '{}'::jsonb,                        -- Addition
  meal_type     public.meal_type not null,
  components    jsonb not null check (jsonb_typeof(components) = 'array' and jsonb_array_length(components) > 0),
                -- [{"recipe_id":"uuid","role":"main"},{"label":"Kachumber salad","ingredient_ids":["uuid"],"role":"side"}]
  plate_split   jsonb not null default '{"veg_fruit":0.5,"protein":0.25,"carb":0.25}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  check (
    (plate_split ?& array['veg_fruit','protein','carb'])
    and abs((plate_split->>'veg_fruit')::numeric + (plate_split->>'protein')::numeric
            + (plate_split->>'carb')::numeric - 1) <= 0.05
  ),
  unique (id, household_id)
);
create index meals_household_idx on public.meals (household_id) where household_id is not null and deleted_at is null;
create index meals_catalog_type_idx on public.meals (meal_type) where household_id is null and deleted_at is null;
create index meals_components_gin on public.meals using gin (components jsonb_path_ops);

-- 7.9 portions: guidance per life stage
create table public.portions (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid references public.households(id) on delete cascade,  -- Addition: set for portions of household meals
  meal_id           uuid references public.meals(id) on delete cascade,
  recipe_id         uuid references public.recipes(id) on delete cascade,
  life_stage        public.life_stage not null,
  grams             numeric(7,1) not null check (grams > 0),
  household_measure text not null,              -- '1 small roti, half katori daal'
  household_measure_i18n jsonb not null default '{}'::jsonb,                  -- Addition
  kcal              numeric(7,1) check (kcal >= 0),  -- stored for adults; never displayed for minors (UI rule, 15-family-health-modules.md)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (num_nonnulls(meal_id, recipe_id) = 1)
);
create unique index portions_meal_stage_key on public.portions (meal_id, life_stage) where meal_id is not null;
create unique index portions_recipe_stage_key on public.portions (recipe_id, life_stage) where recipe_id is not null;
create index portions_household_idx on public.portions (household_id) where household_id is not null;

-- 7.10 meal_alternatives
create table public.meal_alternatives (
  id                   uuid primary key default gen_random_uuid(),
  meal_id              uuid not null references public.meals(id) on delete cascade,
  alternative_meal_id  uuid not null references public.meals(id) on delete cascade,
  reason               text not null check (reason in ('allergy','budget','autism','picky','season','preference')),
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (meal_id <> alternative_meal_id),
  unique (meal_id, alternative_meal_id, reason)
);
create index meal_alternatives_alt_idx on public.meal_alternatives (alternative_meal_id);

-- 7.11 seasonal_produce
create table public.seasonal_produce (
  id             uuid primary key default gen_random_uuid(),
  region_id      uuid not null references public.regions(id) on delete cascade,
  ingredient_id  uuid not null references public.ingredients(id) on delete restrict,
  month          smallint not null check (month between 1 and 12),
  availability   text not null check (availability in ('peak','available','scarce')),
  price_index    numeric(4,2) not null default 1.00 check (price_index > 0),  -- 1.00 = annual average price
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (region_id, ingredient_id, month)
);
create index seasonal_produce_region_month_idx on public.seasonal_produce (region_id, month, availability);

-- 7.12 price_profiles: a regional price book
create table public.price_profiles (
  id              uuid primary key default gen_random_uuid(),
  region_id       uuid not null references public.regions(id) on delete restrict,
  city            text,                 -- null = region-wide fallback
  currency        char(3) not null check (currency ~ '^[A-Z]{3}$'),
  effective_from  date not null,
  label           text,                 -- Addition: 'Lahore retail Oct 2026'
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index price_profiles_key on public.price_profiles (region_id, coalesce(city, ''), effective_from);

-- 7.13 price_observations
create table public.price_observations (
  id                 uuid primary key default gen_random_uuid(),
  price_profile_id   uuid not null references public.price_profiles(id) on delete cascade,
  ingredient_id      uuid not null references public.ingredients(id) on delete restrict,
  unit               text not null check (unit in ('g','kg','ml','l','piece','dozen','bunch','lot','bottle','pack')),
  amount_minor       bigint not null check (amount_minor > 0),   -- price per one unit
  observed_on        date not null default current_date,
  source             public.price_source not null,
  reporter_user_id   uuid references public.users(id) on delete set null,
  moderation_status  text not null default 'accepted'
                       check (moderation_status in ('pending','accepted','rejected')),  -- Addition
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (source <> 'user_report' or reporter_user_id is not null)
);
create index price_observations_lookup_idx
  on public.price_observations (price_profile_id, ingredient_id, observed_on desc)
  where moderation_status = 'accepted';
create index price_observations_reporter_idx on public.price_observations (reporter_user_id) where reporter_user_id is not null;
create index price_observations_pending_idx on public.price_observations (created_at) where moderation_status = 'pending';
```

Notes:
- `recipes.per_serving_nutrition` shape: `{"kcal":312.5,"protein_g":18.2,"carbs_g":40.1,"fiber_g":7.9,"fat_g":8.4,"sat_fat_g":2.1,"sodium_mg":410,"iron_mg":3.2,"calcium_mg":120, ...}`. It is recomputed by `recompute_recipe_nutrition()` (0012) whenever `recipe_ingredients` change. Keys mirror the `ingredients` nutrient columns.
- Household meals created by `ai-generate-plan` set `meals.household_id`, `source = 'ai_generated'` and reference only verified global recipes or household recipes in `components`. Validation lives in the Edge Function (`14-meal-planning-and-grocery.md`).
- Effective prices for planning come from the materialized view `mv_ingredient_prices` (0014), refreshed by `prices-refresh`.

## 8. 0005 Health profile

All tables carry `household_id` and `family_member_id`, with a composite foreign key to `family_members (id, household_id)`. All are soft-deletable.

```sql
-- supabase/migrations/20261001000500_health_profile.sql

-- 8.1 medical_conditions
create table public.medical_conditions (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  family_member_id  uuid not null,
  condition_code    text,                -- SNOMED CT concept id where known, e.g. '44054006' (type 2 diabetes)
  label             text not null check (char_length(label) between 1 and 120),
  diagnosed_on      date,
  notes             text check (char_length(notes) <= 2000),
  on_insulin_or_sulfonylurea boolean not null default false,  -- Addition: drives fasting red flag (00-foundations 10.2)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index medical_conditions_member_idx on public.medical_conditions (household_id, family_member_id) where deleted_at is null;

-- 8.2 allergies
create table public.allergies (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  family_member_id  uuid not null,
  allergen_id       uuid not null references public.allergens(id) on delete restrict,
  kind              text not null default 'allergy' check (kind in ('allergy','intolerance')),
  severity          public.severity not null,
  reaction_notes    text check (char_length(reaction_notes) <= 2000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create unique index allergies_member_allergen_key on public.allergies (family_member_id, allergen_id) where deleted_at is null;
create index allergies_household_idx on public.allergies (household_id) where deleted_at is null;

-- 8.3 medications
create table public.medications (
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid not null references public.households(id) on delete cascade,
  family_member_id       uuid not null,
  name                   text not null check (char_length(name) between 1 and 120),
  dose                   text,
  frequency              text,
  food_interaction_flags text[] not null default '{}',  -- e.g. {'take_with_food','avoid_grapefruit','vitamin_k_consistency','fasting_risk_hypoglycemia'}
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index medications_member_idx on public.medications (household_id, family_member_id) where deleted_at is null;

-- 8.4 supplements
create table public.supplements (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  family_member_id  uuid not null,
  name              text not null check (char_length(name) between 1 and 120),
  dose              text,
  frequency         text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index supplements_member_idx on public.supplements (household_id, family_member_id) where deleted_at is null;

-- 8.5 food_preferences
create table public.food_preferences (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  family_member_id  uuid not null,
  ingredient_id     uuid references public.ingredients(id) on delete restrict,
  recipe_id         uuid references public.recipes(id) on delete set null,
  label             text not null check (char_length(label) between 1 and 120),
  strength          smallint not null default 2 check (strength between 1 and 3),
  is_safe_food      boolean not null default false,   -- autism / picky "safe food" list
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index food_preferences_member_idx on public.food_preferences (household_id, family_member_id) where deleted_at is null;
create index food_preferences_safe_idx on public.food_preferences (family_member_id) where is_safe_food and deleted_at is null;

-- 8.6 food_dislikes
create table public.food_dislikes (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  family_member_id  uuid not null,
  ingredient_id     uuid references public.ingredients(id) on delete restrict,
  label             text not null check (char_length(label) between 1 and 120),
  reason            text not null default 'taste' check (reason in ('taste','texture','smell','color','religious','other')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index food_dislikes_member_idx on public.food_dislikes (household_id, family_member_id) where deleted_at is null;

-- 8.7 nutrition_goals
create table public.nutrition_goals (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  family_member_id  uuid not null,
  goal_type         public.goal_type not null,
  target_value      numeric(8,2),
  target_unit       text check (target_unit in ('kg','kg_per_week','cm','mmol_l','mg_dl','ml_per_day','servings_per_day','percent','kcal_per_day')),
  target_date       date,
  is_primary        boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  check ((target_value is null) = (target_unit is null)),
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create unique index nutrition_goals_one_primary on public.nutrition_goals (family_member_id) where is_primary and deleted_at is null;
create index nutrition_goals_member_idx on public.nutrition_goals (household_id, family_member_id) where deleted_at is null;
-- Child safety (no weight_loss and no kcal targets under 18) is enforced by trigger enforce_child_goal_safety (0012).

-- 8.8 pregnancy_profiles
create table public.pregnancy_profiles (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references public.households(id) on delete cascade,
  family_member_id      uuid not null,
  trimester             smallint check (trimester between 1 and 3),
  due_date              date,
  gestational_diabetes  boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create unique index pregnancy_profiles_one_live on public.pregnancy_profiles (family_member_id) where deleted_at is null;
create index pregnancy_profiles_household_idx on public.pregnancy_profiles (household_id) where deleted_at is null;

-- 8.9 sensory_profiles
create table public.sensory_profiles (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references public.households(id) on delete cascade,
  family_member_id     uuid not null,
  texture_likes        public.texture[] not null default '{}',
  texture_avoids       public.texture[] not null default '{}',
  color_sensitivities  text[] not null default '{}',
  presentation_prefs   jsonb not null default '{}'::jsonb,
                       -- {"separate_foods":true,"same_plate":true,"divided_plate":true,"cut_shapes":["strips","circles"],"sauce_on_side":true}
  temperature_prefs    text[] not null default '{}'
                         check (temperature_prefs <@ array['hot','warm','room','cold']::text[]),
  brand_rigidity       boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  check (not (texture_likes && texture_avoids)),
  check (jsonb_typeof(presentation_prefs) = 'object'),
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create unique index sensory_profiles_one_live on public.sensory_profiles (family_member_id) where deleted_at is null;
create index sensory_profiles_household_idx on public.sensory_profiles (household_id) where deleted_at is null;
```

## 9. 0006 Islamic knowledge and evidence

Curated global content. The user-facing rule from `00-foundations.md` section 10.5 ("only verified sources are cited") is enforced in RLS by exposing only rows whose `islamic_sources.verification_status = 'verified'`. Editorial workflow and grading rules live in `13-islamic-knowledge-module.md`.

```sql
-- supabase/migrations/20261001000600_islamic_knowledge.sql

-- 9.1 quran_references
create table public.quran_references (
  id                uuid primary key default gen_random_uuid(),
  surah             smallint not null check (surah between 1 and 114),
  ayah_start        smallint not null check (ayah_start >= 1),
  ayah_end          smallint not null,
  arabic_text       text not null,
  translation_i18n  jsonb not null check (translation_i18n ? 'en'),  -- {"en":"...","ur":"..."}
  translator        text not null,          -- e.g. 'Sahih International' (en), 'Fateh Muhammad Jalandhari' (ur)
  topic_tags        text[] not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (ayah_end >= ayah_start),
  unique (surah, ayah_start, ayah_end)
);
create index quran_references_tags_gin on public.quran_references using gin (topic_tags);

-- 9.2 hadith_references (Sunni collections and shared narrations)
create table public.hadith_references (
  id                uuid primary key default gen_random_uuid(),
  collection        text not null check (collection in (
                      'bukhari','muslim','tirmidhi','abu_dawud','ibn_majah','nasai','ahmad',
                      'malik_muwatta','darimi','bayhaqi','tabarani','hakim','ibn_hibban','other')),
  book              text,                   -- book / chapter name as printed
  number            text not null,          -- text to allow '2022a' style numbering
  numbering_scheme  text not null default 'sunnah_com',  -- Addition: which numbering the number follows
  arabic_text       text not null,
  translation_i18n  jsonb not null check (translation_i18n ? 'en'),
  narrator          text,
  grade             public.evidence_grade_hadith not null default 'ungraded',
  graded_by         text,                   -- e.g. 'al-Albani', 'Shuaib al-Arnaut'
  tradition         public.source_tradition not null default 'sunni',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (collection, numbering_scheme, number)
);

-- 9.3 imam_narrations (narrations of the Twelve Imams, peace be upon them)
create table public.imam_narrations (
  id                uuid primary key default gen_random_uuid(),
  imam              text not null check (imam in (
                      'ali_ibn_abi_talib','hasan_ibn_ali','husayn_ibn_ali','ali_zayn_al_abidin',
                      'muhammad_al_baqir','jafar_al_sadiq','musa_al_kazim','ali_al_rida',
                      'muhammad_al_jawad','ali_al_hadi','hasan_al_askari','muhammad_al_mahdi')),
  collection        text not null check (collection in (
                      'al_kafi','tibb_al_aimma','bihar_al_anwar','wasail_al_shia','al_mahasin',
                      'man_la_yahduruhu_al_faqih','tahdhib_al_ahkam','uyun_akhbar_al_rida',
                      'makarim_al_akhlaq','nahj_al_balagha','other')),
  volume            text,
  page              text,
  number            text,
  arabic_text       text not null,
  translation_i18n  jsonb not null check (translation_i18n ? 'en'),
  grade             public.evidence_grade_hadith not null default 'ungraded',
  graded_by         text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (num_nonnulls(volume, page, number) >= 1)
);
create unique index imam_narrations_locator_key
  on public.imam_narrations (collection, coalesce(volume,''), coalesce(page,''), coalesce(number,''));

-- 9.4 islamic_sources: polymorphic index used for retrieval and citation
create table public.islamic_sources (
  id                   uuid primary key default gen_random_uuid(),
  kind                 public.source_kind not null,
  ref_id               uuid,                 -- id in quran_references / hadith_references / imam_narrations; null for 'scholarly'
  tradition            public.source_tradition not null,
  citation_text        text not null,        -- 'Tirmidhi 2380; Ibn Majah 3349 (sahih, al-Albani)'
  embedding            extensions.vector(1536),
  verification_status  public.verification_status not null default 'unverified',  -- Addition: synced from latest source_verifications row
  topic_tags           text[] not null default '{}',                               -- Addition: retrieval filter
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check ((kind = 'scholarly') = (ref_id is null))
);
create unique index islamic_sources_ref_key on public.islamic_sources (kind, ref_id) where ref_id is not null;
create index islamic_sources_verified_idx on public.islamic_sources (tradition, kind) where verification_status = 'verified';
create index islamic_sources_tags_gin on public.islamic_sources using gin (topic_tags);
create index islamic_sources_embedding_hnsw on public.islamic_sources
  using hnsw (embedding extensions.vector_cosine_ops) with (m = 16, ef_construction = 64);

-- 9.5 source_verifications
create table public.source_verifications (
  id                    uuid primary key default gen_random_uuid(),
  islamic_source_id     uuid not null references public.islamic_sources(id) on delete cascade,
  status                public.verification_status not null,
  reviewer_name         text not null,
  reviewer_credentials  text not null,
  reviewed_on           date not null default current_date,
  method                text not null check (method in ('primary_text_check','takhrij','scholar_panel','cross_reference')),
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index source_verifications_source_idx on public.source_verifications (islamic_source_id, reviewed_on desc, created_at desc);

-- 9.6 foods_in_narrations
create table public.foods_in_narrations (
  id                 uuid primary key default gen_random_uuid(),
  islamic_source_id  uuid not null references public.islamic_sources(id) on delete cascade,
  ingredient_id      uuid references public.ingredients(id) on delete restrict,
  food_label         text not null,          -- 'talbina', 'dates', 'pumpkin (dubba)'
  context            text not null check (context in ('recommended','mentioned','cautioned')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index foods_in_narrations_source_idx on public.foods_in_narrations (islamic_source_id);
create index foods_in_narrations_ingredient_idx on public.foods_in_narrations (ingredient_id) where ingredient_id is not null;

-- 9.7 scientific_evidence
create table public.scientific_evidence (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  citation    text not null,                -- Vancouver style
  doi         text unique check (doi ~* '^10\.\d{4,9}/\S+$'),
  pmid        text unique check (pmid ~ '^\d{1,9}$'),
  study_type  text not null check (study_type in (
                'systematic_review','meta_analysis','rct','cohort','case_control',
                'cross_sectional','guideline','narrative_review','expert_opinion')),
  grade       public.evidence_grade_science not null,
  summary     text not null,
  population  text,                          -- 'children 2-5 y', 'pregnant women', 'adults with T2D'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index scientific_evidence_title_trgm on public.scientific_evidence using gin (title extensions.gin_trgm_ops);

-- 9.8 recommendations
create table public.recommendations (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique check (code ~ '^[a-z0-9_.]+$'),   -- 'hydration.pre_meal_water'
  title_i18n           jsonb not null check (title_i18n ? 'en'),
  practical_text_i18n  jsonb not null check (practical_text_i18n ? 'en'),
  applies_to           jsonb not null default '{}'::jsonb,
                       -- {"life_stages":["adult"],"modules":["pregnancy"],"goals":["blood_sugar"],"min_age_months":24}
  contraindications    jsonb not null default '{}'::jsonb,
                       -- {"conditions":["ckd"],"medications":["warfarin"],"life_stages":["infant"]}
  review_status        public.verification_status not null default 'unverified',  -- Addition: publish gate
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index recommendations_applies_gin on public.recommendations using gin (applies_to jsonb_path_ops);

-- 9.9 recommendation_evidence
create table public.recommendation_evidence (
  id                      uuid primary key default gen_random_uuid(),
  recommendation_id       uuid not null references public.recommendations(id) on delete cascade,
  islamic_source_id       uuid references public.islamic_sources(id) on delete restrict,
  scientific_evidence_id  uuid references public.scientific_evidence(id) on delete restrict,
  relationship            text not null check (relationship in ('supports','context','caution')),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (num_nonnulls(islamic_source_id, scientific_evidence_id) >= 1)
);
create index recommendation_evidence_rec_idx on public.recommendation_evidence (recommendation_id);
create index recommendation_evidence_src_idx on public.recommendation_evidence (islamic_source_id) where islamic_source_id is not null;
create index recommendation_evidence_sci_idx on public.recommendation_evidence (scientific_evidence_id) where scientific_evidence_id is not null;

-- 9.10 coaching_tips
create table public.coaching_tips (
  id              uuid primary key default gen_random_uuid(),
  module          text not null check (module in ('picky','autism','ramadan','general')),
  age_min_months  smallint not null default 0 check (age_min_months >= 0),
  age_max_months  smallint not null default 1200,
  body_i18n       jsonb not null check (body_i18n ? 'en'),
  evidence_id     uuid references public.scientific_evidence(id) on delete set null,
  is_active       boolean not null default true,    -- Addition
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (age_max_months >= age_min_months)
);
create index coaching_tips_module_age_idx on public.coaching_tips (module, age_min_months, age_max_months) where is_active;
```

Publishing rule (trigger `enforce_recommendation_publish`, 0012): a recommendation can only move to `review_status = 'verified'` when it has non-empty `practical_text_i18n.en`, at least one `recommendation_evidence` row with a `scientific_evidence_id`, and at least one row with a verified `islamic_source_id`. This encodes "every recommendation stores Islamic source + scientific evidence + practical recommendation".

## 10. 0007 AI

```sql
-- supabase/migrations/20261001000700_ai.sql

-- 10.1 ai_assessments
create table public.ai_assessments (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.households(id) on delete cascade,
  family_member_id   uuid,
  kind               text not null check (kind in ('intake','periodic','plan_rationale')),
  summary            text not null,
  energy_targets     jsonb not null default '{}'::jsonb,
                     -- adults: {"kcal_per_day":2100,"method":"mifflin_st_jeor","pal":1.55}
                     -- minors: {"method":"eer_iom_2005","display":false} (never shown, 00-foundations 10.3)
  macro_targets      jsonb not null default '{}'::jsonb,    -- {"protein_g":80,"carbs_pct":50,"fat_pct":30,"fiber_g":30}
  hydration_targets  jsonb not null default '{}'::jsonb,    -- Addition: {"daily_ml":2300,"basis":{...}}
  risk_flags         text[] not null default '{}',           -- 'red_flag.faltering_growth', 'red_flag.ed_signals', ...
  input_snapshot     jsonb not null default '{}'::jsonb,    -- Addition: de-identified intake used for the run
  model_route        text not null,                          -- 'plan.generate'
  model              text,                                   -- Addition: concrete model id actually used
  prompt_version     text not null,                          -- 'intake_assess@3'
  created_by_user_id uuid references public.users(id) on delete set null,  -- Addition
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, household_id),
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index ai_assessments_household_idx on public.ai_assessments (household_id, created_at desc);
create index ai_assessments_member_idx on public.ai_assessments (family_member_id, created_at desc) where family_member_id is not null;

-- 10.2 chat_sessions (private to the user who started them)
create table public.chat_sessions (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  user_id           uuid not null references public.users(id) on delete cascade,
  title             text not null default '' check (char_length(title) <= 120),
  context_snapshot  jsonb not null default '{}'::jsonb,
  last_message_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  unique (id, household_id)
);
create index chat_sessions_user_idx on public.chat_sessions (user_id, household_id, last_message_at desc nulls last) where deleted_at is null;

-- 10.3 chat_messages (written only by ai-chat with service role)
create table public.chat_messages (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null,
  household_id uuid not null references public.households(id) on delete cascade,
  role         public.chat_role not null,
  content      text not null default '',
  attachments  jsonb not null default '[]'::jsonb,
               -- [{"type":"image","path":"{household_id}/{session_id}/{uuid}.jpg","mime":"image/jpeg"},{"type":"audio",...}]
  tool_calls   jsonb not null default '[]'::jsonb,
  tokens_in    integer check (tokens_in >= 0),
  tokens_out   integer check (tokens_out >= 0),
  model        text,
  safety_flags text[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (jsonb_typeof(attachments) = 'array'),
  foreign key (session_id, household_id) references public.chat_sessions(id, household_id) on delete cascade
);
create index chat_messages_session_idx on public.chat_messages (session_id, created_at);
create index chat_messages_household_idx on public.chat_messages (household_id, created_at desc);
create index chat_messages_safety_idx on public.chat_messages using gin (safety_flags) where cardinality(safety_flags) > 0;

-- 10.4 ai_memories (premium long-term memory)
create table public.ai_memories (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.households(id) on delete cascade,
  family_member_id   uuid,
  fact               text not null check (char_length(fact) between 1 and 500),
  source_message_id  uuid references public.chat_messages(id) on delete set null,
  embedding          extensions.vector(1536) not null,
  confidence         numeric(3,2) not null default 0.80 check (confidence between 0 and 1),
  expires_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index ai_memories_household_idx on public.ai_memories (household_id, family_member_id) where deleted_at is null;
create index ai_memories_embedding_hnsw on public.ai_memories
  using hnsw (embedding extensions.vector_cosine_ops) with (m = 16, ef_construction = 64);

-- 10.5 ai_usage (metering; written by Edge Functions)
create table public.ai_usage (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  household_id     uuid references public.households(id) on delete set null,
  route_key        text not null,
  provider         text not null check (provider in ('anthropic','openai','google')),
  model            text not null,
  tokens_in        integer not null default 0 check (tokens_in >= 0),
  tokens_out       integer not null default 0 check (tokens_out >= 0),
  cost_usd_micros  bigint not null default 0 check (cost_usd_micros >= 0),
  latency_ms       integer check (latency_ms >= 0),
  status           text not null default 'ok' check (status in ('ok','error','fallback','blocked')), -- Addition
  request_id       text,                                                                      -- Addition: correlates with Sentry
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index ai_usage_user_day_idx on public.ai_usage (user_id, route_key, created_at desc);
create index ai_usage_created_idx on public.ai_usage using brin (created_at);

-- 10.6 ai_model_routes
create table public.ai_model_routes (
  id          uuid primary key default gen_random_uuid(),
  route_key   text not null,
  provider    text not null check (provider in ('anthropic','openai','google')),
  model       text not null,
  params      jsonb not null default '{}'::jsonb,   -- {"max_tokens":4096,"temperature":0.4,"timeout_ms":60000}
  priority    smallint not null default 1 check (priority >= 1),  -- 1 = primary, 2+ = fallbacks
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (route_key, priority)
);

-- 10.7 prompt_templates
create table public.prompt_templates (
  id          uuid primary key default gen_random_uuid(),
  key         text not null check (key ~ '^[a-z0-9_.]+$'),
  version     integer not null check (version >= 1),
  body        text not null,
  variables   jsonb not null default '[]'::jsonb,   -- ["household_summary","locale","tradition"]
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (key, version)
);
create unique index prompt_templates_one_active on public.prompt_templates (key) where is_active;
```

Daily chat quota (20 free / 200 premium, `00-foundations.md` section 8) is counted by `ai-chat` as `count(*) from ai_usage where user_id = $1 and route_key = 'chat.default' and status <> 'blocked' and created_at >= date_trunc('day', now() at time zone users.timezone) at time zone users.timezone`. The `ai_usage_user_day_idx` index serves this query.

## 11. 0008 Plans, grocery and budget

```sql
-- supabase/migrations/20261001000800_plans_grocery_budget.sql

-- 11.1 budget_profiles
create table public.budget_profiles (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references public.households(id) on delete cascade,
  monthly_amount_minor  bigint not null check (monthly_amount_minor > 0),
  currency              char(3) not null check (currency ~ '^[A-Z]{3}$'),
  strictness            text not null default 'target' check (strictness in ('flexible','target','hard_cap')),
  category_split        jsonb not null default '{}'::jsonb,
                        -- {"staples":0.18,"protein_animal":0.30,"dairy":0.15,"produce_veg":0.12,...}; values sum to 1 +/- 0.02 (validated in Edge Function)
  is_active             boolean not null default true,     -- Addition: one active profile per household
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  unique (id, household_id),
  check (jsonb_typeof(category_split) = 'object')
);
create unique index budget_profiles_one_active on public.budget_profiles (household_id) where is_active and deleted_at is null;

-- 11.2 meal_plans
create table public.meal_plans (
  id                          uuid primary key default gen_random_uuid(),
  household_id                uuid not null references public.households(id) on delete cascade,
  kind                        public.plan_kind not null default 'standard',
  status                      public.plan_status not null default 'draft',
  title                       text,                                        -- Addition
  start_date                  date not null,
  end_date                    date not null,
  week_count                  smallint not null default 1 check (week_count between 1 and 12),
  generated_by_assessment_id  uuid,
  budget_profile_id           uuid,
  rationale                   text,
  version                     integer not null default 1 check (version >= 1),
  parent_plan_id              uuid,
  failure_reason              text,                                        -- Addition: set when status = 'failed'
  generation_meta             jsonb not null default '{}'::jsonb,          -- Addition: {"route":"plan.generate","model":"...","prompt_version":"...","job_id":"..."}
  created_by_user_id          uuid references public.users(id) on delete set null,  -- Addition
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  deleted_at                  timestamptz,
  unique (id, household_id),
  check (end_date >= start_date),
  check (end_date - start_date + 1 <= week_count * 7),
  check (status <> 'failed' or failure_reason is not null),
  foreign key (generated_by_assessment_id, household_id) references public.ai_assessments(id, household_id) on delete set null (generated_by_assessment_id),
  foreign key (budget_profile_id, household_id) references public.budget_profiles(id, household_id) on delete set null (budget_profile_id),
  foreign key (parent_plan_id, household_id) references public.meal_plans(id, household_id) on delete set null (parent_plan_id)
);
create index meal_plans_household_status_idx on public.meal_plans (household_id, status, start_date desc) where deleted_at is null;
create index meal_plans_parent_idx on public.meal_plans (parent_plan_id) where parent_plan_id is not null;
-- linear version history: at most one non-failed child per parent, so concurrent adjustments cannot fork a plan
create unique index meal_plans_one_child on public.meal_plans (parent_plan_id)
  where parent_plan_id is not null and status <> 'failed' and deleted_at is null;

-- 11.3 daily_meals: a planned meal slot
create table public.daily_meals (
  id              uuid primary key default gen_random_uuid(),
  meal_plan_id    uuid not null,
  household_id    uuid not null references public.households(id) on delete cascade,
  plan_date       date not null,
  meal_type       public.meal_type not null,
  slot            smallint not null default 1 check (slot between 1 and 4),  -- Addition: allows two snacks a day
  meal_id         uuid not null references public.meals(id) on delete restrict,
  scheduled_time  time,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, household_id),
  unique (meal_plan_id, plan_date, meal_type, slot),
  foreign key (meal_plan_id, household_id) references public.meal_plans(id, household_id) on delete cascade
);
create index daily_meals_household_date_idx on public.daily_meals (household_id, plan_date, meal_type);
create index daily_meals_meal_idx on public.daily_meals (meal_id);

-- 11.4 daily_meal_servings: per-member portion and tracking
create table public.daily_meal_servings (
  id                uuid primary key default gen_random_uuid(),
  daily_meal_id     uuid not null,
  household_id      uuid not null references public.households(id) on delete cascade,
  family_member_id  uuid not null,
  portion_id        uuid references public.portions(id) on delete set null,
  adaptation        text not null default 'none' check (adaptation in ('none','autism','picky','allergy','pregnancy')),
  adapted_meal_id   uuid references public.meals(id) on delete restrict,
  status            public.meal_status not null default 'planned',
  acceptance        public.acceptance_score,
  logged_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (daily_meal_id, family_member_id),
  check (adaptation <> 'none' or adapted_meal_id is null),
  check (status = 'planned' or logged_at is not null),
  foreign key (daily_meal_id, household_id) references public.daily_meals(id, household_id) on delete cascade,
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index daily_meal_servings_member_idx on public.daily_meal_servings (household_id, family_member_id, status);
create index daily_meal_servings_meal_idx on public.daily_meal_servings (daily_meal_id);

-- 11.5 grocery_lists
create table public.grocery_lists (
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid not null references public.households(id) on delete cascade,
  meal_plan_id           uuid,
  period                 text not null default 'weekly' check (period in ('weekly','monthly','adhoc')),
  starts_on              date not null,
  ends_on                date not null,
  estimated_total_minor  bigint not null default 0 check (estimated_total_minor >= 0),
  currency               char(3) not null check (currency ~ '^[A-Z]{3}$'),
  status                 text not null default 'open' check (status in ('open','shopping','done')),
  price_profile_id       uuid references public.price_profiles(id) on delete set null,  -- Addition: price book used for estimates
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  unique (id, household_id),
  check (ends_on >= starts_on),
  foreign key (meal_plan_id, household_id) references public.meal_plans(id, household_id) on delete set null (meal_plan_id)
);
create index grocery_lists_household_idx on public.grocery_lists (household_id, starts_on desc) where deleted_at is null;

-- 11.6 shopping_items
create table public.shopping_items (
  id                        uuid primary key default gen_random_uuid(),
  grocery_list_id           uuid not null,
  household_id              uuid not null references public.households(id) on delete cascade,
  ingredient_id             uuid references public.ingredients(id) on delete restrict,
  label                     text not null check (char_length(label) between 1 and 160),
  quantity                  numeric(8,2) not null default 1 check (quantity > 0),
  unit                      text not null default 'piece',
  estimated_minor           bigint check (estimated_minor >= 0),
  actual_minor              bigint check (actual_minor >= 0),
  is_checked                boolean not null default false,
  substitution_for_item_id  uuid references public.shopping_items(id) on delete set null,
  aisle                     text,               -- budget_categories.code by default, user-editable
  is_fresh                  boolean not null default true,   -- true = buy weekly, false = monthly staple
  sort_order                smallint not null default 0,     -- Addition
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  check (substitution_for_item_id is distinct from id),
  foreign key (grocery_list_id, household_id) references public.grocery_lists(id, household_id) on delete cascade
);
create index shopping_items_list_idx on public.shopping_items (grocery_list_id, aisle, sort_order);
create index shopping_items_household_idx on public.shopping_items (household_id);

-- 11.7 budget_entries: actual spend
create table public.budget_entries (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.households(id) on delete cascade,
  budget_profile_id  uuid not null,
  amount_minor       bigint not null check (amount_minor > 0),
  currency           char(3) not null check (currency ~ '^[A-Z]{3}$'),   -- Addition: explicit, must equal profile currency
  category_id        uuid not null references public.budget_categories(id) on delete restrict,
  spent_on           date not null default current_date,
  grocery_list_id    uuid,
  note               text,                                               -- Addition
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (budget_profile_id, household_id) references public.budget_profiles(id, household_id) on delete cascade,
  foreign key (grocery_list_id, household_id) references public.grocery_lists(id, household_id) on delete set null (grocery_list_id)
);
create index budget_entries_household_month_idx on public.budget_entries (household_id, spent_on desc);
create index budget_entries_profile_idx on public.budget_entries (budget_profile_id, category_id, spent_on);

-- 11.8 plan_recommendations: recommendation instances shown in a plan or chat
create table public.plan_recommendations (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.households(id) on delete cascade,
  meal_plan_id       uuid,
  chat_message_id    uuid references public.chat_messages(id) on delete cascade,
  recommendation_id  uuid not null references public.recommendations(id) on delete restrict,
  family_member_id   uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (num_nonnulls(meal_plan_id, chat_message_id) >= 1),
  foreign key (meal_plan_id, household_id) references public.meal_plans(id, household_id) on delete cascade,
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index plan_recommendations_plan_idx on public.plan_recommendations (household_id, meal_plan_id);
create index plan_recommendations_msg_idx on public.plan_recommendations (chat_message_id) where chat_message_id is not null;
```

Notes:
- `on delete set null (column)` (Postgres 15+) nulls only the optional column of a composite foreign key and leaves `household_id` intact.
- Free tier "1 active weekly plan" is enforced by `enforce_plan_entitlement` (0012). Edge Functions additionally check before spending AI tokens.
- `meal_plans_one_child` keeps version history linear: `ai-adjust-plan` creates the child with `version = parent.version + 1`, and a second concurrent adjustment of the same parent fails with a unique violation that the function maps to `PLAN_ADJUST_CONFLICT`.

## 12. 0009 Tracking and family modules

High-volume log tables (`hydration_logs`, `fasting_logs`, `growth_tracking`, `weight_tracking`, `nutrition_journal`, `food_exposures`, `exposure_ladder_steps`) are hard-deletable by editors for quick undo; their deletes on sensitive tables are captured in `audit_log`. Entity tables (`meal_logs`, `hydration_targets`, `ramadan_plans`, `exposure_ladders`) are soft-deleted.

```sql
-- supabase/migrations/20261001000900_tracking_modules.sql

-- 12.1 meal_logs: free-form tracking outside a plan
create table public.meal_logs (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references public.households(id) on delete cascade,
  family_member_id     uuid not null,
  eaten_at             timestamptz not null default now(),
  meal_type            public.meal_type not null,
  description          text not null default '' check (char_length(description) <= 2000),
  photo_path           text,                  -- bucket "meal-photos": {household_id}/{family_member_id}/{yyyy}/{mm}/{id}.jpg
  estimated_nutrition  jsonb not null default '{}'::jsonb,
                       -- {"items":[{"label":"chicken karahi","grams":180,"confidence":0.7}],"kcal":640,"protein_g":38,...,"thuluth_feedback":"..."}
  fullness_before      smallint check (fullness_before between 0 and 10),   -- hunger-fullness scale, 0 = starving, 10 = stuffed
  fullness_after       smallint check (fullness_after between 0 and 10),
  source               text not null default 'manual' check (source in ('manual','photo_ai','plan')),
  daily_meal_serving_id uuid references public.daily_meal_servings(id) on delete set null,  -- Addition: when source = 'plan'
  logged_by_user_id    uuid references public.users(id) on delete set null,                  -- Addition
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  check (source <> 'photo_ai' or photo_path is not null),
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index meal_logs_member_time_idx on public.meal_logs (household_id, family_member_id, eaten_at desc) where deleted_at is null;

-- 12.2 hydration_targets
create table public.hydration_targets (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  family_member_id  uuid not null,
  daily_ml          integer not null check (daily_ml between 300 and 6000),
  schedule          jsonb not null default '[]'::jsonb,
                    -- [{"window":"pre_breakfast","start":"07:00","ml":250},{"window":"pre_lunch","start":"12:30","ml":250},...]
  basis             jsonb not null default '{}'::jsonb,
                    -- {"age_years":34,"weight_kg":68,"climate_zone":"hot_semi_arid","pregnancy":false,"breastfeeding":false,"fasting":false,"source":"efsa_2010"}
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  check (jsonb_typeof(schedule) = 'array'),
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create unique index hydration_targets_one_live on public.hydration_targets (family_member_id) where deleted_at is null;
create index hydration_targets_household_idx on public.hydration_targets (household_id) where deleted_at is null;

-- 12.3 hydration_logs
create table public.hydration_logs (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  family_member_id  uuid not null,
  logged_at         timestamptz not null default now(),
  volume_ml         integer not null check (volume_ml between 10 and 3000),
  beverage          text not null default 'water' check (beverage in ('water','milk','laban','juice','tea','other')),
  timing            text not null default 'other' check (timing in ('pre_meal','with_meal','post_meal','other')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index hydration_logs_member_time_idx on public.hydration_logs (household_id, family_member_id, logged_at desc);

-- 12.4 fasting_logs
create table public.fasting_logs (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  family_member_id  uuid not null,
  fast_date         date not null,
  kind              public.fast_kind not null,
  started_at        timestamptz,
  ended_at          timestamptz,
  completed         boolean not null default false,
  exemption_reason  text check (exemption_reason in ('illness','travel','menstruation','pregnancy','breastfeeding','age','medical_advice','other')),
  is_practice_fast  boolean not null default false,   -- Addition: child half-day practice fast (7 to puberty)
  notes             text check (char_length(notes) <= 2000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (ended_at is null or started_at is null or ended_at > started_at),
  check (not (completed and exemption_reason is not null)),
  unique (family_member_id, fast_date, kind),
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index fasting_logs_member_date_idx on public.fasting_logs (household_id, family_member_id, fast_date desc);
-- Safety trigger enforce_fasting_safety (0012): no 'intermittent' fasting for minors; under-7s may only be logged as exempt (reason 'age').

-- 12.5 ramadan_plans
create table public.ramadan_plans (
  id                        uuid primary key default gen_random_uuid(),
  household_id              uuid not null references public.households(id) on delete cascade,
  hijri_year                smallint not null check (hijri_year between 1440 and 1600),
  start_date                date not null,
  end_date                  date not null,
  meal_plan_id              uuid,
  suhoor_time_strategy      text not null default 'late' check (suhoor_time_strategy in ('late','early','split')),
  child_participation       jsonb not null default '{}'::jsonb,
                            -- {"<family_member_id>":{"mode":"practice_half_day","days":["sat","sun"]}}; under-7 => "none"
  pregnancy_adjustments     jsonb not null default '{}'::jsonb,
                            -- {"<family_member_id>":{"fasting":"deferred_to_clinician","snack_plan":true}}
  city_prayer_times_source  text not null default 'aladhan' check (city_prayer_times_source in ('aladhan','manual','umm_al_qura','isna','mwl','karachi','tehran','jafari')),
  prayer_times              jsonb not null default '[]'::jsonb,   -- Addition: cached [{"date":"2027-02-08","fajr":"05:31","maghrib":"17:55"}]
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  deleted_at                timestamptz,
  check (end_date >= start_date and end_date - start_date <= 30),
  foreign key (meal_plan_id, household_id) references public.meal_plans(id, household_id) on delete set null (meal_plan_id)
);
create unique index ramadan_plans_one_per_year on public.ramadan_plans (household_id, hijri_year) where deleted_at is null;

-- 12.6 growth_reference_lms (global reference data: WHO 2006, WHO 2007, CDC 2000)
create table public.growth_reference_lms (
  id          uuid primary key default gen_random_uuid(),
  reference   text not null check (reference in ('who_2006','who_2007','cdc_2000')),
  indicator   text not null check (indicator in ('wfa','lhfa','bmifa','hcfa')),  -- weight, length/height, BMI, head circumference for age
  sex         public.sex_at_birth not null check (sex in ('female','male')),
  age_months  numeric(6,2) not null check (age_months between 0 and 240),
  l           numeric(10,6) not null,
  m           numeric(10,4) not null check (m > 0),
  s           numeric(10,6) not null check (s > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (reference, indicator, sex, age_months)
);

-- 12.7 growth_tracking (children)
create table public.growth_tracking (
  id                          uuid primary key default gen_random_uuid(),
  household_id                uuid not null references public.households(id) on delete cascade,
  family_member_id            uuid not null,
  measured_on                 date not null,
  age_months                  numeric(6,2),                 -- Addition: computed by growth-compute
  height_cm                   numeric(5,1) check (height_cm between 30 and 230),
  weight_kg                   numeric(5,2) check (weight_kg between 0.5 and 250),
  bmi                         numeric(5,2) generated always as (public.compute_bmi(weight_kg, height_cm)) stored,
  head_circumference_cm       numeric(4,1) check (head_circumference_cm between 20 and 70),
  height_for_age_z            numeric(5,2) check (height_for_age_z between -10 and 10),
  weight_for_age_z            numeric(5,2) check (weight_for_age_z between -10 and 10),
  bmi_for_age_z               numeric(5,2) check (bmi_for_age_z between -10 and 10),
  head_circumference_for_age_z numeric(5,2) check (head_circumference_for_age_z between -10 and 10),  -- Addition
  height_for_age_percentile   numeric(5,2) check (height_for_age_percentile between 0 and 100),
  weight_for_age_percentile   numeric(5,2) check (weight_for_age_percentile between 0 and 100),
  bmi_for_age_percentile      numeric(5,2) check (bmi_for_age_percentile between 0 and 100),
  head_circumference_for_age_percentile numeric(5,2) check (head_circumference_for_age_percentile between 0 and 100), -- Addition
  reference                   text not null default 'who_2006' check (reference in ('who_2006','who_2007','cdc_2000')),
  flags                       text[] not null default '{}',  -- Addition: 'red_flag.wfa_below_p3', 'red_flag.crossed_two_major_lines'
  computed_at                 timestamptz,                   -- Addition: null until growth-compute has run
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  check (num_nonnulls(height_cm, weight_kg, head_circumference_cm) >= 1),
  unique (family_member_id, measured_on),
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index growth_tracking_member_idx on public.growth_tracking (household_id, family_member_id, measured_on desc);
create index growth_tracking_flags_idx on public.growth_tracking using gin (flags) where cardinality(flags) > 0;

-- 12.8 weight_tracking (adults)
create table public.weight_tracking (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  family_member_id  uuid not null,
  measured_on       date not null,
  weight_kg         numeric(5,2) not null check (weight_kg between 20 and 400),
  waist_cm          numeric(5,1) check (waist_cm between 30 and 250),
  bmi               numeric(5,2),          -- set by trigger from family_members.height_cm
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (family_member_id, measured_on),
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index weight_tracking_member_idx on public.weight_tracking (household_id, family_member_id, measured_on desc);

-- 12.9 nutrition_journal
create table public.nutrition_journal (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.households(id) on delete cascade,
  family_member_id   uuid not null,
  journal_date       date not null,
  mood               smallint check (mood between 1 and 5),
  energy             smallint check (energy between 1 and 5),
  digestion          smallint check (digestion between 1 and 5),
  thuluth_adherence  smallint check (thuluth_adherence between 0 and 3),  -- thirds respected today (adults); rhythm score for minors
  notes              text check (char_length(notes) <= 4000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (family_member_id, journal_date),
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index nutrition_journal_member_idx on public.nutrition_journal (household_id, family_member_id, journal_date desc);

-- 12.10 food_exposures (picky eater and autism exposure log)
create table public.food_exposures (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  family_member_id  uuid not null,
  ingredient_id     uuid not null references public.ingredients(id) on delete restrict,
  exposed_on        date not null default current_date,
  stage             public.exposure_stage not null,
  acceptance        public.acceptance_score not null,
  context           text check (context in ('family_meal','snack','cooking_together','grocery_trip','play','school','other')),
  ladder_step_id    uuid,                     -- Addition: FK added below once exposure_ladder_steps exists
  notes             text check (char_length(notes) <= 2000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index food_exposures_member_idx on public.food_exposures (household_id, family_member_id, exposed_on desc);
create index food_exposures_ingredient_idx on public.food_exposures (family_member_id, ingredient_id, exposed_on desc);

-- 12.11 exposure_ladders
create table public.exposure_ladders (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references public.households(id) on delete cascade,
  family_member_id      uuid not null,
  target_ingredient_id  uuid not null references public.ingredients(id) on delete restrict,
  strategy              text not null check (strategy in ('exposure_ladder','food_chaining')),
  status                text not null default 'active' check (status in ('active','paused','completed','abandoned')),
  current_step          smallint not null default 1 check (current_step >= 1),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  unique (id, household_id),
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index exposure_ladders_member_idx on public.exposure_ladders (household_id, family_member_id, status) where deleted_at is null;
create unique index exposure_ladders_one_active_target
  on public.exposure_ladders (family_member_id, target_ingredient_id) where status = 'active' and deleted_at is null;

-- 12.12 exposure_ladder_steps
create table public.exposure_ladder_steps (
  id                         uuid primary key default gen_random_uuid(),
  ladder_id                  uuid not null,
  household_id               uuid not null references public.households(id) on delete cascade,
  step_no                    smallint not null check (step_no >= 1),
  stage                      public.exposure_stage not null,
  food_label                 text not null,       -- 'orange lentil puffs', 'carrot coin, soft-cooked'
  bridge_from_ingredient_id  uuid references public.ingredients(id) on delete restrict,
  criteria                   text not null,       -- 'two calm sessions at this stage with acceptance >= 2_touched'
  completed_on               date,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (ladder_id, step_no),
  unique (id, household_id),
  foreign key (ladder_id, household_id) references public.exposure_ladders(id, household_id) on delete cascade
);
create index exposure_ladder_steps_household_idx on public.exposure_ladder_steps (household_id);

alter table public.food_exposures
  add constraint food_exposures_ladder_step_fkey
  foreign key (ladder_step_id, household_id) references public.exposure_ladder_steps(id, household_id)
  on delete set null (ladder_step_id);
```

## 13. 0010 Platform

```sql
-- supabase/migrations/20261001001000_platform.sql

-- 13.1 subscriptions (server truth from revenuecat-webhook; see 17-subscription-architecture.md)
create table public.subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  tier                public.subscription_tier not null default 'free',
  status              public.subscription_status not null,
  product_id          text not null,      -- 'thuluth_premium_monthly' | 'thuluth_premium_annual' | promo id
  store               text not null check (store in ('app_store','play_store','promotional')),
  rc_app_user_id      text not null,      -- equals users.id::text (RevenueCat appUserID)
  current_period_end  timestamptz,
  will_renew          boolean not null default false,
  raw_event           jsonb not null default '{}'::jsonb,   -- latest webhook payload (PII-scrubbed)
  last_event_id       text,               -- Addition: RevenueCat event.id for idempotency
  last_event_at       timestamptz,        -- Addition: event.event_timestamp_ms; older events are ignored
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (rc_app_user_id, product_id, store)
);
create index subscriptions_user_active_idx on public.subscriptions (user_id, tier, status, current_period_end desc);
create unique index subscriptions_last_event_key on public.subscriptions (last_event_id) where last_event_id is not null;

-- 13.2 notifications
create table public.notifications (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  household_id   uuid references public.households(id) on delete cascade,
  channel        public.notification_channel not null default 'push',
  kind           text not null,            -- same vocabulary as notification_preferences.kind
  title          text not null check (char_length(title) <= 120),
  body           text not null check (char_length(body) <= 500),
  data           jsonb not null default '{}'::jsonb,   -- {"deeplink":"thuluth://today","family_member_id":"..."}
  scheduled_for  timestamptz not null default now(),
  sent_at        timestamptz,
  read_at        timestamptz,
  onesignal_id   text,
  status         text not null default 'pending' check (status in ('pending','sent','failed','cancelled')),  -- Addition
  dedupe_key     text,                     -- Addition: e.g. 'hydration:<member>:2026-10-06T12:30'
  attempts       smallint not null default 0,  -- Addition
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index notifications_due_idx on public.notifications (scheduled_for) where status = 'pending';
create index notifications_user_inbox_idx on public.notifications (user_id, created_at desc) where channel = 'in_app';
create unique index notifications_dedupe_key on public.notifications (user_id, dedupe_key) where dedupe_key is not null;

-- 13.3 notification_preferences
create table public.notification_preferences (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  kind         text not null check (kind in (
                 'meal_reminder','hydration_reminder','suhoor_alarm','iftar_alert','fasting_reminder',
                 'growth_measurement_due','plan_ready','grocery_reminder','weekly_summary',
                 'coaching_tip','household_activity','subscription','marketing')),
  enabled      boolean not null default true,
  quiet_hours  jsonb not null default '{}'::jsonb,   -- {"start":"22:00","end":"06:30","tz":"Asia/Karachi"}
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, kind)
);

-- 13.4 devices
create table public.devices (
  id                         uuid primary key default gen_random_uuid(),
  user_id                    uuid not null references public.users(id) on delete cascade,
  platform                   text not null check (platform in ('ios','android','web')),
  onesignal_subscription_id  text unique,
  app_version                text not null,
  last_seen_at               timestamptz not null default now(),
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
create index devices_user_idx on public.devices (user_id, last_seen_at desc);

-- 13.5 consents (append-only history; withdrawal sets withdrawn_at)
create table public.consents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  household_id  uuid references public.households(id) on delete cascade,  -- Addition: scope for 'child_data'
  kind          text not null check (kind in ('terms','privacy','health_data','child_data','ai_processing','marketing')),
  version       text not null,           -- document version, e.g. '2026-09-01'
  granted_at    timestamptz not null default now(),
  withdrawn_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (withdrawn_at is null or withdrawn_at >= granted_at),
  check (kind <> 'child_data' or household_id is not null)
);
create index consents_user_kind_idx on public.consents (user_id, kind, granted_at desc);
create unique index consents_one_live on public.consents (user_id, kind, coalesce(household_id, '00000000-0000-0000-0000-000000000000'::uuid), version)
  where withdrawn_at is null;

-- 13.6 audit_log (append-only)
create table public.audit_log (
  id             uuid primary key default gen_random_uuid(),
  actor_user_id  uuid references public.users(id) on delete set null,
  household_id   uuid references public.households(id) on delete set null,
  action         text not null check (action in ('insert','update','delete','soft_delete','restore','role_change','export','login','erasure')),
  entity         text not null,           -- table name
  entity_id      uuid,
  diff           jsonb not null default '{}'::jsonb,
  ip_hash        text,
  at             timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index audit_log_household_at_idx on public.audit_log (household_id, at desc);
create index audit_log_actor_at_idx on public.audit_log (actor_user_id, at desc);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);
create index audit_log_at_brin on public.audit_log using brin (at);

-- 13.7 analytics_events (range-partitioned by month on occurred_at)
create table public.analytics_events (
  id           uuid not null default gen_random_uuid(),
  user_id      uuid,                      -- no FK: partitioned, erasure job nulls it (18 retention)
  household_id uuid,                      -- no FK, same reason
  event        text not null check (event ~ '^[a-z][a-z0-9_.]{2,63}$'),   -- 'plan.generated', 'hydration.logged'
  props        jsonb not null default '{}'::jsonb,
  occurred_at  timestamptz not null,
  app_version  text,
  platform     text check (platform in ('ios','android','web','server')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

create index analytics_events_event_time_idx on public.analytics_events (event, occurred_at);
create index analytics_events_user_time_idx on public.analytics_events (user_id, occurred_at);

create table public.analytics_events_default partition of public.analytics_events default;
-- Monthly partitions (analytics_events_yYYYYmMM) are created by private.ensure_analytics_partitions() in 0014.

-- 13.8 exports
create table public.exports (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  kind          text not null check (kind in ('meal_plan','grocery_list','nutrition_report','growth_report','ramadan_pack','family_summary')),
  status        text not null default 'queued' check (status in ('queued','rendering','ready','failed','expired')),
  params        jsonb not null default '{}'::jsonb,   -- Addition: {"meal_plan_id":"...","locale":"ur","paper":"A4"}
  storage_path  text,                                 -- bucket "exports": {household_id}/{id}.pdf
  error         text,                                 -- Addition
  expires_at    timestamptz not null default now() + interval '7 days',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (status <> 'ready' or storage_path is not null)
);
create index exports_household_idx on public.exports (household_id, created_at desc);
create index exports_expiry_idx on public.exports (expires_at) where status = 'ready';

-- 13.9 feature_flags
create table public.feature_flags (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique check (key ~ '^[a-z0-9_.]+$'),
  enabled     boolean not null default false,
  rules       jsonb not null default '{}'::jsonb,
              -- {"countries":["PK"],"min_app_version":"1.2.0","percent":25,"tiers":["premium"],"user_ids":[]}
  description text,                                   -- Addition
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
```

`account-export` uses `entity`-keyed queries over every table above. Note that `account-delete` must also delete from `analytics_events` by `user_id` (no FK cascade), which `18-exports-and-analytics.md` and the function spec in `06-api-specification.md` cover.

## 14. 0011 Access helper functions

All helpers are `security definer` so they read `household_members` without triggering its own RLS (avoiding recursion), `stable` so Postgres can cache them within a statement, and `set search_path = ''`.

```sql
-- supabase/migrations/20261001001100_access_helpers.sql

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- 14.1 membership
create or replace function public.is_household_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = auth.uid()
      and hm.deleted_at is null
  );
$$;

create or replace function public.household_role_of(p_household_id uuid)
returns public.household_role
language sql
stable
security definer
set search_path = ''
as $$
  select hm.role
  from public.household_members hm
  where hm.household_id = p_household_id
    and hm.user_id = auth.uid()
    and hm.deleted_at is null
  limit 1;
$$;

-- owner or caregiver: may write family data
create or replace function public.can_edit_household(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.household_role_of(p_household_id) in ('owner','caregiver'), false);
$$;

-- Addition: owner, caregiver or coach may author plans and recommendations (coach is Phase 2)
create or replace function public.can_author_plans(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.household_role_of(p_household_id) in ('owner','caregiver','coach'), false);
$$;

-- Addition: the caller is the linked app user of this family member (self-logging teen or adult)
create or replace function public.is_linked_member(p_family_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.family_members fm
    where fm.id = p_family_member_id
      and fm.linked_user_id = auth.uid()
      and fm.deleted_at is null
      and public.is_household_member(fm.household_id)
  );
$$;

-- Addition: used by users RLS so co-members can see each other's display name
create or replace function public.shares_household_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members me
    join public.household_members them on them.household_id = me.household_id
    where me.user_id = auth.uid() and me.deleted_at is null
      and them.user_id = p_user_id and them.deleted_at is null
  );
$$;

-- Addition: set-returning variant for policies that benefit from an initPlan
create or replace function public.my_household_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select hm.household_id from public.household_members hm
  where hm.user_id = auth.uid() and hm.deleted_at is null;
$$;

-- 14.2 entitlements
-- Premium = a premium subscription row that is active, in grace, or cancelled-but-not-yet-expired.
create or replace function public.has_premium(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user_id
      and s.tier = 'premium'
      and (
        s.status in ('active','in_grace')
        or (s.status = 'cancelled' and s.current_period_end > now())
      )
      and (s.current_period_end is null or s.current_period_end > now() - interval '3 days')  -- clock-skew / webhook-lag tolerance
  );
$$;

-- Addition: premium follows the household owner, so caregivers in a premium household get premium features there
create or replace function public.household_has_premium(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select public.has_premium(h.owner_user_id) from public.households h where h.id = p_household_id
  ), false);
$$;

-- 14.3 soft delete RPC (Addition).
-- Why: an UPDATE that sets deleted_at makes the row fail the SELECT policy (deleted_at is null),
-- and PostgREST's filtered UPDATE needs the new row to stay visible, so a plain PATCH fails with 42501.
-- Clients call supabase.rpc('soft_delete', { p_table: 'allergies', p_id }) instead.
create or replace function public.soft_delete(p_table text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
  v_allowed constant text[] := array[
    'family_members','medical_conditions','allergies','medications','supplements','food_preferences',
    'food_dislikes','nutrition_goals','pregnancy_profiles','sensory_profiles','meal_plans','meal_logs',
    'budget_profiles','grocery_lists','hydration_targets','ramadan_plans','exposure_ladders',
    'chat_sessions','ai_memories','recipes','meals','household_members'];
begin
  if not (p_table = any (v_allowed)) then
    raise exception 'SOFT_DELETE_NOT_ALLOWED' using errcode = '42501', detail = p_table;
  end if;

  execute format('select household_id from public.%I where id = $1 and deleted_at is null', p_table)
    into v_household using p_id;
  if v_household is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_table = 'chat_sessions' then
    if not exists (select 1 from public.chat_sessions where id = p_id and user_id = auth.uid()) then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
  elsif p_table = 'household_members' then
    -- owner may remove others; anyone may leave; the owner row cannot be removed this way
    if exists (select 1 from public.household_members where id = p_id and role = 'owner') then
      raise exception 'OWNER_CANNOT_LEAVE' using errcode = '42501';
    end if;
    if not (public.household_role_of(v_household) = 'owner'
            or exists (select 1 from public.household_members where id = p_id and user_id = auth.uid())) then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
  elsif p_table = 'meal_plans' then
    if not public.can_author_plans(v_household) then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
  elsif not public.can_edit_household(v_household) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  execute format('update public.%I set deleted_at = now() where id = $1', p_table) using p_id;
end;
$$;

revoke execute on function public.soft_delete(text, uuid) from public, anon;
grant execute on function public.soft_delete(text, uuid) to authenticated;
-- Helper functions are callable by authenticated (RLS needs them); none leak data beyond a boolean or the caller's own role.
revoke execute on function public.has_premium(uuid) from public, anon;
grant execute on function public.has_premium(uuid) to authenticated, service_role;
```

Policy authoring rule: inside policies, always pass a column (`is_household_member(household_id)`), never a subquery. For list endpoints over very large tables (for example `hydration_logs` history), the API layer filters by `household_id = :id` explicitly so the planner uses the composite index first and the helper is evaluated on few rows.

`has_premium(other_user)` lets an authenticated user learn whether another user is premium. That is acceptable (it is a boolean, and the client already sees household premium state through `household_has_premium`), but Edge Functions call it with the service role and the caller's verified `sub` only.

## 15. 0012 Triggers

Trigger inventory:

| Trigger function | Table(s) | Timing | Purpose |
|---|---|---|---|
| `set_updated_at` | every table with `updated_at` | before update | Maintain `updated_at` |
| `private.validate_timezone` | `users`, `households` | before insert/update of `timezone` | Reject unknown IANA names |
| `private.family_members_derive` | `family_members` | before insert/update | Derive `life_stage`, reject future DOB, module sanity |
| `private.family_size_sync` | `family_members` | after insert/delete/update of `deleted_at` | Maintain `households.family_size` |
| `private.household_bootstrap` | `households` | after insert | Create the owner `household_members` row |
| `private.enforce_household_entitlement` | `households` | before insert / restore | Free: 1 owned household |
| `private.enforce_member_entitlement` | `family_members` | before insert / restore | Free: 6, Premium: 20 members |
| `private.enforce_plan_entitlement` | `meal_plans` | before insert/update of `status`, `week_count` | Free: 1 active weekly plan |
| `private.protect_owner_membership` | `household_members` | before update/delete | Owner row immutable except via `transfer_household_ownership` |
| `private.audit_row_change` | sensitive tables (list below) | after insert/update/delete | Append to `audit_log` |
| `private.audit_log_immutable` | `audit_log` | before update/delete | Append-only |
| `private.handle_new_auth_user` | `auth.users` | after insert | Create `users` profile + default notification preferences |
| `private.sync_auth_email` | `auth.users` | after update of `email` | Keep `users.email` in sync |
| `private.weight_tracking_bmi` | `weight_tracking` | before insert/update | Set `bmi` from member height |
| `private.sync_latest_measurement` | `growth_tracking`, `weight_tracking` | after insert/update | Copy latest height/weight onto `family_members` |
| `private.growth_reset_computed` | `growth_tracking` | before update | Clear z-scores when raw values change |
| `private.enforce_child_goal_safety` | `nutrition_goals` | before insert/update | No weight-loss or kcal goals for minors |
| `private.enforce_fasting_safety` | `fasting_logs` | before insert/update | No intermittent fasting for minors; no fasts under 7 |
| `private.chat_touch_session` | `chat_messages` | after insert | Maintain `chat_sessions.last_message_at` |
| `private.recipe_nutrition_sync` | `recipe_ingredients`, `recipes` | after change | Recompute `per_serving_nutrition` |
| `private.validate_islamic_source` | `islamic_sources` | before insert/update | Polymorphic ref check, tradition consistency, status managed |
| `private.sync_source_verification` | `source_verifications` | after insert/update/delete | Denormalise latest status to `islamic_sources` |
| `private.reset_verification_on_edit` | `quran_references`, `hadith_references`, `imam_narrations` | after update of text or grade | Send edited source back to `in_review` |
| `private.enforce_recommendation_publish` | `recommendations` | before insert/update of `review_status` | Publishing gate |
| `private.price_report_moderation` | `price_observations` | before insert | User reports start `pending` |
| `private.budget_entry_currency` | `budget_entries` | before insert/update | Currency equals profile currency |

All entitlement and safety errors use `errcode` and a stable `message` string. Edge Functions and the client map them to the error envelope (`06-api-specification.md`): `ENTITLEMENT_HOUSEHOLD_LIMIT`, `ENTITLEMENT_MEMBER_LIMIT`, `ENTITLEMENT_PLAN_LIMIT`, `CHILD_WEIGHT_LOSS_GOAL_NOT_ALLOWED`, `CHILD_CALORIE_TARGET_NOT_ALLOWED`, `CHILD_INTERMITTENT_FASTING_NOT_ALLOWED`, `UNDER_7_FASTING_NOT_ALLOWED`, `OWNER_ROW_PROTECTED`, `DOB_IN_FUTURE`, `INVALID_TIMEZONE`, `AUDIT_LOG_IMMUTABLE`.

```sql
-- supabase/migrations/20261001001200_triggers.sql

-- 15.1 updated_at on every table that has the column (partition children inherit from the parent trigger)
do $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'updated_at' and not a.attisdropped
    where n.nspname = 'public' and c.relkind in ('r','p') and not c.relispartition
  loop
    execute format(
      'create trigger trg_%s_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      r.relname, r.relname);
  end loop;
end $$;

-- 15.2 time zone validation
create or replace function private.validate_timezone()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'INVALID_TIMEZONE' using errcode = '22023', detail = new.timezone;
  end if;
  return new;
end $$;
create trigger trg_users_timezone before insert or update of timezone on public.users
  for each row execute function private.validate_timezone();
create trigger trg_households_timezone before insert or update of timezone on public.households
  for each row execute function private.validate_timezone();

-- 15.3 family_members derived fields
create or replace function private.family_members_derive()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.date_of_birth is not null and new.date_of_birth > current_date then
    raise exception 'DOB_IN_FUTURE' using errcode = '22007';
  end if;
  new.life_stage := public.life_stage_for_dob(new.date_of_birth);
  if new.special_modules && array['pregnancy','breastfeeding']::public.special_module[]
     and (new.sex_at_birth = 'male' or new.life_stage in ('infant','toddler','child')) then
    raise exception 'MODULE_NOT_APPLICABLE' using errcode = '23514', detail = 'pregnancy/breastfeeding';
  end if;
  return new;
end $$;
create trigger trg_family_members_derive
  before insert or update of date_of_birth, sex_at_birth, special_modules on public.family_members
  for each row execute function private.family_members_derive();

-- nightly refresh for birthdays (scheduled in 0014)
create or replace function private.refresh_life_stages()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  update public.family_members fm
     set life_stage = public.life_stage_for_dob(fm.date_of_birth)
   where fm.deleted_at is null
     and fm.date_of_birth is not null
     and fm.life_stage is distinct from public.life_stage_for_dob(fm.date_of_birth);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- 15.4 households.family_size
create or replace function private.family_size_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_household uuid := coalesce(new.household_id, old.household_id);
begin
  update public.households h
     set family_size = (select count(*) from public.family_members fm
                        where fm.household_id = v_household and fm.deleted_at is null)
   where h.id = v_household;
  return null;
end $$;
create trigger trg_family_members_family_size
  after insert or delete or update of deleted_at on public.family_members
  for each row execute function private.family_size_sync();

-- 15.5 owner membership bootstrap
create or replace function private.household_bootstrap()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.household_members (household_id, user_id, role)
  values (new.id, new.owner_user_id, 'owner');
  return null;
end $$;
create trigger trg_households_bootstrap after insert on public.households
  for each row execute function private.household_bootstrap();

-- 15.6 entitlements (00-foundations section 8)
create or replace function private.enforce_household_entitlement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if coalesce(current_setting('app.bypass_entitlements', true), '') = 'on' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('households:' || new.owner_user_id::text, 0));
  select count(*) into v_count
    from public.households h
   where h.owner_user_id = new.owner_user_id and h.deleted_at is null and h.id <> new.id;
  if v_count >= 1 and not public.has_premium(new.owner_user_id) then
    raise exception 'ENTITLEMENT_HOUSEHOLD_LIMIT' using errcode = 'P0001',
      detail = json_build_object('tier','free','limit',1,'current',v_count)::text,
      hint = 'upgrade_required';
  end if;
  return new;
end $$;
create trigger trg_households_entitlement before insert on public.households
  for each row execute function private.enforce_household_entitlement();
create trigger trg_households_entitlement_restore before update of deleted_at on public.households
  for each row when (old.deleted_at is not null and new.deleted_at is null)
  execute function private.enforce_household_entitlement();

create or replace function private.enforce_member_entitlement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_count integer; v_limit integer;
begin
  if coalesce(current_setting('app.bypass_entitlements', true), '') = 'on' then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('family_members:' || new.household_id::text, 0));
  v_limit := case when public.household_has_premium(new.household_id) then 20 else 6 end;
  select count(*) into v_count
    from public.family_members fm
   where fm.household_id = new.household_id and fm.deleted_at is null and fm.id <> new.id;
  if v_count >= v_limit then
    raise exception 'ENTITLEMENT_MEMBER_LIMIT' using errcode = 'P0001',
      detail = json_build_object('limit',v_limit,'current',v_count)::text,
      hint = case when v_limit = 6 then 'upgrade_required' else 'hard_limit' end;
  end if;
  return new;
end $$;
create trigger trg_family_members_entitlement before insert on public.family_members
  for each row execute function private.enforce_member_entitlement();
create trigger trg_family_members_entitlement_restore before update of deleted_at on public.family_members
  for each row when (old.deleted_at is not null and new.deleted_at is null)
  execute function private.enforce_member_entitlement();

create or replace function private.enforce_plan_entitlement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if coalesce(current_setting('app.bypass_entitlements', true), '') = 'on'
     or public.household_has_premium(new.household_id) then
    return new;
  end if;
  if new.status in ('generating','active') then
    if new.week_count > 1 or new.kind not in ('standard','custom') then
      raise exception 'ENTITLEMENT_PLAN_LIMIT' using errcode = 'P0001',
        detail = json_build_object('reason','multi_week_or_kind','kind',new.kind,'week_count',new.week_count)::text,
        hint = 'upgrade_required';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('meal_plans:' || new.household_id::text, 0));
    select count(*) into v_count from public.meal_plans mp
     where mp.household_id = new.household_id and mp.deleted_at is null
       and mp.status in ('generating','active') and mp.id <> new.id
       and mp.id is distinct from new.parent_plan_id;   -- an adjustment replaces its parent
    if v_count >= 1 then
      raise exception 'ENTITLEMENT_PLAN_LIMIT' using errcode = 'P0001',
        detail = json_build_object('reason','one_active_plan','current',v_count)::text,
        hint = 'upgrade_required';
    end if;
  end if;
  return new;
end $$;
create trigger trg_meal_plans_entitlement
  before insert or update of status, week_count, kind on public.meal_plans
  for each row execute function private.enforce_plan_entitlement();

-- 15.7 owner row protection and ownership transfer
create or replace function private.protect_owner_membership()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('app.allow_owner_change', true), '') = 'on' then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    -- allow cascades from a deleted household or user (erasure)
    if old.role = 'owner' and exists (select 1 from public.households h where h.id = old.household_id) then
      raise exception 'OWNER_ROW_PROTECTED' using errcode = '42501';
    end if;
    return old;
  end if;
  if new.household_id <> old.household_id or new.user_id <> old.user_id then
    raise exception 'MEMBERSHIP_IMMUTABLE' using errcode = '42501';
  end if;
  if (old.role = 'owner' or new.role = 'owner') and old.role is distinct from new.role then
    raise exception 'OWNER_ROW_PROTECTED' using errcode = '42501';
  end if;
  if old.role = 'owner' and new.deleted_at is not null then
    raise exception 'OWNER_ROW_PROTECTED' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_household_members_protect_owner before update or delete on public.household_members
  for each row execute function private.protect_owner_membership();

-- Addition beyond 00-foundations: ownership transfer RPC
create or replace function public.transfer_household_ownership(p_household_id uuid, p_new_owner uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old_owner uuid;
begin
  select owner_user_id into v_old_owner from public.households where id = p_household_id and deleted_at is null for update;
  if v_old_owner is null or v_old_owner <> auth.uid() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (select 1 from public.household_members where household_id = p_household_id
                 and user_id = p_new_owner and deleted_at is null and role in ('caregiver','viewer')) then
    raise exception 'NEW_OWNER_NOT_MEMBER' using errcode = '23514';
  end if;
  if exists (select 1 from public.households where owner_user_id = p_new_owner and deleted_at is null)
     and not public.has_premium(p_new_owner) then
    raise exception 'ENTITLEMENT_HOUSEHOLD_LIMIT' using errcode = 'P0001', hint = 'new_owner_upgrade_required';
  end if;
  perform set_config('app.allow_owner_change', 'on', true);
  update public.household_members set role = 'caregiver'
   where household_id = p_household_id and user_id = v_old_owner and deleted_at is null;
  update public.household_members set role = 'owner'
   where household_id = p_household_id and user_id = p_new_owner and deleted_at is null;
  update public.households set owner_user_id = p_new_owner where id = p_household_id;
  perform set_config('app.allow_owner_change', 'off', true);
end $$;
revoke execute on function public.transfer_household_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_household_ownership(uuid, uuid) to authenticated;

-- 15.8 audit
create or replace function private.request_ip_hash()
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_ip text; v_salt text;
begin
  v_ip := split_part(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1);
  if v_ip = '' then
    return null;
  end if;
  select decrypted_secret into v_salt from vault.decrypted_secrets where name = 'audit_ip_salt';
  return encode(extensions.digest(trim(v_ip) || coalesce(v_salt, ''), 'sha256'), 'hex');
end $$;

-- tg_argv[0] = 'full' (store old/new values) or 'keys_only' (store changed column names only; used for health data)
create or replace function private.audit_row_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_mode   text := coalesce(tg_argv[0], 'full');
  v_redact constant text[] := array['token_hash','raw_event','embedding','updated_at'];
  v_old    jsonb;
  v_new    jsonb;
  v_row    jsonb;
  v_diff   jsonb := '{}'::jsonb;
  v_action text := lower(tg_op);
  v_household uuid;
  k        text;
begin
  if tg_op in ('UPDATE','DELETE') then v_old := to_jsonb(old) - v_redact; end if;
  if tg_op in ('INSERT','UPDATE') then v_new := to_jsonb(new) - v_redact; end if;
  v_row := coalesce(v_new, v_old);

  if tg_op = 'UPDATE' then
    if v_old ->> 'deleted_at' is null and v_new ->> 'deleted_at' is not null then
      v_action := 'soft_delete';
    elsif v_old ->> 'deleted_at' is not null and v_new ->> 'deleted_at' is null then
      v_action := 'restore';
    elsif tg_table_name = 'household_members' and (v_old ->> 'role') is distinct from (v_new ->> 'role') then
      v_action := 'role_change';
    end if;
    for k in select jsonb_object_keys(v_new) loop
      if (v_new -> k) is distinct from (v_old -> k) then
        v_diff := v_diff || jsonb_build_object(k,
          case when v_mode = 'keys_only' then to_jsonb('changed'::text)
               else jsonb_build_object('old', v_old -> k, 'new', v_new -> k) end);
      end if;
    end loop;
    if v_diff = '{}'::jsonb then
      return null;   -- no-op update
    end if;
  elsif tg_op = 'INSERT' then
    v_diff := case when v_mode = 'keys_only'
                   then jsonb_build_object('keys', (select jsonb_agg(x) from jsonb_object_keys(v_new) x))
                   else jsonb_build_object('new', v_new) end;
  else
    v_diff := case when v_mode = 'keys_only' then '{}'::jsonb else jsonb_build_object('old', v_old) end;
  end if;

  v_household := case when tg_table_name = 'households' then (v_row ->> 'id')::uuid
                      else (v_row ->> 'household_id')::uuid end;
  -- during erasure cascades the household is already gone; keep the entry but drop the FK value
  if v_household is not null and not exists (select 1 from public.households h where h.id = v_household) then
    v_household := null;
  end if;

  insert into public.audit_log (actor_user_id, household_id, action, entity, entity_id, diff, ip_hash)
  values (
    -- the actor may be the user being erased in this very transaction
    (select u.id from public.users u where u.id = auth.uid()),
    v_household,
    v_action,
    tg_table_name,
    (v_row ->> 'id')::uuid,
    v_diff,
    private.request_ip_hash()
  );
  return null;
end $$;

do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('households','full'), ('household_members','full'), ('household_invitations','full'),
      ('family_members','keys_only'), ('medical_conditions','keys_only'), ('allergies','keys_only'),
      ('medications','keys_only'), ('supplements','keys_only'), ('pregnancy_profiles','keys_only'),
      ('nutrition_goals','keys_only'), ('growth_tracking','keys_only'), ('weight_tracking','keys_only'),
      ('ai_memories','keys_only'), ('subscriptions','full'), ('consents','full'), ('exports','full'),
      ('source_verifications','full'), ('recommendations','full'), ('ai_model_routes','full'),
      ('prompt_templates','full'), ('feature_flags','full')
    ) as v(tbl, mode)
  loop
    execute format(
      'create trigger trg_%s_audit after insert or update or delete on public.%I for each row execute function private.audit_row_change(%L)',
      t.tbl, t.tbl, t.mode);
  end loop;
end $$;

create or replace function private.audit_log_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('app.retention_job', true), '') = 'on' then
    return old;
  end if;
  -- allow the FK "on delete set null" actions fired by erasure (users / households deleted);
  -- nothing else about the row may change
  if tg_op = 'UPDATE'
     and (to_jsonb(new) - array['actor_user_id','household_id','updated_at'])
         = (to_jsonb(old) - array['actor_user_id','household_id','updated_at'])
     and (new.actor_user_id is null or new.actor_user_id = old.actor_user_id)
     and (new.household_id is null or new.household_id = old.household_id) then
    return new;
  end if;
  raise exception 'AUDIT_LOG_IMMUTABLE' using errcode = '42501';
end $$;
create trigger trg_audit_log_immutable before update or delete on public.audit_log
  for each row execute function private.audit_log_immutable();

-- 15.9 auth.users -> public.users
create or replace function private.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_tz   text  := nullif(v_meta ->> 'timezone', '');
begin
  if v_tz is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = v_tz) then
    v_tz := 'Asia/Karachi';
  end if;
  insert into public.users (id, email, display_name, locale, timezone, country_code)
  values (
    new.id,
    new.email,
    left(coalesce(nullif(v_meta ->> 'display_name',''), nullif(v_meta ->> 'full_name',''), nullif(v_meta ->> 'name',''), ''), 80),
    case when v_meta ->> 'locale' in ('en','ur','ar') then v_meta ->> 'locale' else 'en' end,
    v_tz,
    case when (v_meta ->> 'country_code') ~ '^[A-Z]{2}$' then v_meta ->> 'country_code' end
  )
  on conflict (id) do nothing;

  insert into public.notification_preferences (user_id, kind, enabled)
  select new.id, k, k <> 'marketing'
  from unnest(array['meal_reminder','hydration_reminder','suhoor_alarm','iftar_alert','fasting_reminder',
                    'growth_measurement_due','plan_ready','grocery_reminder','weekly_summary',
                    'coaching_tip','household_activity','subscription','marketing']) as k
  on conflict (user_id, kind) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_auth_user();

create or replace function private.sync_auth_email()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.users set email = new.email where id = new.id;
  return new;
end $$;
create trigger on_auth_user_email_updated after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function private.sync_auth_email();

-- 15.10 measurements
create or replace function private.weight_tracking_bmi()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select public.compute_bmi(new.weight_kg, fm.height_cm) into new.bmi
    from public.family_members fm where fm.id = new.family_member_id;
  return new;
end $$;
create trigger trg_weight_tracking_bmi before insert or update of weight_kg on public.weight_tracking
  for each row execute function private.weight_tracking_bmi();

create or replace function private.sync_latest_measurement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'growth_tracking' then
    if not exists (select 1 from public.growth_tracking g
                   where g.family_member_id = new.family_member_id and g.measured_on > new.measured_on) then
      update public.family_members
         set height_cm = coalesce(new.height_cm, height_cm),
             weight_kg = coalesce(new.weight_kg, weight_kg)
       where id = new.family_member_id;
    end if;
  else
    if not exists (select 1 from public.weight_tracking w
                   where w.family_member_id = new.family_member_id and w.measured_on > new.measured_on) then
      update public.family_members set weight_kg = new.weight_kg where id = new.family_member_id;
    end if;
  end if;
  return null;
end $$;
create trigger trg_growth_tracking_sync after insert or update of height_cm, weight_kg on public.growth_tracking
  for each row execute function private.sync_latest_measurement();
create trigger trg_weight_tracking_sync after insert or update of weight_kg on public.weight_tracking
  for each row execute function private.sync_latest_measurement();

create or replace function private.growth_reset_computed()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.height_cm, new.weight_kg, new.head_circumference_cm, new.measured_on)
       is distinct from (old.height_cm, old.weight_kg, old.head_circumference_cm, old.measured_on)
     and new.computed_at is not distinct from old.computed_at then
    new.age_months := null;
    new.height_for_age_z := null; new.weight_for_age_z := null;
    new.bmi_for_age_z := null; new.head_circumference_for_age_z := null;
    new.height_for_age_percentile := null; new.weight_for_age_percentile := null;
    new.bmi_for_age_percentile := null; new.head_circumference_for_age_percentile := null;
    new.flags := '{}'; new.computed_at := null;
  end if;
  return new;
end $$;
create trigger trg_growth_tracking_reset before update on public.growth_tracking
  for each row execute function private.growth_reset_computed();

-- 15.11 child safety (00-foundations sections 2.5 and 10.3)
create or replace function private.enforce_child_goal_safety()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_dob date; v_stage public.life_stage;
begin
  select date_of_birth, life_stage into v_dob, v_stage
    from public.family_members where id = new.family_member_id;
  if v_stage in ('infant','toddler','child','teen') or public.is_minor(v_dob) then
    if new.goal_type = 'weight_loss' then
      raise exception 'CHILD_WEIGHT_LOSS_GOAL_NOT_ALLOWED' using errcode = '23514';
    end if;
    if new.target_unit in ('kcal_per_day','kg_per_week') then
      raise exception 'CHILD_CALORIE_TARGET_NOT_ALLOWED' using errcode = '23514';
    end if;
  end if;
  if new.goal_type in ('pregnancy_support','breastfeeding_support') and v_stage in ('infant','toddler','child') then
    raise exception 'MODULE_NOT_APPLICABLE' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger trg_nutrition_goals_child_safety before insert or update on public.nutrition_goals
  for each row execute function private.enforce_child_goal_safety();

create or replace function private.enforce_fasting_safety()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_dob date;
begin
  select date_of_birth into v_dob from public.family_members where id = new.family_member_id;
  if public.is_minor(v_dob, new.fast_date) and new.kind = 'intermittent' then
    raise exception 'CHILD_INTERMITTENT_FASTING_NOT_ALLOWED' using errcode = '23514';
  end if;
  if v_dob is not null and age(new.fast_date, v_dob) < interval '7 years'
     and (new.completed or new.started_at is not null or new.is_practice_fast) then
    raise exception 'UNDER_7_FASTING_NOT_ALLOWED' using errcode = '23514';
  end if;
  if new.is_practice_fast and not public.is_minor(v_dob, new.fast_date) then
    new.is_practice_fast := false;
  end if;
  return new;
end $$;
create trigger trg_fasting_logs_safety before insert or update on public.fasting_logs
  for each row execute function private.enforce_fasting_safety();

-- 15.12 chat
create or replace function private.chat_touch_session()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.chat_sessions set last_message_at = new.created_at
   where id = new.session_id and (last_message_at is null or last_message_at < new.created_at);
  return null;
end $$;
create trigger trg_chat_messages_touch after insert on public.chat_messages
  for each row execute function private.chat_touch_session();

-- 15.13 recipe nutrition
create or replace function public.recompute_recipe_nutrition(p_recipe_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.recipes r
     set per_serving_nutrition = coalesce((
       select jsonb_strip_nulls(jsonb_build_object(
         'kcal',          round(sum(i.kcal          * ri.grams / 100) / r.servings, 1),
         'protein_g',     round(sum(i.protein_g     * ri.grams / 100) / r.servings, 1),
         'carbs_g',       round(sum(i.carbs_g       * ri.grams / 100) / r.servings, 1),
         'fiber_g',       round(sum(i.fiber_g       * ri.grams / 100) / r.servings, 1),
         'sugar_g',       round(sum(i.sugar_g       * ri.grams / 100) / r.servings, 1),
         'fat_g',         round(sum(i.fat_g         * ri.grams / 100) / r.servings, 1),
         'sat_fat_g',     round(sum(i.sat_fat_g     * ri.grams / 100) / r.servings, 1),
         'sodium_mg',     round(sum(i.sodium_mg     * ri.grams / 100) / r.servings, 0),
         'iron_mg',       round(sum(i.iron_mg       * ri.grams / 100) / r.servings, 2),
         'calcium_mg',    round(sum(i.calcium_mg    * ri.grams / 100) / r.servings, 0),
         'zinc_mg',       round(sum(i.zinc_mg       * ri.grams / 100) / r.servings, 2),
         'vitamin_a_mcg', round(sum(i.vitamin_a_mcg * ri.grams / 100) / r.servings, 0),
         'vitamin_c_mg',  round(sum(i.vitamin_c_mg  * ri.grams / 100) / r.servings, 1),
         'vitamin_d_mcg', round(sum(i.vitamin_d_mcg * ri.grams / 100) / r.servings, 2),
         'b12_mcg',       round(sum(i.b12_mcg       * ri.grams / 100) / r.servings, 2),
         'folate_mcg',    round(sum(i.folate_mcg    * ri.grams / 100) / r.servings, 0),
         'potassium_mg',  round(sum(i.potassium_mg  * ri.grams / 100) / r.servings, 0),
         'omega3_g',      round(sum(i.omega3_g      * ri.grams / 100) / r.servings, 3),
         'grams',         round(sum(ri.grams) / r.servings, 0)
       ))
       from public.recipe_ingredients ri
       join public.ingredients i on i.id = ri.ingredient_id
       where ri.recipe_id = r.id and not ri.optional
     ), '{}'::jsonb)
   where r.id = p_recipe_id;
$$;
revoke execute on function public.recompute_recipe_nutrition(uuid) from public, anon, authenticated;

create or replace function private.recipe_nutrition_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'recipes' then
    perform public.recompute_recipe_nutrition(new.id);
  else
    if tg_op in ('INSERT','UPDATE') then perform public.recompute_recipe_nutrition(new.recipe_id); end if;
    if tg_op in ('UPDATE','DELETE') and (tg_op = 'DELETE' or old.recipe_id <> new.recipe_id) then
      perform public.recompute_recipe_nutrition(old.recipe_id);
    end if;
  end if;
  return null;
end $$;
create trigger trg_recipe_ingredients_nutrition after insert or update or delete on public.recipe_ingredients
  for each row execute function private.recipe_nutrition_sync();
create trigger trg_recipes_servings_nutrition after update of servings on public.recipes
  for each row execute function private.recipe_nutrition_sync();

-- 15.14 Islamic sources integrity
create or replace function private.validate_islamic_source()
returns trigger language plpgsql set search_path = '' as $$
declare v_trad public.source_tradition;
begin
  if new.kind = 'quran' then
    if not exists (select 1 from public.quran_references where id = new.ref_id) then
      raise exception 'ISLAMIC_SOURCE_REF_INVALID' using errcode = '23503';
    end if;
    new.tradition := 'shared';
  elsif new.kind = 'hadith' then
    select tradition into v_trad from public.hadith_references where id = new.ref_id;
    if v_trad is null then raise exception 'ISLAMIC_SOURCE_REF_INVALID' using errcode = '23503'; end if;
    new.tradition := v_trad;
  elsif new.kind = 'imam_narration' then
    if not exists (select 1 from public.imam_narrations where id = new.ref_id) then
      raise exception 'ISLAMIC_SOURCE_REF_INVALID' using errcode = '23503';
    end if;
    new.tradition := 'shia';
  end if;

  if coalesce(current_setting('app.verification_sync', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      new.verification_status := 'unverified';
    elsif new.verification_status is distinct from old.verification_status then
      raise exception 'VERIFICATION_STATUS_MANAGED' using errcode = '42501',
        hint = 'insert a source_verifications row instead';
    end if;
  end if;
  return new;
end $$;
create trigger trg_islamic_sources_validate before insert or update on public.islamic_sources
  for each row execute function private.validate_islamic_source();

create or replace function private.sync_source_verification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_source uuid := coalesce(new.islamic_source_id, old.islamic_source_id);
begin
  perform set_config('app.verification_sync', 'on', true);
  update public.islamic_sources s
     set verification_status = coalesce((
           select v.status from public.source_verifications v
            where v.islamic_source_id = s.id
            order by v.reviewed_on desc, v.created_at desc limit 1), 'unverified')
   where s.id = v_source;
  perform set_config('app.verification_sync', 'off', true);
  return null;
end $$;
create trigger trg_source_verifications_sync after insert or update or delete on public.source_verifications
  for each row execute function private.sync_source_verification();

create or replace function private.reset_verification_on_edit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_kind public.source_kind := case tg_table_name
  when 'quran_references' then 'quran' when 'hadith_references' then 'hadith' else 'imam_narration' end;
begin
  perform set_config('app.verification_sync', 'on', true);
  update public.islamic_sources set verification_status = 'in_review'
   where kind = v_kind and ref_id = new.id and verification_status = 'verified';
  perform set_config('app.verification_sync', 'off', true);
  return null;
end $$;
create trigger trg_quran_references_reverify after update of arabic_text, translation_i18n on public.quran_references
  for each row execute function private.reset_verification_on_edit();
create trigger trg_hadith_references_reverify after update of arabic_text, translation_i18n, grade, number, collection on public.hadith_references
  for each row execute function private.reset_verification_on_edit();
create trigger trg_imam_narrations_reverify after update of arabic_text, translation_i18n, grade, collection, volume, page, number on public.imam_narrations
  for each row execute function private.reset_verification_on_edit();

-- 15.15 recommendation publishing gate
create or replace function private.enforce_recommendation_publish()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(new.practical_text_i18n ->> 'en', '') = '' then
    raise exception 'RECOMMENDATION_MISSING_PRACTICAL_TEXT' using errcode = '23514';
  end if;
  if not exists (select 1 from public.recommendation_evidence re
                 where re.recommendation_id = new.id and re.scientific_evidence_id is not null) then
    raise exception 'RECOMMENDATION_MISSING_SCIENTIFIC_EVIDENCE' using errcode = '23514';
  end if;
  if not exists (select 1 from public.recommendation_evidence re
                 join public.islamic_sources s on s.id = re.islamic_source_id
                 where re.recommendation_id = new.id and s.verification_status = 'verified') then
    raise exception 'RECOMMENDATION_MISSING_VERIFIED_ISLAMIC_SOURCE' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger trg_recommendations_publish before insert or update of review_status on public.recommendations
  for each row when (new.review_status = 'verified')
  execute function private.enforce_recommendation_publish();

-- 15.16 price report moderation and budget currency
create or replace function private.price_report_moderation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.source = 'user_report' and not public.is_admin() then
    new.moderation_status := 'pending';
    new.reporter_user_id := auth.uid();
    new.observed_on := least(new.observed_on, current_date);
  end if;
  return new;
end $$;
create trigger trg_price_observations_moderation before insert on public.price_observations
  for each row execute function private.price_report_moderation();

create or replace function private.budget_entry_currency()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.currency <> (select currency from public.budget_profiles where id = new.budget_profile_id) then
    raise exception 'CURRENCY_MISMATCH' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger trg_budget_entries_currency before insert or update of currency, budget_profile_id on public.budget_entries
  for each row execute function private.budget_entry_currency();
```

> `transfer_household_ownership`, `recompute_recipe_nutrition` and `refresh_life_stages` are **Additions beyond 00-foundations**.

## 16. 0013 Row Level Security

### 16.1 Role model

| Role | Read household data | Write family profile, tracking, grocery, budget | Author plans and plan recommendations | Manage members and invitations | Update household settings | Chat |
|---|---|---|---|---|---|---|
| `owner` | Yes | Yes | Yes | Yes | Yes | Own sessions |
| `caregiver` | Yes | Yes | Yes | No | No | Own sessions |
| `viewer` | Yes | No (except self-logging when linked to a `family_members` row) | No | No | No | Own sessions |
| `coach` (Phase 2) | Yes | No | Yes | No | No | Own sessions |
| `service_role` (Edge Functions) | Bypasses RLS | Bypasses RLS | Bypasses RLS | Bypasses RLS | Bypasses RLS | Writes all chat messages |
| platform admin (`is_admin()`) | No household access | No | No | No | No | No; writes global catalog only |

Chat sessions are private to the user who created them, even from the household owner. Viewers and coaches can chat because chatting does not modify household data; any plan change requested in chat goes through `ai-adjust-plan`, which re-checks `can_author_plans`.

### 16.2 Policy matrix

Pattern legend: **HE** = household edit (select: member; insert/update/delete: `can_edit_household`); **HE+self** = HE plus a linked member may write their own rows; **HP** = household plan (select: member; writes: `can_author_plans`); **HS** = household read, service writes only; **CAT** = global catalog (select: authenticated; writes: `is_admin()`); **SVC** = no client access; **custom** = see SQL.

Soft-deletable tables have no `delete` policy for clients; they use `rpc('soft_delete')`.

| Table | Pattern | Notes |
|---|---|---|
| `users` | custom | self + co-members read; self update via column grants |
| `households` | custom | owner updates; insert as owner |
| `household_members` | custom | owner manages; leave via `soft_delete` |
| `household_invitations` | custom | owner only |
| `family_members` | HE | |
| `medical_conditions`, `allergies`, `medications`, `supplements`, `food_preferences`, `food_dislikes`, `nutrition_goals`, `pregnancy_profiles`, `sensory_profiles` | HE | |
| `ai_assessments` | HS | written by `ai-intake-assess`, `ai-generate-plan` |
| `chat_sessions` | custom | own sessions only |
| `chat_messages` | custom | read own sessions; service writes |
| `ai_memories` | custom | owner/caregiver read, update, forget; service inserts |
| `ai_usage` | custom | read own; service writes |
| `ai_model_routes`, `prompt_templates` | admin only | |
| `allergens`, `budget_categories`, `regions`, `ingredients`, `ingredient_allergens`, `meal_alternatives`, `seasonal_produce`, `price_profiles`, `growth_reference_lms`, `scientific_evidence`, `coaching_tips`, `feature_flags` | CAT | `coaching_tips` filters `is_active`; `feature_flags` read-only |
| `recipes`, `recipe_ingredients`, `meals`, `portions` | custom | global verified rows + household-private rows |
| `price_observations` | custom | read accepted; authenticated may report |
| `quran_references`, `hadith_references`, `imam_narrations`, `islamic_sources`, `foods_in_narrations` | custom | verified only |
| `source_verifications` | custom | read rows of verified sources; admin writes |
| `recommendations`, `recommendation_evidence` | custom | verified only; admin writes |
| `meal_plans`, `daily_meals`, `plan_recommendations` | HP | |
| `daily_meal_servings`, `grocery_lists`, `shopping_items`, `budget_profiles`, `budget_entries`, `hydration_targets`, `ramadan_plans`, `exposure_ladders`, `exposure_ladder_steps`, `growth_tracking` | HE | |
| `meal_logs`, `hydration_logs`, `fasting_logs`, `weight_tracking`, `nutrition_journal`, `food_exposures` | HE+self | |
| `subscriptions` | custom | read own |
| `notifications` | custom | read own; mark read |
| `notification_preferences`, `devices` | custom | own rows |
| `consents` | custom | own; insert and withdraw only |
| `audit_log` | custom | household owner and actor read |
| `analytics_events` | custom | insert own; no read |
| `exports` | custom | requester and household editors read; service writes |

### 16.3 Policies

```sql
-- supabase/migrations/20261001001300_rls.sql

-- 16.3.0 Baseline privileges: anon gets nothing in public; authenticated gets DML gated by RLS.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- Policy generators (kept in schema private, not exposed through PostgREST).
create or replace procedure private.apply_household_rls(p_table regclass, p_write text)
language plpgsql set search_path = '' as $$
declare
  v_soft  boolean;
  v_check text;
  v_name  text := (select relname from pg_class where oid = p_table);
begin
  select exists (select 1 from pg_attribute where attrelid = p_table and attname = 'deleted_at' and not attisdropped)
    into v_soft;
  v_check := case p_write
    when 'edit'      then 'public.can_edit_household(household_id)'
    when 'edit_self' then '(public.can_edit_household(household_id) or public.is_linked_member(family_member_id))'
    when 'plan'      then 'public.can_author_plans(household_id)'
    when 'service'   then null
    else null end;

  execute format('alter table %s enable row level security', p_table);
  execute format(
    'create policy %I on %s for select to authenticated using (%s public.is_household_member(household_id))',
    v_name || '_select_member', p_table, case when v_soft then 'deleted_at is null and' else '' end);

  if v_check is not null then
    execute format('create policy %I on %s for insert to authenticated with check (%s)',
                   v_name || '_insert_' || p_write, p_table, v_check);
    execute format('create policy %I on %s for update to authenticated using (%s) with check (%s)',
                   v_name || '_update_' || p_write, p_table, v_check, v_check);
    if not v_soft then
      execute format('create policy %I on %s for delete to authenticated using (%s)',
                     v_name || '_delete_' || p_write, p_table, v_check);
    end if;
  end if;
end $$;

create or replace procedure private.apply_catalog_rls(p_table regclass, p_select_using text default 'true')
language plpgsql set search_path = '' as $$
declare v_name text := (select relname from pg_class where oid = p_table);
begin
  execute format('alter table %s enable row level security', p_table);
  execute format('create policy %I on %s for select to authenticated using (%s or public.is_admin())',
                 v_name || '_select_all', p_table, p_select_using);
  execute format('create policy %I on %s for insert to authenticated with check (public.is_admin())',
                 v_name || '_insert_admin', p_table);
  execute format('create policy %I on %s for update to authenticated using (public.is_admin()) with check (public.is_admin())',
                 v_name || '_update_admin', p_table);
  execute format('create policy %I on %s for delete to authenticated using (public.is_admin())',
                 v_name || '_delete_admin', p_table);
end $$;

-- 16.3.1 Identity and tenancy -------------------------------------------------------------

alter table public.users enable row level security;
create policy users_select_self_or_comember on public.users for select to authenticated
  using (deleted_at is null and (id = auth.uid() or public.shares_household_with(id)));
create policy users_update_self on public.users for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- no insert (trigger on auth.users) and no delete (account-delete Edge Function)
revoke insert, update, delete on public.users from authenticated;
grant update (display_name, avatar_path, locale, country_code, timezone, tradition_preference, units, onboarding_completed_at)
  on public.users to authenticated;

alter table public.households enable row level security;
create policy households_select_member on public.households for select to authenticated
  using (deleted_at is null and (owner_user_id = auth.uid() or public.is_household_member(id)));
  -- owner_user_id branch lets INSERT ... RETURNING see the row before the bootstrap trigger's membership row is visible
create policy households_insert_owner on public.households for insert to authenticated
  with check (owner_user_id = auth.uid());
create policy households_update_owner on public.households for update to authenticated
  using (public.household_role_of(id) = 'owner') with check (public.household_role_of(id) = 'owner');
revoke update on public.households from authenticated;
grant update (name, country_code, region, region_id, city, timezone, currency) on public.households to authenticated;
-- households are soft-deleted only through account-delete or an owner "delete household" Edge Function path

alter table public.household_members enable row level security;
create policy household_members_select on public.household_members for select to authenticated
  using (deleted_at is null and public.is_household_member(household_id));
create policy household_members_insert_owner on public.household_members for insert to authenticated
  with check (public.household_role_of(household_id) = 'owner' and role <> 'owner');
create policy household_members_update_owner on public.household_members for update to authenticated
  using (public.household_role_of(household_id) = 'owner')
  with check (public.household_role_of(household_id) = 'owner' and role <> 'owner');
revoke update on public.household_members from authenticated;
grant update (role) on public.household_members to authenticated;

alter table public.household_invitations enable row level security;
create policy household_invitations_select_owner on public.household_invitations for select to authenticated
  using (public.household_role_of(household_id) = 'owner');
create policy household_invitations_insert_owner on public.household_invitations for insert to authenticated
  with check (public.household_role_of(household_id) = 'owner' and invited_by = auth.uid());
create policy household_invitations_update_owner on public.household_invitations for update to authenticated
  using (public.household_role_of(household_id) = 'owner')
  with check (public.household_role_of(household_id) = 'owner');
revoke update on public.household_invitations from authenticated;
grant update (revoked_at) on public.household_invitations to authenticated;   -- owner may revoke; acceptance is service-only
-- In practice household-invite (service role) creates invitations so it can send the email; the insert policy
-- exists so an owner-side retry from the admin console also works.

call private.apply_household_rls('public.family_members', 'edit');

-- 16.3.2 Health profile -------------------------------------------------------------------
call private.apply_household_rls('public.medical_conditions', 'edit');
call private.apply_household_rls('public.allergies', 'edit');
call private.apply_household_rls('public.medications', 'edit');
call private.apply_household_rls('public.supplements', 'edit');
call private.apply_household_rls('public.food_preferences', 'edit');
call private.apply_household_rls('public.food_dislikes', 'edit');
call private.apply_household_rls('public.nutrition_goals', 'edit');
call private.apply_household_rls('public.pregnancy_profiles', 'edit');
call private.apply_household_rls('public.sensory_profiles', 'edit');

-- 16.3.3 Food catalog ---------------------------------------------------------------------
call private.apply_catalog_rls('public.allergens');
call private.apply_catalog_rls('public.budget_categories');
call private.apply_catalog_rls('public.regions');
call private.apply_catalog_rls('public.ingredients', 'is_active');
call private.apply_catalog_rls('public.ingredient_allergens');
call private.apply_catalog_rls('public.meal_alternatives');
call private.apply_catalog_rls('public.seasonal_produce');
call private.apply_catalog_rls('public.price_profiles');

-- recipes: verified global rows, plus rows private to the caller's households
alter table public.recipes enable row level security;
create policy recipes_select on public.recipes for select to authenticated
  using (
    deleted_at is null and (
      (household_id is null and review_status = 'verified')
      or (household_id is not null and public.is_household_member(household_id))
      or public.is_admin()
    ));
create policy recipes_insert on public.recipes for insert to authenticated
  with check (
    (household_id is not null and source = 'user' and created_by_user_id = auth.uid()
       and review_status = 'unverified' and public.can_edit_household(household_id))
    or public.is_admin());
create policy recipes_update on public.recipes for update to authenticated
  using ((household_id is not null and public.can_edit_household(household_id)) or public.is_admin())
  with check ((household_id is not null and source = 'user' and public.can_edit_household(household_id)) or public.is_admin());
create policy recipes_delete_admin on public.recipes for delete to authenticated using (public.is_admin());

alter table public.recipe_ingredients enable row level security;
-- the subquery runs under the caller's RLS on recipes, so visibility follows the parent recipe
create policy recipe_ingredients_select on public.recipe_ingredients for select to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id));
create policy recipe_ingredients_write on public.recipe_ingredients for all to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id
                 and ((r.household_id is not null and r.source = 'user' and public.can_edit_household(r.household_id)) or public.is_admin())))
  with check (exists (select 1 from public.recipes r where r.id = recipe_id
                 and ((r.household_id is not null and r.source = 'user' and public.can_edit_household(r.household_id)) or public.is_admin())));

alter table public.meals enable row level security;
create policy meals_select on public.meals for select to authenticated
  using (deleted_at is null and (household_id is null or public.is_household_member(household_id) or public.is_admin()));
create policy meals_insert on public.meals for insert to authenticated
  with check ((household_id is not null and source = 'user' and public.can_author_plans(household_id)) or public.is_admin());
create policy meals_update on public.meals for update to authenticated
  using ((household_id is not null and public.can_author_plans(household_id)) or public.is_admin())
  with check ((household_id is not null and public.can_author_plans(household_id)) or public.is_admin());
create policy meals_delete_admin on public.meals for delete to authenticated using (public.is_admin());

alter table public.portions enable row level security;
create policy portions_select on public.portions for select to authenticated
  using (household_id is null or public.is_household_member(household_id) or public.is_admin());
create policy portions_write on public.portions for all to authenticated
  using ((household_id is not null and public.can_author_plans(household_id)) or public.is_admin())
  with check ((household_id is not null and public.can_author_plans(household_id)) or public.is_admin());

alter table public.price_observations enable row level security;
create policy price_observations_select on public.price_observations for select to authenticated
  using (moderation_status = 'accepted' or reporter_user_id = auth.uid() or public.is_admin());
create policy price_observations_insert on public.price_observations for insert to authenticated
  with check ((source = 'user_report' and reporter_user_id = auth.uid()) or public.is_admin());
create policy price_observations_update_admin on public.price_observations for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy price_observations_delete_admin on public.price_observations for delete to authenticated
  using (public.is_admin());

-- 16.3.4 Islamic knowledge and evidence: users see verified content only (00-foundations 10.5)
alter table public.islamic_sources enable row level security;
create policy islamic_sources_select_verified on public.islamic_sources for select to authenticated
  using (verification_status = 'verified' or public.is_admin());
create policy islamic_sources_write_admin on public.islamic_sources for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.quran_references enable row level security;
create policy quran_references_select_verified on public.quran_references for select to authenticated
  using (public.is_admin() or exists (select 1 from public.islamic_sources s
         where s.kind = 'quran' and s.ref_id = quran_references.id and s.verification_status = 'verified'));
create policy quran_references_write_admin on public.quran_references for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.hadith_references enable row level security;
create policy hadith_references_select_verified on public.hadith_references for select to authenticated
  using (public.is_admin() or exists (select 1 from public.islamic_sources s
         where s.kind = 'hadith' and s.ref_id = hadith_references.id and s.verification_status = 'verified'));
create policy hadith_references_write_admin on public.hadith_references for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.imam_narrations enable row level security;
create policy imam_narrations_select_verified on public.imam_narrations for select to authenticated
  using (public.is_admin() or exists (select 1 from public.islamic_sources s
         where s.kind = 'imam_narration' and s.ref_id = imam_narrations.id and s.verification_status = 'verified'));
create policy imam_narrations_write_admin on public.imam_narrations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.source_verifications enable row level security;
create policy source_verifications_select on public.source_verifications for select to authenticated
  using (public.is_admin() or (status = 'verified' and exists (select 1 from public.islamic_sources s
         where s.id = islamic_source_id)));
create policy source_verifications_write_admin on public.source_verifications for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.foods_in_narrations enable row level security;
create policy foods_in_narrations_select on public.foods_in_narrations for select to authenticated
  using (exists (select 1 from public.islamic_sources s where s.id = islamic_source_id));  -- inherits verified filter
create policy foods_in_narrations_write_admin on public.foods_in_narrations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

call private.apply_catalog_rls('public.scientific_evidence');
call private.apply_catalog_rls('public.coaching_tips', 'is_active');

alter table public.recommendations enable row level security;
create policy recommendations_select_verified on public.recommendations for select to authenticated
  using (review_status = 'verified' or public.is_admin());
create policy recommendations_write_admin on public.recommendations for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.recommendation_evidence enable row level security;
create policy recommendation_evidence_select on public.recommendation_evidence for select to authenticated
  using (public.is_admin() or (
    exists (select 1 from public.recommendations r where r.id = recommendation_id)
    and (islamic_source_id is null or exists (select 1 from public.islamic_sources s where s.id = islamic_source_id))));
create policy recommendation_evidence_write_admin on public.recommendation_evidence for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 16.3.5 AI ------------------------------------------------------------------------------
call private.apply_household_rls('public.ai_assessments', 'service');

alter table public.chat_sessions enable row level security;
create policy chat_sessions_select_own on public.chat_sessions for select to authenticated
  using (deleted_at is null and user_id = auth.uid() and public.is_household_member(household_id));
create policy chat_sessions_insert_own on public.chat_sessions for insert to authenticated
  with check (user_id = auth.uid() and public.is_household_member(household_id));
create policy chat_sessions_update_own on public.chat_sessions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_household_member(household_id));
revoke update on public.chat_sessions from authenticated;
grant update (title) on public.chat_sessions to authenticated;

alter table public.chat_messages enable row level security;
create policy chat_messages_select_own_session on public.chat_messages for select to authenticated
  using (exists (select 1 from public.chat_sessions s where s.id = session_id and s.user_id = auth.uid()));
-- no client insert/update/delete: ai-chat (service role) persists both user and assistant turns

alter table public.ai_memories enable row level security;
create policy ai_memories_select_editors on public.ai_memories for select to authenticated
  using (deleted_at is null and public.can_edit_household(household_id));
create policy ai_memories_update_editors on public.ai_memories for update to authenticated
  using (public.can_edit_household(household_id)) with check (public.can_edit_household(household_id));
revoke update on public.ai_memories from authenticated;
grant update (fact, expires_at) on public.ai_memories to authenticated;  -- edits re-embedded by ai-chat on next read; forget via soft_delete

alter table public.ai_usage enable row level security;
create policy ai_usage_select_own on public.ai_usage for select to authenticated
  using (user_id = auth.uid());

alter table public.ai_model_routes enable row level security;
create policy ai_model_routes_admin on public.ai_model_routes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.prompt_templates enable row level security;
create policy prompt_templates_admin on public.prompt_templates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 16.3.6 Plans, grocery, budget -----------------------------------------------------------
call private.apply_household_rls('public.meal_plans', 'plan');
call private.apply_household_rls('public.daily_meals', 'plan');
call private.apply_household_rls('public.plan_recommendations', 'plan');
call private.apply_household_rls('public.daily_meal_servings', 'edit');
call private.apply_household_rls('public.budget_profiles', 'edit');
call private.apply_household_rls('public.grocery_lists', 'edit');
call private.apply_household_rls('public.shopping_items', 'edit');
call private.apply_household_rls('public.budget_entries', 'edit');

-- 16.3.7 Tracking and modules -------------------------------------------------------------
call private.apply_household_rls('public.meal_logs', 'edit_self');
call private.apply_household_rls('public.hydration_logs', 'edit_self');
call private.apply_household_rls('public.fasting_logs', 'edit_self');
call private.apply_household_rls('public.weight_tracking', 'edit_self');
call private.apply_household_rls('public.nutrition_journal', 'edit_self');
call private.apply_household_rls('public.food_exposures', 'edit');
call private.apply_household_rls('public.hydration_targets', 'edit');
call private.apply_household_rls('public.ramadan_plans', 'edit');
call private.apply_household_rls('public.growth_tracking', 'edit');
call private.apply_household_rls('public.exposure_ladders', 'edit');
call private.apply_household_rls('public.exposure_ladder_steps', 'edit');
call private.apply_catalog_rls('public.growth_reference_lms');

-- 16.3.8 Platform ------------------------------------------------------------------------
alter table public.subscriptions enable row level security;
create policy subscriptions_select_own on public.subscriptions for select to authenticated
  using (user_id = auth.uid());

alter table public.notifications enable row level security;
create policy notifications_select_own on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

alter table public.notification_preferences enable row level security;
create policy notification_preferences_own on public.notification_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.devices enable row level security;
create policy devices_own on public.devices for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table public.consents enable row level security;
create policy consents_select_own on public.consents for select to authenticated
  using (user_id = auth.uid());
create policy consents_insert_own on public.consents for insert to authenticated
  with check (user_id = auth.uid() and withdrawn_at is null
              and (household_id is null or public.can_edit_household(household_id)));
create policy consents_withdraw_own on public.consents for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update, delete on public.consents from authenticated;
grant update (withdrawn_at) on public.consents to authenticated;

alter table public.audit_log enable row level security;
create policy audit_log_select on public.audit_log for select to authenticated
  using (actor_user_id = auth.uid()
         or (household_id is not null and public.household_role_of(household_id) = 'owner'));
revoke insert, update, delete on public.audit_log from authenticated;

alter table public.analytics_events enable row level security;
create policy analytics_events_insert_own on public.analytics_events for insert to authenticated
  with check (user_id = auth.uid()
              and (household_id is null or public.is_household_member(household_id))
              and occurred_at between now() - interval '7 days' and now() + interval '5 minutes');
revoke select, update, delete on public.analytics_events from authenticated;

alter table public.exports enable row level security;
create policy exports_select on public.exports for select to authenticated
  using (user_id = auth.uid() or public.can_edit_household(household_id));

call private.apply_catalog_rls('public.feature_flags');
```

Notes:
- RLS is enabled but deliberately not `force`d. Tables are owned by `postgres`, and the `security definer` helpers and trigger functions (also owned by `postgres`) must read `household_members` and write `audit_log` without re-entering RLS; forcing RLS on the owner would make `is_household_member` recurse into its own policy. `service_role` has `bypassrls`, so Edge Functions are unaffected either way.
- Every table above has `enable row level security`. The pgTAP test `supabase/tests/rls/000_all_tables_have_rls.test.sql` (see section 21) fails the build if any `public` table lacks RLS or has zero policies.
- Storage object policies (buckets keyed by `household_id`) are in `10-supabase-structure.md`.

## 17. 0014 Analytics partitions, materialized views and cron

```sql
-- supabase/migrations/20261001001400_analytics_cron.sql

-- 17.1 analytics_events monthly partitions -----------------------------------------------
create or replace function private.ensure_analytics_partitions(p_months_ahead integer default 3)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_start date; v_end date; v_name text; v_created integer := 0;
begin
  for i in 0..p_months_ahead loop
    v_start := (date_trunc('month', now() at time zone 'UTC') + make_interval(months => i))::date;
    v_end   := (v_start + interval '1 month')::date;
    v_name  := format('analytics_events_y%sm%s', to_char(v_start, 'YYYY'), to_char(v_start, 'MM'));
    if to_regclass('public.' || v_name) is null then
      execute format(
        'create table public.%I partition of public.analytics_events for values from (%L) to (%L)',
        v_name, v_start::timestamptz, v_end::timestamptz);
      -- partitions are reachable directly by name; lock them down (parent RLS does not apply to direct access)
      execute format('alter table public.%I enable row level security', v_name);
      execute format('revoke all on table public.%I from anon, authenticated', v_name);
      v_created := v_created + 1;
    end if;
  end loop;
  return v_created;
end $$;

create or replace function private.drop_old_analytics_partitions(p_keep_months integer default 25)
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; v_month date; v_dropped integer := 0;
begin
  for r in
    select c.relname
    from pg_inherits i join pg_class c on c.oid = i.inhrelid
    where i.inhparent = 'public.analytics_events'::regclass
      and c.relname ~ '^analytics_events_y\d{4}m\d{2}$'
  loop
    v_month := to_date(regexp_replace(r.relname, '^analytics_events_y(\d{4})m(\d{2})$', '\1\2'), 'YYYYMM');
    if v_month < (date_trunc('month', now()) - make_interval(months => p_keep_months))::date then
      execute format('drop table public.%I', r.relname);
      v_dropped := v_dropped + 1;
    end if;
  end loop;
  return v_dropped;
end $$;

alter table public.analytics_events_default enable row level security;
revoke all on table public.analytics_events_default from anon, authenticated;
select private.ensure_analytics_partitions(3);

-- 17.2 materialized views ---------------------------------------------------------------
-- Effective ingredient prices: median of accepted observations within 90 days of the latest one,
-- so seed prices never disappear just because nobody reported recently.
create materialized view public.mv_ingredient_prices as
with ranked as (
  select po.*,
         max(po.observed_on) over (partition by po.price_profile_id, po.ingredient_id, po.unit) as latest_on
  from public.price_observations po
  where po.moderation_status = 'accepted'
)
select price_profile_id,
       ingredient_id,
       unit,
       percentile_cont(0.5) within group (order by amount_minor)::bigint as median_minor,
       count(*)                                                        as n_observations,
       max(observed_on)                                                as last_observed_on,
       bool_or(source in ('user_report','partner_feed'))               as has_live_data
from ranked
where observed_on >= latest_on - 90
group by price_profile_id, ingredient_id, unit
with no data;
create unique index mv_ingredient_prices_key on public.mv_ingredient_prices (price_profile_id, ingredient_id, unit);
grant select on public.mv_ingredient_prices to authenticated;   -- public price information, no PII

create materialized view public.mv_daily_active_users as
select date_trunc('day', occurred_at)::date as day,
       coalesce(platform, 'unknown')       as platform,
       count(distinct user_id)             as dau,
       count(*)                            as events
from public.analytics_events
where occurred_at >= now() - interval '400 days'
group by 1, 2
with no data;
create unique index mv_daily_active_users_key on public.mv_daily_active_users (day, platform);

create materialized view public.mv_feature_usage_daily as
select date_trunc('day', occurred_at)::date as day,
       event,
       count(distinct user_id)             as users,
       count(distinct household_id)        as households,
       count(*)                            as events
from public.analytics_events
where occurred_at >= now() - interval '400 days'
group by 1, 2
with no data;
create unique index mv_feature_usage_daily_key on public.mv_feature_usage_daily (day, event);

revoke all on public.mv_daily_active_users, public.mv_feature_usage_daily from anon, authenticated;

-- RPCs for the cron Edge Functions (service role only)
create or replace function public.refresh_ingredient_prices()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.mv_ingredient_prices limit 1) then
    refresh materialized view public.mv_ingredient_prices;            -- first population cannot be concurrent
  else
    refresh materialized view concurrently public.mv_ingredient_prices;
  end if;
end $$;

create or replace function public.refresh_analytics_views()
returns void language plpgsql security definer set search_path = '' as $$
begin
  refresh materialized view public.mv_daily_active_users;
  refresh materialized view public.mv_feature_usage_daily;
  -- 18-exports-and-analytics.md adds further views here; switch to CONCURRENTLY once populated
end $$;

revoke execute on function public.refresh_ingredient_prices(), public.refresh_analytics_views() from public, anon, authenticated;
grant execute on function public.refresh_ingredient_prices(), public.refresh_analytics_views() to service_role;
refresh materialized view public.mv_ingredient_prices;
refresh materialized view public.mv_daily_active_users;
refresh materialized view public.mv_feature_usage_daily;

-- 17.3 retention helpers -----------------------------------------------------------------
create or replace function private.purge_soft_deleted(p_days integer default 30)
returns integer language plpgsql security definer set search_path = '' as $$
declare r record; v_total integer := 0; v_n integer;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'deleted_at' and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname not in ('users','households',        -- handled by account-delete
                            'recipes','meals')           -- may still be referenced by historical plans
  loop
    begin
      execute format('delete from public.%I where deleted_at < now() - make_interval(days => $1)', r.relname)
        using p_days;
      get diagnostics v_n = row_count;
      v_total := v_total + v_n;
    exception when foreign_key_violation then
      raise warning 'purge_soft_deleted: % skipped (%)', r.relname, sqlerrm;   -- surfaces in cron.job_run_details
    end;
  end loop;
  return v_total;
end $$;

create or replace function private.purge_audit_log(p_years integer default 3)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  perform set_config('app.retention_job', 'on', true);
  delete from public.audit_log where at < now() - make_interval(years => p_years);
  get diagnostics v_n = row_count;
  perform set_config('app.retention_job', 'off', true);
  return v_n;
end $$;

-- 17.4 Edge Function invoker for cron (secrets live in Supabase Vault) ---------------------
-- Vault secrets (created per environment, never in migrations):
--   project_url  = https://<ref>.supabase.co
--   cron_secret  = random 32-byte hex; Edge Functions compare it to header x-cron-secret
--   audit_ip_salt = random 32-byte hex
create or replace function private.invoke_edge_function(p_name text, p_body jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_url text; v_secret text;
begin
  select decrypted_secret into v_url    from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';
  if v_url is null or v_secret is null then
    raise warning 'invoke_edge_function: vault secrets missing, skipping %', p_name;
    return null;
  end if;
  return net.http_post(
    url     := v_url || '/functions/v1/' || p_name,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body    := p_body,
    timeout_milliseconds := 15000
  );
end $$;

-- 17.5 pg_cron schedule (UTC). Pakistan Standard Time is UTC+5. --------------------------
select cron.schedule('notifications-dispatch', '* * * * *',
  $$select private.invoke_edge_function('notifications-dispatch')$$);
select cron.schedule('prices-refresh', '15 0 * * *',                       -- 05:15 PKT
  $$select private.invoke_edge_function('prices-refresh')$$);
select cron.schedule('analytics-rollup', '10 * * * *',
  $$select private.invoke_edge_function('analytics-rollup')$$);
select cron.schedule('exports-purge-expired', '25 * * * *',
  $$select private.invoke_edge_function('export-pdf', '{"action":"purge_expired"}'::jsonb)$$);
select cron.schedule('analytics-partitions', '0 3 20 * *',
  $$select private.ensure_analytics_partitions(3)$$);
select cron.schedule('analytics-retention', '30 3 1 * *',
  $$select private.drop_old_analytics_partitions(25)$$);
select cron.schedule('refresh-life-stages', '5 19 * * *',                  -- 00:05 PKT
  $$select private.refresh_life_stages()$$);
select cron.schedule('ai-memories-expire', '20 19 * * *',
  $$update public.ai_memories set deleted_at = now() where expires_at < now() and deleted_at is null$$);
select cron.schedule('soft-delete-purge', '40 19 * * *',
  $$select private.purge_soft_deleted(30)$$);
select cron.schedule('invitations-cleanup', '50 19 * * *',
  $$delete from public.household_invitations where accepted_at is null and expires_at < now() - interval '30 days'$$);
select cron.schedule('notifications-retention', '0 20 * * 0',
  $$delete from public.notifications where status in ('sent','cancelled','failed') and created_at < now() - interval '180 days'$$);
select cron.schedule('ai-usage-retention', '0 21 2 * *',
  $$delete from public.ai_usage where created_at < now() - interval '25 months'$$);
select cron.schedule('audit-retention', '0 22 3 * *',
  $$select private.purge_audit_log(3)$$);
select cron.schedule('cron-history-retention', '0 23 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '14 days'$$);
```

Operational notes:
- If an event arrives for a month without a partition it lands in `analytics_events_default`. The monthly job creates partitions three months ahead, so the default partition should stay empty; an alert in `analytics-rollup` fires if `count(*) > 0` there. Creating a partition fails if the default already contains rows in that range; the runbook moves them with `insert ... select` + `delete` before retrying.
- The cron wiring, the per-function auth mode and the Vault setup are described in `10-supabase-structure.md`.

## 18. Data retention

Retention aligns with `16-security-architecture.md` (privacy) and `18-exports-and-analytics.md`. Hard deletes run as `service_role` or `postgres` from `pg_cron`.

| Data | Retention | Mechanism |
|---|---|---|
| Soft-deleted rows (all tables with `deleted_at` except `users`, `households`) | 30 days after `deleted_at`, then hard-deleted | `soft-delete-purge` cron |
| Account (`users`, owned `households` and everything under them) | Erased within 30 days of request; immediate soft-delete and sign-out | `account-delete` Edge Function deletes `auth.users`, cascading through `public.users` |
| Analytics events | 25 months, then partition dropped; `user_id`/`household_id` deleted on account erasure | `analytics-retention` cron, `account-delete` |
| Audit log | 3 years; on erasure `actor_user_id` and `household_id` become null (FK `set null`), diffs of health tables contain keys only | `audit-retention` cron |
| AI usage metering | 25 months (billing disputes, cost analysis) | `ai-usage-retention` cron |
| Chat sessions and messages | Until the user deletes the session or the account. Attachments in Storage are removed with the session (`10-supabase-structure.md`) | `soft_delete('chat_sessions')` then purge |
| AI memories | Until `expires_at` (default 365 days set by `ai-chat`), user "forget", or account deletion | `ai-memories-expire` cron |
| Notifications | 180 days after send | `notifications-retention` cron |
| Exports (PDF/zip files) | `expires_at` (7 days) then file deleted and row marked `expired` | `exports-purge-expired` cron calling `export-pdf` |
| Invitations | 30 days after expiry if not accepted | `invitations-cleanup` cron |
| Subscriptions | Life of account + 7 years for the `raw_event` of paid periods if tax law requires (default: life of account) | Manual export to finance before erasure |
| Consents | Life of account; kept 3 years after erasure as proof of consent in a pseudonymised export (default: deleted with account, decision pending legal review) | `account-delete` |
| `cron.job_run_details` | 14 days | `cron-history-retention` |
| Global catalog, Islamic sources, price observations | Indefinite (not personal data; `reporter_user_id` set null on erasure) | n/a |

## 19. Seed strategy

Seed data lives in `supabase/seed/` as idempotent SQL (`insert ... on conflict do update`) and CSV loaded by `supabase/seed/load.ts` (layout in `10-supabase-structure.md`). Order matters because of foreign keys. Seeds run with `set app.bypass_entitlements = 'on'`.

| Order | File | Source | Contents and acceptance |
|---|---|---|---|
| 1 | `010_allergens.sql` | EU Regulation 1169/2011 Annex II (14) + US FALCPA/FASTER Act (9) | 15 codes: `gluten_cereals`, `crustaceans`, `eggs`, `fish`, `peanuts`, `soy`, `milk`, `tree_nuts`, `celery`, `mustard`, `sesame`, `sulphites`, `lupin`, `molluscs`, `wheat` (US lists wheat separately from gluten cereals). `name_i18n` has `en` and `ur`. |
| 2 | `020_budget_categories.sql` | `00-foundations.md` | The 10 codes with `en`/`ur` names and `sort_order`. |
| 3 | `030_regions.sql` | ISO 3166-2 | MVP: `PK-PB` Punjab (`hot_semi_arid`, PKR), `PK-SD` Sindh (`hot_arid`), `PK-IS` Islamabad Capital Territory (`humid_subtropical`), `PK-KP`. Phase 2 rows (`AE-DU`, `SA-01`, `GB-ENG`, `US-*`, `CA-ON`) seeded disabled through the absence of price profiles. |
| 4 | `040_ingredients.csv` | USDA FoodData Central (`fdc_id`) + Pakistan Food Composition Table 2001 for local items | About 450 ingredients at MVP. Every row has `budget_category_id`, `halal_status`, `textures`, `color`; Sunnah foods flagged (dates, barley/talbina, pumpkin/dubba, honey, olive oil, black seed, milk, vinegar, pomegranate, figs, grapes, cucumber, watermelon). Urdu names reviewed by a native speaker. |
| 5 | `050_ingredient_allergens.csv` | Derived | Joins for every ingredient containing an allergen (`besan` -> none; `atta` -> `gluten_cereals`, `wheat`; `paneer` -> `milk`). |
| 6 | `060_growth_reference_lms.csv` | WHO Child Growth Standards 2006 (0 to 60 months: wfa, lhfa, bmifa, hcfa by sex) and WHO Growth Reference 2007 (61 to 228 months: wfa to 120 months, hfa, bmifa); CDC 2000 for Phase 2 US | Monthly LMS rows. Checksum of the published WHO expanded tables stored in `supabase/seed/checksums.txt`; a pgTAP test spot-checks known values (for example WHO 2006 boys wfa at 0 months: L 0.3487, M 3.3464, S 0.14602). |
| 7 | `070_seasonal_produce_punjab.csv` | Punjab Agriculture Department crop calendars, Lahore wholesale market observation | Per month availability for about 60 produce items. Example for October: guava `peak`, pumpkin `peak`, spinach `available` (peak Nov to Feb), turnip `available`, kinnow `scarce` (peak Dec to Feb), mango `scarce`. |
| 8 | `080_price_book_lahore.sql` | `/mnt/project-files/nutrition-program/source/data.py` (Lahore retail, Oct 2026 estimates) | `price_profiles` row `region PK-PB, city 'Lahore', currency PKR, effective_from 2026-10-01, label 'Lahore retail Oct 2026'`, plus `price_observations` with `source 'seed'`. Karachi and Islamabad profiles are derived from Lahore with a city factor until real data arrives (flagged `label` "derived"). |
| 9 | `090_recipes_curated.sql` | In-house dietitian-reviewed recipes from the 4-week Lahore programme (`meals.py`) | About 120 recipes (daal chawal, palak chana, shalgam gosht, lauki koftas, talbina, chana-pumpkin curry, fish cutlets, besan cheela, haleem with barley) with `recipe_ingredients`, `portions` per life stage, `review_status 'verified'`. Then about 80 global `meals` with `plate_split` and `meal_alternatives`. Nutrition computed by the trigger, then spot-checked. |
| 10 | `100_islamic_sources.sql` | Primary collections, verified by the scholar panel (`13-islamic-knowledge-module.md`) | Only references that passed verification are inserted with a `source_verifications` row (`status 'verified'`, reviewer name and credentials). Initial core set includes Tirmidhi 2380 / Ibn Majah 3349 (rule of thirds), Bukhari 5376 / Muslim 2022 (Bismillah, right hand, eat from what is near you), Bukhari 5409 / Muslim 2064 (never criticising food), Muslim 2028 (drinking in three breaths), Bukhari 5392 (food for two suffices three), Bukhari 5417 (talbina), Muslim 2033 (picking up a fallen morsel), Qur'an 7:31 (eat and drink, do not be excessive), 80:24-32, 55:68. Shia narrations from *al-Kafi* and *Tibb al-A'imma* are seeded only after a qualified Shia scholar has verified the exact volume, page and grading; until then they stay `unverified` and are invisible to users. |
| 11 | `110_scientific_evidence.sql` + `120_recommendations.sql` | Peer-reviewed sources (WHO, EFSA, AAP, NICE, Satter Division of Responsibility, exposure-based feeding literature) | Each recommendation inserted `unverified`, its evidence links inserted, then updated to `verified` so the publishing trigger validates it. |
| 12 | `130_coaching_tips.sql` | Content team, evidence-linked | Picky, autism, Ramadan and general tips with age bands. |
| 13 | `140_ai_model_routes.sql`, `150_prompt_templates.sql`, `160_feature_flags.sql` | `00-foundations.md` section 3 routing table | Routes per environment; prompts versioned from `packages/ai-core/prompts/`. |
| dev only | `900_dev_fixtures.sql` | Synthetic | Test users (`owner@thuluth.test`, `caregiver@thuluth.test`, `viewer@thuluth.test`), a Lahore household of four (two adults, son 7, daughter 4 with autism module), a premium subscription row for the owner. Never loaded in staging or prod. |

Example seed (Lahore price book excerpt):

```sql
-- supabase/seed/080_price_book_lahore.sql (excerpt)
with region as (
  select id from public.regions where country_code = 'PK' and region_code = 'PB'
), profile as (
  insert into public.price_profiles (region_id, city, currency, effective_from, label)
  select id, 'Lahore', 'PKR', date '2026-10-01', 'Lahore retail Oct 2026' from region
  on conflict (region_id, coalesce(city, ''), effective_from) do update set label = excluded.label
  returning id
)
insert into public.price_observations (price_profile_id, ingredient_id, unit, amount_minor, observed_on, source)
select p.id, i.id, v.unit, v.rupees * 100, date '2026-10-01', 'seed'
from profile p
cross join (values
  ('Onion',                 'kg',     120),
  ('Tomato',                'kg',     175),
  ('Potato',                'kg',      90),
  ('Bottle gourd (lauki)',  'kg',     160),
  ('Pumpkin (kaddu)',       'kg',      60),
  ('Spinach (palak)',       'kg',     100),
  ('Guava (amrood)',        'kg',     200),
  ('Banana',                'dozen',  180),
  ('Chicken, whole, with bone', 'kg', 570),
  ('Beef mince, lean',      'kg',    1400),
  ('Eggs, farm',            'dozen',  315),
  ('Fresh milk',            'l',      210),
  ('Chakki atta (whole wheat flour)', 'kg', 135),
  ('Whole barley (jau)',    'kg',     260),
  ('Masoor daal',           'kg',     300),
  ('Kabuli chana',          'kg',     380),
  ('Dates (Aseel)',         'kg',     600),
  ('Desi ghee',             'kg',    3400)
) as v(name, unit, rupees)
join public.ingredients i on lower(i.name) = lower(v.name);
```

## 20. Additions beyond 00-foundations

| Kind | Name | Reason |
|---|---|---|
| Extension | `pg_net` | `pg_cron` to Edge Function HTTP calls |
| Schema | `private` | Non-exposed home for trigger functions, generators, cron helpers |
| Function | `is_admin()` | Admin writes to curated catalog through RLS |
| Function | `age_in_months(date, date)`, `is_minor(date, date)` | Child safety rules and growth math |
| Function | `can_author_plans(uuid)`, `is_linked_member(uuid)`, `shares_household_with(uuid)`, `my_household_ids()`, `household_has_premium(uuid)` | RLS for coach role, self-logging, co-member profile visibility, household-level premium |
| Function | `soft_delete(text, uuid)` | Soft delete through RLS (PostgREST cannot PATCH a row out of its own select policy) |
| Function | `transfer_household_ownership(uuid, uuid)` | Owner row is otherwise immutable |
| Function | `recompute_recipe_nutrition(uuid)`, `refresh_ingredient_prices()`, `refresh_analytics_views()` | Derived data maintained by triggers and cron |
| Materialized views | `mv_ingredient_prices`, `mv_daily_active_users`, `mv_feature_usage_daily` | Pricing for `grocery-generate`, analytics for `analytics-rollup` |
| Columns | `users.email`, `users.avatar_path` | Invitation matching; avatar storage path |
| Columns | `households.region_id` | FK to `regions` alongside the text `region` |
| Columns | `household_members.invited_by`; `household_invitations.accepted_by`, `revoked_at` | Invitation lifecycle |
| Columns | `family_members.sort_order` | Display order |
| Columns | `allergens.eu14`, `us_big9`; `budget_categories.sort_order`; `ingredients.grams_per_unit`, `is_active` | Catalog quality |
| Columns | `recipes.household_id`, `created_by_user_id`; `recipe_ingredients.sort_order`; `meals.household_id`, `source`, `title_i18n`; `portions.household_id`, `household_measure_i18n` | Household-private recipes and AI-composed meals |
| Columns | `price_profiles.label`; `price_observations.moderation_status` | Crowd-sourced price moderation |
| Columns | `medical_conditions.on_insulin_or_sulfonylurea` | Fasting red flag from section 10.2 |
| Columns | `hadith_references.numbering_scheme`; `islamic_sources.verification_status`, `topic_tags`; `recommendations.review_status`; `coaching_tips.is_active` | Verified-only exposure and publishing gate |
| Columns | `ai_assessments.hydration_targets`, `input_snapshot`, `model`, `created_by_user_id`; `ai_usage.status`, `request_id` | Intake output and observability |
| Columns | `budget_profiles.is_active`; `meal_plans.title`, `failure_reason`, `generation_meta`, `created_by_user_id`; `daily_meals.slot`; `grocery_lists.price_profile_id`; `shopping_items.sort_order`; `budget_entries.currency`, `note` | Plan lifecycle and grocery UX |
| Columns | `meal_logs.daily_meal_serving_id`, `logged_by_user_id`; `fasting_logs.is_practice_fast`; `ramadan_plans.prayer_times`; `growth_tracking.age_months`, `head_circumference_for_age_z`, `head_circumference_for_age_percentile`, `flags`, `computed_at`; `food_exposures.ladder_step_id` | Module requirements |
| Columns | `subscriptions.last_event_id`, `last_event_at`; `notifications.status`, `dedupe_key`, `attempts`; `consents.household_id`; `exports.params`, `error`; `feature_flags.description` | Idempotency, dispatch, scoping |

## 21. Acceptance criteria and test hooks

pgTAP tests live in `supabase/tests/` (structure in `10-supabase-structure.md`, strategy in `21-testing-strategy.md`). The schema is accepted when all of the following pass on `supabase db reset`:

1. **RLS coverage:** every `public` base table and partition has `relrowsecurity = true`; every non-partition table has at least one policy, except partitions (locked by revoked grants).
   ```sql
   select is(
     (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity),
     0::bigint, 'all public tables have RLS enabled');
   ```
2. **Tenancy isolation:** a user in household A selects zero rows of household B from every household-scoped table (generated test iterates the tables that have a `household_id` column).
3. **Role matrix:** viewer cannot insert into `allergies`; caregiver can; coach can insert `meal_plans` but not `allergies`; only the owner can update `households.name` and insert `household_members`.
4. **Self-logging:** a viewer linked to a family member can insert `hydration_logs` for that member and not for another member.
5. **Entitlements:** a free owner's second `households` insert fails with `ENTITLEMENT_HOUSEHOLD_LIMIT`; the 7th `family_members` insert fails with `ENTITLEMENT_MEMBER_LIMIT`; after inserting an active premium `subscriptions` row both succeed up to 20 members; a free household cannot have two `active` plans or a 2-week plan.
6. **Child safety:** `nutrition_goals` with `goal_type 'weight_loss'` for a 12-year-old fails; `fasting_logs` `kind 'intermittent'` for a 16-year-old fails; a completed fast for a 6-year-old fails.
7. **Islamic verification:** an `islamic_sources` row without a verified `source_verifications` row is invisible to `authenticated`; editing the hadith text sends it back to `in_review` and hides it; a recommendation cannot be set `verified` without both evidence kinds.
8. **Audit:** updating `allergies.severity` writes one `audit_log` row with `diff = {"severity":"changed"}` (keys only), and `update audit_log` fails.
9. **Auth bootstrap:** inserting into `auth.users` creates `public.users` and 13 `notification_preferences` rows (`marketing` disabled).
10. **Derived data:** `family_members.life_stage` is `toddler` for a DOB 20 months ago; `growth_tracking.bmi` equals `compute_bmi`; adding a recipe ingredient updates `recipes.per_serving_nutrition`.
11. **Partitions:** `analytics_events` has partitions for the current month and the next three; `authenticated` cannot select from `analytics_events` or any partition.
12. **Indexes:** `explain` of `select * from ai_memories order by embedding <=> $1 limit 8` uses `ai_memories_embedding_hnsw`.
