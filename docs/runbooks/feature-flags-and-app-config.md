# Feature flags and app config: configuration runbook

> **Environments:** dev / staging / prod · **Time:** ~20 min per environment at setup, seconds per later change · **Needs:** SQL access as `postgres` (dashboard SQL editor) or an admin account · **Related:** `19-deployment-architecture.md` §11 and §12.4, [`../ops/launch-runbook.md`](../ops/launch-runbook.md) §2 and §5, [`../ops/backups-and-pitr.md`](../ops/backups-and-pitr.md) §2.1, `supabase/seed/catalog/160_feature_flags.sql`, [`supabase-projects.md`](supabase-projects.md), [`ai-providers.md`](ai-providers.md)

The Supabase dashboard menu names may differ slightly from this runbook.

## What this configures

The table `public.feature_flags` turns features on and off without a release. It holds config values (AI caps, minimum app version), kill switches for shipped features, and release flags for features not yet public. The catalog seed creates every flag with a safe default, and **never changes `enabled` or `rules` again**, so your changes survive every deploy. The app reads flags through `evaluate_feature_flags()` and refreshes them within about 5 minutes or at the next launch. The Edge Functions read the table on each request. A separate database setting, `app.environment`, tells the database whether it is production. Two flags only work when it says dev or staging.

## Before you start

- The project exists and the catalog seeds ran ([`supabase-projects.md`](supabase-projects.md) step 8).
- `app.environment` is set on dev and staging ([`supabase-projects.md`](supabase-projects.md) step 7).
- You know what each flag does. Read the tables in step 2 first.

## Steps

### 1. View the flags

```sql
select key, enabled, rules, updated_at from public.feature_flags order by key;
```

On a fresh project you see 23 rows.

### 2. What each flag does, and the value per environment

How to read the tables:

- "At launch" means the value in prod on launch day.
- **Server-side**, a flag with **no row** counts as **on** (`featureEnabled` in `supabase/functions/_shared/platform.ts` returns true for a missing row). **In the app**, a missing flag counts as **off** (`selectFlag` default).
- `rules` keys understood by `evaluate_feature_flags()`: `user_ids`, `countries`, `tiers`, `min_app_version`, `percent`. The `value` key carries config data.

#### Config flags

| Key | What it does in the code today | dev | staging | prod at launch |
|---|---|---|---|---|
| `ai.caps` | Per-tier AI limits. `ai_quota_check` reads `per_day` counts, `monthly_hard_usd_micros` and `degrade_route`. `ai-chat` reads `daily_hard_usd_micros` per tier and `global_daily_usd_micros`. If the flag is off, built-in defaults apply | on | on | **on**, values below |
| `catalog.include_in_review` | Users also see `in_review` recipes, meals, portions and meal alternatives (internal alpha). Works only when `app.environment` is `local`, `development`, `staging` or `test` | **on** | **on** | **off. Never on in prod** |
| `allow_sandbox_premium` | Sandbox (test) RevenueCat purchases grant premium. Works only when `app.environment` is dev or staging, like the flag above | **on** | **on** | **off. Never on in prod** |
| `app.min_supported_version` | Holds `{"value":{"ios":"1.0.0","android":"1.0.0"}}`. The app compares its own version with the value for its platform and, when it is older, shows a blocking "update required" screen with a store button (forced upgrade; a function answering `UPGRADE_REQUIRED` has the same effect). Optional `ios_store_url` and `android_store_url` in `value` set the store link; without `ios_store_url` the iOS button opens the App Store home page, so add `https://apps.apple.com/app/id<asc-app-id>` once the record exists ([apple-app-store.md](apple-app-store.md) step 4). Raise the versions only after the newer build is live in both stores. The app reads it only when signed in; missing, unreadable or offline flags never block | `1.0.0` | `1.0.0` | **on, `1.0.0` for both** |
| `app.critical_update` | Holds `update_group_ids` for a forced OTA reload. **No code reads it yet** | off | off | off |
| `catalog_version` | Holds `{"value":1}` to bust client catalog caches. **No code reads it yet** | on, 1 | on, 1 | on, 1 |
| `exports.kinds` | Holds the enabled export kinds. **No code reads it yet** (the kinds are fixed in `packages/shared/src/contracts/export-pdf.ts`) | on | on | on |
| `chat.free_route` | Meant to send free chat to route `chat.free`. **No code reads it**: free users always use `chat.free` (`chatRouteForTier`) | on | on | on (no effect) |

**AI cost caps (PO decision 2026-10-06).** Free users: **$0.10 per day** each. Premium users: **$0.60 per day** each; above that, premium chat drops to the cheaper `chat.free` route. Everyone together: **$100 per day** for chat; above that, free chat stops for the day and premium chat moves to `chat.free`. In `ai.caps` rules these are, in micro-dollars (1 USD = 1,000,000):

| Rules path | Value | Meaning |
|---|---|---|
| `free.daily_hard_usd_micros` | `100000` | $0.10 |
| `premium.daily_hard_usd_micros` | `600000` | $0.60 |
| `global_daily_usd_micros` | `100000000` | $100 |
| `free.monthly_hard_usd_micros` / `premium.monthly_hard_usd_micros` | `500000` / `8000000` | $0.50 / $8 per month (`ai_quota_check`) |
| `free.per_day` / `premium.per_day` | chat 20 / 200, photo 0 / 15, voice 0 / 40, plan changes 0 / 20 | messages or calls per day |

The current seed file already holds these keys. A project seeded **before** they were added keeps its old rules, because the seed never overwrites rules. `ai-chat` falls back to the same numbers when the keys are missing, so behaviour is identical, but add them so the table shows the truth:

```sql
update public.feature_flags
   set rules = jsonb_set(jsonb_set(jsonb_set(rules,
               '{free,daily_hard_usd_micros}', '100000'),
               '{premium,daily_hard_usd_micros}', '600000'),
               '{global_daily_usd_micros}', '100000000')
 where key = 'ai.caps'
returning key, rules;
```

These caps only bite when `ai_usage.cost_usd_micros` is above 0. The route prices that make it non-zero ship in the catalog seed ([`ai-providers.md`](ai-providers.md) step 6).

#### Kill switches (on means the feature works)

| Key | What turning it **off** does | dev | staging | prod at launch |
|---|---|---|---|---|
| `app.maintenance` | Turning it **on** puts the whole product in maintenance: the app shows its "We'll be right back" screen (also shown as soon as any function answers with the maintenance reason), every user-facing Edge Function answers 503 `FEATURE_DISABLED` with `details.reason = 'maintenance'`, and `health` reports `degraded` (check `maintenance`). See "Maintenance mode" below | off | off | **off** |
| `ai.chat.enabled` | `ai-chat` returns `FEATURE_DISABLED`; the app hides chat | on | on | **on** |
| `ai.vision.enabled` | `ai-analyze-meal` returns `FEATURE_DISABLED`; the app hides photo logging | on | on | **on** |
| `ai.voice.enabled` | `ai-transcribe` returns `FEATURE_DISABLED`; the app hides voice | on | on | **on** |
| `ai.plan.enabled` | `ai-adjust-plan` refuses; `ai-generate-plan` and `ramadan-generate` use templates only | on | on | **on** |
| `plan.generate.enabled` | `ai-generate-plan` and `ramadan-generate` refuse entirely | on | on | **on** |
| `ramadan.generate.enabled` | `ramadan-generate` refuses Ramadan plans (`FEATURE_DISABLED`) | on | on | **on** |
| `grocery.generate.enabled` | `grocery-generate` refuses grocery lists | on | on | **on** |
| `growth.compute.enabled` | `growth-compute` refuses new growth measurements | on | on | **on** |
| `exports.pdf.enabled` | `export-pdf` refuses PDF exports | on | on | **on** |

A project seeded before these four rows existed gets them, switched on, at the next catalog-seed run. A server kill switch with no row still counts as on.

**Maintenance mode** (`app.maintenance`, used in [`../ops/launch-runbook.md`](../ops/launch-runbook.md) §5 and [`../ops/backups-and-pitr.md`](../ops/backups-and-pitr.md) §2.1):

- Functions read the flag through `supabase/functions/_shared/maintenance.ts` and cache it for 15 seconds per instance, so a change takes effect within about 15 seconds on the server, and within about 5 minutes (or at the next launch) in the app.
- These keep running during maintenance: `health` (it reports `degraded`), `revenuecat-webhook` (store events are still recorded), the cron-only functions (`ai-reassess`, `analytics-rollup`, `notifications-dispatch`, `prices-refresh`), and internal calls inside other functions (requests with the `x-internal-secret` header, and the `/worker` and `/execute` routes). So scheduled pushes still go out. Turn off `ai.*` or other kill switches as well if a job must stop.
- If the flag cannot be read, functions treat maintenance as off (it is an operator tool, not a security control).
- Post the maintenance on the status page ([uptime-and-status-page.md](uptime-and-status-page.md)) at the same time.

#### Release flags and experiments

| Key | What it does | dev | staging | prod at launch |
|---|---|---|---|---|
| `ramadan_planner` | Shows the Ramadan planner, its deep links and Ramadan notifications in the app | on | on | **on** |
| `photo_meal_analysis` | Rules `{"tiers":["premium"]}`. **No code reads it**; photo analysis is gated by `ai.vision.enabled` and premium | either | either | either (no effect) |
| `debug_menu` | Hidden debug screen | on | testers only | **never globally**; testers only if needed |
| `paywall.variant` | Paywall copy test. **No code reads it yet** | off | off | off |
| `autism.food_chaining` | Food chaining strategy in the autism ladder editor (`apps/mobile/src/features/autism/`, premium in the app) | either | either | **off** until a paediatric dietitian or feeding specialist has reviewed the ingredient textures and colours (seed description), then on |

**Turning a flag on for named testers only.** `user_ids` adds people, but it does not exclude anyone. With `enabled = true` and only `user_ids`, **everyone** gets the flag. Add `"percent":0` so nobody else qualifies:

```sql
update public.feature_flags
   set enabled = true, rules = '{"percent":0,"user_ids":["<user uuid>","<user uuid>"]}'
 where key = 'debug_menu'
returning key, enabled, rules;
```

The seed now ships `debug_menu` with rules `{"percent":0,"user_ids":[]}`. A project seeded earlier keeps its old `{}` rules, because the seed never overwrites rules, so always set `"percent":0` yourself as above.

### 3. Change a flag safely

1. Write down the current row (step 1).
2. Change exactly one key, and make the statement return the row so you can see what changed:

```sql
update public.feature_flags set enabled = true where key = 'ramadan_planner'
returning key, enabled, rules;
```

3. Check that one row came back. Zero rows means a typo in the key; nothing changed.
4. To change one value inside `rules`, use `jsonb_set` (see the `ai.caps` example) rather than retyping the whole JSON.
5. Every change is written to `audit_log`:

```sql
select at, action, diff from public.audit_log
 where entity = 'feature_flags' order by at desc limit 10;
```

6. In prod, write the change and the reason in the on-call channel. For the launch flags, tick the box in the S7 issue.

The functions see the change on their next request. The app sees it within about 5 minutes, or at the next launch.

### 4. Set the launch values on prod

Run this once on `thuluth-prod` before launch ([`../ops/launch-runbook.md`](../ops/launch-runbook.md) §2):

```sql
begin;
update public.feature_flags set enabled = true  where key = 'ramadan_planner';
update public.feature_flags set enabled = false where key in ('catalog.include_in_review', 'allow_sandbox_premium', 'app.maintenance', 'debug_menu', 'autism.food_chaining');
update public.feature_flags set enabled = true  where key in ('ai.chat.enabled','ai.vision.enabled','ai.voice.enabled','ai.plan.enabled','plan.generate.enabled',
  'ramadan.generate.enabled','grocery.generate.enabled','growth.compute.enabled','exports.pdf.enabled','ai.caps');
update public.feature_flags set enabled = true,
       rules = '{"value":{"ios":"1.0.0","android":"1.0.0","ios_store_url":"https://apps.apple.com/app/id<asc-app-id>"}}'
 where key = 'app.min_supported_version';
select key, enabled, rules from public.feature_flags order by key;
commit;
```

Check the `select` output before `commit`. Run `rollback;` instead if anything looks wrong.

For dev and staging, run:

```sql
update public.feature_flags set enabled = true
 where key in ('catalog.include_in_review', 'allow_sandbox_premium', 'ramadan_planner')
returning key, enabled;
```

### 5. The `app.environment` database setting

`catalog.include_in_review` and `allow_sandbox_premium` work only when the database setting `app.environment` is `local`, `development`, `staging` or `test` (`public.catalog_review_statuses()` and `public.has_premium()`). An unset or unknown value counts as production, so a flag turned on in prod by mistake does nothing. That is the safety net.

How it is set:

| Environment | How | Value |
|---|---|---|
| local stack | `supabase/seed/local/900_dev_fixtures.sql` sets it on `supabase db reset` | `local` |
| `thuluth-dev` | once, by hand: `alter database postgres set app.environment = 'development';` then restart the project | `development` |
| `thuluth-staging` | once, by hand: `alter database postgres set app.environment = 'staging';` then restart | `staging` |
| `thuluth-prod` | nothing | unset |

No migration or workflow sets it on hosted projects. The full steps are in [`supabase-projects.md`](supabase-projects.md) step 7. Check it from a new SQL editor tab:

```sql
select current_setting('app.environment', true) as app_environment;
```

## Where the values go

| Value | Where it is set | Name |
|---|---|---|
| Every flag | table `public.feature_flags` (seed `160_feature_flags.sql` creates them) | keys above |
| AI caps | `feature_flags['ai.caps'].rules` | `daily_hard_usd_micros`, `global_daily_usd_micros`, `monthly_hard_usd_micros`, `per_day` |
| Environment marker | database setting | `app.environment` |
| Function environment | function secret | `APP_ENV` ([`supabase-secrets-and-vault.md`](supabase-secrets-and-vault.md)) |

## Verify

| Check | How | Expect |
|---|---|---|
| Prod flags | step 1 query on prod | `ramadan_planner` on; `catalog.include_in_review`, `allow_sandbox_premium`, `app.maintenance`, `debug_menu` off; all nine feature kill switches on |
| Gate is closed in prod | `select current_setting('app.environment', true);` on prod | empty or `production` |
| Gate is open on staging | the same on staging | `staging` |
| Health | `curl -s https://api.thuluth.app/functions/v1/health` | `"maintenance":"ok"` in the checks, overall `ok` |
| App | sign in on a prod build and open More | the Ramadan planner entry is visible |

## Rotate or revoke

Flags are not secrets, so nothing to rotate. Review them with each release:

- Remove release flags within two releases of reaching 100 percent (19 §11). Removing a flag is a code change plus a migration. Never just delete the row: for server kill switches a missing row means on.
- `catalog.include_in_review` goes away once the catalog is dietitian-verified.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| A flag change has no effect in the app | the app caches flags for about 5 minutes | wait, or close and reopen the app |
| `in_review` recipes still hidden on staging with the flag on | `app.environment` not set, or set without a restart | step 5 |
| Sandbox purchases do not give premium on staging | `allow_sandbox_premium` off, or `app.environment` not set | step 4 dev and staging block, and step 5 |
| `update ... returning` returns no rows | the key is misspelled (keys use dots and underscores exactly as listed) | copy the key from step 1 output |
| `app.maintenance` on, but users can still use the app | the app refreshes flags about every 5 minutes, and functions cache the flag for 15 seconds | wait; the server side refuses requests within about 15 seconds anyway |
| Users get the update screen although they have the newest version | `app.min_supported_version` was raised before the build was live in that store | lower it again at once, then raise it after release |
| Food chaining missing in the app | `autism.food_chaining` is off (the seed default) | turn it on after the dietitian review (step 3) |
