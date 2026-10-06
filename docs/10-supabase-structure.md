# 10 · Supabase Structure

> **Status:** Draft v1 for implementation · **Owner:** Backend / Platform · **Deliverable:** 9 (Supabase Structure)
>
> **Related docs:** `00-foundations.md` (canonical names, Edge Function list, tiers), `04-system-architecture.md`, `05-database-schema.md` (all DDL, RLS, triggers, cron SQL), `06-api-specification.md` (function contracts), `11-authentication.md`, `12-ai-agent-architecture.md`, `16-security-architecture.md`, `17-subscription-architecture.md`, `18-exports-and-analytics.md`, `19-deployment-architecture.md`, `20-ci-cd-pipeline.md`, `21-testing-strategy.md`.
>
> Items not in `00-foundations.md` are marked **Addition beyond 00-foundations** and collected in [section 17](#17-additions-beyond-00-foundations).

## Table of contents

1. [Overview](#1-overview)
2. [Directory layout](#2-directory-layout)
3. [config.toml](#3-configtoml)
4. [Environments](#4-environments)
5. [Auth settings](#5-auth-settings)
6. [Storage buckets](#6-storage-buckets)
7. [Realtime](#7-realtime)
8. [Scheduled jobs (pg_cron)](#8-scheduled-jobs-pg_cron)
9. [Edge Functions](#9-edge-functions)
10. [Database roles](#10-database-roles)
11. [Secrets management](#11-secrets-management)
12. [Backups and point-in-time recovery](#12-backups-and-point-in-time-recovery)
13. [Local development workflow](#13-local-development-workflow)
14. [Seeding](#14-seeding)
15. [Database tests (pgTAP)](#15-database-tests-pgtap)
16. [Migration rules](#16-migration-rules)
17. [Additions beyond 00-foundations](#17-additions-beyond-00-foundations)

---

## 1. Overview

Supabase is the whole backend: Postgres (data, RLS, triggers, `pg_cron`, `pgvector`), Auth, Storage, Realtime and Edge Functions (Deno). The mobile app talks to it in exactly two ways:

1. **PostgREST via `supabase-js`** for CRUD, always under RLS with the user's JWT.
2. **Edge Functions** for anything that calls an AI provider or third party, writes across many tables, or needs secrets (`00-foundations.md` section 4.2).

```mermaid
flowchart LR
  App[Expo app<br/>supabase-js] -- JWT --> PR[PostgREST]
  App -- JWT --> EF[Edge Functions]
  App -- JWT --> ST[Storage]
  App -- JWT --> RT[Realtime]
  PR --> PG[(Postgres<br/>RLS)]
  RT --> PG
  ST --> PG
  EF -- service_role --> PG
  EF --> AI[Anthropic / OpenAI / Gemini]
  EF --> OS[OneSignal]
  EF --> EM[Email provider]
  RC[RevenueCat] -- webhook secret --> EF
  CRON[pg_cron + pg_net] -- x-cron-secret --> EF
```

## 2. Directory layout

```text
supabase/
├── config.toml                       # local stack + per-function settings (section 3)
├── .env.local.example                # template for `supabase functions serve --env-file`
├── migrations/                       # forward-only SQL, applied in filename order
│   ├── 20261001000100_extensions_enums.sql
│   ├── 20261001000200_core_helpers.sql
│   ├── 20261001000300_identity_tenancy.sql
│   ├── 20261001000400_food_catalog.sql
│   ├── 20261001000500_health_profile.sql
│   ├── 20261001000600_islamic_knowledge.sql
│   ├── 20261001000700_ai.sql
│   ├── 20261001000800_plans_grocery_budget.sql
│   ├── 20261001000900_tracking_modules.sql
│   ├── 20261001001000_platform.sql
│   ├── 20261001001100_access_helpers.sql
│   ├── 20261001001200_triggers.sql
│   ├── 20261001001300_rls.sql
│   ├── 20261001001400_analytics_cron.sql
│   ├── 20261001001500_storage.sql            # section 6.4
│   └── 20261001001600_realtime.sql           # section 7.3
├── seed/
│   ├── catalog/                      # loaded in every environment (idempotent upserts)
│   │   ├── 010_allergens.sql
│   │   ├── 020_budget_categories.sql
│   │   ├── 030_regions.sql
│   │   ├── 040_ingredients.sql           # GENERATED from data/ingredients.csv
│   │   ├── 050_ingredient_allergens.sql  # GENERATED
│   │   ├── 060_growth_reference_lms.sql  # GENERATED from WHO tables
│   │   ├── 070_seasonal_produce_punjab.sql
│   │   ├── 080_price_book_lahore.sql
│   │   ├── 090_recipes_curated.sql
│   │   ├── 100_islamic_sources.sql
│   │   ├── 110_scientific_evidence.sql
│   │   ├── 120_recommendations.sql
│   │   ├── 130_coaching_tips.sql
│   │   ├── 140_ai_model_routes.sql
│   │   ├── 150_prompt_templates.sql      # GENERATED from packages/ai-core/prompts/
│   │   └── 160_feature_flags.sql
│   ├── local/                        # local and CI only, never staging/prod
│   │   ├── 000_local_vault.sql           # vault secrets for the local stack
│   │   └── 900_dev_fixtures.sql          # test users, Lahore household of four
│   ├── data/                         # CSV sources (reviewed in PRs as data)
│   │   ├── ingredients.csv
│   │   ├── ingredient_allergens.csv
│   │   ├── who_2006_lms.csv
│   │   ├── who_2007_lms.csv
│   │   └── checksums.txt
│   └── build.ts                      # CSV -> SQL generator (`pnpm seed:build`), output committed
├── functions/
│   ├── deno.json                     # import map, compiler options, lint/fmt config
│   ├── _shared/                      # not deployed on its own; imported by functions
│   │   ├── auth.ts
│   │   ├── clients.ts
│   │   ├── cors.ts
│   │   ├── cron.ts
│   │   ├── entitlements.ts
│   │   ├── errors.ts
│   │   ├── http.ts
│   │   ├── logger.ts
│   │   ├── rate-limit.ts
│   │   ├── sentry.ts
│   │   ├── sse.ts
│   │   ├── storage.ts
│   │   ├── time.ts
│   │   ├── validate.ts
│   │   ├── ai/
│   │   │   ├── router.ts             # reads ai_model_routes, fallback chain, metering into ai_usage
│   │   │   ├── safety.ts             # classify.safety + red-flag rules (12-ai-agent-architecture.md)
│   │   │   └── prompts.ts            # loads active prompt_templates
│   │   ├── integrations/
│   │   │   ├── onesignal.ts
│   │   │   ├── email.ts
│   │   │   ├── revenuecat.ts
│   │   │   └── prayer-times.ts
│   │   └── test/                     # Deno test helpers (fake providers, fixtures)
│   ├── ai-chat/index.ts
│   ├── ai-intake-assess/index.ts
│   ├── ai-generate-plan/index.ts
│   ├── ai-adjust-plan/index.ts
│   ├── ai-analyze-meal/index.ts
│   ├── ai-transcribe/index.ts
│   ├── grocery-generate/index.ts
│   ├── growth-compute/index.ts
│   ├── ramadan-generate/index.ts
│   ├── export-pdf/
│   │   ├── index.ts
│   │   └── templates/                # meal_plan.html, grocery_list.html, ... (18-exports-and-analytics.md)
│   ├── household-invite/index.ts
│   ├── account-export/index.ts
│   ├── account-delete/index.ts
│   ├── revenuecat-webhook/index.ts
│   ├── notifications-dispatch/index.ts
│   ├── prices-refresh/index.ts
│   ├── analytics-rollup/index.ts
│   ├── promo-redeem/index.ts
│   └── health-notes/index.ts
└── tests/
    ├── _helpers/
    │   └── 000_helpers.sql           # tests.create_user, tests.authenticate_as, tests.clear_auth
    ├── schema/
    │   ├── 001_extensions.test.sql
    │   ├── 002_enums.test.sql
    │   └── 003_indexes.test.sql
    ├── rls/
    │   ├── 000_all_tables_have_rls.test.sql
    │   ├── 010_tenancy_isolation.test.sql
    │   ├── 020_role_matrix.test.sql
    │   ├── 030_self_logging.test.sql
    │   ├── 040_catalog_readonly.test.sql
    │   ├── 050_islamic_verified_only.test.sql
    │   └── 060_storage_policies.test.sql
    ├── triggers/
    │   ├── 010_entitlements.test.sql
    │   ├── 020_child_safety.test.sql
    │   ├── 030_audit.test.sql
    │   ├── 040_auth_bootstrap.test.sql
    │   └── 050_derived_fields.test.sql
    └── seed/
        └── 010_growth_reference_spotcheck.test.sql
```

Each function directory contains only `index.ts` (plus templates where needed). Business logic that the app also needs (Zod contracts, nutrition math, plate-split validation, growth z-score math) lives in `packages/shared` and `packages/ai-core`, never duplicated in a function.

### 2.1 Sharing code with the monorepo

Deno cannot import the extensionless TypeScript that React Native uses, so the two packages ship a Deno build:

| Package | Build | Output imported by functions |
|---|---|---|
| `packages/shared` | `tsup src/deno.ts --format esm --dts --out-dir dist/deno` | `@thuluth/shared` |
| `packages/ai-core` | `tsup src/index.ts --format esm --dts --out-dir dist/deno --external npm:*` | `@thuluth/ai-core` |

```json
// supabase/functions/deno.json
{
  "imports": {
    "@thuluth/shared": "../../packages/shared/dist/deno/deno.js",
    "@thuluth/ai-core": "../../packages/ai-core/dist/deno/index.js",
    "@supabase/supabase-js": "npm:@supabase/supabase-js@2",
    "zod": "npm:zod@3",
    "@sentry/deno": "npm:@sentry/deno@8",
    "@anthropic-ai/sdk": "npm:@anthropic-ai/sdk",
    "openai": "npm:openai",
    "@google/genai": "npm:@google/genai"
  },
  "compilerOptions": { "strict": true, "noUncheckedIndexedAccess": true },
  "lint": { "rules": { "tags": ["recommended"] } },
  "fmt": { "lineWidth": 110, "singleQuote": true }
}
```

Turborepo makes `supabase#functions:deploy` and `supabase#functions:serve` depend on `@thuluth/shared#build:deno` and `@thuluth/ai-core#build:deno`. Provider SDK versions are pinned in `deno.lock`, which is committed.

### 2.2 `_shared` modules

| Module | Exports | Notes |
|---|---|---|
| `http.ts` | `serve(handler, opts)` | Wraps `Deno.serve`: CORS preflight, request id, JSON parse, Zod validation, error envelope, Sentry capture, structured log line. Every function's `index.ts` is `serve(handler, { auth: 'user', input: Schema })`. |
| `auth.ts` | `requireUser(req): Promise<AuthContext>`, `requireCron(req)`, `requireWebhookSecret(req, envName)` | `AuthContext = { userId: string; jwt: string; email?: string; isAdmin: boolean }`. User JWT is verified with `supabase.auth.getClaims(jwt)` (JWKS, asymmetric signing keys). Cron and webhook secrets use constant-time comparison. |
| `clients.ts` | `userClient(jwt)`, `serviceClient()` | `userClient` runs PostgREST as the caller (RLS applies) and is the default for reads; `serviceClient` is used only for writes that RLS forbids to clients (chat messages, assessments, metering). |
| `errors.ts` | `AppError`, `errorResponse(e)`, `mapPgError(e)` | Envelope `{ "error": { "code", "message", "details" } }`. Maps trigger messages such as `ENTITLEMENT_MEMBER_LIMIT` to HTTP 402 and `CHILD_WEIGHT_LOSS_GOAL_NOT_ALLOWED` to 422. |
| `validate.ts` | `parseBody(req, schema)` | Zod schemas from `@thuluth/shared/contracts`. |
| `entitlements.ts` | `assertPremium(ctx, householdId?)`, `assertChatQuota(ctx)` | Calls `has_premium` / `household_has_premium`; quota per `00-foundations.md` section 8. |
| `rate-limit.ts` | `rateLimit(key, limit, windowSec)` | Postgres-backed sliding window over `ai_usage` for AI routes; per-IP limit for `household-invite` accept. |
| `sse.ts` | `sseStream(write => ...)` | `text/event-stream`, heartbeat every 15 s, `event: error` frames use the error envelope. |
| `ai/router.ts` | `callModel(routeKey, request, ctx)` | Loads `ai_model_routes` (cached 60 s), walks priority order on retryable errors, records each attempt in `ai_usage` (`status 'fallback'` for failed attempts). |
| `ai/safety.ts` | `screenInput`, `screenOutput`, `redFlags(profile)` | Enforces `00-foundations.md` section 10 before any plan or chat output is persisted. |
| `storage.ts` | `signedUrl(bucket, path, ttl)`, `removeObjects(bucket, paths)`, `householdPath(...)` | Builds paths per section 6.2 conventions. |
| `time.ts` | `householdToday(tz)`, `startOfLocalDay(tz)` | All "today" logic uses `households.timezone`. |
| `cron.ts` | `cronHandler(fn)` | `requireCron` + single-flight guard via `pg_try_advisory_lock`. |
| `logger.ts`, `sentry.ts` | `log.info/warn/error`, `initSentry('thuluth-edge')` | JSON logs; PII scrubbing (`email`, `name`, `notes`, free text) before sending to Sentry. |
| `integrations/*` | Thin typed clients | OneSignal (push), email (invitations, export ready), RevenueCat REST (subscriber fetch for reconciliation), prayer times (AlAdhan API). |

## 3. config.toml

Only the settings that differ from CLI defaults are shown. Hosted projects are configured to match through the dashboard or the Management API (`20-ci-cd-pipeline.md` keeps a `supabase/remote-settings.json` drift check).

```toml
# supabase/config.toml
project_id = "thuluth"

[api]
enabled = true
port = 54321
schemas = ["public", "graphql_public"]   # "private" is never exposed
extra_search_path = ["public", "extensions"]
max_rows = 1000

[db]
port = 54322
major_version = 15

[db.pooler]
enabled = true
pool_mode = "transaction"

[db.seed]
enabled = true
sql_paths = ["./seed/local/000_local_vault.sql", "./seed/catalog/*.sql", "./seed/local/900_dev_fixtures.sql"]

[realtime]
enabled = true

[studio]
enabled = true
port = 54323

[inbucket]                 # local mail catcher for OTP and invitation emails
enabled = true
port = 54324

[storage]
enabled = true
file_size_limit = "25MiB"

[auth]
enabled = true
site_url = "https://thuluth.app"
additional_redirect_urls = ["thuluth://auth-callback", "https://thuluth.app/auth/callback", "exp+thuluth://auth-callback"]
jwt_expiry = 3600
enable_refresh_token_rotation = true
refresh_token_reuse_interval = 10
enable_signup = true
enable_anonymous_sign_ins = false
minimum_password_length = 12            # passwords are disabled for users; this guards admin accounts

[auth.rate_limit]
email_sent = 1000                        # per hour, PROJECT-WIDE (all users share it); needs custom SMTP on hosted
token_refresh = 150
sign_in_sign_ups = 30
token_verifications = 30

[auth.email]
enable_signup = true
double_confirm_changes = true
enable_confirmations = true
otp_length = 6
otp_expiry = 600
max_frequency = "60s"
secure_password_change = true

[auth.email.template.magic_link]        # OTP code email for existing users ({{ .Token }}, en + ur)
subject = "Your Thuluth code / ثلث کوڈ"
content_path = "./supabase/templates/auth/magic-link.html"

[auth.email.template.confirmation]      # OTP code email on first sign-in (user created)
subject = "Your Thuluth code / ثلث کوڈ"
content_path = "./supabase/templates/auth/confirmation.html"

[auth.external.google]
enabled = true
client_id = "env(GOOGLE_OAUTH_CLIENT_ID)"
secret = "env(GOOGLE_OAUTH_SECRET)"
skip_nonce_check = true                  # native Google Sign-In on iOS issues ID tokens without nonce

[auth.external.apple]
enabled = true
client_id = "app.thuluth.mobile"
secret = "env(APPLE_OAUTH_SECRET)"

[auth.hook.before_user_created]         # 11 section 3.1.1; enable by hand on hosted projects
enabled = true
uri = "pg-functions://postgres/public/hook_before_user_created"

[auth.mfa]
max_enrolled_factors = 10
[auth.mfa.totp]
enroll_enabled = true                    # offered to admin accounts only (enforced in admin console)
verify_enabled = true

[edge_runtime]
enabled = true
policy = "per_worker"
deno_version = 2

# ---- Edge Functions: gateway JWT verification per function (section 9) ----
[functions.ai-chat]
verify_jwt = true
[functions.ai-intake-assess]
verify_jwt = true
[functions.ai-generate-plan]
verify_jwt = true
[functions.ai-adjust-plan]
verify_jwt = true
[functions.ai-analyze-meal]
verify_jwt = true
[functions.ai-transcribe]
verify_jwt = true
[functions.grocery-generate]
verify_jwt = true
[functions.growth-compute]
verify_jwt = true
[functions.ramadan-generate]
verify_jwt = true
[functions.household-invite]
verify_jwt = true
[functions.account-export]
verify_jwt = true
[functions.export-pdf]
verify_jwt = false          # dual mode: user JWT verified in code, or cron secret for action "purge_expired"
[functions.account-delete]
verify_jwt = false          # dual mode: user JWT verified in code, or cron secret for action "sweep_orphans"
[functions.revenuecat-webhook]
verify_jwt = false          # shared secret in Authorization header
[functions.notifications-dispatch]
verify_jwt = false          # x-cron-secret
[functions.prices-refresh]
verify_jwt = false          # x-cron-secret
[functions.analytics-rollup]
verify_jwt = false          # x-cron-secret
[functions.promo-redeem]
verify_jwt = true
[functions.health-notes]
verify_jwt = true
```

## 4. Environments

| | Local | `thuluth-dev` | `thuluth-staging` | `thuluth-prod` |
|---|---|---|---|---|
| Purpose | Developer laptop, CI | Shared integration, preview builds | Release candidates, beta (TestFlight / Play internal) | Public app |
| Supabase plan | CLI (Docker) | Free or Pro | Pro | Pro + PITR add-on + compute add-on sized at launch (Small, scale on CPU > 60 percent) |
| Region | n/a | `eu-central-1` (Frankfurt) | `eu-central-1` | `eu-central-1` |
| Deployed by | `supabase start` | CI on merge to `main` | CI on release tag `v*-rc*` | CI on release tag `v*` with manual approval |
| Seeds | catalog + local fixtures | catalog + local fixtures | catalog only | catalog only |
| Auth providers | Email OTP (Inbucket), Google, Apple (test clients) | Same, test OAuth clients | Production OAuth clients, staging redirect URLs | Production |
| AI keys | Developer's own low-limit keys or fakes (`AI_FAKE=1`) | Shared dev keys with low spend caps | Staging keys | Production keys |
| RevenueCat | Sandbox | Sandbox | Sandbox | Production |
| OneSignal app | `Thuluth Dev` | `Thuluth Dev` | `Thuluth Dev` | `Thuluth Prod` |
| Sentry environment | `local` | `development` | `staging` | `production` |
| Custom domain | none | none | none | `api.thuluth.app` (Supabase custom domain add-on) |

**Region choice:** Supabase has no region in Pakistan or the Gulf. Frankfurt gives GDPR alignment for the UK and Europe phase and stable latency from Pakistan (traffic between Pakistan and India commonly transits Europe or the Gulf, so Mumbai is not reliably faster). Revisit for a GCC data-residency requirement in Phase 2 (`23-phase-2-roadmap.md`).

Promotion path: migrations, functions and catalog seeds move dev → staging → prod only through CI (`20-ci-cd-pipeline.md`). Nobody runs `supabase db push` against staging or prod from a laptop; the prod database password is held by CI and two named maintainers only.

## 5. Auth settings

Full design, flows and screens are in `11-authentication.md`. Settings that matter for the backend:

| Setting | Value | Reason |
|---|---|---|
| Sign-in methods | Email OTP (6-digit code), Sign in with Apple, Google | MVP scope. No passwords for end users. |
| Anonymous sign-in | Off | Every row is tied to a real account for consent and erasure. |
| JWT signing | Asymmetric signing keys (ES256) with JWKS | Edge Functions verify locally via `getClaims`; keys rotate without app releases. |
| Access token lifetime | 3600 s | Default; `supabase-js` refreshes automatically. |
| Refresh token rotation | On, reuse interval 10 s | Detects token theft. |
| OTP | 6 digits, 600 s expiry, resend after 60 s | |
| CAPTCHA | Cloudflare Turnstile on OTP request (staging, prod) | Blocks SMS/email bombing and signup abuse. |
| SMTP | Custom SMTP through the transactional email provider (default Postmark), sender `no-reply@thuluth.app`, SPF/DKIM/DMARC set | Supabase's built-in sender is rate-limited and not for production. |
| Email templates | `en` and `ur` variants chosen by `raw_user_meta_data.locale` in the template (Go template `{{ if eq .Data.locale "ur" }}`) | |
| Redirect URLs | `thuluth://auth-callback`, `https://thuluth.app/auth/callback` (universal link) | |
| User metadata at signup | `display_name`, `locale`, `timezone`, `country_code` | Read by `private.handle_new_auth_user()` (`05-database-schema.md` 0012) to create `public.users`. |
| App metadata | `role: "admin"` for internal admins only, set by service role | Read by `is_admin()`. Never writable by users. |
| Custom access token hook | None in MVP | Household membership is resolved in RLS by `is_household_member`, not in claims, so role changes take effect immediately. |
| MFA | TOTP available; required for admin accounts | |
| Account deletion | `account-delete` Edge Function (calls `auth.admin.deleteUser`), never client-side | Cascades through `public.users`. |

## 6. Storage buckets

### 6.1 Buckets

All buckets except `recipe-images` are private; clients read through RLS-checked downloads or signed URLs.

| Bucket | Public | Size limit | Allowed MIME types | Written by | Read by |
|---|---|---|---|---|---|
| `avatars` | No | 2 MiB | `image/webp`, `image/jpeg`, `image/png` | Owner/caregiver (family member avatars), each user (own avatar) | Household members; co-members for user avatars |
| `meal-photos` | No | 8 MiB | `image/jpeg`, `image/webp`, `image/heic` | Household editors and self-logging linked members | Household members; `ai-analyze-meal` (service) |
| `chat-attachments` | No | 10 MiB | `image/jpeg`, `image/webp`, `image/heic`, `audio/m4a`, `audio/mp4`, `audio/aac`, `audio/webm` | The session owner | The session owner; `ai-chat`, `ai-transcribe`, `ai-analyze-meal` (service) |
| `exports` | No | 25 MiB | `application/pdf`, `application/zip`, `application/json` | Service only (`export-pdf`, `account-export`) | Requester and household editors (via signed URL, 15 min TTL) |
| `recipe-images` | Yes (CDN) | 4 MiB | `image/webp`, `image/jpeg` | Admins only (`catalog/` prefix) | Anyone with the URL |

Images are resized on the client before upload (longest edge 1600 px for meal photos, 512 px for avatars, WebP or JPEG quality 0.8) and served through Supabase image transformations (`?width=`) for thumbnails.

### 6.2 Path conventions

The first path segment is always the `household_id` for family data, so one policy predicate covers every bucket: `is_household_member(public.path_household_id(name))`.

| Bucket | Path | Example |
|---|---|---|
| `avatars` | `{household_id}/members/{family_member_id}.webp` | `5c1e.../members/9a7b....webp` |
| `avatars` | `users/{user_id}/avatar.webp` | `users/0d4f.../avatar.webp` |
| `meal-photos` | `{household_id}/{family_member_id}/{yyyy}/{mm}/{meal_log_id}.jpg` | `5c1e.../9a7b.../2026/10/3f20....jpg` |
| `meal-photos` | `{household_id}/recipes/{recipe_id}.webp` (household-private recipe photos) | |
| `chat-attachments` | `{household_id}/{chat_session_id}/{uuid}.{ext}` | `5c1e.../77aa.../b1c2....m4a` |
| `exports` | `{household_id}/{export_id}.pdf` and `account/{user_id}/{export_id}.zip` | |
| `recipe-images` | `catalog/{recipe_id}/{size}.webp` (`size` in `hero`, `card`) | |

Paths are stored on rows (`family_members.avatar_path`, `users.avatar_path`, `meal_logs.photo_path`, `chat_messages.attachments[].path`, `recipes.image_path`, `exports.storage_path`) without the bucket name. Object names never contain a person's name or free text.

### 6.3 Object lifecycle

| Event | Objects removed | By |
|---|---|---|
| Family member soft-deleted and purged | `avatars/{hh}/members/{id}.webp`, `meal-photos/{hh}/{id}/**` | `account-delete` action `sweep_orphans` (daily cron) |
| Meal log purged | Its `photo_path` | `sweep_orphans` |
| Chat session soft-deleted (purged after 30 days) | `chat-attachments/{hh}/{session}/**` | `sweep_orphans` |
| Export expires | `exports/...` | `export-pdf` action `purge_expired` (hourly cron) |
| Account erased | Every object under each household the user owned, `avatars/users/{id}`, `exports/account/{id}` | `account-delete` (synchronously, before deleting `auth.users`) |

`sweep_orphans` lists objects per bucket prefix in pages of 1000 and deletes those whose owning row no longer exists. Objects must be removed through the Storage API (`storage.from(bucket).remove()`), never by deleting from `storage.objects`, so the underlying files are actually freed.

### 6.4 Migration: buckets and policies

```sql
-- supabase/migrations/20261001001500_storage.sql

-- Addition beyond 00-foundations: safe extraction of the household id from an object name
create or replace function public.path_household_id(p_name text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', 1)::uuid
  end;
$$;

create or replace function public.path_segment_uuid(p_name text, p_index integer)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when split_part(p_name, '/', p_index) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(p_name, '/', p_index)::uuid
  end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars',          'avatars',          false,  2097152, array['image/webp','image/jpeg','image/png']),
  ('meal-photos',      'meal-photos',      false,  8388608, array['image/jpeg','image/webp','image/heic']),
  ('chat-attachments', 'chat-attachments', false, 10485760, array['image/jpeg','image/webp','image/heic','audio/m4a','audio/mp4','audio/aac','audio/webm']),
  ('exports',          'exports',          false, 26214400, array['application/pdf','application/zip','application/json']),
  ('recipe-images',    'recipe-images',    true,   4194304, array['image/webp','image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- avatars ---------------------------------------------------------------------------------
create policy avatars_select on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (
    public.is_household_member(public.path_household_id(name))
    or (split_part(name, '/', 1) = 'users'
        and (public.path_segment_uuid(name, 2) = auth.uid()
             or public.shares_household_with(public.path_segment_uuid(name, 2))))
  ));
create policy avatars_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (
    (public.can_edit_household(public.path_household_id(name)) and split_part(name, '/', 2) = 'members')
    or (split_part(name, '/', 1) = 'users' and public.path_segment_uuid(name, 2) = auth.uid())
  ));
create policy avatars_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (
    public.can_edit_household(public.path_household_id(name))
    or (split_part(name, '/', 1) = 'users' and public.path_segment_uuid(name, 2) = auth.uid())
  ));
create policy avatars_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (
    public.can_edit_household(public.path_household_id(name))
    or (split_part(name, '/', 1) = 'users' and public.path_segment_uuid(name, 2) = auth.uid())
  ));

-- meal-photos ------------------------------------------------------------------------------
create policy meal_photos_select on storage.objects for select to authenticated
  using (bucket_id = 'meal-photos' and public.is_household_member(public.path_household_id(name)));
create policy meal_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'meal-photos' and (
    public.can_edit_household(public.path_household_id(name))
    or (public.is_household_member(public.path_household_id(name))
        and public.is_linked_member(public.path_segment_uuid(name, 2)))   -- self-logging teen/adult
  ));
create policy meal_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'meal-photos' and (
    public.can_edit_household(public.path_household_id(name))
    or public.is_linked_member(public.path_segment_uuid(name, 2))
  ));
-- no update policy: photos are immutable; re-upload under a new meal_log id

-- chat-attachments: private to the session owner ------------------------------------------
create policy chat_attachments_select on storage.objects for select to authenticated
  using (bucket_id = 'chat-attachments' and exists (
    select 1 from public.chat_sessions s
    where s.id = public.path_segment_uuid(name, 2)
      and s.household_id = public.path_household_id(name)
      and s.user_id = auth.uid()));
create policy chat_attachments_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-attachments' and exists (
    select 1 from public.chat_sessions s
    where s.id = public.path_segment_uuid(name, 2)
      and s.household_id = public.path_household_id(name)
      and s.user_id = auth.uid()
      and s.deleted_at is null));
create policy chat_attachments_delete on storage.objects for delete to authenticated
  using (bucket_id = 'chat-attachments' and exists (
    select 1 from public.chat_sessions s
    where s.id = public.path_segment_uuid(name, 2) and s.user_id = auth.uid()));

-- exports: read-only for clients; written by service role --------------------------------
create policy exports_select on storage.objects for select to authenticated
  using (bucket_id = 'exports' and (
    public.can_edit_household(public.path_household_id(name))
    or (split_part(name, '/', 1) = 'account' and public.path_segment_uuid(name, 2) = auth.uid())
  ));

-- recipe-images: public bucket (reads bypass policies via the public URL); admin writes only
create policy recipe_images_admin_write on storage.objects for all to authenticated
  using (bucket_id = 'recipe-images' and public.is_admin())
  with check (bucket_id = 'recipe-images' and public.is_admin() and split_part(name, '/', 1) = 'catalog');

-- Daily orphan sweep (account-delete, action sweep_orphans). Complements the jobs in 05 / 0014.
select cron.schedule('storage-orphan-sweep', '30 20 * * *',     -- 01:30 PKT
  $$select private.invoke_edge_function('account-delete', '{"action":"sweep_orphans"}'::jsonb)$$);
```

`storage.objects` already has RLS enabled by Supabase. Note that the Storage API needs `select` permission for upserts and for `insert ... returning`, which is why each bucket that clients write to also has a `select` policy covering the same paths.

### 6.5 Migration 0016b: `voice-notes` bucket

Addition from `12-ai-agent-architecture.md` section 21, consolidated with the other schema additions in `05-database-schema.md` section 22. The client uploads a voice note to `voice-notes/{household_id}/{uuid}.m4a`, calls `ai-transcribe`, and the function deletes the object after transcription. Objects older than 24 hours are also removed by `account-delete` action `sweep_orphans` (daily cron above).

| Bucket | Public | Size limit | Allowed MIME types | Written by | Read by |
|---|---|---|---|---|---|
| `voice-notes` | No | 5 MiB | `audio/m4a`, `audio/mp4`, `audio/aac`, `audio/webm` | Premium household members | The uploader; `ai-transcribe` (service) |

```sql
-- supabase/migrations/20261001001650_storage_voice_notes.sql   (0016b)
-- Transient audio for ai-transcribe (12-ai-agent-architecture.md section 15). Path: {household_id}/{uuid}.m4a
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('voice-notes', 'voice-notes', false, 5242880, array['audio/m4a','audio/mp4','audio/aac','audio/webm'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Voice is a premium AI feature (per-user entitlement, 00-foundations section 11). Only the uploader can
-- read or delete the object; ai-transcribe reads with the service role and deletes it after transcription.
create policy voice_notes_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'voice-notes'
              and public.is_household_member(public.path_household_id(name))
              and public.has_premium(auth.uid()));
create policy voice_notes_select_own on storage.objects for select to authenticated
  using (bucket_id = 'voice-notes' and owner_id = auth.uid()::text);
create policy voice_notes_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'voice-notes' and owner_id = auth.uid()::text);
```

## 7. Realtime

### 7.1 What uses Realtime

Realtime is used only where another person or a background job changes data the user is looking at. Everything else relies on React Query refetch-on-focus (`09-state-management.md`).

| Channel | Type | Filter | Consumer | Why |
|---|---|---|---|---|
| `plan:{meal_plan_id}` | Postgres changes on `meal_plans` (UPDATE) | `id=eq.{meal_plan_id}` | Plan screen, plan-generation progress | `ai-generate-plan/worker` processes the pgmq `plan_generation` queue and writes `generation_progress`; status flips `generating` → `active` or `failed`. Household-wide plan list freshness comes from `use-household-realtime.ts` (`09-state-management.md`). |
| `today:{household_id}` | Postgres changes on `daily_meal_servings` (INSERT, UPDATE) | `household_id=eq.{id}` | Today screen | Two caregivers logging the same family meal see each other's ticks. |
| `grocery:{grocery_list_id}` | Postgres changes on `shopping_items` (*) | `grocery_list_id=eq.{id}` | Shopping mode | Shared list while one parent shops and the other adds items. |
| `grocery-presence:{grocery_list_id}` | Presence | private channel | Shopping mode | "Ayesha is shopping now" indicator. |
| `inbox:{user_id}` | Postgres changes on `notifications` (INSERT) | `user_id=eq.{uid}` | In-app inbox badge | |
| `exports:{user_id}` | Postgres changes on `exports` (UPDATE) | `user_id=eq.{uid}` | Export sheet | `rendering` → `ready`, then open the signed URL. |

Not on Realtime: chat (streamed over SSE from `ai-chat`), hydration and fasting logs (single-user, written by the same device), analytics.

Postgres-changes delivery respects RLS: Realtime checks the subscriber's JWT against the table's `select` policy for every change, so household isolation needs no extra work. Keep the published set small; each published table adds per-change RLS evaluation.

### 7.2 Client usage

```ts
// apps/mobile/src/features/plans/hooks/use-plan-status-channel.ts
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { planKeys } from '@/features/plans/api/query-keys';

export function usePlanStatusChannel(householdId: string, mealPlanId: string): void {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel(`plan:${mealPlanId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'meal_plans', filter: `id=eq.${mealPlanId}` },
        (payload) => {
          qc.invalidateQueries({ queryKey: planKeys.byHousehold(householdId) });
          if (payload.new && (payload.new as { status?: string }).status === 'active') {
            qc.invalidateQueries({ queryKey: planKeys.today(householdId) });
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [householdId, mealPlanId, qc]);
}
```

### 7.3 Migration: publication and private channel authorization

```sql
-- supabase/migrations/20261001001600_realtime.sql
alter publication supabase_realtime add table
  public.meal_plans,
  public.daily_meal_servings,
  public.shopping_items,
  public.notifications,
  public.exports;

-- Private channels (presence/broadcast) are authorized by RLS on realtime.messages.
-- Topic convention: 'grocery-presence:{grocery_list_id}'.
create policy grocery_presence_read on realtime.messages for select to authenticated
  using (
    realtime.messages.extension in ('presence','broadcast')
    and split_part(realtime.topic(), ':', 1) = 'grocery-presence'
    and exists (
      select 1 from public.grocery_lists gl
      where gl.id = public.path_segment_uuid(replace(realtime.topic(), ':', '/'), 2)
        and public.is_household_member(gl.household_id))
  );
create policy grocery_presence_write on realtime.messages for insert to authenticated
  with check (
    realtime.messages.extension in ('presence','broadcast')
    and split_part(realtime.topic(), ':', 1) = 'grocery-presence'
    and exists (
      select 1 from public.grocery_lists gl
      where gl.id = public.path_segment_uuid(replace(realtime.topic(), ':', '/'), 2)
        and public.is_household_member(gl.household_id))
  );
```

The client joins with `supabase.channel('grocery-presence:<id>', { config: { private: true, presence: { key: userId } } })`. "Allow public access" for Realtime is switched off in project settings for staging and prod so only private channels are accepted.

## 8. Scheduled jobs (pg_cron)

SQL for every job is in `05-database-schema.md` migration 0014, except `storage-orphan-sweep` (section 6.4 above). All schedules are UTC; Pakistan Standard Time is UTC+5.

| Job | Schedule (UTC) | PKT | Action | Owner function / SQL |
|---|---|---|---|---|
| `notifications-dispatch` | `* * * * *` | every minute | Send due `notifications` rows to OneSignal, respect quiet hours, set `sent_at` | Edge Function `notifications-dispatch` |
| `prices-refresh` | `15 0 * * *` | 05:15 | Re-moderate user price reports (outlier rejection), refresh `mv_ingredient_prices`, update `seasonal_produce.price_index` | Edge Function `prices-refresh` |
| `analytics-rollup` | `10 * * * *` | hourly | `refresh_analytics_views()`, alert if default partition non-empty | Edge Function `analytics-rollup` |
| `exports-purge-expired` | `25 * * * *` | hourly | Delete expired export files, mark rows `expired` | Edge Function `export-pdf` (`purge_expired`) |
| `storage-orphan-sweep` | `30 20 * * *` | 01:30 | Delete objects whose rows are gone | Edge Function `account-delete` (`sweep_orphans`) |
| `refresh-life-stages` | `5 19 * * *` | 00:05 | Update `family_members.life_stage` after birthdays | `private.refresh_life_stages()` |
| `ai-memories-expire` | `20 19 * * *` | 00:20 | Soft-delete expired memories | SQL |
| `soft-delete-purge` | `40 19 * * *` | 00:40 | Hard-delete rows soft-deleted more than 30 days ago | `private.purge_soft_deleted(30)` |
| `invitations-cleanup` | `50 19 * * *` | 00:50 | Remove long-expired invitations | SQL |
| `notifications-retention` | `0 20 * * 0` | Sun 01:00 | Delete sent notifications older than 180 days | SQL |
| `analytics-partitions` | `0 3 20 * *` | 20th 08:00 | Create next 3 monthly partitions | `private.ensure_analytics_partitions(3)` |
| `analytics-retention` | `30 3 1 * *` | 1st 08:30 | Drop partitions older than 13 months | `private.drop_old_analytics_partitions(13)` |
| `ai-usage-retention` | `0 21 2 * *` | 3rd 02:00 | Delete metering older than 25 months | SQL |
| `audit-retention` | `0 22 3 * *` | 4th 03:00 | Delete audit rows older than 3 years | `private.purge_audit_log(3)` |
| `cron-history-retention` | `0 23 * * *` | 04:00 | Trim `cron.job_run_details` to 14 days | SQL |

Reminder generation (meal, hydration, suhoor and iftar times) is not a cron job: Edge Functions that create plans, hydration targets and Ramadan schedules insert future `notifications` rows with `scheduled_for`, and `notifications-dispatch` sends them when due. Each dispatch run takes `pg_try_advisory_lock` so overlapping minutes never double-send, and `dedupe_key` makes inserts idempotent.

Monitoring: `analytics-rollup` also queries `cron.job_run_details` for failures in the last hour and reports them to Sentry (`thuluth-edge`, tag `cron_job`).

## 9. Edge Functions

### 9.1 Auth modes

| Mode | Gateway `verify_jwt` | In-code check | Used by |
|---|---|---|---|
| **User JWT** | `true` | `requireUser(req)` then household checks through `userClient` RLS or `can_edit_household` RPC | All user-facing functions |
| **Dual** | `false` | `requireUser(req)` for user actions, or `requireCron(req)` restricted to one maintenance action | `export-pdf`, `account-delete` |
| **Cron secret** | `false` | `requireCron(req)`: header `x-cron-secret` equals `CRON_SECRET` | `notifications-dispatch`, `prices-refresh`, `analytics-rollup` |
| **Webhook secret** | `false` | `requireWebhookSecret(req, 'REVENUECAT_WEBHOOK_AUTH')`: `Authorization: Bearer <secret>` configured in the RevenueCat dashboard | `revenuecat-webhook` |

Functions never trust a `household_id` or `user_id` from the body without checking it: `user_id` always comes from the verified JWT `sub`, and `household_id` is checked with `is_household_member` / `can_edit_household` / `can_author_plans` via `userClient(jwt).rpc(...)`.

### 9.2 Inventory

Common environment for every function (provided automatically by Supabase or set once): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_ENV` (`local|development|staging|production`), `SENTRY_DSN_EDGE`, `LOG_LEVEL`, `AI_FAKE` (local/CI only).

| Function | Method | Auth | Premium gate | Reads / writes | Function-specific secrets and env | Limits |
|---|---|---|---|---|---|---|
| `ai-chat` | POST (SSE) | User JWT | Voice/photo attachments and long-term memory premium; daily quota 20 / 200 | R: household profile, plan, `ai_memories`, verified `islamic_sources`; W: `chat_messages`, `ai_memories`, `ai_usage`, `plan_recommendations` | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` | 150 s wall clock; 30 requests/min/user |
| `ai-intake-assess` | POST | User JWT (editor) | No | R: family profile; W: `ai_assessments`, `hydration_targets`, `ai_usage` | AI keys | 60 s; 10/hour/household |
| `ai-generate-plan` | POST | User JWT (plan author) | Multi-week, non-standard kinds premium (also enforced by trigger) | W: `meal_plans` (status `generating`), enqueue to pgmq `plan_generation`; the `/worker` sub-route then writes `meal_plans.generation_progress`, `meals`, `portions`, `daily_meals`, `daily_meal_servings`, `plan_recommendations`, `notifications`, `ai_usage` | AI keys | Returns 202 within 2 s; stages processed by `ai-generate-plan/worker` from the queue (400 s cap per stage), progress over Realtime channel `plan:{id}`; 5/day/household free, 20/day premium |
| `ai-adjust-plan` | POST | User JWT (plan author) | Premium | W: new `meal_plans` version + children | AI keys | 120 s; 20/day/household |
| `ai-analyze-meal` | POST | User JWT | Premium | R: `meal-photos` object; W: `meal_logs.estimated_nutrition`, `ai_usage` | AI keys | 60 s; 30/day/user |
| `ai-transcribe` | POST | User JWT | Premium | R: `chat-attachments` object; W: `ai_usage` | `OPENAI_API_KEY`, `GEMINI_API_KEY` | 60 s; audio ≤ 2 min |
| `grocery-generate` | POST | User JWT (editor) | Budget optimization, substitutions, monthly lists premium | R: plan, `mv_ingredient_prices`, `seasonal_produce`; W: `grocery_lists`, `shopping_items` | none | 30 s |
| `growth-compute` | POST | User JWT (editor) | Percentile charts, trends and non-safety alerts premium (z-scores, latest percentile and safety alerts for faltering growth or rapid loss on every tier) | R: `growth_reference_lms`; W: `growth_tracking` computed columns, `notifications` | none | 10 s |
| `ramadan-generate` | POST | User JWT (plan author) | Premium | W: `ramadan_plans`, `meal_plans` (`kind 'ramadan'`), `notifications` | `PRAYER_TIMES_API_BASE` (default `https://api.aladhan.com/v1`) | 120 s |
| `export-pdf` | POST | Dual | Premium (all exports) | W: `exports`, `exports` bucket | `GOTENBERG_URL`, `GOTENBERG_TOKEN` (HTML is rendered by the private Gotenberg service on Cloud Run, see `18-exports-and-analytics.md`), `CRON_SECRET` | 60 s; 10/hour/user |
| `household-invite` | POST | User JWT | Inviting is free; household limits apply to members, not invitees | W: `household_invitations`, `household_members` (accept) | `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM`, `INVITE_LINK_BASE_URL` (`https://thuluth.app/invite`), `INVITE_TOKEN_PEPPER` | 20 invites/day/household; accept 10/hour/IP |
| `account-export` | POST | User JWT | No (legal right) | R: every table the user can see + own rows; W: `exports` bucket under `account/{user_id}` | `EMAIL_PROVIDER_API_KEY` | Background job, 400 s; 1/day/user |
| `account-delete` | POST | Dual | No | Deletes Storage objects, `analytics_events` rows, then `auth.admin.deleteUser` | `CRON_SECRET` | Requires a fresh OTP re-auth (`11-authentication.md`) |
| `revenuecat-webhook` | POST | Webhook secret | n/a | W: `subscriptions`, `notifications` | `REVENUECAT_WEBHOOK_AUTH`, `REVENUECAT_SECRET_API_KEY` (subscriber re-fetch on out-of-order events) | Idempotent on `last_event_id` |
| `notifications-dispatch` | POST (cron) | Cron secret | n/a | R/W: `notifications`, `notification_preferences`, `devices` | `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY`, `CRON_SECRET` | Batch of 500 per run, 50 s |
| `prices-refresh` | POST (cron) | Cron secret | n/a | W: `price_observations.moderation_status`, `seasonal_produce.price_index`; RPC `refresh_ingredient_prices()` | `CRON_SECRET` | 120 s |
| `analytics-rollup` | POST (cron) | Cron secret | n/a | RPC `refresh_analytics_views()`; R: `cron.job_run_details` via RPC | `CRON_SECRET` | 120 s |
| `promo-redeem` | POST | User JWT | No | W: `promo_redemptions`, `promo_codes`, `promo_campaigns.redeemed_count`, `subscriptions` (`store='promotional'`), `audit_log` | `REVENUECAT_SECRET_API_KEY`, `PROMO_CODE_PEPPER` | 10 s; 5 attempts/hour/user and per IP |
| `health-notes` | POST | User JWT (read: member; write: editor) | No | R/W: `*_enc` and `*_key_version` columns on `medical_conditions`, `allergies`, `nutrition_journal`, `fasting_logs`, `pregnancy_profiles`; R: `household_keys` via security definer function; W: `audit_log` | KEK in Supabase Vault (`kek_v1`), no env secret | 10 s; 120 requests/min/user |

Request and response schemas for each function are in `06-api-specification.md`; prompt and tool design for the AI functions is in `12-ai-agent-architecture.md`.

### 9.3 Function skeleton

```ts
// supabase/functions/growth-compute/index.ts
import { serve } from '../_shared/http.ts';
import { userClient, serviceClient } from '../_shared/clients.ts';
import { AppError } from '../_shared/errors.ts';
import { GrowthComputeInput, type GrowthComputeOutput } from '@thuluth/shared';
import { computeGrowthZScores } from '@thuluth/shared';

serve<typeof GrowthComputeInput, GrowthComputeOutput>(
  { auth: 'user', input: GrowthComputeInput, name: 'growth-compute' },
  async ({ ctx, input }) => {
    const db = userClient(ctx.jwt);
    const { data: row, error } = await db
      .from('growth_tracking')
      .select('id, household_id, family_member_id, measured_on, height_cm, weight_kg, head_circumference_cm, family_members(date_of_birth, sex_at_birth)')
      .eq('id', input.growthTrackingId)
      .single();
    if (error || !row) throw new AppError('NOT_FOUND', 'Measurement not found', 404);

    const { data: canEdit } = await db.rpc('can_edit_household', { p_household_id: row.household_id });
    if (!canEdit) throw new AppError('FORBIDDEN', 'You cannot update this household', 403);

    const lms = await loadLms(serviceClient(), row); // growth_reference_lms rows for sex/age window
    const result = computeGrowthZScores(row, lms);   // pure function in packages/shared, unit-tested

    await serviceClient().from('growth_tracking').update({ ...result.columns, computed_at: new Date().toISOString() }).eq('id', row.id);
    return { growthTrackingId: row.id, ...result.summary };
  },
);
```

## 10. Database roles

| Role | Who uses it | Privileges |
|---|---|---|
| `postgres` | Migrations (CI), maintainers via SQL editor in emergencies | Owns all objects in `public` and `private`; owns `security definer` functions |
| `authenticated` | Every signed-in app request through PostgREST, Storage, Realtime | DML on `public` tables gated by RLS and column grants (`05-database-schema.md` 0013); `execute` on helper RPCs |
| `anon` | Requests without a session | No table, sequence or function access in `public` (revoked in 0013). Auth endpoints still work. |
| `service_role` | Edge Functions only (`SUPABASE_SERVICE_ROLE_KEY`) | `bypassrls`; never shipped to the client, never logged |
| `supabase_auth_admin`, `supabase_storage_admin`, `supabase_realtime_admin`, `authenticator`, `pgbouncer` | Supabase internals | Managed by Supabase; we do not grant them anything beyond defaults except that the auth trigger function is `security definer` |
| `analytics_reader` (Phase 2, **Addition**) | BI tool read-only access | `select` on `mv_*` materialized views only, `login` with a rotated password, connection through the pooler, IP allowlist |
| Platform admin | Internal staff using the admin console with their own app account | Not a database role: `auth.users.raw_app_meta_data.role = 'admin'` read by `is_admin()`; can write global catalog tables through RLS; cannot read household data |

Rules:
- `security definer` functions always `set search_path = ''`, fully qualify names, and are owned by `postgres`.
- The `private` schema is not in `api.schemas`, so nothing in it is reachable over PostgREST.
- Granting a privilege to `anon` requires a security review comment in the migration.

## 11. Secrets management

| Secret class | Where it lives | Who can read | How it is set | Rotation |
|---|---|---|---|---|
| Edge Function secrets (AI keys, OneSignal, RevenueCat, email, `CRON_SECRET`, `INVITE_TOKEN_PEPPER`) | Supabase project secrets (`supabase secrets set`) | Edge runtime only | CI job `secrets-sync` reads GitHub Actions environment secrets (`dev`, `staging`, `prod`) and runs `supabase secrets set --env-file` | AI keys every 90 days or on staff change; `CRON_SECRET` every 180 days (update Vault and function secret in one CI job) |
| Database-side secrets (`project_url`, `cron_secret`, `audit_ip_salt`) | Supabase Vault (`vault.secrets`) | `security definer` functions in `private` | One-time CI step `vault-bootstrap` running `select vault.create_secret('<value>', '<name>')`; locally from `seed/local/000_local_vault.sql` | With `CRON_SECRET`; `audit_ip_salt` never (it would break hash continuity), only on compromise |
| OAuth client secrets (Google, Apple) | Supabase Auth provider settings | Supabase Auth | Dashboard / Management API from CI | Apple client secret JWT expires every 6 months: calendar reminder plus CI check that fails 30 days before expiry |
| Database passwords | 1Password vault "Thuluth Platform" + GitHub environment secret `SUPABASE_DB_PASSWORD` | Two maintainers, CI | Manual | On staff change |
| `SUPABASE_ACCESS_TOKEN` (CLI) | GitHub environment secret | CI | Personal access token of a dedicated bot account | 90 days |
| Mobile app public config (`SUPABASE_URL`, anon key, RevenueCat public SDK keys, OneSignal app id, Sentry DSN) | EAS environment variables | Public by design | `eas env:create` | On project recreation |

Never in git: `.env*` files except `*.example`; a `gitleaks` pre-commit hook and CI scan enforce it (`20-ci-cd-pipeline.md`). The service-role key never appears in the mobile app, in logs or in Sentry events; `_shared/logger.ts` redacts any header named `authorization`, `apikey` or `x-cron-secret`.

## 12. Backups and point-in-time recovery

| Environment | Mechanism | Retention | RPO | RTO |
|---|---|---|---|---|
| `thuluth-prod` | PITR add-on (WAL archiving) | 7 days | about 2 minutes | 4 hours |
| `thuluth-prod` | Supabase daily physical backups (included in Pro) | 7 days | 24 hours | 4 hours |
| `thuluth-prod` | Weekly logical dump (`supabase db dump` for schema + `pg_dump --data-only` for `public`) from CI to an encrypted, versioned object-storage bucket outside Supabase (separate cloud account) | 35 days | 7 days | 8 hours |
| `thuluth-prod` Storage (`avatars`, `meal-photos`, `chat-attachments`) | Nightly `rclone sync` via the S3-compatible Storage endpoint to the same external bucket, object versioning on | 30 days of versions | 24 hours | 8 hours |
| `thuluth-staging` | Daily backups | 7 days | 24 hours | best effort |
| `thuluth-dev`, local | None (reproducible from migrations + seeds) | n/a | n/a | n/a |

PITR does not cover Storage objects, which is why the nightly sync exists. `exports` and `recipe-images` are not synced: exports are regenerable and short-lived, recipe images are re-uploadable from the content repository.

**Restore drill:** quarterly, restore prod PITR to a new project, run the pgTAP suite and a read-only smoke test, record the elapsed time against the RTO in the runbook (`19-deployment-architecture.md`).

**Erasure versus backups:** erased accounts disappear from backups when backups age out (7 days PITR, 35 days logical). The privacy policy states this window; restores re-apply erasures from the `audit_log` `erasure` entries before the restored project serves traffic.

## 13. Local development workflow

### 13.1 Prerequisites

| Tool | Version |
|---|---|
| Docker Desktop or OrbStack | current |
| Supabase CLI | pinned in root `package.json` as a dev dependency (`supabase` npm package) and invoked as `pnpm supabase` |
| Deno | 2.x (for `deno test` and editor support) |
| Node / pnpm | per root `package.json` `engines` and `packageManager` |

### 13.2 Daily commands

```bash
# one time
cp supabase/.env.local.example supabase/.env.local       # fill AI keys or set AI_FAKE=1
pnpm install

# start the stack (Postgres, Auth, Storage, Realtime, Studio, Inbucket)
pnpm supabase start

# rebuild the database from migrations + seeds (catalog + local fixtures)
pnpm db:reset            # = supabase db reset && pnpm db:types

# generate TypeScript types for the app and functions
pnpm db:types            # = supabase gen types typescript --local --schema public > packages/shared/src/types/database.gen.ts

# serve Edge Functions with hot reload
pnpm turbo run build:deno --filter=@thuluth/shared --filter=@thuluth/ai-core
pnpm supabase functions serve --env-file supabase/.env.local

# run tests
pnpm db:test             # = supabase test db  (pgTAP, section 15)
pnpm functions:test      # = deno test --allow-env --allow-net supabase/functions

# create a new migration
pnpm supabase migration new add_meal_log_tags
# optionally draft it from Studio changes, then hand-edit
pnpm supabase db diff --local -f add_meal_log_tags
```

| Local URL | Service |
|---|---|
| `http://127.0.0.1:54321` | API gateway (PostgREST, Auth, Storage, Functions at `/functions/v1/*`) |
| `postgresql://postgres:postgres@127.0.0.1:54322/postgres` | Postgres |
| `http://127.0.0.1:54323` | Studio |
| `http://127.0.0.1:54324` | Inbucket (read OTP emails here) |

The mobile app points at the local stack with `EXPO_PUBLIC_SUPABASE_URL=http://<LAN IP>:54321` (not `127.0.0.1`, because the device or emulator is a different host; Android emulator can use `10.0.2.2`).

### 13.3 Generated types

`packages/shared/src/types/database.gen.ts` is generated, committed and never edited by hand. A thin wrapper exports friendly aliases used everywhere:

```ts
// packages/shared/src/types/db.ts
import type { Database } from './database.gen';

export type Tables<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Row'];
export type TablesInsert<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Insert'];
export type TablesUpdate<T extends keyof Database['public']['Tables']> = Database['public']['Tables'][T]['Update'];
export type Enums<T extends keyof Database['public']['Enums']> = Database['public']['Enums'][T];

export type FamilyMember = Tables<'family_members'>;
export type MealPlan = Tables<'meal_plans'>;
export type HouseholdRole = Enums<'household_role'>;
export type LifeStage = Enums<'life_stage'>;
```

CI regenerates the types against a fresh `supabase db reset` and fails if the committed file differs (`20-ci-cd-pipeline.md`).

### 13.4 Local fixtures

`seed/local/900_dev_fixtures.sql` creates, with password sign-in enabled only on the local stack for convenience:

| User | Role | Notes |
|---|---|---|
| `owner@thuluth.test` | owner | Premium subscription row (`store 'promotional'`) |
| `caregiver@thuluth.test` | caregiver | |
| `viewer@thuluth.test` | viewer | Linked to the adult family member "Nani" for self-logging tests |
| `free@thuluth.test` | owner of a second household | Free tier, used for entitlement tests |

Household "Lahore Family" (`Asia/Karachi`, PKR, region `PK-PB`): two adults, a 7-year-old son (picky eater module), a 4-year-old daughter (autism module, sensory profile, safe foods), one active weekly plan, a grocery list priced from the Lahore price book.

## 14. Seeding

| Environment | What runs | How |
|---|---|---|
| Local, CI | `seed/local/000_local_vault.sql`, `seed/catalog/*.sql`, `seed/local/900_dev_fixtures.sql` | `supabase db reset` (via `[db.seed] sql_paths`) |
| dev, staging, prod | `seed/catalog/*.sql` only | CI job `catalog-sync` runs `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -1 -f` for each file in order, after migrations |

Rules:
- Catalog seed files are idempotent (`insert ... on conflict (...) do update`), so `catalog-sync` runs on every deploy and doubles as content deployment for curated recipes, verified sources and prompts.
- Seeds run with `set app.bypass_entitlements = 'on'` at the top of fixture files only; catalog files do not need it.
- CSV sources in `seed/data/` are converted by `seed/build.ts` (`pnpm seed:build`) into the generated SQL files. CI re-runs the generator and fails on drift. WHO LMS CSVs are verified against `checksums.txt`.
- Islamic sources are inserted together with their `source_verifications` row. A source without a completed scholar review is not added to `100_islamic_sources.sql` at all (it stays in the content team's review tool; see `13-islamic-knowledge-module.md`).
- Seed content inventory, ordering and sources: `05-database-schema.md` section 19.

## 15. Database tests (pgTAP)

`supabase test db` runs every `*.test.sql` under `supabase/tests/` inside a transaction that is rolled back. Helpers:

```sql
-- supabase/tests/_helpers/000_helpers.sql
create extension if not exists pgtap with schema extensions;
create schema if not exists tests;

create or replace function tests.create_user(p_email text, p_meta jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, p_meta,
          '{"provider":"email"}'::jsonb, now(), now());
  return v_id;
end $$;

create or replace function tests.authenticate_as(p_user_id uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user_id::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function tests.clear_auth()
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'reset role';
end $$;

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;
```

Example test:

```sql
-- supabase/tests/triggers/010_entitlements.test.sql
begin;
select plan(4);

\ir ../_helpers/000_helpers.sql

select tests.create_user('free-owner@thuluth.test') as owner \gset
select tests.authenticate_as(:'owner');

insert into public.households (id, owner_user_id, name)
values ('11111111-1111-1111-1111-111111111111', :'owner', 'First');

select throws_ok(
  format($$insert into public.households (owner_user_id, name) values (%L, 'Second')$$, :'owner'),
  'P0001', 'ENTITLEMENT_HOUSEHOLD_LIMIT', 'free owner cannot create a second household');

insert into public.family_members (household_id, name)
select '11111111-1111-1111-1111-111111111111', 'Member ' || g from generate_series(1, 6) g;

select throws_ok(
  $$insert into public.family_members (household_id, name) values ('11111111-1111-1111-1111-111111111111', 'Seventh')$$,
  'P0001', 'ENTITLEMENT_MEMBER_LIMIT', 'free household is limited to 6 members');

select tests.clear_auth();
insert into public.subscriptions (user_id, tier, status, product_id, store, rc_app_user_id, current_period_end)
values (:'owner', 'premium', 'active', 'thuluth_premium_monthly', 'app_store', :'owner', now() + interval '30 days');
select tests.authenticate_as(:'owner');

select lives_ok(
  $$insert into public.family_members (household_id, name) values ('11111111-1111-1111-1111-111111111111', 'Seventh')$$,
  'premium household can add a 7th member');

select is((select family_size from public.households where id = '11111111-1111-1111-1111-111111111111'), 7::smallint,
  'family_size is maintained by trigger');

select * from finish();
rollback;
```

The full list of required assertions is in `05-database-schema.md` section 21; the overall test pyramid and CI gates are in `21-testing-strategy.md`.

## 16. Migration rules

1. **Forward-only.** Never edit a migration that has reached `thuluth-dev`. Fix forward with a new file. `supabase migration repair` is used only by a maintainer to reconcile history after an incident.
2. **Naming.** `YYYYMMDDHHMMSS_snake_case_summary.sql` via `supabase migration new`. One concern per file (a feature's tables, its RLS and its triggers may share a file; unrelated changes may not).
3. **Every new table ships with**, in the same pull request: `id`, `created_at`, `updated_at`, the `set_updated_at` trigger (the loop in 0012 only covered tables that existed then), `household_id` + composite FK if family-scoped, `deleted_at` if user-owned, `enable row level security`, explicit policies (or a `call private.apply_household_rls(...)`), audit trigger if it holds health, identity or billing data, indexes for every FK and RLS predicate, and a pgTAP test proving isolation.
4. **Enums are additive.** `alter type ... add value` goes in its own migration file, and no statement in that file may use the new value (Postgres cannot use a new enum value in the transaction that added it). Never rename or drop a value; deprecate in application code.
5. **Expand and contract** for anything destructive: add the new column or table, dual-write from Edge Functions and app, backfill, ship an app version that no longer reads the old shape, wait until that version is the minimum supported (`19-deployment-architecture.md`), then drop in a later migration. Mobile clients lag releases by weeks, so a column the current store build reads is never dropped or renamed directly.
6. **No long locks on hot tables after launch.** Adding a `not null` column uses a default; large backfills run in batches from an Edge Function or one-off script, not inside the migration. New indexes on large tables are created by the ops runbook with `create index concurrently` (which cannot run inside the migration transaction), and the migration contains `create index if not exists` with the same name so it becomes a no-op.
7. **Security review triggers.** Any change to RLS policies, `security definer` functions, grants, Storage policies or the `private` schema requires review from a second engineer and the security checklist in `16-security-architecture.md`.
8. **Types and drift.** CI runs `supabase db reset`, `supabase db lint --level warning`, `supabase test db`, regenerates `database.gen.ts` and fails on diff, then runs `supabase db diff --linked` against staging after deploy and fails if non-empty (catches dashboard edits).
9. **Data migrations** that change content (catalog, prompts, routes) belong in `seed/catalog/`, not in `migrations/`, unless they must run exactly once alongside a schema change.
10. **Rollback** is a new forward migration. For a bad deploy, prefer disabling the feature via `feature_flags` and shipping the fix; use PITR only for data loss.

## 17. Additions beyond 00-foundations

| Kind | Name | Reason |
|---|---|---|
| Migrations | `20261001001500_storage.sql`, `20261001001600_realtime.sql` | Buckets, Storage policies, Realtime publication and private-channel authorization |
| Functions | `public.path_household_id(text)`, `public.path_segment_uuid(text, int)` | Safe UUID extraction from object names and channel topics for policies |
| Cron job | `storage-orphan-sweep` | Remove Storage objects orphaned by purges (uses existing `account-delete` with action `sweep_orphans`) |
| Function actions | `export-pdf` `purge_expired`, `account-delete` `sweep_orphans` | Maintenance actions on existing functions instead of new functions |
| Database role | `analytics_reader` (Phase 2) | Read-only BI access to materialized views |
| Seed layout | `seed/catalog/`, `seed/local/`, `seed/data/`, `seed/build.ts` | Separates content seeds deployed everywhere from local fixtures |
| Package builds | `build:deno` outputs for `packages/shared` and `packages/ai-core` | Deno-compatible imports for Edge Functions |
| Vault secrets | `project_url`, `cron_secret`, `audit_ip_salt` | Cron invocation and audit IP hashing |
| Env vars | `CRON_SECRET`, `INVITE_TOKEN_PEPPER`, `INVITE_LINK_BASE_URL`, `PRAYER_TIMES_API_BASE`, `GOTENBERG_URL`, `GOTENBERG_TOKEN`, `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM`, `AI_FAKE`, `APP_ENV` | Function configuration |
