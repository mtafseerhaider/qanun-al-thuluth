# RevenueCat: configuration runbook

> **Environments:** dev / staging (sandbox purchases) and prod (real purchases), all in one RevenueCat project · **Time:** ~60 min for prod, ~30 min each for staging and dev · **Needs:** a RevenueCat account, the App Store and Play setup from [apple-app-store.md](apple-app-store.md) and [google-play.md](google-play.md), the Supabase CLI and project refs, 1Password vault "Thuluth Platform" · **Related:** [eas-builds.md](eas-builds.md), [supabase-secrets-and-vault.md](supabase-secrets-and-vault.md), [feature-flags-and-app-config.md](feature-flags-and-app-config.md), [password-manager.md](password-manager.md), [`docs/ops/secrets.md`](../ops/secrets.md), [`docs/ops/production-environment.md`](../ops/production-environment.md) Step 6, `17-subscription-architecture.md`

## What this configures

RevenueCat sits between the app and the two stores. The app asks it for the current offering and makes purchases through it (`apps/mobile/src/lib/purchases/purchases.ts`); RevenueCat then tells our backend about every subscription change through the `revenuecat-webhook` Edge Function, which writes `public.subscriptions`. The database function `has_premium()` reads that table, so the server, not the app, decides who has premium. While it is missing: without the SDK keys the paywall shows "store unavailable"; without `REVENUECAT_WEBHOOK_SECRET` every webhook is refused with 401 and no subscription syncs; without `REVENUECAT_SECRET_API_KEY` the lazy entitlement sync is off and account erasure reports `not_configured` for RevenueCat (secrets.md §1).

Menu names in the RevenueCat dashboard change from time to time. They may differ slightly from the labels below.

## Before you start

- [ ] The app records and subscriptions exist and are at least "Ready to Submit": [apple-app-store.md](apple-app-store.md) steps 4 to 6, [google-play.md](google-play.md) steps 3, 5 and 7.
- [ ] The Paid Applications Agreement is active (Apple) and the payments profile exists (Play).
- [ ] The Supabase projects exist and `revenuecat-webhook` is deployed on each one ([supabase-projects.md](supabase-projects.md)).
- [ ] `openssl` on your laptop (to generate the webhook secret).

## How environments map to RevenueCat

There is **one** RevenueCat project, `Thuluth` (17 §2.2). Each bundle id is a separate app inside it. Sandbox purchases come from dev and staging builds and from TestFlight; real purchases only from the production app.

| Environment | App Store app (bundle id) | Play Store app (package) | Webhook goes to | Webhook events | `allow_sandbox_premium` |
|---|---|---|---|---|---|
| dev | `app.thuluth.mobile.dev` (optional) | `app.thuluth.mobile.dev` (optional) | `https://<dev-ref>.supabase.co/functions/v1/revenuecat-webhook` | Sandbox only | on |
| staging | `app.thuluth.mobile.staging` | `app.thuluth.mobile.staging` | `https://<staging-ref>.supabase.co/functions/v1/revenuecat-webhook` | Sandbox only | on |
| prod | `app.thuluth.mobile` | `app.thuluth.mobile` | `https://api.thuluth.app/functions/v1/revenuecat-webhook` | **Production only** | **off, always** |

A store app record is needed for a bundle id before RevenueCat can sell there. If you skip the dev store records, dev builds simply show "store unavailable", and you test purchases on staging builds.

## Steps

### 1. Create the account and project

1. Sign up at https://app.revenuecat.com with a role mailbox (for example `billing@thuluth.app`). Turn on two-factor authentication.
2. **Create new project**, name `Thuluth`.
3. Project settings > **Collaborators**: invite developers as **Developer** or **Viewer**. Keep **Admin** for Tafseer.
4. Project settings > General: set **Restore behaviour** to **Keep with original App User ID** (17 §11). The app logs in with `users.id` as the App User ID and never buys anonymously.

### 2. Add the App Store apps

For each bundle id in the table (prod first):

1. Project > **Apps and providers** (or "Apps") > **+ New** > **App Store**.
2. App name `Thuluth iOS Prod` (or `Staging`, `Dev`). Bundle ID `app.thuluth.mobile` (or `.staging`, `.dev`).
3. **In-app purchase key configuration**: upload the In-App Purchase key `.p8` from [apple-app-store.md](apple-app-store.md) step 6, with its Key ID and Issuer ID. (1Password: "shared asc-iap-key-revenuecat".)
4. **App Store Connect API**: optionally upload the "shared asc-api-key-revenuecat" key so RevenueCat can import products.
5. Save. Copy the **Apple Server to Server notification URL** that RevenueCat shows and paste it into App Store Connect for that app, both Production and Sandbox, version 2 ([apple-app-store.md](apple-app-store.md) step 5 point 6).
6. Open **API keys** for the project and copy this app's **public SDK key** (starts with `appl_`). It goes into the EAS variable `EXPO_PUBLIC_RC_IOS_KEY` for that environment (step 7).

### 3. Add the Play Store apps

For each package in the table:

1. **+ New** > **Play Store**. App name `Thuluth Android Prod` (or `Staging`, `Dev`). Package `app.thuluth.mobile` (or `.staging`, `.dev`).
2. **Service account credentials JSON**: upload the RevenueCat service account key from [google-play.md](google-play.md) step 7 (1Password: "prod play-service-account-revenuecat"). The same key works for every package in the same Play developer account. It can take up to 36 hours before RevenueCat shows it as valid.
3. **Google developer notifications**: **Connect to Google**, then paste the topic into the Play Console ([google-play.md](google-play.md) step 7 point 6).
4. Copy the app's **public SDK key** (starts with `goog_`). It goes into `EXPO_PUBLIC_RC_ANDROID_KEY` for that environment.

### 4. Products

Product catalog > **Products** > **+ New** (or **Import** if the App Store Connect API key was added). Create these exactly, matching `packages/shared/src/constants/products.ts`:

| App | Product identifier in RevenueCat | Type |
|---|---|---|
| iOS prod | `thuluth_premium_monthly` | Subscription |
| iOS prod | `thuluth_premium_annual` | Subscription |
| Android prod | `thuluth_premium_monthly:monthly` | Subscription |
| Android prod | `thuluth_premium_annual:annual` | Subscription |
| iOS staging | `thuluth_premium_monthly_staging`, `thuluth_premium_annual_staging` | Subscription (Apple ids are unique per account, see [apple-app-store.md](apple-app-store.md) step 5) |
| Android staging | `thuluth_premium_monthly:monthly`, `thuluth_premium_annual:annual` | Subscription |
| dev apps (if created) | as staging, with `_dev` on iOS | Subscription |

The Android identifiers are `<subscription id>:<base plan id>`, because Play has two subscriptions, each with one base plan (17 §2.1, [google-play.md](google-play.md) step 5).

### 5. Entitlement

Product catalog > **Entitlements** > **+ New**:

1. Identifier: **`premium`** (exactly; `PREMIUM_ENTITLEMENT` in `products.ts` and `ENTITLEMENT_ID` in `purchases.ts`). Description: "Thuluth Premium".
2. **Attach** every product from step 4, on every app.

Do not create a `coach` entitlement yet. It is Phase 2 (17 §2.1).

### 6. Offering and packages

The app shows whatever offering is marked **Current** (`getOfferings().current`), and recognises plans by package type.

1. Product catalog > **Offerings** > **+ New**. Identifier **`default`**, display name "Default".
2. Add two packages:

| Package identifier | Products attached (one per app) |
|---|---|
| `$rc_annual` (Annual) | `thuluth_premium_annual` (iOS prod), `thuluth_premium_annual:annual` (Android prod), and the staging and dev annual products |
| `$rc_monthly` (Monthly) | `thuluth_premium_monthly`, `thuluth_premium_monthly:monthly`, and the staging and dev monthly products |

3. Metadata (Offering > **Metadata** > edit JSON), from 17 §2.3:

```json
{ "highlight": "$rc_annual", "headline_key": "paywall.headline.default", "badge_key": "paywall.badge.save_40", "show_trial_timeline": true }
```

4. **Make current** on the `default` offering.

The `ramadan`, `winback` and `pk_launch` offerings in 17 §2.3 are later work (Targeting rules and promotional offers). Create them only when that work starts.

### 7. Public SDK keys into EAS

For each environment, set the two public keys from steps 2 and 3 ([eas-builds.md](eas-builds.md) step 3):

```bash
eas env:create --environment production --name EXPO_PUBLIC_RC_IOS_KEY --value <appl-key-for-app.thuluth.mobile> --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_RC_ANDROID_KEY --value <goog-key-for-app.thuluth.mobile> --visibility plaintext
# repeat with --environment preview (staging keys) and --environment development (dev keys)
```

These keys are public by design (they ship inside the app). They take effect in the next build or in an update published with `--environment`. Save them in 1Password as "prod EXPO_PUBLIC_RC_IOS_KEY", "staging EXPO_PUBLIC_RC_IOS_KEY" and so on, for convenience.

### 8. Secret API key and webhook (per backend)

**Secret API key** (`REVENUECAT_SECRET_API_KEY`):

1. Project settings > **API keys** > **+ New secret API key**. Name it after the environment, for example `thuluth-prod-edge`. Choose **v1** (the functions call `GET https://api.revenuecat.com/v1/subscribers/{id}`).
2. Save it in 1Password as "prod REVENUECAT_SECRET_API_KEY" (and "staging ...", "dev ..." for separate keys per environment, so one can be revoked alone).

**Webhook secret** (`REVENUECAT_WEBHOOK_SECRET`):

```bash
openssl rand -hex 32
```

Save the output as "prod REVENUECAT_WEBHOOK_SECRET" in 1Password. Use a **new** value per environment, never reused from dev or staging. The code ignores values shorter than 16 characters.

**Set both as function secrets** on the matching Supabase project (method in [supabase-secrets-and-vault.md](supabase-secrets-and-vault.md)):

```bash
supabase secrets set --project-ref <prod-ref> --env-file ./.env.functions.prod   # contains both names; delete the file afterwards
```

**Create the webhook** in RevenueCat: Project > **Integrations** > **Webhooks** > **+ Add new configuration**:

| Field | prod | staging | dev |
|---|---|---|---|
| Name | `thuluth-prod` | `thuluth-staging` | `thuluth-dev` |
| Webhook URL | `https://api.thuluth.app/functions/v1/revenuecat-webhook` | `https://<staging-ref>.supabase.co/functions/v1/revenuecat-webhook` | `https://<dev-ref>.supabase.co/functions/v1/revenuecat-webhook` |
| Authorization header value | `Bearer <prod REVENUECAT_WEBHOOK_SECRET>` | `Bearer <staging secret>` | `Bearer <dev secret>` |
| Environment to send events for | **Production** | **Sandbox** | **Sandbox** |
| App filter | the two prod apps | the two staging apps | the two dev apps |
| Events | All events | All events | All events |

Type the word `Bearer`, one space, then the secret. RevenueCat sends the field as the whole `Authorization` header, and `requireRevenueCat` in `supabase/functions/_shared/auth.ts` compares the whole header with `Bearer <secret>`. A missing `Bearer ` prefix gives 401.

Use `https://<prod-ref>.supabase.co/functions/v1/revenuecat-webhook` for prod only until the custom domain `api.thuluth.app` is live, then switch.

Why the environment filter matters: the production function also drops any `SANDBOX` event (it answers `{"ok":true,"ignored":"sandbox"}`), so sandbox purchases can never grant real premium. On dev and staging the function stores sandbox events, and `has_premium()` counts them only when step 9 is done.

### 9. Let sandbox purchases grant premium on dev and staging only

On **thuluth-dev** and **thuluth-staging** only (SQL editor, as `postgres`):

```sql
-- once per project; 'development' on dev, 'staging' on staging
alter database postgres set app.environment = 'staging';
update public.feature_flags set enabled = true where key = 'allow_sandbox_premium';
```

`has_premium()` counts a sandbox row only when **both** hold: the flag is on and the database setting `app.environment` is `local`, `development`, `staging` or `test`. If either is missing, sandbox purchases are stored but do not unlock premium. Never enable the flag on `thuluth-prod`; the seed ships it off. The flag mechanism is described in [feature-flags-and-app-config.md](feature-flags-and-app-config.md).

### 10. Demo account entitlement (prod)

For the store reviewer account ([`docs/store/demo-account.md`](../store/demo-account.md)): Customers > search the reviewer's App User ID (their `users.id`) > **Grant promotional entitlement** > `premium`, duration one year (or lifetime). The webhook stores it as `store = 'promotional'`.

### 11. Sandbox purchase test

1. Install a staging build (`preview` or `staging-store` from [eas-builds.md](eas-builds.md)).
2. iOS: in Settings > App Store > **Sandbox Account**, sign in with a sandbox tester ([apple-app-store.md](apple-app-store.md) step 8). Android: add the tester's Google account under Play Console > Settings > **License testing**, and install from the internal testing track.
3. Sign in to Thuluth with a test account. More > **Thuluth Premium**. The paywall shows the annual and monthly prices from the store (not hard-coded) and "7 days free" on annual.
4. Buy the annual plan. Sandbox renewals are fast (an annual plan renews every hour in Apple sandbox).
5. Check RevenueCat > Customers > the user: entitlement `premium` active, sandbox.
6. Check the staging database (SQL editor):

```sql
select event_id, type, environment, processed_at, error
from public.revenuecat_events order by received_at desc limit 5;
-- expect INITIAL_PURCHASE, SANDBOX, processed_at set, error null

select store, product_id, status, tier, environment, current_period_end
from public.subscriptions where user_id = '<test-user-id>';
-- expect app_store or play_store, active, premium, sandbox

select public.has_premium('<test-user-id>');
-- expect true (only with step 9 done)
```

7. In the app, premium features open without restarting (AC-SUB1).

## Where the values go

| Value | Where it is set | Name |
|---|---|---|
| iOS public SDK key (per environment) | EAS env | `EXPO_PUBLIC_RC_IOS_KEY` |
| Android public SDK key (per environment) | EAS env | `EXPO_PUBLIC_RC_ANDROID_KEY` |
| Secret API key v1 (per environment) | Supabase function secret | `REVENUECAT_SECRET_API_KEY` |
| Webhook secret (per environment) | Supabase function secret, and RevenueCat webhook "Authorization header value" as `Bearer <secret>` | `REVENUECAT_WEBHOOK_SECRET` |
| Next webhook secret (rotation only) | Supabase function secret | `REVENUECAT_WEBHOOK_SECRET_NEXT` |
| Sandbox premium switch (dev and staging) | `public.feature_flags` row and `app.environment` database setting | `allow_sandbox_premium` |
| In-App Purchase key, Play service account | RevenueCat app settings | none in the repo |

## Verify

```bash
# 1. The webhook refuses unsigned calls (also part of tooling/scripts/ops/smoke.sh)
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://api.thuluth.app/functions/v1/revenuecat-webhook \
  -H 'content-type: application/json' -d '{}'
# expect 401

# 2. The secrets exist (digests only)
supabase secrets list --project-ref <prod-ref> | grep REVENUECAT
# expect REVENUECAT_WEBHOOK_SECRET and REVENUECAT_SECRET_API_KEY
```

3. RevenueCat > Integrations > Webhooks > the prod configuration > **Send test event**. Expect a 200 in the delivery log. The function answers `{"ok":true,"note":"test_event"}` and stores the event with `error = 'test_event'`.
4. Sandbox purchase test (step 11) passes on staging.
5. Production: after the first real purchase (or the reviewer's promotional grant), `select type, environment, error from public.revenuecat_events order by received_at desc limit 5;` on prod shows `PRODUCTION` events with `error` null.

## Rotate or revoke

| Item | Cadence (secrets.md) | How |
|---|---|---|
| `REVENUECAT_WEBHOOK_SECRET` | 180 days | Generate a new value. Set it as `REVENUECAT_WEBHOOK_SECRET_NEXT` (the function accepts both). Change the RevenueCat webhook header to `Bearer <new>`. Send a test event (200). Then set `REVENUECAT_WEBHOOK_SECRET` to the new value and unset `_NEXT` with `supabase secrets unset REVENUECAT_WEBHOOK_SECRET_NEXT --project-ref <ref>`. |
| `REVENUECAT_SECRET_API_KEY` | 180 days | Create a new secret key and set it on the function. Wait for the next real webhook delivery and check that its `revenuecat_events` row has `processed_at` set and `error` null (test events do not call the API). Then delete the old key in RevenueCat |
| Public SDK keys | only if RevenueCat reissues them | update the EAS variables and rebuild or publish an update with `--environment` |
| Collaborators | on staff change | remove them in Project settings |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Webhook deliveries fail with 401 | Header value missing `Bearer `, a typo, a secret shorter than 16 characters, or the function secret not set on that project | Re-enter `Bearer <secret>` exactly; `supabase secrets list` on the right project |
| Deliveries return 200 but nothing changes; `revenuecat_events.error = 'no_known_user'` | The App User ID is not a `users.id` in that database (a purchase made on another environment, or before sign-in) | Check the webhook app filter and environment; the app only configures purchases after sign-in |
| Prod answers `"ignored":"sandbox"` | A sandbox event reached the prod webhook | Set the prod webhook's environment filter to **Production** only |
| Sandbox purchase works but the app stays free on staging | `allow_sandbox_premium` off, or `app.environment` not set on the database | Step 9; new database sessions pick up the setting |
| Paywall shows "store unavailable" | The build has no `EXPO_PUBLIC_RC_*_KEY`, no offering is **Current**, or the products are not approved or not "Ready to Submit" | Check the EAS environment and the build's variables; make `default` current; check product status in the store consoles |
| Deliveries return 503 and RevenueCat retries | `REVENUECAT_SECRET_API_KEY` is set but invalid, so the subscriber refetch fails (`UPSTREAM_UNAVAILABLE`) | Replace the key (v1 secret key of this project) |
