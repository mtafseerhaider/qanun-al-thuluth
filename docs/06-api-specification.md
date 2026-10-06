# 06 · API Specification

> **Status:** Draft for implementation (v1 / MVP) · **Owner:** Backend · **Deliverable:** 5. API Specification
>
> **Related:** `00-foundations.md` (canonical names, Edge Function list, tiers), `04-system-architecture.md` (request paths, sequences), `05-database-schema.md` (DDL and RLS), `10-supabase-structure.md` (function folders, config), `11-authentication.md`, `12-ai-agent-architecture.md` (prompts, tools, guardrails), `14-meal-planning-and-grocery.md`, `15-family-health-modules.md`, `16-security-architecture.md`, `17-subscription-architecture.md`, `18-exports-and-analytics.md`, `21-testing-strategy.md` (contract tests).

## Table of contents

1. [Scope and surfaces](#1-scope-and-surfaces)
2. [Conventions](#2-conventions)
   - 2.1 Base URLs · 2.2 Headers and auth · 2.3 Error envelope and codes · 2.4 Idempotency · 2.5 Pagination · 2.6 Versioning · 2.7 Rate limits and quotas · 2.8 Size limits and timeouts · 2.9 Shared Zod primitives
3. [PostgREST resource usage](#3-postgrest-resource-usage)
4. [Edge Functions](#4-edge-functions)
   - 4.1 `ai-chat` · 4.2 `ai-intake-assess` · 4.3 `ai-generate-plan` · 4.4 `ai-adjust-plan` · 4.5 `ai-analyze-meal` · 4.6 `ai-transcribe` · 4.7 `grocery-generate` · 4.8 `growth-compute` · 4.9 `ramadan-generate` · 4.10 `export-pdf` · 4.11 `household-invite` · 4.12 `account-export` · 4.13 `account-delete` · 4.14 `revenuecat-webhook` · 4.15 `notifications-dispatch` · 4.16 `prices-refresh` · 4.17 `analytics-rollup`
5. [RevenueCat webhook payload handling](#5-revenuecat-webhook-payload-handling)
6. [OneSignal outbound calls](#6-onesignal-outbound-calls)
7. [Other outbound calls](#7-other-outbound-calls)
8. [OpenAPI 3.1 skeleton](#8-openapi-31-skeleton)
9. [Additions beyond 00-foundations](#9-additions-beyond-00-foundations)

---

## 1. Scope and surfaces

| Surface | Used for | Contract source |
|---|---|---|
| Supabase Auth (`/auth/v1/*`) | Sign-in, sessions | supabase-js; see `11-authentication.md` |
| PostgREST (`/rest/v1/*`) | CRUD on household data and catalog reads, guarded by RLS | Generated types `packages/shared/src/db/database.types.ts` (`supabase gen types typescript`) |
| Storage (`/storage/v1/*`) | Photos, avatars, exports | supabase-js storage client |
| Realtime (`/realtime/v1`) | Plan generation status, shared grocery lists, export readiness | supabase-js channels |
| Edge Functions (`/functions/v1/*`) | Everything in `00-foundations.md` section 7 | Zod schemas in `packages/shared/src/contracts/` (this document) |

All Zod schemas below are the source of truth for both the app and the functions. File paths are given per function. The app imports them from `@thuluth/shared/contracts`; functions import the same files through the import map entry `"@thuluth/shared/": "../../packages/shared/src/"` in `supabase/functions/deno.json`.

## 2. Conventions

### 2.1 Base URLs

| Env | Supabase project | Base URL |
|---|---|---|
| dev | `thuluth-dev` | `https://{dev-ref}.supabase.co` |
| staging | `thuluth-staging` | `https://api.staging.thuluth.app` |
| prod | `thuluth-prod` | `https://api.thuluth.app` |
| local | `supabase start` | `http://127.0.0.1:54321` |

Functions: `{base}/functions/v1/{function-name}[/{sub-route}]`.

### 2.2 Headers and auth

| Header | Required | Value |
|---|---|---|
| `Authorization` | Yes (except webhooks and cron) | `Bearer {access_token}` from Supabase Auth (asymmetric-signed JWT, 1 h) |
| `apikey` | Yes for gateway | Publishable key (`sb_publishable_...`) |
| `Content-Type` | Yes for bodies | `application/json` (or `multipart/form-data` for `ai-transcribe`) |
| `Accept` | For `ai-chat` | `text/event-stream` |
| `X-Request-Id` | Recommended | Client UUID v4; echoed back; generated server-side if absent |
| `X-App-Version` | Yes from the app | Semver, e.g. `1.2.0` |
| `X-App-Build` | Yes from the app | Build number, e.g. `142` |
| `X-Platform` | Yes from the app | `ios` or `android` |
| `X-Api-Version` | Optional | Date version, default `2026-10-01` (2.6) |
| `Accept-Language` | Optional | `en` or `ur`; falls back to `users.locale` |
| `Idempotency-Key` | Required where marked | Client UUID v4 (2.4) |
| `x-region` | Yes from the app for functions | `eu-central-1` (pins the function to the DB region) |
| `x-internal-secret` | Internal only | Cron and worker calls |

Authentication in functions (`supabase/functions/_shared/auth.ts`):

```ts
export type Caller =
  | { kind: 'user'; userId: string; jwt: string; aal: 'aal1' | 'aal2' }
  | { kind: 'internal' }
  | { kind: 'webhook'; source: 'revenuecat' };

export async function requireUser(req: Request): Promise<Extract<Caller, { kind: 'user' }>>;   // getClaims() via JWKS, throws UNAUTHENTICATED
export function requireInternal(req: Request): Extract<Caller, { kind: 'internal' }>;          // constant-time compare with INTERNAL_CRON_SECRET
export function requireRevenueCat(req: Request): Extract<Caller, { kind: 'webhook' }>;         // constant-time compare with REVENUECAT_WEBHOOK_SECRET
```

Every function creates two clients: `userClient` (publishable key + caller JWT, so RLS applies) for reads that must respect membership, and `adminClient` (secret key) for writes after all checks pass. Writes with `adminClient` always set `household_id` explicitly and are covered by contract tests that assert cross-household isolation.

### 2.3 Error envelope and codes

All non-2xx JSON responses use the envelope from `00-foundations.md`:

```json
{
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "You have used today's 20 free messages. They reset at midnight.",
    "details": { "request_id": "6c1f0f1e-6a3b-4f61-9a39-3d2f3a0c8f11", "limit": 20, "reset_at": "2026-10-06T19:00:00Z" }
  }
}
```

`details.request_id` is always present. `message` is localized by `Accept-Language` and is safe to show; the app may override it with its own i18n key `errors.{code}`.

```ts
// packages/shared/src/contracts/errors.ts
import { z } from 'zod';

export const ErrorCode = z.enum([
  'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'VALIDATION_FAILED', 'CONFLICT',
  'IDEMPOTENCY_KEY_REUSED', 'IDEMPOTENCY_IN_PROGRESS',
  'PREMIUM_REQUIRED', 'QUOTA_EXCEEDED', 'RATE_LIMITED', 'LIMIT_REACHED',
  'CONSENT_REQUIRED', 'UPGRADE_REQUIRED', 'FEATURE_DISABLED',
  'SAFETY_ESCALATION',
  'AI_UNAVAILABLE', 'AI_TIMEOUT', 'AI_OUTPUT_INVALID',
  'UPSTREAM_UNAVAILABLE', 'PAYLOAD_TOO_LARGE', 'UNSUPPORTED_MEDIA_TYPE',
  'PLAN_NOT_ADJUSTABLE', 'PLAN_ALREADY_ACTIVE',
  'INVITE_INVALID', 'INVITE_EXPIRED', 'INVITE_EMAIL_MISMATCH', 'ALREADY_MEMBER',
  'OWNERSHIP_TRANSFER_REQUIRED', 'ACCOUNT_DELETION_PENDING',
  'PRAYER_TIMES_UNAVAILABLE', 'GROWTH_REFERENCE_OUT_OF_RANGE', 'EXPORT_KIND_UNSUPPORTED',
  'WEBHOOK_UNAUTHORIZED', 'INTERNAL',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorEnvelope = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.record(z.unknown()).default({}),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;
```

| Code | HTTP | Retryable | Meaning / typical details |
|---|---|---|---|
| `UNAUTHENTICATED` | 401 | After refresh | Missing, invalid or expired JWT |
| `FORBIDDEN` | 403 | No | Not a member of the household or role too low (viewer writing) |
| `NOT_FOUND` | 404 | No | Entity missing or invisible under RLS |
| `VALIDATION_FAILED` | 400 | No | `details.issues` = Zod `issues` array (path, message) |
| `CONFLICT` | 409 | Refetch | State precondition failed, `details.current_status` |
| `IDEMPOTENCY_KEY_REUSED` | 422 | No | Same key, different request hash |
| `IDEMPOTENCY_IN_PROGRESS` | 409 | Yes, after `Retry-After` | First request with this key still running |
| `PREMIUM_REQUIRED` | 402 | No | `details.feature`, `details.pending_confirmation` (purchase not yet confirmed) |
| `QUOTA_EXCEEDED` | 429 | After `reset_at` | Daily quota (chat messages, plans) |
| `RATE_LIMITED` | 429 | After `Retry-After` | Burst limit |
| `LIMIT_REACHED` | 409 | No | Tier count limit (`details.resource`: `households` or `family_members`) |
| `CONSENT_REQUIRED` | 403 | After consent | `details.consents`: missing kinds |
| `UPGRADE_REQUIRED` | 426 | After update | App below `app.min_supported_version` |
| `FEATURE_DISABLED` | 503 | Later | Kill switch flag off (`details.flag`) |
| `SAFETY_ESCALATION` | 422 | No | Red flag; `details.escalation` (see 2.9 `Escalation`) |
| `AI_UNAVAILABLE` | 503 | Yes | All routes failed |
| `AI_TIMEOUT` | 504 | Yes | Route timeouts exhausted |
| `AI_OUTPUT_INVALID` | 502 | Yes | Structured output failed validation on every route |
| `UPSTREAM_UNAVAILABLE` | 503 | Yes | Third party (Aladhan, Gotenberg, RevenueCat, Postmark) failed |
| `PAYLOAD_TOO_LARGE` | 413 | No | Body or file over limit |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | No | Wrong mime |
| `PLAN_NOT_ADJUSTABLE` | 409 | No | Plan status not in (`draft`, `active`) |
| `PLAN_ALREADY_ACTIVE` | 409 | No | Free tier already has an active plan |
| `INVITE_INVALID` / `INVITE_EXPIRED` / `INVITE_EMAIL_MISMATCH` / `ALREADY_MEMBER` | 400 / 410 / 403 / 409 | No | Invitation acceptance |
| `OWNERSHIP_TRANSFER_REQUIRED` | 409 | No | Account owns a household with other caregivers |
| `ACCOUNT_DELETION_PENDING` | 409 | No | Action blocked during erasure grace |
| `PRAYER_TIMES_UNAVAILABLE` | 503 | Yes | Aladhan and local computation both failed |
| `GROWTH_REFERENCE_OUT_OF_RANGE` | 422 | No | Age outside reference tables |
| `EXPORT_KIND_UNSUPPORTED` | 400 | No | Kind not available in this release |
| `WEBHOOK_UNAUTHORIZED` | 401 | No | Bad webhook secret |
| `INTERNAL` | 500 | Yes | Unexpected; reported to Sentry |

Database-originated errors are mapped in `_shared/errors.ts`: trigger exceptions with message prefix `LIMIT_REACHED:` map to `LIMIT_REACHED`; RLS violations (`42501`) map to `FORBIDDEN`; unique violations (`23505`) map to `CONFLICT`.

### 2.4 Idempotency

Functions marked **Idempotent: required** reject requests without `Idempotency-Key` (`VALIDATION_FAILED`). The key is scoped to (user, function). The server stores the SHA-256 of the canonical JSON body; the same key with a different body returns `IDEMPOTENCY_KEY_REUSED`. A completed request with the same key replays the stored status code and body with header `Idempotent-Replayed: true`. Keys expire after 24 h (RevenueCat event ids after 30 days).

```sql
-- Addition beyond 00-foundations
create table public.idempotency_keys (
  id            uuid primary key default gen_random_uuid(),
  scope         text not null,                 -- function name, or 'revenuecat'
  user_id       uuid references public.users(id) on delete cascade,  -- null for webhooks
  key           text not null,
  request_hash  text not null,
  status        text not null check (status in ('in_progress','completed','failed')),
  response_code smallint,
  response_body jsonb,
  expires_at    timestamptz not null default now() + interval '24 hours',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index idempotency_keys_scope_user_key on public.idempotency_keys (scope, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
alter table public.idempotency_keys enable row level security;   -- no policies: service role only
```

`in_progress` rows older than 5 minutes are treated as abandoned and may be taken over by a retry.

### 2.5 Pagination

- **PostgREST lists**: keyset pagination on a stable sort, never offset for user logs. Pattern: `.order('logged_at', { ascending: false }).order('id', { ascending: false }).lt('logged_at', cursor).limit(50)`. Use `range()` only for small bounded catalog pages with `count: 'estimated'`.
- **Edge Function lists** (none in MVP return unbounded lists): when needed they accept `{ cursor?: string; limit?: number (1..100, default 25) }` and return `{ items: T[]; next_cursor: string | null }` where the cursor is an opaque base64url of the last sort key.

### 2.6 Versioning

- Functions keep stable names from `00-foundations.md`. The contract version is a date sent in `X-Api-Version` (default `2026-10-01`, the MVP baseline).
- **Additive changes** (new optional request fields, new response fields, new SSE event types, new enum values) do not bump the version. Clients must ignore unknown fields and unknown SSE events (Zod schemas use `.passthrough()` on responses in the app).
- **Breaking changes** add a new date version. The function branches on `X-Api-Version` for at least two store release cycles (about 8 weeks) and logs usage of the old version. If a contract must change so much that branching is unreasonable, a new function `{name}-v2` is created (documented as an addition at that time).
- `app.min_supported_version` in `feature_flags` forces old binaries to upgrade (`UPGRADE_REQUIRED`, the app shows a blocking update screen).

### 2.7 Rate limits and quotas

Two mechanisms:
1. **Daily quotas** from tier entitlements (`00-foundations.md` section 8), counted from source tables in the user's time zone (`users.timezone`), reset at local midnight. Response `QUOTA_EXCEEDED` with `details.limit`, `details.reset_at`.
2. **Burst limits** via a token-bucket-like fixed window in Postgres. Response `RATE_LIMITED` with `Retry-After`.

All responses from limited functions carry `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` (seconds) for the burst window, plus `X-Quota-Limit`, `X-Quota-Remaining` for daily quotas where applicable.

| Function | Free daily quota | Premium daily quota | Burst (per user) |
|---|---|---|---|
| `ai-chat` | 20 user messages, text only | 200 user messages (fair use) | Free 6/min, Premium 20/min |
| `ai-intake-assess` | 5 | 10 | 2/min |
| `ai-generate-plan` | 3 (template personalization, 1 week) | 10 | 1/min |
| `ai-adjust-plan` | Not available (`PREMIUM_REQUIRED`) | 20 | 3/min |
| `ai-analyze-meal` | Not available | 30 | 5/min |
| `ai-transcribe` | Not available | 60 | 10/min |
| `grocery-generate` | 10 (basic) | 30 | 3/min |
| `growth-compute` | 60 | 60 | 10/min |
| `ramadan-generate` | Not available | 5 | 1/min |
| `export-pdf` | Not available | 30 | 5/min |
| `household-invite` | 20 | 50 | 5/min |
| `account-export` | 2 | 2 | 1/min |
| `account-delete` | 5 | 5 | 2/min |
| PostgREST (all) | Not quota limited | | Supabase defaults plus Auth rate limits; abusive clients blocked by IP at gateway |

Per-IP limits on unauthenticated paths (Auth OTP) are configured in Supabase Auth settings: 30 OTP emails per hour per project-level IP bucket default, tuned in `11-authentication.md`.

```sql
-- Addition beyond 00-foundations
create unlogged table public.rate_limit_buckets (
  bucket_key   text primary key,         -- e.g. 'ai-chat:{user_id}:min'
  window_start timestamptz not null,
  count        integer not null
);

create or replace function public.consume_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns table (allowed boolean, remaining int, reset_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_now timestamptz := now();
  v_window_start timestamptz := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);
  v_count int;
begin
  insert into rate_limit_buckets as b (bucket_key, window_start, count)
  values (p_key, v_window_start, 1)
  on conflict (bucket_key) do update
    set count = case when b.window_start = excluded.window_start then b.count + 1 else 1 end,
        window_start = excluded.window_start
  returning b.count into v_count;
  return query select v_count <= p_limit, greatest(p_limit - v_count, 0), v_window_start + make_interval(secs => p_window_seconds);
end $$;
revoke all on function public.consume_rate_limit(text, int, int) from public, anon, authenticated;
```

### 2.8 Size limits and timeouts

| Item | Limit |
|---|---|
| JSON request body | 256 KB (functions reject larger with `PAYLOAD_TOO_LARGE`) |
| Chat message text | 4,000 characters |
| Meal photo upload | 4 MB after client resize (max 1280 px long edge) |
| Voice note | 5 MB, 120 s, `audio/m4a`, `audio/mp4`, `audio/aac`, `audio/mpeg`, `audio/webm` |
| Synchronous function soft deadline | 20 s, then switch to async (202) where supported |
| SSE idle | Server sends `: ping` comment every 15 s; client aborts after 45 s of silence |
| Edge Function wall clock | Platform limit (currently 150 s free, 400 s paid); workers self-reschedule before 280 s |

### 2.9 Shared Zod primitives

```ts
// packages/shared/src/contracts/common.ts
import { z } from 'zod';

export const Uuid = z.string().uuid();
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
export const IsoInstant = z.string().datetime({ offset: true });
export const Locale = z.enum(['en', 'ur']);                          // Phase 2 adds 'ar', ...
export const CurrencyCode = z.string().length(3).regex(/^[A-Z]{3}$/);
export const Money = z.object({ amount_minor: z.number().int(), currency: CurrencyCode });

// Canonical enums mirrored from 00-foundations section 5
export const MealType = z.enum(['suhoor', 'breakfast', 'lunch', 'snack', 'dinner', 'iftar']);
export const MealStatus = z.enum(['planned', 'eaten', 'partly_eaten', 'skipped', 'swapped']);
export const PlanStatus = z.enum(['draft', 'generating', 'active', 'completed', 'archived', 'failed']);
export const PlanKind = z.enum(['standard', 'ramadan', 'growth', 'weight_management', 'custom']);
export const HouseholdRole = z.enum(['owner', 'caregiver', 'viewer', 'coach']);
export const SourceTradition = z.enum(['shared', 'sunni', 'shia']);
export const SourceKind = z.enum(['quran', 'hadith', 'imam_narration', 'scholarly']);
export const EvidenceGradeHadith = z.enum(['sahih', 'hasan', 'daif', 'mawdu', 'sahih_shia', 'muwaththaq', 'hasan_shia', 'daif_shia', 'ungraded']);
export const EvidenceGradeScience = z.enum(['high', 'moderate', 'low', 'very_low', 'expert_opinion']);
export const FastKind = z.enum(['ramadan', 'sunnah_monday_thursday', 'ayyam_al_bid', 'arafah', 'ashura', 'qada', 'nafl', 'intermittent']);
export const Texture = z.enum(['smooth', 'soft', 'crunchy', 'chewy', 'crispy', 'mixed', 'lumpy', 'wet', 'dry']);
export const ExportKind = z.enum(['meal_plan', 'grocery_list', 'nutrition_report', 'growth_report', 'ramadan_pack', 'family_summary']);

export const PlateSplit = z.object({
  veg_fruit: z.number().min(0).max(1),
  protein: z.number().min(0).max(1),
  carb: z.number().min(0).max(1),
});

export const NutritionEstimate = z.object({
  kcal: z.number().nonnegative(),
  protein_g: z.number().nonnegative(),
  carbs_g: z.number().nonnegative(),
  fiber_g: z.number().nonnegative(),
  sugar_g: z.number().nonnegative().optional(),
  fat_g: z.number().nonnegative(),
  sat_fat_g: z.number().nonnegative().optional(),
  sodium_mg: z.number().nonnegative().optional(),
  iron_mg: z.number().nonnegative().optional(),
  calcium_mg: z.number().nonnegative().optional(),
});

// Red-flag escalation payload (00-foundations section 10.2)
export const EscalationReason = z.enum([
  'eating_disorder_signals', 'rapid_child_weight_loss', 'faltering_growth', 'dehydration_signs',
  'pregnancy_complication', 'severe_allergy_reaction', 'insulin_or_sulfonylurea_fasting', 'other_clinical',
]);
export const Escalation = z.object({
  reason: EscalationReason,
  family_member_id: Uuid.nullable(),
  message: z.string(),                        // localized, from prompt_templates key safety.escalation.{reason}
  recommend: z.enum(['see_gp', 'see_pediatrician', 'see_dietitian', 'urgent_care', 'emergency']),
});

export const Citation = z.object({
  kind: z.enum(['islamic_source', 'scientific_evidence', 'recommendation']),
  ref_id: Uuid,                               // islamic_sources.id | scientific_evidence.id | recommendations.id
  label: z.string(),                          // e.g. "Tirmidhi 2380" or "WHO 2023 guideline"
  tradition: SourceTradition.optional(),
  hadith_grade: EvidenceGradeHadith.optional(),
  science_grade: EvidenceGradeScience.optional(),
});

export const AsyncAccepted = z.object({
  status: z.literal('accepted'),
  poll_after_ms: z.number().int().positive(),
  realtime: z.object({ schema: z.literal('public'), table: z.string(), filter: z.string() }),
});
```

## 3. PostgREST resource usage

RLS baseline (full policies in `05-database-schema.md`):
- **Household-scoped tables**: `select` requires `is_household_member(household_id)` and `deleted_at is null`; `insert`/`update` require role `owner` or `caregiver` (helper defined in `05-database-schema.md`); `viewer` is read-only; hard `delete` is not granted to `authenticated` (soft delete via `update set deleted_at = now()`).
- **User-scoped tables** (`users`, `notification_preferences`, `devices`, `consents`, `subscriptions`): `user_id = auth.uid()` (or `id = auth.uid()`); `subscriptions` is read-only to users.
- **Global catalog and knowledge tables**: `select` for `authenticated`; Islamic and evidence tables additionally filter `verification_status = 'verified'` through views or policies; writes only by service role / admin.
- **Server-only tables** (`ai_usage`, `ai_model_routes`, `prompt_templates`, `audit_log`, `idempotency_keys`, `rate_limit_buckets`, `prayer_times_cache`): no `authenticated` grants except where noted.

All examples use the typed client `supabase: SupabaseClient<Database>`.

### 3.1 Identity and tenancy

| Table | Client ops | RLS expectation |
|---|---|---|
| `users` | select / update own row | `id = auth.uid()`; insert only by `handle_new_user()` trigger |
| `households` | select, insert (owner), update (owner/caregiver), soft delete (owner) | Member read; insert trigger enforces tier household count and inserts the owner into `household_members` |
| `household_members` | select; update role and delete by owner | Member read; owner manages; insert only via `household-invite` |
| `household_invitations` | select (owner/caregiver) | Inserted and accepted only via `household-invite` |
| `family_members` | full CRUD (soft delete) | Member read, owner/caregiver write; tier member-count trigger |

```ts
// Households I belong to, with my role
const { data } = await supabase
  .from('household_members')
  .select('role, household:households(id, name, country_code, city, timezone, currency, family_size)')
  .eq('user_id', userId);

// Add a family member (client uuid for idempotent retry)
const { error } = await supabase.from('family_members').upsert({
  id: crypto.randomUUID(), household_id: hh, name: 'Aisha', date_of_birth: '2017-03-14',
  sex_at_birth: 'female', height_cm: 132.0, weight_kg: 27.5, activity_level: 'active',
  life_stage: 'child', special_modules: ['picky_eater'],
}, { onConflict: 'id', ignoreDuplicates: true });
// error.code 'P0001' with message 'LIMIT_REACHED:family_members' -> show upgrade sheet
```

### 3.2 Health profile

Tables: `medical_conditions`, `allergies`, `medications`, `supplements`, `food_preferences`, `food_dislikes`, `nutrition_goals`, `pregnancy_profiles`, `sensory_profiles`. All carry `household_id` + `family_member_id`. Member read, owner/caregiver write. A trigger rejects `nutrition_goals.goal_type = 'weight_loss'` when the member is under 18 (`P0001 CHILD_RULE:weight_loss`), mapped to `VALIDATION_FAILED` with `details.rule = 'no_weight_loss_under_18'`.

```ts
// Full health profile for one member in one round trip
const { data } = await supabase
  .from('family_members')
  .select(`
    id, name, date_of_birth, sex_at_birth, life_stage, special_modules,
    allergies(id, kind, severity, reaction_notes, allergen:allergens(code, name_i18n)),
    medical_conditions(id, condition_code, label),
    medications(id, name, dose, frequency, food_interaction_flags),
    food_dislikes(id, label, reason),
    food_preferences(id, label, strength, is_safe_food),
    sensory_profiles(texture_likes, texture_avoids, color_sensitivities, presentation_prefs, brand_rigidity),
    nutrition_goals(id, goal_type, is_primary, target_date)
  `)
  .eq('id', memberId)
  .eq('household_id', hh)
  .is('deleted_at', null)
  .single();
```

### 3.3 Plans and daily meals

| Table | Client ops | Notes |
|---|---|---|
| `meal_plans` | select; update `status` only via RPC `activate_meal_plan`; soft delete drafts | Created by `ai-generate-plan`, `ai-adjust-plan`, `ramadan-generate` only |
| `daily_meals` | select; update `scheduled_time`, `notes` | Rows created by functions |
| `daily_meal_servings` | select; update `status`, `acceptance`, `logged_at`, `adapted_meal_id` | Offline-capable (field-level LWW) |
| `plan_recommendations` | select | Written by functions |

```ts
// Today screen
const { data } = await supabase
  .from('daily_meals')
  .select(`
    id, plan_date, meal_type, scheduled_time, notes,
    meal:meals(id, title, plate_split),
    servings:daily_meal_servings(id, family_member_id, status, acceptance, adaptation, adapted_meal_id, updated_at,
      portion:portions(household_measure, grams))
  `)
  .eq('household_id', hh)
  .eq('plan_date', today)          // household local date
  .is('deleted_at', null)
  .order('scheduled_time');

// Mark eaten with optimistic concurrency
await supabase.from('daily_meal_servings')
  .update({ status: 'eaten', acceptance: '5_ate_well', logged_at: new Date().toISOString() })
  .eq('id', servingId).eq('updated_at', knownUpdatedAt)
  .select('id, updated_at');

// Accept a draft plan (archives the previous active plan atomically)
await supabase.rpc('activate_meal_plan', { p_meal_plan_id: planId });
```

```sql
-- Addition beyond 00-foundations: activation RPC (security invoker, RLS applies)
create or replace function public.activate_meal_plan(p_meal_plan_id uuid)
returns public.meal_plans language plpgsql security invoker as $$
declare v_plan public.meal_plans;
begin
  select * into v_plan from meal_plans where id = p_meal_plan_id and deleted_at is null for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  if v_plan.status <> 'draft' then raise exception 'CONFLICT:status=%', v_plan.status using errcode = 'P0001'; end if;
  update meal_plans set status = 'archived'
   where household_id = v_plan.household_id and status = 'active' and kind = v_plan.kind and id <> v_plan.id;
  update meal_plans set status = 'active' where id = v_plan.id returning * into v_plan;
  return v_plan;
end $$;
```

### 3.4 Tracking

Tables: `meal_logs`, `hydration_targets` (read; written by `ai-intake-assess`), `hydration_logs`, `fasting_logs`, `growth_tracking` (insert raw, computed by `growth-compute`), `weight_tracking`, `nutrition_journal`, `food_exposures`, `exposure_ladders`, `exposure_ladder_steps`. Member read, owner/caregiver write. A user with a `linked_user_id` family member may write their own logs even as `viewer` (policy: `family_members.linked_user_id = auth.uid()`).

```ts
// Log water (offline-capable)
await supabase.from('hydration_logs').upsert({
  id: clientId, household_id: hh, family_member_id: memberId,
  logged_at: new Date().toISOString(), volume_ml: 250, beverage: 'water', timing: 'pre_meal',
}, { onConflict: 'id', ignoreDuplicates: true });

// Today's hydration total per member (small result, aggregated client-side)
const { data } = await supabase.from('hydration_logs')
  .select('family_member_id, volume_ml')
  .eq('household_id', hh)
  .gte('logged_at', dayStartUtc).lt('logged_at', dayEndUtc)
  .is('deleted_at', null);

// Exposure log history, keyset paginated
const { data: page } = await supabase.from('food_exposures')
  .select('id, exposed_on, stage, acceptance, context, ingredient:ingredients(id, name, name_i18n)')
  .eq('family_member_id', memberId).eq('household_id', hh)
  .lt('exposed_on', cursor ?? '9999-12-31')
  .order('exposed_on', { ascending: false }).order('id', { ascending: false })
  .limit(30);
```

### 3.5 Grocery and budget

| Table | Client ops | Notes |
|---|---|---|
| `grocery_lists` | select, update `status`, soft delete; insert for ad hoc lists | Plan-based lists come from `grocery-generate` |
| `shopping_items` | full CRUD | Realtime enabled for shared shopping |
| `budget_profiles` | CRUD (owner/caregiver) | |
| `budget_entries` | CRUD | |

```ts
// Shared shopping: subscribe to item changes for one list
const channel = supabase.channel(`list:${listId}`)
  .on('postgres_changes',
      { event: '*', schema: 'public', table: 'shopping_items', filter: `grocery_list_id=eq.${listId}` },
      (payload) => queryClient.setQueryData(['shopping-items', listId], (old) => applyChange(old, payload)))
  .subscribe();

await supabase.from('shopping_items')
  .update({ is_checked: true, actual_minor: 34000 })   // PKR 340.00
  .eq('id', itemId).eq('updated_at', knownUpdatedAt).select('id, updated_at');
```

### 3.6 Food catalog (read-only)

Tables: `ingredients`, `allergens`, `ingredient_allergens`, `recipes` (only `review_status = 'verified'` visible to users), `recipe_ingredients`, `meals`, `portions`, `meal_alternatives`, `budget_categories`, `regions`, `seasonal_produce`, `price_profiles`, `price_observations` (users may `insert` with `source = 'user_report'` and `reporter_user_id = auth.uid()`).

```ts
// Recipe search (trigram index on title; filters)
const { data } = await supabase.from('recipes')
  .select('id, title, title_i18n, cuisine, prep_min, cook_min, kid_friendly, autism_friendly, cost_tier, image_path, per_serving_nutrition')
  .ilike('title', `%${q}%`)
  .contains('meal_types', ['lunch'])
  .eq('kid_friendly', true)
  .lte('cost_tier', 2)
  .order('title').range(0, 29);
```

### 3.7 Islamic knowledge and evidence (read-only)

Users read through views that only expose verified rows and honour tradition preference in the query:

```ts
const { data } = await supabase.from('islamic_sources')
  .select('id, kind, tradition, citation_text')
  .in('tradition', ['shared', userTradition])     // users.tradition_preference
  .in('id', sourceIds);
```

RLS: `select` allowed only when a `source_verifications` row with `status = 'verified'` exists (policy defined in `05-database-schema.md`). Details of presentation are in `13-islamic-knowledge-module.md`.

### 3.8 Chat (read via PostgREST, write via `ai-chat`)

```ts
const { data } = await supabase.from('chat_messages')
  .select('id, role, content, attachments, created_at, safety_flags')
  .eq('session_id', sessionId).eq('household_id', hh)
  .in('role', ['user', 'assistant'])
  .order('created_at', { ascending: false }).limit(50);
```

RLS: `chat_sessions.user_id = auth.uid()` (sessions are private to the user even within a household). `tool_calls`, `tokens_*`, `model` are excluded from client selects by column privileges (`revoke select (tool_calls, tokens_in, tokens_out, model) on chat_messages from authenticated`). Inserts by `authenticated` are not granted.

### 3.9 Platform

| Table | Client ops | RLS |
|---|---|---|
| `subscriptions` | select own | `user_id = auth.uid()`, no writes |
| `notifications` | select own, update `read_at` | `user_id = auth.uid()` |
| `notification_preferences` | CRUD own | `user_id = auth.uid()` |
| `devices` | upsert own | `user_id = auth.uid()` |
| `consents` | insert own, update `withdrawn_at` own | `user_id = auth.uid()`; no deletes |
| `analytics_events` | insert only (batched) | `user_id = auth.uid()`; `props` size check < 2 KB by trigger |
| `exports` | select own household | `is_household_member(household_id)` |
| `feature_flags` | select | all authenticated (rules must not contain secrets) |

```ts
const { data: isPremium } = await supabase.rpc('has_premium', { p_user_id: userId });
await supabase.from('analytics_events').insert(batch.map(e => ({ ...e, user_id: userId })));
```

## 4. Edge Functions

Each function lives in `supabase/functions/{name}/index.ts`, with its contract in `packages/shared/src/contracts/{name}.ts`. Every authenticated function runs the common pipeline described in `04-system-architecture.md` section 5.2 (auth, validation, version gate, consent, membership, entitlement, quota, rate limit, idempotency, kill switch). Only differences are listed per function.

Summary:

| Function | Method / path | Auth | Tier | Idempotent | Mode |
|---|---|---|---|---|---|
| `ai-chat` | POST `/ai-chat` | User | Free text, Premium voice/photo | By `client_message_id` | SSE |
| `ai-intake-assess` | POST `/ai-intake-assess` | User | All | Required | Sync |
| `ai-generate-plan` | POST `/ai-generate-plan` (+ internal `/worker`) | User / internal | Free limited, Premium full | Required | Async 202 |
| `ai-adjust-plan` | POST `/ai-adjust-plan` | User | Premium | Required | Sync or async |
| `ai-analyze-meal` | POST `/ai-analyze-meal` | User | Premium | Optional | Sync |
| `ai-transcribe` | POST `/ai-transcribe` | User | Premium | No | Sync, multipart |
| `grocery-generate` | POST `/grocery-generate` | User | Free basic, Premium optimized | Required | Sync |
| `growth-compute` | POST `/growth-compute` | User | All (details by tier) | Natural (by row id) | Sync |
| `ramadan-generate` | POST `/ramadan-generate` | User | Premium | Required | Async 202 |
| `export-pdf` | POST `/export-pdf` | User | Premium | Required | Sync, falls back to 202 |
| `household-invite` | POST `/household-invite` | User | All | Required for `create` | Sync |
| `account-export` | POST `/account-export` | User | All | Required | Async 202 |
| `account-delete` | POST `/account-delete` (+ internal `/execute`) | User (aal per `11-authentication.md`) / internal | All | Required for `request` | Sync |
| `revenuecat-webhook` | POST `/revenuecat-webhook` | Shared secret | n/a | By `event.id` | Sync |
| `notifications-dispatch` | POST `/notifications-dispatch` | Internal (cron) | n/a | By design | Sync |
| `prices-refresh` | POST `/prices-refresh` | Internal (cron) | n/a | By design | Sync |
| `analytics-rollup` | POST `/analytics-rollup` | Internal (cron) | n/a | By design | Sync |

---

### 4.1 `ai-chat`

| | |
|---|---|
| Method / path | `POST /functions/v1/ai-chat` |
| Auth | User JWT |
| Response | `200 text/event-stream` (errors before the stream starts use the JSON envelope) |
| Consents | `ai_processing`, `health_data`; `child_data` if the household has a member under 18 |
| Tier | Free: text only, 20/day. Premium: 200/day, image attachments, voice (via `ai-transcribe`), long-term memory |
| Rate limit | Free 6/min, Premium 20/min |
| Idempotency | `client_message_id` (unique per session). Replaying an id whose assistant reply completed streams the stored reply as a single `message.delta` followed by `done` (`replayed: true`). Replaying an id whose reply failed regenerates it. |
| Route keys | `classify.safety`, `chat.default` (or `chat.free` if enabled), `embed.knowledge` (retrieval), `classify.intent` (memory extraction, background) |
| Side effects | `chat_sessions` (insert or update `last_message_at`, `title` on first turn), `chat_messages` (user + assistant + tool rows), `plan_recommendations`, `ai_memories` (premium, background), `ai_usage`, `analytics_events` (`chat_message_sent`) |

Request (`packages/shared/src/contracts/ai-chat.ts`):

```ts
import { z } from 'zod';
import { Uuid, Locale, Citation, Escalation } from './common';

export const ChatAttachment = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('image'),
    storage_path: z.string().regex(/^[0-9a-f-]{36}\/.+\.(jpg|jpeg|png|webp|heic)$/i),   // chat-attachments/{household_id}/...
    mime: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  }),
  z.object({
    kind: z.literal('meal_log'),
    meal_log_id: Uuid,                              // share an analysed meal into the chat
  }),
]);

export const AiChatRequest = z.object({
  session_id: Uuid.nullable(),                      // null starts a new session
  household_id: Uuid,
  client_message_id: Uuid,
  message: z.object({
    text: z.string().trim().min(1).max(4000),
    input_mode: z.enum(['text', 'voice']).default('text'),   // voice = text came from ai-transcribe
    attachments: z.array(ChatAttachment).max(4).default([]),
  }),
  focus_family_member_id: Uuid.optional(),          // "talking about Aisha"
  screen_context: z.object({                        // where the user opened chat from
    screen: z.enum(['today', 'plan', 'recipe', 'grocery', 'growth', 'ramadan', 'chat', 'meal_log']),
    entity_id: Uuid.optional(),
  }).optional(),
  locale: Locale.optional(),
});
export type AiChatRequest = z.infer<typeof AiChatRequest>;
```

SSE wire format: each event is `id: {seq}\nevent: {type}\ndata: {json}\n\n`. Comments `: ping` every 15 s.

```ts
export const ChatToolName = z.enum([           // authoritative list and schemas in 12-ai-agent-architecture.md
  'get_family_member_summary', 'get_meals_for_date', 'search_recipes', 'get_recipe',
  'search_islamic_sources', 'search_scientific_evidence', 'get_hydration_status',
  'get_growth_summary', 'get_budget_status', 'propose_plan_adjustment', 'propose_log_entry',
]);

export const ChatSseEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message.start'), data: z.object({
    session_id: Uuid, user_message_id: Uuid, assistant_message_id: Uuid,
    model_route: z.string(), quota: z.object({ limit: z.number().int(), remaining: z.number().int() }),
  }) }),
  z.object({ type: z.literal('message.delta'), data: z.object({ text: z.string() }) }),
  z.object({ type: z.literal('tool.call'), data: z.object({
    tool_call_id: z.string(), name: ChatToolName,
    display: z.string(),                       // localized status line: "Checking Aisha's profile..."
  }) }),
  z.object({ type: z.literal('tool.result'), data: z.object({
    tool_call_id: z.string(), name: ChatToolName, ok: z.boolean(),
    summary: z.string().optional(),
    card: z.discriminatedUnion('kind', [     // optional rich card the app renders under the message
      z.object({ kind: z.literal('recipe'), recipe_id: Uuid }),
      z.object({ kind: z.literal('plan_adjustment_proposal'), meal_plan_id: Uuid, change_request: z.string(), scope_summary: z.string() }),
      z.object({ kind: z.literal('log_proposal'), table: z.enum(['hydration_logs', 'meal_logs', 'fasting_logs', 'food_exposures']), values: z.record(z.unknown()) }),
    ]).optional(),
  }) }),
  z.object({ type: z.literal('citation'), data: Citation.extend({ marker: z.number().int().positive() }) }),  // [1], [2] markers in text
  z.object({ type: z.literal('safety'), data: z.object({
    action: z.enum(['notice', 'escalate']),
    escalation: Escalation.optional(),
    notice_key: z.string().optional(),        // e.g. 'safety.notice.not_medical_advice'
  }) }),
  z.object({ type: z.literal('follow_up'), data: z.object({ suggestions: z.array(z.string().max(80)).max(3) }) }),
  z.object({ type: z.literal('done'), data: z.object({
    assistant_message_id: Uuid,
    finish_reason: z.enum(['complete', 'escalated', 'length', 'cancelled']),
    replayed: z.boolean().default(false),
  }) }),
  z.object({ type: z.literal('error'), data: z.object({
    code: z.enum(['AI_UNAVAILABLE', 'AI_TIMEOUT', 'INTERNAL', 'FEATURE_DISABLED']),
    message: z.string(), retryable: z.boolean(),
  }) }),
]);
export type ChatSseEvent = z.infer<typeof ChatSseEvent>;
```

Event ordering guarantees: `message.start` first; then any interleaving of `tool.call`, `tool.result`, `message.delta`; then zero or more `citation`; at most one `safety`; at most one `follow_up`; finally exactly one of `done` or `error`. Write tools never execute server-side: the agent returns a `log_proposal` or `plan_adjustment_proposal` card and the user confirms in the UI, which then calls PostgREST or `ai-adjust-plan`.

Errors before stream: `UNAUTHENTICATED`, `VALIDATION_FAILED`, `FORBIDDEN`, `CONSENT_REQUIRED`, `PREMIUM_REQUIRED` (attachments on free tier), `QUOTA_EXCEEDED`, `RATE_LIMITED`, `FEATURE_DISABLED` (`ai.chat.enabled`), `UPGRADE_REQUIRED`.

Example request:

```json
{
  "session_id": null,
  "household_id": "8f2d4c3e-5b1a-4e7f-9c6d-2a1b3c4d5e6f",
  "client_message_id": "0b7e3c52-9d41-4c0e-8a8e-2f5b6c7d8e90",
  "message": { "text": "Can Aisha have dates and milk for suhoor? She is 9 and wants to try fasting.", "input_mode": "text", "attachments": [] },
  "focus_family_member_id": "c1a2b3c4-d5e6-4f70-8192-a3b4c5d6e7f8",
  "screen_context": { "screen": "ramadan" },
  "locale": "en"
}
```

Example stream:

```text
id: 1
event: message.start
data: {"session_id":"5e0c...","user_message_id":"77aa...","assistant_message_id":"88bb...","model_route":"chat.default","quota":{"limit":200,"remaining":187}}

id: 2
event: tool.call
data: {"tool_call_id":"tc_1","name":"get_family_member_summary","display":"Checking Aisha's profile..."}

id: 3
event: tool.result
data: {"tool_call_id":"tc_1","name":"get_family_member_summary","ok":true,"summary":"Age 9, no allergies, picky eater module on"}

id: 4
event: message.delta
data: {"text":"Yes. Dates with milk make a gentle suhoor for a 9-year-old practising a part-day fast [1]. "}

id: 5
event: message.delta
data: {"text":"Add a whole-wheat paratha or oats for slow energy, and offer water in small sips until Fajr..."}

id: 6
event: citation
data: {"marker":1,"kind":"islamic_source","ref_id":"3f9a...","label":"Sunan Abi Dawud 2345 (dates as the believer's suhoor)","tradition":"sunni","hadith_grade":"sahih"}

id: 7
event: safety
data: {"action":"notice","notice_key":"safety.notice.child_practice_fast"}

id: 8
event: follow_up
data: {"suggestions":["Plan a practice-fast week for Aisha","What should she eat at iftar?","How much water before Fajr?"]}

id: 9
event: done
data: {"assistant_message_id":"88bb...","finish_reason":"complete","replayed":false}
```

### 4.2 `ai-intake-assess`

| | |
|---|---|
| Method / path | `POST /functions/v1/ai-intake-assess` |
| Auth | User JWT, role owner or caregiver |
| Consents | `ai_processing`, `health_data`, `child_data` when any assessed member is under 18 |
| Tier | All |
| Rate limit | 5/day free, 10/day premium, 2/min |
| Idempotency | Required |
| Route keys | `classify.safety`, `plan.adjust` route model for assessment reasoning (Sonnet) via prompt `assessment.intake` |
| Side effects | `ai_assessments` (one row per member, `kind = 'intake'`), `hydration_targets` (upsert per member), `plan_recommendations`, `ai_usage`, `audit_log` |

Energy and macro targets are computed deterministically in code (Mifflin-St Jeor for adults, IOM EER equations for children and teens, pregnancy and lactation increments) and the model writes the narrative summary and risk interpretation. The model never invents numbers. For members under 18 the response never includes calorie or weight targets; it includes `child_guidance` instead (growth-first rhythm and mindful eating). Internal estimates for minors are stored in `ai_assessments.energy_targets` under key `internal_estimate` and are excluded from client rendering.

```ts
// packages/shared/src/contracts/ai-intake-assess.ts
export const AiIntakeAssessRequest = z.object({
  household_id: Uuid,
  family_member_ids: z.array(Uuid).min(1).max(20).optional(),   // default: all active members
  reason: z.enum(['onboarding', 'profile_changed', 'periodic']).default('onboarding'),
  locale: Locale.optional(),
});

export const MemberAssessment = z.object({
  assessment_id: Uuid,
  family_member_id: Uuid,
  life_stage: z.enum(['infant', 'toddler', 'child', 'teen', 'adult', 'older_adult']),
  summary: z.string(),
  energy_targets: z.object({ kcal_per_day: z.number(), method: z.string() }).nullable(),   // null for under-18
  macro_targets: z.object({ protein_g: z.number(), carbs_g: z.number(), fat_g: z.number(), fiber_g: z.number() }).nullable(),
  hydration_target_ml: z.number().int(),
  child_guidance: z.array(z.string()).optional(),               // present for under-18
  risk_flags: z.array(z.string()),
  escalation: Escalation.nullable(),
  recommendation_ids: z.array(Uuid),
});

export const AiIntakeAssessResponse = z.object({
  household_id: Uuid,
  assessments: z.array(MemberAssessment),
  disclaimer_key: z.literal('disclaimer.not_medical_advice'),
});
```

Red flags do not fail the call: the affected member gets `escalation` set and plan generation for that member is blocked until a caregiver acknowledges (acknowledgement stored as `consents`-style audit entry, see `15-family-health-modules.md`).

Errors: common set, plus `NOT_FOUND` (member not in household), `AI_UNAVAILABLE`, `AI_OUTPUT_INVALID`.

Example response (abridged):

```json
{
  "household_id": "8f2d4c3e-5b1a-4e7f-9c6d-2a1b3c4d5e6f",
  "assessments": [
    {
      "assessment_id": "a1...", "family_member_id": "f1...", "life_stage": "adult",
      "summary": "Moderately active adult; goal is steady energy and digestive comfort.",
      "energy_targets": { "kcal_per_day": 2350, "method": "mifflin_st_jeor_x_1.55" },
      "macro_targets": { "protein_g": 95, "carbs_g": 300, "fat_g": 80, "fiber_g": 30 },
      "hydration_target_ml": 2600, "risk_flags": [], "escalation": null, "recommendation_ids": ["r1...", "r2..."]
    },
    {
      "assessment_id": "a2...", "family_member_id": "c1...", "life_stage": "child",
      "summary": "Growing well; selective with vegetables and textures.",
      "energy_targets": null, "macro_targets": null, "hydration_target_ml": 1600,
      "child_guidance": ["Offer, never force: you decide what and when, she decides how much.", "Seconds are always allowed when she is hungry."],
      "risk_flags": ["picky_eating_moderate"], "escalation": null, "recommendation_ids": ["r7..."]
    }
  ],
  "disclaimer_key": "disclaimer.not_medical_advice"
}
```

### 4.3 `ai-generate-plan`

| | |
|---|---|
| Method / path | `POST /functions/v1/ai-generate-plan` (public); `POST /functions/v1/ai-generate-plan/worker` (internal) |
| Auth | User JWT (owner or caregiver); worker: `x-internal-secret` |
| Consents | `ai_processing`, `health_data`, `child_data` if minors |
| Tier | Free: `week_count = 1`, `kind = 'standard'`, mode `template_personalize` (curated template + light swaps), one active plan (`PLAN_ALREADY_ACTIVE` unless `replace_active = true`). Premium: 1 to 4 weeks, all kinds except `ramadan` (use `ramadan-generate`), full generation. |
| Rate limit | 3/day free, 10/day premium, 1/min |
| Idempotency | Required |
| Route keys | `classify.safety`, `plan.generate` (premium) or `plan.adjust` (free personalization) |
| Side effects | `meal_plans` (status `generating` → `draft` or `failed`, `generation_progress`), pgmq `plan_generation`, `daily_meals`, `daily_meal_servings`, `plan_recommendations`, `notifications` (`plan_ready`), `ai_usage`, `audit_log` |

```ts
// packages/shared/src/contracts/ai-generate-plan.ts
export const AiGeneratePlanRequest = z.object({
  household_id: Uuid,
  kind: PlanKind.exclude(['ramadan']).default('standard'),
  start_date: IsoDate,                                  // household local date, today..today+14
  week_count: z.number().int().min(1).max(4).default(1),
  family_member_ids: z.array(Uuid).min(1).optional(),   // default: all active members
  budget_profile_id: Uuid.optional(),
  assessment_ids: z.array(Uuid).optional(),             // default: latest per member
  meal_types: z.array(MealType.exclude(['suhoor', 'iftar'])).min(1).default(['breakfast', 'lunch', 'snack', 'dinner']),
  preferences: z.object({
    cuisines: z.array(z.string()).max(5).optional(),    // e.g. ['pakistani', 'mediterranean']
    max_prep_min_weekday: z.number().int().min(5).max(180).optional(),
    batch_cooking: z.boolean().default(false),
    repeat_tolerance: z.enum(['low', 'medium', 'high']).default('medium'),
    sunnah_foods_emphasis: z.boolean().default(true),
  }).default({}),
  replace_active: z.boolean().default(false),
});

export const AiGeneratePlanAccepted = AsyncAccepted.extend({
  meal_plan_id: Uuid,
  plan_status: z.literal('generating'),
  version: z.number().int(),
  mode: z.enum(['full', 'template_personalize']),
});

// Shape of meal_plans.generation_progress (Addition beyond 00-foundations)
export const GenerationProgress = z.object({
  phase: z.enum(['queued', 'safety_check', 'generating', 'validating', 'writing', 'done', 'failed']),
  completed_weeks: z.number().int(),
  total_weeks: z.number().int(),
  attempt: z.number().int(),
  error_code: ErrorCode.optional(),
  escalation: Escalation.optional(),
});

// Internal worker
export const PlanWorkerRequest = z.object({ meal_plan_id: Uuid.optional() });   // omitted = take next queue message
export const PlanWorkerResponse = z.object({ processed: z.number().int(), rescheduled: z.boolean() });
```

Validation applied to model output before any write (fail → repair → fallback, see `04-system-architecture.md` section 4.3):
- Every `meal_id` exists, is `halal` or `depends_on_source` with a halal note, and contains none of the member's allergens (via `ingredient_allergens`).
- Members under 18: portions come from `portions` for their `life_stage`; no reduction below the reference portion; no `weight_management` adaptation.
- Pregnancy and breastfeeding: no deficit relative to assessment target.
- Autism and picky adaptations reference `meal_alternatives` or a safe food from `food_preferences.is_safe_food`.
- Plate split within tolerance (veg/fruit 0.4 to 0.6, protein 0.2 to 0.3, carb 0.2 to 0.3) for adult main meals.
- Budget estimate within `budget_profiles.strictness` tolerance (hard cap must not exceed).

Errors (sync): common set, `PLAN_ALREADY_ACTIVE`, `NOT_FOUND`, `FEATURE_DISABLED` (`plan.generate.enabled`). Async failures appear in `generation_progress.error_code`: `SAFETY_ESCALATION`, `AI_UNAVAILABLE`, `AI_OUTPUT_INVALID`.

Example:

```json
// Request
{ "household_id": "8f2d...", "kind": "standard", "start_date": "2026-10-12", "week_count": 4,
  "budget_profile_id": "b0b1...", "preferences": { "cuisines": ["pakistani"], "max_prep_min_weekday": 40, "batch_cooking": true } }

// 202 Accepted
{ "status": "accepted", "meal_plan_id": "9a8b7c6d-...", "plan_status": "generating", "version": 1, "mode": "full",
  "poll_after_ms": 2000,
  "realtime": { "schema": "public", "table": "meal_plans", "filter": "id=eq.9a8b7c6d-..." } }
```

Polling query: `supabase.from('meal_plans').select('id, status, generation_progress, rationale').eq('id', id).single()`.

### 4.4 `ai-adjust-plan`

| | |
|---|---|
| Method / path | `POST /functions/v1/ai-adjust-plan` |
| Auth | User JWT, owner or caregiver |
| Tier | Premium (`PREMIUM_REQUIRED` for free; free users can swap single meals via `meal_alternatives` through PostgREST) |
| Rate limit | 20/day, 3/min |
| Idempotency | Required |
| Route keys | `classify.safety`, `plan.adjust` |
| Mode | Sync when the affected range is 7 days or less and `dry_run = false`; otherwise 202 with the same job pattern as 4.3 |
| Side effects | New `meal_plans` row (`version + 1`, `parent_plan_id`, status `draft`), copied and modified `daily_meals` and `daily_meal_servings`, `plan_recommendations`, `ai_usage`, `audit_log`. The parent is archived only when the new version is activated via `activate_meal_plan`. |

```ts
export const AiAdjustPlanRequest = z.object({
  meal_plan_id: Uuid,
  change_request: z.string().trim().min(3).max(1000),     // "Less rice on weekdays, Ahmed has exams next week"
  scope: z.object({
    from_date: IsoDate,
    to_date: IsoDate,
    family_member_ids: z.array(Uuid).optional(),
    meal_types: z.array(MealType).optional(),
  }),
  dry_run: z.boolean().default(false),                     // true = return a diff preview, write nothing
  source: z.enum(['user', 'chat_proposal']).default('user'),
});

export const PlanDiffItem = z.object({
  plan_date: IsoDate,
  meal_type: MealType,
  family_member_id: Uuid.nullable(),                       // null = whole-family slot
  before: z.object({ meal_id: Uuid, title: z.string() }).nullable(),
  after: z.object({ meal_id: Uuid, title: z.string() }).nullable(),
  reason: z.string(),
});

export const AiAdjustPlanResponse = z.union([
  z.object({
    status: z.literal('completed'),
    meal_plan_id: Uuid.nullable(),                         // null when dry_run
    parent_plan_id: Uuid,
    version: z.number().int(),
    diff: z.array(PlanDiffItem),
    rationale: z.string(),
    budget_delta_minor: z.number().int(),
    currency: CurrencyCode,
  }),
  AsyncAccepted.extend({ meal_plan_id: Uuid, plan_status: z.literal('generating') }),
]);
```

Errors: common set, `PLAN_NOT_ADJUSTABLE`, `NOT_FOUND`, `SAFETY_ESCALATION` (422, for example "make my 12-year-old eat less to lose weight" returns an escalation with reason `other_clinical` and a child-rule explanation), `AI_*`.

Example response:

```json
{ "status": "completed", "meal_plan_id": "aa11...", "parent_plan_id": "9a8b...", "version": 2,
  "diff": [ { "plan_date": "2026-10-13", "meal_type": "lunch", "family_member_id": null,
              "before": { "meal_id": "m1...", "title": "Chicken pulao" },
              "after":  { "meal_id": "m2...", "title": "Daal chawal with kachumber (half rice, extra salad)" },
              "reason": "Lighter weekday lunch with less rice" } ],
  "rationale": "Weekday rice portions reduced for adults; children's portions unchanged.",
  "budget_delta_minor": -45000, "currency": "PKR" }
```

### 4.5 `ai-analyze-meal`

| | |
|---|---|
| Method / path | `POST /functions/v1/ai-analyze-meal` |
| Auth | User JWT; may analyse for members they can write logs for |
| Tier | Premium |
| Rate limit | 30/day, 5/min |
| Idempotency | Optional (`Idempotency-Key` recommended when `save = true`) |
| Route keys | `vision.meal_analysis`, `classify.safety` (only when `text` is present) |
| Side effects | `ai_usage`; when `save = true`, `meal_logs` (`source = 'photo_ai'`). Default flow uses `save = false` and the app saves after user edits via PostgREST. |

```ts
export const AiAnalyzeMealRequest = z.object({
  household_id: Uuid,
  family_member_id: Uuid,
  photo_path: z.string().min(1),          // meal-photos/{household_id}/{member_id}/{uuid}.jpg
  text: z.string().max(500).optional(),   // "home-made, about one plate"
  meal_type: MealType.optional(),
  eaten_at: IsoInstant.optional(),
  save: z.boolean().default(false),
});

export const AnalyzedItem = z.object({
  label: z.string(),
  ingredient_id: Uuid.nullable(),
  recipe_id: Uuid.nullable(),
  estimated_grams: z.number().positive(),
  household_measure: z.string().optional(),       // "1 roti", "1/2 katori"
  confidence: z.number().min(0).max(1),
  halal_note: z.string().optional(),
});

export const AiAnalyzeMealResponse = z.object({
  analysis_id: Uuid,                               // correlates with ai_usage
  items: z.array(AnalyzedItem),
  nutrition: NutritionEstimate.nullable(),         // estimate used for meal_logs.estimated_nutrition; null if nothing recognised
  show_numbers: z.boolean(),                       // false for members under 18: the app never renders kcal or macros for them
  plate_split: PlateSplit,
  thuluth_feedback: z.object({
    headline: z.string(),
    points: z.array(z.string()).max(4),
    tone: z.enum(['celebrate', 'gentle_suggestion', 'neutral']),
  }),
  overall_confidence: z.number().min(0).max(1),
  meal_log_id: Uuid.nullable(),
});
```

Errors: common set, `PREMIUM_REQUIRED`, `NOT_FOUND` (photo missing), `UNSUPPORTED_MEDIA_TYPE`, `PAYLOAD_TOO_LARGE`, `FEATURE_DISABLED` (`ai.vision.enabled`), `AI_*`.

Example response:

```json
{ "analysis_id": "e5...", "show_numbers": true, "overall_confidence": 0.72, "meal_log_id": null,
  "items": [
    { "label": "Chapati", "ingredient_id": null, "recipe_id": "r-chapati", "estimated_grams": 80, "household_measure": "2 small", "confidence": 0.86 },
    { "label": "Chicken karahi", "ingredient_id": null, "recipe_id": "r-karahi", "estimated_grams": 220, "household_measure": "1 katori", "confidence": 0.71 },
    { "label": "Cucumber raita", "ingredient_id": null, "recipe_id": "r-raita", "estimated_grams": 90, "confidence": 0.64 } ],
  "nutrition": { "kcal": 690, "protein_g": 41, "carbs_g": 58, "fiber_g": 7, "fat_g": 31 },
  "plate_split": { "veg_fruit": 0.15, "protein": 0.45, "carb": 0.40 },
  "thuluth_feedback": { "headline": "Good protein, room for more vegetables", "tone": "gentle_suggestion",
    "points": ["Add a side salad or sabzi to reach half a plate of vegetables.", "Drink water 20 to 30 minutes before the next meal.", "Pause halfway and ask: could I eat more if I had to?"] } }
```

### 4.6 `ai-transcribe`

| | |
|---|---|
| Method / path | `POST /functions/v1/ai-transcribe` |
| Content type | `multipart/form-data` with fields `audio` (file) and `meta` (JSON string) |
| Auth | User JWT |
| Tier | Premium |
| Rate limit | 60/day, 10/min |
| Idempotency | None (no side effects besides metering) |
| Route key | `speech.transcribe` |
| Side effects | `ai_usage` only. Audio is held in memory and never stored. |

```ts
export const AiTranscribeMeta = z.object({
  household_id: Uuid,
  language_hint: z.enum(['en', 'ur', 'ar', 'auto']).default('auto'),
  duration_ms: z.number().int().max(120_000),
});
export const AiTranscribeResponse = z.object({
  text: z.string(),
  language: z.string(),          // BCP-47 detected, e.g. 'ur'
  duration_ms: z.number().int(),
});
```

Errors: `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_TYPE`, `PREMIUM_REQUIRED`, `AI_*`.

Example response: `{ "text": "Aaj Ahmed ne sirf aadhi roti khayi, kya yeh theek hai?", "language": "ur", "duration_ms": 6400 }`

### 4.7 `grocery-generate`

| | |
|---|---|
| Method / path | `POST /functions/v1/grocery-generate` |
| Auth | User JWT, owner or caregiver |
| Tier | Free: basic aggregation from plan (`optimize` forced false, no substitutions, no monthly split). Premium: budget optimization, substitutions, weekly vs monthly purchasing (`is_fresh`), price tracking. |
| Rate limit | 10/day free, 30/day premium, 3/min |
| Idempotency | Required |
| AI | None in MVP (deterministic optimizer, see `14-meal-planning-and-grocery.md`) |
| Side effects | `grocery_lists`, `shopping_items` (including substitution rows with `substitution_for_item_id`), `audit_log` |

```ts
export const GroceryGenerateRequest = z.object({
  household_id: Uuid,
  meal_plan_id: Uuid,
  period: z.enum(['weekly', 'monthly']).default('weekly'),
  starts_on: IsoDate,
  ends_on: IsoDate,
  budget_profile_id: Uuid.optional(),
  price_profile_id: Uuid.optional(),          // default: household region/city profile
  optimize: z.boolean().default(true),        // premium only
  pantry_exclusions: z.array(z.string()).max(100).default([]),   // labels the family already has
  replace_list_id: Uuid.optional(),           // regenerate into an existing open list
});

export const GroceryGenerateResponse = z.object({
  grocery_list_id: Uuid,
  currency: CurrencyCode,
  estimated_total_minor: z.number().int(),
  items_count: z.number().int(),
  fresh_items_count: z.number().int(),
  budget: z.object({
    target_minor: z.number().int().nullable(),
    status: z.enum(['no_budget', 'under', 'near', 'over']),
    by_category: z.array(z.object({ category_code: z.string(), estimated_minor: z.number().int(), target_minor: z.number().int().nullable() })),
  }),
  substitutions: z.array(z.object({
    item_id: Uuid, substitute_item_id: Uuid, label: z.string(), saves_minor: z.number().int(), reason: z.enum(['budget', 'season', 'availability']),
  })),
  price_coverage: z.number().min(0).max(1),   // share of items with a known price
});
```

Errors: common set, `NOT_FOUND`, `CONFLICT` (list not `open`).

Example response:

```json
{ "grocery_list_id": "g1...", "currency": "PKR", "estimated_total_minor": 2174000, "items_count": 46, "fresh_items_count": 28,
  "budget": { "target_minor": 2500000, "status": "under",
    "by_category": [ { "category_code": "produce_veg", "estimated_minor": 410000, "target_minor": 450000 } ] },
  "substitutions": [ { "item_id": "i1...", "substitute_item_id": "i2...", "label": "Seasonal guava instead of imported apples", "saves_minor": 36000, "reason": "season" } ],
  "price_coverage": 0.93 }
```

### 4.8 `growth-compute`

| | |
|---|---|
| Method / path | `POST /functions/v1/growth-compute` |
| Auth | User JWT, owner or caregiver |
| Tier | All tiers get z-scores, latest percentile and **safety alerts** (safety position overrides tier gating). Premium additionally receives `trend` and chart series. |
| Rate limit | 60/day, 10/min |
| Idempotency | Natural: computing the same `growth_tracking_id` twice yields the same result |
| AI | None (LMS method with `growth_reference_lms`) |
| Side effects | `growth_tracking` (computed columns), `notifications` for alerts to owners and caregivers, `audit_log` |

```ts
export const GrowthComputeRequest = z.union([
  z.object({ growth_tracking_id: Uuid }),                          // row already inserted (offline path)
  z.object({
    household_id: Uuid,
    family_member_id: Uuid,
    measured_on: IsoDate,
    height_cm: z.number().min(30).max(220),
    weight_kg: z.number().min(1).max(200),
    head_circumference_cm: z.number().min(25).max(60).optional(),
  }),
]);

export const GrowthAlert = z.object({
  code: z.enum(['weight_for_age_below_p3', 'crossed_two_major_percentiles', 'rapid_weight_loss', 'bmi_for_age_above_p97', 'height_for_age_below_p3']),
  severity: z.enum(['info', 'watch', 'see_clinician']),
  message: z.string(),
  escalation: Escalation.nullable(),
});

export const GrowthComputeResponse = z.object({
  growth_tracking_id: Uuid,
  reference: z.enum(['who_2006', 'who_2007', 'cdc_2000']),
  age_months: z.number(),
  bmi: z.number(),
  z: z.object({ height_for_age: z.number().nullable(), weight_for_age: z.number().nullable(), bmi_for_age: z.number().nullable() }),
  percentile: z.object({ height_for_age: z.number().nullable(), weight_for_age: z.number().nullable(), bmi_for_age: z.number().nullable() }),
  alerts: z.array(GrowthAlert),
  trend: z.object({                                                 // premium only, else null
    series: z.array(z.object({ measured_on: IsoDate, weight_for_age_percentile: z.number().nullable(), height_for_age_percentile: z.number().nullable() })),
    direction: z.enum(['stable', 'rising', 'falling']),
  }).nullable(),
});
```

Reference selection: WHO 2006 for 0 to 60 months, WHO 2007 for 61 to 228 months; `cdc_2000` only when the household opts in (US Phase 2). `weight_for_age` is not computed above 120 months (WHO 2007 limit). Errors: `GROWTH_REFERENCE_OUT_OF_RANGE` (age over 19 years: use `weight_tracking`), `NOT_FOUND`, `VALIDATION_FAILED`.

Example response:

```json
{ "growth_tracking_id": "gt1...", "reference": "who_2007", "age_months": 114.6, "bmi": 15.8,
  "z": { "height_for_age": 0.21, "weight_for_age": -0.35, "bmi_for_age": -0.48 },
  "percentile": { "height_for_age": 58.3, "weight_for_age": 36.3, "bmi_for_age": 31.6 },
  "alerts": [], "trend": null }
```

### 4.9 `ramadan-generate`

| | |
|---|---|
| Method / path | `POST /functions/v1/ramadan-generate` |
| Auth | User JWT, owner or caregiver |
| Tier | Premium (free users get generic Suhoor/Iftar tips from `coaching_tips` via PostgREST) |
| Rate limit | 5/day, 1/min |
| Idempotency | Required |
| Route keys | `classify.safety`, `plan.generate` |
| External | Aladhan `calendarByCity` (cached in `prayer_times_cache`), fallback local computation with `npm:adhan` |
| Side effects | `ramadan_plans`, `meal_plans` (`kind = 'ramadan'`, async), `daily_meals` with `suhoor` and `iftar` slots and `scheduled_time` from prayer times, `daily_meal_servings`, `hydration_targets` (fasting schedule in `schedule`), `notifications` (suhoor and iftar reminders materialized by dispatcher), `prayer_times_cache`, `ai_usage`, `audit_log` |

Safety rules enforced in code before any model call (`00-foundations.md` section 10): no fasting schedule for members under 7 (they get normal meals in the plan); members 7 to puberty may have `practice_fast` with configurable partial days only; pregnancy and breastfeeding members follow `intends_to_fast` exactly as the family chose, with the decision deferred to their clinician and scholar and the plan supporting either choice; any member with a medication flag for insulin or sulfonylureas who intends to fast produces `SAFETY_ESCALATION` for that member (plan still generated for others, that member gets non-fasting meals and a clinician recommendation).

```ts
export const RamadanParticipant = z.object({
  family_member_id: Uuid,
  intention: z.enum(['fasting', 'practice_fast', 'not_fasting', 'exempt']),
  practice_fast: z.object({                         // only for 7 to puberty
    days_per_week: z.number().int().min(1).max(7),
    until: z.enum(['dhuhr', 'asr', 'maghrib']),
  }).optional(),
  exemption_reason: z.enum(['travel', 'illness', 'pregnancy', 'breastfeeding', 'menstruation', 'age', 'other']).optional(),
});

export const RamadanGenerateRequest = z.object({
  household_id: Uuid,
  hijri_year: z.number().int().min(1447).max(1500),
  start_date: IsoDate.optional(),                   // default: Aladhan Hijri calendar; user can correct for local moon sighting
  end_date: IsoDate.optional(),
  location: z.object({ city: z.string().min(2), country_code: z.string().length(2) }),
  calculation: z.object({
    method: z.number().int().min(0).max(23).optional(),   // Aladhan method id; default by tradition and country
    asr_school: z.enum(['standard', 'hanafi']).optional(),
    iftar_at: z.enum(['sunset', 'maghrib']).optional(),   // default: maghrib for Shia preference, sunset otherwise
    suhoor_buffer_min: z.number().int().min(0).max(30).default(10),  // stop eating this many minutes before Fajr
  }).default({}),
  participants: z.array(RamadanParticipant).min(1),
  suhoor_time_strategy: z.enum(['just_before_fajr', 'after_tahajjud', 'before_sleep']).default('just_before_fajr'),
  budget_profile_id: Uuid.optional(),
});

export const RamadanGenerateAccepted = AsyncAccepted.extend({
  ramadan_plan_id: Uuid,
  meal_plan_id: Uuid,
  plan_status: z.literal('generating'),
  dates: z.object({ start_date: IsoDate, end_date: IsoDate }),
  prayer_times_source: z.enum(['aladhan', 'cache', 'computed_fallback']),
  member_escalations: z.array(Escalation),
});
```

Errors: common set, `PREMIUM_REQUIRED`, `PRAYER_TIMES_UNAVAILABLE`, `VALIDATION_FAILED` (`details.rule = 'no_fasting_under_7'` when `intention = 'fasting'` for a member under 7).

### 4.10 `export-pdf`

| | |
|---|---|
| Method / path | `POST /functions/v1/export-pdf` |
| Auth | User JWT (any member role; viewers may export what they can read) |
| Tier | Premium |
| Rate limit | 30/day, 5/min |
| Idempotency | Required |
| External | Gotenberg HTML to PDF |
| Side effects | `exports` (status `processing` → `ready` or `failed`), Storage `exports/{household_id}/{export_id}.pdf`, `audit_log`, `analytics_events` (`export_created`) |
| MVP kinds | `meal_plan`, `grocery_list`. Other `ExportKind` values return `EXPORT_KIND_UNSUPPORTED` until enabled by flag `exports.kinds` (see `18-exports-and-analytics.md`) |

```ts
export const ExportPdfRequest = z.object({
  household_id: Uuid,
  locale: Locale,
  paper: z.enum(['A4', 'Letter']).default('A4'),
  params: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('meal_plan'), meal_plan_id: Uuid, week_index: z.number().int().min(0).max(3).optional(), include_recipes: z.boolean().default(true), include_sources: z.boolean().default(true) }),
    z.object({ kind: z.literal('grocery_list'), grocery_list_id: Uuid, group_by: z.enum(['aisle', 'category']).default('aisle') }),
    z.object({ kind: z.literal('nutrition_report'), family_member_id: Uuid, from: IsoDate, to: IsoDate }),
    z.object({ kind: z.literal('growth_report'), family_member_id: Uuid }),
    z.object({ kind: z.literal('ramadan_pack'), ramadan_plan_id: Uuid }),
    z.object({ kind: z.literal('family_summary') }),
  ]),
});

// Addition beyond 00-foundations: exports.status values
export const ExportStatus = z.enum(['processing', 'ready', 'failed', 'expired']);

export const ExportPdfResponse = z.union([
  z.object({ status: z.literal('ready'), export_id: Uuid, url: z.string().url(), expires_at: IsoInstant, pages: z.number().int() }),
  AsyncAccepted.extend({ export_id: Uuid, export_status: z.literal('processing') }),
]);
```

Example:

```json
// Request
{ "household_id": "8f2d...", "locale": "ur", "paper": "A4", "params": { "kind": "meal_plan", "meal_plan_id": "9a8b...", "week_index": 0 } }
// 200
{ "status": "ready", "export_id": "x1...", "url": "https://api.thuluth.app/storage/v1/object/sign/exports/8f2d.../x1....pdf?token=...", "expires_at": "2026-10-06T15:04:00Z", "pages": 6 }
```

The signed URL lives 1 hour; the object lives 7 days (`exports.expires_at`); the client can request a fresh URL by re-calling with the same Idempotency-Key within 24 h or by `storage.from('exports').createSignedUrl(path, 3600)` (storage RLS allows household members).

### 4.11 `household-invite`

| | |
|---|---|
| Method / path | `POST /functions/v1/household-invite` |
| Auth | User JWT. `create`, `revoke`, `resend`: owner (caregivers may invite `viewer` only). `accept`: any signed-in user whose verified email matches the invitation. |
| Tier | All (member counts are family members, not app users; app users per household capped at 10 in MVP) |
| Rate limit | 20/day free, 50/day premium, 5/min |
| Idempotency | Required for `create` and `resend` |
| External | Postmark template `household-invite-{locale}` |
| Side effects | `household_invitations`, `household_members` (on accept), `notifications` (to inviter on accept), `audit_log` |

```ts
export const HouseholdInviteRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), household_id: Uuid, email: z.string().email().toLowerCase(), role: z.enum(['caregiver', 'viewer']), message: z.string().max(280).optional() }),
  z.object({ action: z.literal('resend'), invitation_id: Uuid }),
  z.object({ action: z.literal('revoke'), invitation_id: Uuid }),
  z.object({ action: z.literal('accept'), token: z.string().min(32).max(128) }),
]);

export const HouseholdInviteResponse = z.discriminatedUnion('action', [
  z.object({ action: z.literal('create'), invitation_id: Uuid, expires_at: IsoInstant, share_url: z.string().url() }),
  z.object({ action: z.literal('resend'), invitation_id: Uuid, expires_at: IsoInstant }),
  z.object({ action: z.literal('revoke'), invitation_id: Uuid, revoked: z.literal(true) }),
  z.object({ action: z.literal('accept'), household_id: Uuid, role: HouseholdRole }),
]);
```

Token: 32 random bytes, base64url (43 chars); only `sha256(token)` stored in `token_hash`. Expiry 7 days. `share_url = https://thuluth.app/invite/{token}` (universal link, see `19-deployment-architecture.md`), so an owner can share via WhatsApp if email fails. Errors: `INVITE_INVALID`, `INVITE_EXPIRED`, `INVITE_EMAIL_MISMATCH`, `ALREADY_MEMBER`, `LIMIT_REACHED`, `FORBIDDEN`.

### 4.12 `account-export`

| | |
|---|---|
| Method / path | `POST /functions/v1/account-export` |
| Auth | User JWT (recent sign-in required: `iat` within 15 minutes, otherwise `UNAUTHENTICATED` with `details.reauth = true`) |
| Tier | All |
| Rate limit | 2/day |
| Idempotency | Required |
| Side effects | `exports` (`kind = 'account_data'`, Addition beyond 00-foundations), Storage zip, Postmark email "Your data is ready", `notifications`, `audit_log` |

```ts
export const AccountExportRequest = z.object({
  include_pdfs: z.boolean().default(true),     // adds meal plan and growth PDFs
  household_ids: z.array(Uuid).optional(),     // default: all households the user belongs to (only data they can read)
});
export const AccountExportAccepted = AsyncAccepted.extend({ export_id: Uuid, export_status: z.literal('processing') });
```

The zip contains `user.json`, one folder per household with one JSON file per table (rows readable by the user under RLS), `chat/` (the user's own sessions), `media/` (photos), `pdf/`, and `README.txt` describing the schema. The link expires after 7 days.

### 4.13 `account-delete`

| | |
|---|---|
| Method / path | `POST /functions/v1/account-delete` (user); `POST /functions/v1/account-delete/execute` (internal, cron hourly) |
| Auth | User JWT with recent sign-in (as 4.12); internal secret for `/execute` |
| Rate limit | 5/day |
| Idempotency | Required for `request` |
| Side effects (request) | `users.deletion_scheduled_for` (Addition beyond 00-foundations), `audit_log`, Postmark confirmation email, OneSignal tag `deletion_pending` |
| Side effects (execute) | Hard delete of the user's rows; households where the user is the only owner and only member are deleted with all household rows and storage objects; `auth.admin.deleteUser`; RevenueCat `DELETE /v1/subscribers/{id}`; OneSignal user delete; `audit_log` keeps a tombstone with `actor_user_id` nulled and `ip_hash` only |

```ts
export const AccountDeleteRequest = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request'), confirm: z.literal('DELETE'), reason: z.enum(['privacy', 'not_useful', 'too_expensive', 'other']).optional() }),
  z.object({ action: z.literal('cancel') }),
]);
export const AccountDeleteResponse = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request'), scheduled_for: IsoInstant, active_subscription_warning: z.boolean() }),
  z.object({ action: z.literal('cancel'), cancelled: z.literal(true) }),
]);
export const AccountDeleteExecuteResponse = z.object({ deleted_users: z.number().int(), failures: z.number().int() });
```

Grace period is 7 days (GDPR "without undue delay" is satisfied; the user can cancel). Store subscriptions cannot be cancelled server-side; `active_subscription_warning = true` tells the app to deep-link to the store's subscription management. Errors: `OWNERSHIP_TRANSFER_REQUIRED` (user owns a household that has other caregivers: transfer ownership or remove them first), `ACCOUNT_DELETION_PENDING` (already requested).

### 4.14 `revenuecat-webhook`

| | |
|---|---|
| Method / path | `POST /functions/v1/revenuecat-webhook` |
| Auth | `Authorization: Bearer {REVENUECAT_WEBHOOK_SECRET}` (configured in RevenueCat dashboard per project) |
| Idempotency | `event.id` in `idempotency_keys` (scope `revenuecat`, 30 days) |
| Response | `200 {"ok":true}` quickly; non-2xx causes RevenueCat retries (they retry with backoff), so only return 5xx for transient failures |
| Side effects | `subscriptions` upsert, `audit_log`, `analytics_events` (`subscription_*`), `notifications` (billing issue) |

Full handling in section 5.

### 4.15 `notifications-dispatch`

| | |
|---|---|
| Method / path | `POST /functions/v1/notifications-dispatch` |
| Auth | `x-internal-secret` |
| Trigger | pg_cron every minute |
| Concurrency | `pg_try_advisory_lock` so only one run at a time |
| Side effects | `notifications` (insert materialized reminders, update `sent_at`, `onesignal_id`), OneSignal REST |

```ts
export const NotificationsDispatchRequest = z.object({ triggered_at: IsoInstant, dry_run: z.boolean().default(false) });
export const NotificationsDispatchResponse = z.object({
  skipped: z.boolean(),                 // lock not acquired
  materialized: z.number().int(),
  sent: z.number().int(),
  suppressed_quiet_hours: z.number().int(),
  stale: z.number().int(),
  failed: z.number().int(),
});
```

Reminder kinds materialized (Addition beyond 00-foundations: `notifications.kind` values, since foundations leaves `kind` free text): `meal_reminder`, `hydration_reminder`, `suhoor_reminder`, `iftar_reminder`, `fasting_sunnah_reminder`, `plan_ready`, `grocery_day`, `growth_measure_due`, `billing_issue`, `invite_accepted`, `export_ready`. A unique index on `(user_id, kind, scheduled_for)` makes materialization idempotent.

### 4.16 `prices-refresh`

| | |
|---|---|
| Method / path | `POST /functions/v1/prices-refresh` |
| Auth | `x-internal-secret` |
| Trigger | pg_cron nightly 21:00 UTC (02:00 PKT) |
| Side effects | `price_profiles` (new `effective_from` row when the median moved more than 3 percent), `seasonal_produce.price_index`, `audit_log` |

```ts
export const PricesRefreshRequest = z.object({ region_ids: z.array(Uuid).optional(), since: IsoDate.optional() });
export const PricesRefreshResponse = z.object({
  profiles_updated: z.number().int(),
  ingredients_repriced: z.number().int(),
  outliers_rejected: z.number().int(),   // user reports outside 3 x IQR
});
```

Algorithm: for each (`price_profile`, `ingredient_id`, `unit`), take observations from the last 60 days weighted by source (`admin` 3, `partner_feed` 3, `seed` 1, `user_report` 1 and only after 3 independent reporters), reject outliers, take the weighted median. Details in `14-meal-planning-and-grocery.md`.

### 4.17 `analytics-rollup`

| | |
|---|---|
| Method / path | `POST /functions/v1/analytics-rollup` |
| Auth | `x-internal-secret` |
| Trigger | Hourly (`scope: hourly`) and nightly (`scope: daily`) |
| Side effects | `refresh materialized view concurrently` on views listed in `18-exports-and-analytics.md` (including `mv_ai_cost_daily`), partition maintenance for `analytics_events` (create next month, detach older than 13 months), cost and push-lag alert checks |

```ts
export const AnalyticsRollupRequest = z.object({ scope: z.enum(['hourly', 'daily']).default('hourly') });
export const AnalyticsRollupResponse = z.object({
  refreshed: z.array(z.string()),
  partitions_created: z.array(z.string()),
  partitions_detached: z.array(z.string()),
  alerts_raised: z.array(z.string()),
  duration_ms: z.number().int(),
});
```

## 5. RevenueCat webhook payload handling

### 5.1 Payload (fields we read)

```ts
// packages/shared/src/contracts/revenuecat-webhook.ts
export const RcEventType = z.enum([
  'TEST', 'INITIAL_PURCHASE', 'RENEWAL', 'CANCELLATION', 'UNCANCELLATION', 'NON_RENEWING_PURCHASE',
  'SUBSCRIPTION_PAUSED', 'EXPIRATION', 'BILLING_ISSUE', 'PRODUCT_CHANGE', 'TRANSFER',
  'SUBSCRIPTION_EXTENDED', 'TEMPORARY_ENTITLEMENT_GRANT', 'REFUND_REVERSED',
]);

export const RevenueCatWebhook = z.object({
  api_version: z.string(),
  event: z.object({
    id: z.string(),
    type: z.union([RcEventType, z.string()]),          // tolerate new types: log and 200
    app_user_id: z.string(),
    original_app_user_id: z.string().optional(),
    aliases: z.array(z.string()).optional(),
    transferred_from: z.array(z.string()).optional(),  // TRANSFER
    transferred_to: z.array(z.string()).optional(),
    product_id: z.string().optional(),
    new_product_id: z.string().optional(),             // PRODUCT_CHANGE
    entitlement_ids: z.array(z.string()).nullable().optional(),
    period_type: z.enum(['TRIAL', 'INTRO', 'NORMAL', 'PROMOTIONAL', 'PREPAID']).optional(),
    purchased_at_ms: z.number().optional(),
    expiration_at_ms: z.number().nullable().optional(),
    grace_period_expiration_at_ms: z.number().nullable().optional(),
    store: z.enum(['APP_STORE', 'MAC_APP_STORE', 'PLAY_STORE', 'AMAZON', 'STRIPE', 'PROMOTIONAL', 'RC_BILLING', 'PADDLE', 'TEST_STORE']).optional(),
    environment: z.enum(['SANDBOX', 'PRODUCTION']),
    cancel_reason: z.string().optional(),
    expiration_reason: z.string().optional(),
    transaction_id: z.string().optional(),
    original_transaction_id: z.string().optional(),
    event_timestamp_ms: z.number(),
  }).passthrough(),
});
```

### 5.2 Processing algorithm

```ts
// supabase/functions/revenuecat-webhook/index.ts (outline)
Deno.serve(async (req) => {
  requireRevenueCat(req);                                     // 401 WEBHOOK_UNAUTHORIZED on mismatch
  const body = RevenueCatWebhook.parse(await req.json());
  const ev = body.event;

  if (ev.environment === 'SANDBOX' && Deno.env.get('APP_ENV') === 'prod') return ok({ ignored: 'sandbox' });
  if (ev.type === 'TEST') return ok({ test: true });
  if (!(await claimIdempotency('revenuecat', null, ev.id, hash(body)))) return ok({ duplicate: true });

  const userIds = ev.type === 'TRANSFER'
    ? [...(ev.transferred_from ?? []), ...(ev.transferred_to ?? [])]
    : [ev.app_user_id];

  for (const appUserId of userIds.filter(isUuid)) {          // anonymous $RCAnonymousID ids are ignored
    const subscriber = await rc.getSubscriber(appUserId);    // GET https://api.revenuecat.com/v1/subscribers/{id}
    await upsertSubscriptionFromSubscriber(appUserId, subscriber, ev);   // single source of truth
  }
  await completeIdempotency(ev.id, 200, { ok: true });
  return ok({ ok: true });
});
```

Mapping from the canonical subscriber (entitlement `premium`) to `subscriptions`:

| Subscriber state | `tier` | `status` |
|---|---|---|
| `entitlements.premium.expires_date` in future, `unsubscribe_detected_at` null, no billing issue | `premium` | `active` |
| Active, `unsubscribe_detected_at` set (auto-renew off) | `premium` | `cancelled` (with `will_renew = false`; access until `current_period_end`) |
| `billing_issues_detected_at` set and `grace_period_expires_date` in future | `premium` | `in_grace` |
| Billing issue, grace over, store still retrying | `free` | `in_billing_retry` |
| Paused (Play) | `free` | `paused` |
| Expired or refunded | `free` | `expired` |
| Promotional grant (`store = PROMOTIONAL`) active | `premium` | `active`, `store = 'promotional'` |

`has_premium(user_id)` returns true when a row exists with `tier = 'premium'` and `status in ('active','in_grace','cancelled')` and `current_period_end > now()`. Event-specific side effects: `BILLING_ISSUE` inserts a `billing_issue` notification; `INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`, `EXPIRATION` insert `analytics_events`. `raw_event` stores the last event payload. Additional details (trials, family sharing, price experiments) in `17-subscription-architecture.md`.

## 6. OneSignal outbound calls

All calls use `Authorization: Key {ONESIGNAL_REST_API_KEY}` and `Content-Type: application/json` against `https://api.onesignal.com`. The app id comes from `ONESIGNAL_APP_ID` (dev/staging share `Thuluth Dev`, prod uses `Thuluth Prod`).

| Call | Endpoint | Used by |
|---|---|---|
| Send push | `POST /notifications?c=push` | `notifications-dispatch` |
| Cancel scheduled | `DELETE /notifications/{id}?app_id=` | Not used in MVP (we schedule in our DB, not in OneSignal) |
| Delete user | `DELETE /apps/{app_id}/users/by/external_id/{user_id}` | `account-delete/execute` |
| Update user tags | `PATCH /apps/{app_id}/users/by/external_id/{user_id}` with `{"properties":{"tags":{"locale":"ur","tier":"premium"}}}` | `revenuecat-webhook` sets `tier`; `locale` is set by the app SDK (`OneSignal.User.addTag`) when the language changes |

Send request built by the dispatcher:

```json
{
  "app_id": "{ONESIGNAL_APP_ID}",
  "target_channel": "push",
  "include_aliases": { "external_id": ["4b1d...", "9e2a..."] },
  "headings": { "en": "Lunch time", "ur": "دوپہر کے کھانے کا وقت" },
  "contents": { "en": "Daal chawal with kachumber at 1:30 PM. Water first, 20 minutes before.", "ur": "دوپہر 1:30 بجے دال چاول اور کچومر۔ کھانے سے 20 منٹ پہلے پانی پی لیں۔" },
  "data": { "kind": "meal_reminder", "deep_link": "thuluth://today?meal=dm_7f3a", "notification_id": "n_51c2" },
  "ios_interruption_level": "active",
  "android_channel_id": "{ANDROID_CHANNEL_MEALS}",
  "idempotency_key": "n_51c2",
  "ttl": 3600
}
```

Rules:
- Up to 2,000 `external_id` values per request; messages are grouped by identical (kind, localized title, localized body). Personalized bodies (meal names) are sent per household in groups of the household's users.
- `idempotency_key` is the `notifications.id` of the first notification in the batch (OneSignal deduplicates repeated sends for 30 days).
- Body text never contains health values, conditions, weights or a child's measurements. Meal names and times are allowed.
- 429 or 5xx: leave `sent_at` null, retry next minute; after 30 minutes mark stale.
- Response `{ "id": "...", "errors": { "invalid_aliases": {...} } }`: invalid aliases mark the matching `devices` rows stale (`last_seen_at` untouched, flag in `devices` metadata) for cleanup.

## 7. Other outbound calls

| Target | Request | Timeout / retry |
|---|---|---|
| RevenueCat REST | `GET https://api.revenuecat.com/v1/subscribers/{app_user_id}` with `Authorization: Bearer {REVENUECAT_SECRET_API_KEY}`; `DELETE` same path for erasure | 5 s, 2 retries |
| Aladhan | `GET https://api.aladhan.com/v1/calendarByCity/{year}/{month}?city={city}&country={cc}&method={m}&school={0or1}`; Hijri dates via `GET /v1/hToGCalendar/{month}/{year}` | 8 s, 2 retries, then cache, then local `adhan` computation |
| Postmark | `POST https://api.postmarkapp.com/email/withTemplate` with `X-Postmark-Server-Token`, `TemplateAlias`, `TemplateModel`, `MessageStream: "outbound"` | 5 s, 2 retries |
| Gotenberg | `POST {GOTENBERG_URL}/forms/chromium/convert/html` multipart (`index.html`, font files), fields `paperWidth`, `paperHeight`, `marginTop`, `printBackground=true`; header `Authorization: Bearer {GOTENBERG_TOKEN}` | 25 s, 1 retry |
| AI providers | Through `packages/ai-core` only (see `12-ai-agent-architecture.md`) | Per route `params.timeout_ms` |

## 8. OpenAPI 3.1 skeleton

The full generated spec is produced from Zod with `@asteasolutions/zod-to-openapi` into `packages/shared/openapi/edge-functions.yaml` by `pnpm --filter @thuluth/shared openapi:generate`. CI fails if the committed file differs from the generated one. The skeleton below fixes the structure.

```yaml
openapi: 3.1.0
info:
  title: Thuluth Edge Functions API
  version: "2026-10-01"
  description: >
    Edge Functions for Thuluth (Qanun al-Thuluth Family Nutrition Companion).
    CRUD is served by PostgREST and is not described here.
servers:
  - url: https://api.thuluth.app/functions/v1
    description: production
  - url: https://api.staging.thuluth.app/functions/v1
    description: staging
  - url: http://127.0.0.1:54321/functions/v1
    description: local
security:
  - bearerAuth: []
    apiKey: []
tags:
  - name: ai
  - name: planning
  - name: health
  - name: exports
  - name: account
  - name: internal
paths:
  /ai-chat:
    post:
      tags: [ai]
      operationId: aiChat
      parameters:
        - $ref: '#/components/parameters/RequestId'
        - $ref: '#/components/parameters/AppVersion'
        - $ref: '#/components/parameters/ApiVersion'
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: '#/components/schemas/AiChatRequest' }
      responses:
        '200':
          description: Server-Sent Events stream of ChatSseEvent
          content:
            text/event-stream:
              schema: { $ref: '#/components/schemas/ChatSseEvent' }
        '400': { $ref: '#/components/responses/Error' }
        '401': { $ref: '#/components/responses/Error' }
        '402': { $ref: '#/components/responses/Error' }
        '403': { $ref: '#/components/responses/Error' }
        '429': { $ref: '#/components/responses/RateLimited' }
        '503': { $ref: '#/components/responses/Error' }
  /ai-intake-assess:
    post:
      tags: [ai]
      operationId: aiIntakeAssess
      parameters: [ { $ref: '#/components/parameters/IdempotencyKey' } ]
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: '#/components/schemas/AiIntakeAssessRequest' } } }
      responses:
        '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/AiIntakeAssessResponse' } } } }
        default: { $ref: '#/components/responses/Error' }
  /ai-generate-plan:
    post:
      tags: [ai, planning]
      operationId: aiGeneratePlan
      parameters: [ { $ref: '#/components/parameters/IdempotencyKey' } ]
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: '#/components/schemas/AiGeneratePlanRequest' } } }
      responses:
        '202': { description: Accepted, content: { application/json: { schema: { $ref: '#/components/schemas/AiGeneratePlanAccepted' } } } }
        default: { $ref: '#/components/responses/Error' }
  /ai-generate-plan/worker:
    post:
      tags: [internal]
      operationId: aiGeneratePlanWorker
      security: [ { internalSecret: [] } ]
      requestBody:
        content: { application/json: { schema: { $ref: '#/components/schemas/PlanWorkerRequest' } } }
      responses:
        '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/PlanWorkerResponse' } } } }
  /ai-adjust-plan:
    post:
      tags: [ai, planning]
      operationId: aiAdjustPlan
      parameters: [ { $ref: '#/components/parameters/IdempotencyKey' } ]
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: '#/components/schemas/AiAdjustPlanRequest' } } }
      responses:
        '200': { description: Completed, content: { application/json: { schema: { $ref: '#/components/schemas/AiAdjustPlanResponse' } } } }
        '202': { description: Accepted, content: { application/json: { schema: { $ref: '#/components/schemas/AiAdjustPlanResponse' } } } }
        default: { $ref: '#/components/responses/Error' }
  /ai-analyze-meal:
    post:
      tags: [ai, health]
      operationId: aiAnalyzeMeal
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: '#/components/schemas/AiAnalyzeMealRequest' } } }
      responses:
        '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/AiAnalyzeMealResponse' } } } }
        default: { $ref: '#/components/responses/Error' }
  /ai-transcribe:
    post:
      tags: [ai]
      operationId: aiTranscribe
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: [audio, meta]
              properties:
                audio: { type: string, contentMediaType: audio/mp4 }
                meta: { $ref: '#/components/schemas/AiTranscribeMeta' }
      responses:
        '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/AiTranscribeResponse' } } } }
        default: { $ref: '#/components/responses/Error' }
  /grocery-generate:
    post:
      tags: [planning]
      operationId: groceryGenerate
      parameters: [ { $ref: '#/components/parameters/IdempotencyKey' } ]
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: '#/components/schemas/GroceryGenerateRequest' } } }
      responses:
        '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/GroceryGenerateResponse' } } } }
        default: { $ref: '#/components/responses/Error' }
  /growth-compute:
    post:
      tags: [health]
      operationId: growthCompute
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: '#/components/schemas/GrowthComputeRequest' } } }
      responses:
        '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/GrowthComputeResponse' } } } }
        default: { $ref: '#/components/responses/Error' }
  /ramadan-generate:
    post:
      tags: [planning]
      operationId: ramadanGenerate
      parameters: [ { $ref: '#/components/parameters/IdempotencyKey' } ]
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: '#/components/schemas/RamadanGenerateRequest' } } }
      responses:
        '202': { description: Accepted, content: { application/json: { schema: { $ref: '#/components/schemas/RamadanGenerateAccepted' } } } }
        default: { $ref: '#/components/responses/Error' }
  /export-pdf:
    post:
      tags: [exports]
      operationId: exportPdf
      parameters: [ { $ref: '#/components/parameters/IdempotencyKey' } ]
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: '#/components/schemas/ExportPdfRequest' } } }
      responses:
        '200': { description: Ready, content: { application/json: { schema: { $ref: '#/components/schemas/ExportPdfResponse' } } } }
        '202': { description: Processing, content: { application/json: { schema: { $ref: '#/components/schemas/ExportPdfResponse' } } } }
        default: { $ref: '#/components/responses/Error' }
  /household-invite:
    post:
      tags: [account]
      operationId: householdInvite
      parameters: [ { $ref: '#/components/parameters/IdempotencyKey' } ]
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: '#/components/schemas/HouseholdInviteRequest' } } }
      responses:
        '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/HouseholdInviteResponse' } } } }
        default: { $ref: '#/components/responses/Error' }
  /account-export:
    post:
      tags: [account]
      operationId: accountExport
      parameters: [ { $ref: '#/components/parameters/IdempotencyKey' } ]
      requestBody:
        content: { application/json: { schema: { $ref: '#/components/schemas/AccountExportRequest' } } }
      responses:
        '202': { description: Accepted, content: { application/json: { schema: { $ref: '#/components/schemas/AccountExportAccepted' } } } }
        default: { $ref: '#/components/responses/Error' }
  /account-delete:
    post:
      tags: [account]
      operationId: accountDelete
      parameters: [ { $ref: '#/components/parameters/IdempotencyKey' } ]
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: '#/components/schemas/AccountDeleteRequest' } } }
      responses:
        '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/AccountDeleteResponse' } } } }
        default: { $ref: '#/components/responses/Error' }
  /account-delete/execute:
    post:
      tags: [internal]
      operationId: accountDeleteExecute
      security: [ { internalSecret: [] } ]
      responses:
        '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/AccountDeleteExecuteResponse' } } } }
  /revenuecat-webhook:
    post:
      tags: [internal]
      operationId: revenuecatWebhook
      security: [ { revenuecatSecret: [] } ]
      requestBody:
        required: true
        content: { application/json: { schema: { $ref: '#/components/schemas/RevenueCatWebhook' } } }
      responses:
        '200': { description: Processed or ignored }
        '401': { $ref: '#/components/responses/Error' }
  /notifications-dispatch:
    post:
      tags: [internal]
      operationId: notificationsDispatch
      security: [ { internalSecret: [] } ]
      requestBody:
        content: { application/json: { schema: { $ref: '#/components/schemas/NotificationsDispatchRequest' } } }
      responses:
        '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/NotificationsDispatchResponse' } } } }
  /prices-refresh:
    post:
      tags: [internal]
      operationId: pricesRefresh
      security: [ { internalSecret: [] } ]
      requestBody:
        content: { application/json: { schema: { $ref: '#/components/schemas/PricesRefreshRequest' } } }
      responses:
        '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/PricesRefreshResponse' } } } }
  /analytics-rollup:
    post:
      tags: [internal]
      operationId: analyticsRollup
      security: [ { internalSecret: [] } ]
      requestBody:
        content: { application/json: { schema: { $ref: '#/components/schemas/AnalyticsRollupRequest' } } }
      responses:
        '200': { description: OK, content: { application/json: { schema: { $ref: '#/components/schemas/AnalyticsRollupResponse' } } } }
components:
  securitySchemes:
    bearerAuth: { type: http, scheme: bearer, bearerFormat: JWT }
    apiKey: { type: apiKey, in: header, name: apikey }
    internalSecret: { type: apiKey, in: header, name: x-internal-secret }
    revenuecatSecret: { type: http, scheme: bearer }
  parameters:
    RequestId: { name: X-Request-Id, in: header, schema: { type: string, format: uuid } }
    AppVersion: { name: X-App-Version, in: header, required: true, schema: { type: string } }
    ApiVersion: { name: X-Api-Version, in: header, schema: { type: string, default: '2026-10-01' } }
    IdempotencyKey: { name: Idempotency-Key, in: header, required: true, schema: { type: string, format: uuid } }
  headers:
    RetryAfter: { schema: { type: integer } }
    RateLimitRemaining: { schema: { type: integer } }
  responses:
    Error:
      description: Error envelope
      content: { application/json: { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
    RateLimited:
      description: Rate limited or quota exceeded
      headers:
        Retry-After: { $ref: '#/components/headers/RetryAfter' }
        RateLimit-Remaining: { $ref: '#/components/headers/RateLimitRemaining' }
      content: { application/json: { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
  schemas:
    ErrorEnvelope:
      type: object
      required: [error]
      properties:
        error:
          type: object
          required: [code, message, details]
          properties:
            code: { $ref: '#/components/schemas/ErrorCode' }
            message: { type: string }
            details: { type: object, additionalProperties: true }
    ErrorCode: { type: string, description: 'Generated from ErrorCode Zod enum' }
    # The following are generated from packages/shared/src/contracts/*.ts
    AiChatRequest: { type: object }
    ChatSseEvent: { type: object }
    AiIntakeAssessRequest: { type: object }
    AiIntakeAssessResponse: { type: object }
    AiGeneratePlanRequest: { type: object }
    AiGeneratePlanAccepted: { type: object }
    PlanWorkerRequest: { type: object }
    PlanWorkerResponse: { type: object }
    AiAdjustPlanRequest: { type: object }
    AiAdjustPlanResponse: { type: object }
    AiAnalyzeMealRequest: { type: object }
    AiAnalyzeMealResponse: { type: object }
    AiTranscribeMeta: { type: object }
    AiTranscribeResponse: { type: object }
    GroceryGenerateRequest: { type: object }
    GroceryGenerateResponse: { type: object }
    GrowthComputeRequest: { type: object }
    GrowthComputeResponse: { type: object }
    RamadanGenerateRequest: { type: object }
    RamadanGenerateAccepted: { type: object }
    ExportPdfRequest: { type: object }
    ExportPdfResponse: { type: object }
    HouseholdInviteRequest: { type: object }
    HouseholdInviteResponse: { type: object }
    AccountExportRequest: { type: object }
    AccountExportAccepted: { type: object }
    AccountDeleteRequest: { type: object }
    AccountDeleteResponse: { type: object }
    AccountDeleteExecuteResponse: { type: object }
    RevenueCatWebhook: { type: object }
    NotificationsDispatchRequest: { type: object }
    NotificationsDispatchResponse: { type: object }
    PricesRefreshRequest: { type: object }
    PricesRefreshResponse: { type: object }
    AnalyticsRollupRequest: { type: object }
    AnalyticsRollupResponse: { type: object }
```

## 9. Additions beyond 00-foundations

| Addition | Where |
|---|---|
| `idempotency_keys` table | 2.4 |
| `rate_limit_buckets` table and `consume_rate_limit()` function | 2.7 |
| `activate_meal_plan(uuid)` RPC (and `write_plan_week(uuid, jsonb)` used by the worker, see `04-system-architecture.md`) | 3.3 |
| `meal_plans.generation_progress jsonb` | 4.3 |
| Internal sub-routes `ai-generate-plan/worker`, `account-delete/execute` | 4.3, 4.13 |
| `exports.status` values (`processing`, `ready`, `failed`, `expired`) and `exports.kind` value `account_data` | 4.10, 4.12 |
| `users.deletion_scheduled_for timestamptz` | 4.13 |
| `notifications.kind` value list and unique index `(user_id, kind, scheduled_for)` | 4.15 |
| `prayer_times_cache` table | 4.9 |
| Column privilege revoke on `chat_messages (tool_calls, tokens_in, tokens_out, model)` | 3.8 |
| Error code catalog | 2.3 |
| Headers `X-Api-Version`, `X-App-Version`, `X-App-Build`, `X-Platform`, `x-region`, `x-internal-secret` | 2.2 |
| Chat tool names (provisional; authoritative list in `12-ai-agent-architecture.md`) | 4.1 |
