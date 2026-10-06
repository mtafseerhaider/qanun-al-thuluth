# Production environment as code (`thuluth-prod`)

> **Story:** S7-06 (NFR 9.7; `22-mvp-roadmap.md` §7.6 T1, T2, T4, T5, T6, T13) · **Owner:** backend prepares, PO runs · **Related:** `19-deployment-architecture.md` §1, §6 to §10, `20-ci-cd-pipeline.md` §7 and §10, `secrets.md`, `backups-and-pitr.md`, `sentry-alerts.md`, `launch-runbook.md`

Everything that can be code is code in the repo. Everything else is listed below, **in the order the owner does it**. No production account, credential or deploy has been made from the repo or by an agent. Tick each box in the S7 sprint issue as you go.

## 1. What is in the repo

| Piece | Path | What it does |
|---|---|---|
| Production deploy workflow | `.github/workflows/deploy-prod.yml` | Manual dispatch with a `vX.Y.Z` tag. Job 1 (`production-readonly`) does a dry-run `db push` and posts it to the summary. Job 2 (`production`, needs the PO's approval) pushes migrations, catalog seeds, `GIT_SHA`/`APP_ENV` and every Edge Function, then runs the smoke test. It fails loudly if any secret is missing. |
| Rollout and rollback workflow | `.github/workflows/rollback-prod.yml` | OTA rollout %, republish of the last good update, channel pinning, function redeploy from a tag (all behind `production` approval) |
| Nightly offsite backup | `.github/workflows/backup-prod.yml` | Dump, then `age` encryption, then upload to a retention-locked GCS bucket. Skips with a notice until it is configured. |
| Catalog seeds for hosted projects | `tooling/scripts/ops/apply-catalog-seeds.sh` | Applies `supabase/seed/catalog/*.sql` only, never `seed/local/*` |
| Vault bootstrap and rotation | `tooling/scripts/ops/vault-secrets.sh` | `project_url`, `cron_secret`, `audit_ip_salt` from env vars |
| Smoke test | `tooling/scripts/ops/smoke.sh` | health 200, webhook and cron auth return 401, anon cannot read tables |
| Status endpoint | `supabase/functions/health` (`GET /functions/v1/health`, no JWT) | `ok` / `degraded` (200) / `down` (503) from `ops_health()`: database, feature flags, cron failures, stuck pushes, maintenance flag |
| Launch KPIs and alerts | migration `20261006150100_launch_kpis.sql`, `analytics-rollup` | see `analytics-launch-dashboard.md` |
| Secret inventory | `docs/ops/secrets.md` | names and locations only |

`deploy-dev.yml` pushes migrations with plain `supabase db push` and then applies only the catalog seeds with `tooling/scripts/ops/apply-catalog-seeds.sh` (skipped with a notice until the `development` environment has a `SUPABASE_DB_URL` secret), the same as production. Neither workflow uses `--include-seed`: the seed list in `supabase/config.toml` also holds `seed/local/000_local_vault.sql` (throwaway Vault values, `project_url = http://host.docker.internal:54321`) and `900_dev_fixtures.sql`. Until 2026-10-06 `deploy-dev.yml` did use `--include-seed`, so `thuluth-dev` may still hold the local Vault values (the file only inserts missing names) and the dev fixture rows. Check `select name from vault.secrets` on dev, set real values with `tooling/scripts/ops/vault-secrets.sh`, and remove the fixture accounts by hand if they are not wanted.

## 2. Owner steps, in order

### Step 1: accounts and projects (day 1)

- [ ] **Supabase:** in the Pro org, create project `thuluth-prod` in `eu-central-1` on Postgres 17 (matches `config.toml`). Compute: **Large** at launch (19 §6). Save the DB password in 1Password.
- [ ] **Supabase add-ons:** turn on PITR (7 days) and the custom domain `api.thuluth.app`. The steps are in `backups-and-pitr.md` §1.
- [ ] **Supabase settings** to match `supabase/config.toml` (Auth rate limits, `enable_anonymous_sign_ins = false`, refresh-token rotation, reuse interval 10 s, OTP length and expiry, MFA TOTP). Also: SSL enforcement on, **spend cap off with billing alerts on**, and network restrictions limited to the GitHub runner egress plus admin IPs (19 §6).
- [ ] **Auth providers:** Google (prod client) and Apple (Services ID `app.thuluth.mobile`). Redirect URLs `thuluth://*` and `https://thuluth.app/*`. CAPTCHA (hCaptcha secret). SMTP set to the Postmark production server. See `secrets.md` §3.
- [ ] **Security settings** (from the S7-03 review, `docs/security/s7-security-review.md` §6 and §7):
  - [ ] API > Exposed schemas: **`public` only**. Remove `graphql_public` (S7-SEC-13); the app does not use GraphQL. Or turn off the `pg_graphql` extension (Database > Extensions), per 16 §16.3.
  - [ ] Auth > Rate limits: the same values as `[auth.rate_limit]` in `supabase/config.toml` (email sent 30/h, sign-ins 30/h per IP, token verifications 30/h, refresh 150/h).
  - [ ] Auth > Bot and abuse protection: **CAPTCHA on** (hCaptcha) for OTP requests, with `HCAPTCHA_SECRET` set. The site key goes to the app.
  - [ ] Settings > JWT keys: **asymmetric signing keys** (ES256 or RS256) in use and the legacy HS256 secret rotated out, so `getClaims` verifies locally. Access tokens stay valid until `jwt_expiry` (3600 s) even after the account-delete session revocation; only refresh tokens are revoked at once.
  - [ ] Storage: leave `storage.allow_delete_query` **unset** (deletes go through the Storage API), and check every bucket has its size and MIME limits from the migrations (`select id, file_size_limit, allowed_mime_types from storage.buckets;`).
  - [ ] Secrets: `INTERNAL_CRON_SECRET` (= Vault `cron_secret`), `REVENUECAT_WEBHOOK_SECRET` and `VAULT_AUDIT_IP_SALT` are each at least 32 random characters (`openssl rand -hex 32`). They must be **new values for prod**, never reused from dev or staging.
  - [ ] Public `health` endpoint: nothing to configure. It caches its database probe for 20 s per isolate (S7-SEC-14). Optionally add a gateway rate limit at Cloudflare if `api` is ever proxied.
- [ ] **DNS (Cloudflare):** `api` CNAME (DNS only, not proxied) plus the TXT verification for the Supabase custom domain. Add `status` CNAME to the status page. Add the Postmark DKIM and return-path records. The SPF and DMARC records are in 19 §9.1.

### Step 2: GitHub (day 1)

- [ ] Create environments `production-readonly`, `production` and `production-backup` with the protections in `secrets.md` §4. Set the `production` reviewer to Tafseer, turn on **prevent self-review**, and leave the wait timer at 0.
- [ ] Add the secrets and variables in `secrets.md` §4. Create a dedicated Supabase access token for production.
- [ ] Optional: a tag ruleset `v*` so only maintainers (or the release bot) can create release tags (20 §10).

### Step 3: function secrets and Vault (day 1 to 2)

- [ ] Write `.env.functions.prod` from 1Password using the names in `secrets.md` §1. Run `supabase secrets set --project-ref <ref> --env-file .env.functions.prod`, then delete the file.
- [ ] Generate `INTERNAL_CRON_SECRET` with `openssl rand -hex 32`. Use **the same value** for the Vault `cron_secret`.
- [ ] Run `SUPABASE_DB_URL=… VAULT_PROJECT_URL=https://api.thuluth.app VAULT_CRON_SECRET=… VAULT_AUDIT_IP_SALT=… tooling/scripts/ops/vault-secrets.sh` from a trusted machine on an allowed IP. Export the values from 1Password; never type them inline.

### Step 4: first deploy (day 2)

- [ ] Tag the release candidate (for example `v1.0.0-rc.1` is **not** accepted; use `v1.0.0` or a `v0.9.x` beta tag) and push the tag.
- [ ] Actions > **Deploy production backend** > Run workflow > `ref = vX.Y.Z`. Read the dry-run plan in the summary, then approve `production`.
- [ ] Confirm that the smoke test passed and that `curl https://api.thuluth.app/functions/v1/health` returns `"status":"ok"`.
- [ ] RLS check (T1): run `DB_TEST_MODE=plain tooling/scripts/db-test.sh` on the release commit (green in CI). Then check prod with `select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity;`, which must return 0.
- [ ] Cron check: `select jobname, schedule from cron.job order by 1;` lists the Sprint 0 to 6 jobs. After an hour, `select status, count(*) from cron.job_run_details where start_time > now() - interval '1 hour' group by 1;` should show no failures.
- [ ] Feature flags for prod (T11): set the Ramadan planner on from launch, and check `app.min_supported_version = 1.0.0` and the kill switches.
- [ ] Create the admin account (PO), then set `raw_app_meta_data.role = 'admin'` with the service role.
- [ ] Create the smoke and demo accounts (store review demo account, S7-07). Mark them `users.is_internal = true` so the KPIs exclude them.

### Step 5: OneSignal production app (T4, day 2)

- [ ] Create the OneSignal app **Thuluth Prod**, separate from "Thuluth Dev" (19 §1).
- [ ] iOS: upload an APNs auth key (`.p8`) with the **production** environment, bundle id `app.thuluth.mobile`.
- [ ] Android: upload the FCM v1 service account JSON from the Firebase project linked to `app.thuluth.mobile`.
- [ ] Copy the App ID to the function secret `ONESIGNAL_APP_ID` and the EAS variable `EXPO_PUBLIC_ONESIGNAL_APP_ID`. Put the REST API key in `ONESIGNAL_REST_API_KEY`.
- [ ] Settings: external id = `users.id` (the app already calls `login(userId)`). Allow only the tags `locale` and `tier` (04 §3). Do not enable in-app message analytics or location.
- [ ] Ramadan load test (iftar burst, 19 §14, 22 §9): run `scripts/load/iftar.js` on staging as described in [`load-testing.md`](load-testing.md) and attach the summary to the readiness issue.

### Step 6: RevenueCat production (T5, day 2 to 3)

- [ ] In the existing RevenueCat project, add the **App Store** app (bundle `app.thuluth.mobile`, App Store Connect in-app purchase key) and the **Play Store** app (package `app.thuluth.mobile`, Play service account with financial access).
- [ ] Create the products and the `premium` entitlement and offerings exactly as `packages/shared/src/constants/products.ts` names them. The products must be **approved in both stores** (S7-08).
- [ ] Integrations > Webhooks: add a webhook for **production events only**. URL `https://api.thuluth.app/functions/v1/revenuecat-webhook`. Authorization header `Bearer <REVENUECAT_WEBHOOK_SECRET>`, generated with `openssl rand -hex 32`. The staging webhook stays on sandbox events (19 §1).
- [ ] Put the secret API key (v1) in `REVENUECAT_SECRET_API_KEY` and the public SDK keys in the EAS variables `EXPO_PUBLIC_RC_IOS_KEY` and `EXPO_PUBLIC_RC_ANDROID_KEY`.
- [ ] Test: buy a sandbox purchase on a TestFlight build pointed at staging, check that the `subscriptions` row appears, then use "Send test webhook" against prod and check for a 200.

### Step 7: Sentry (T6, day 3)

- [ ] Create org `thuluth` with projects `thuluth-mobile` (React Native) and `thuluth-edge` (Deno or "Other"). Set the EU data region.
- [ ] Put the DSN in EAS `EXPO_PUBLIC_SENTRY_DSN` and an auth token (scope `project:releases`) in EAS `SENTRY_AUTH_TOKEN` and GitHub `SENTRY_AUTH_TOKEN`.
- [ ] Create the alert rules in `sentry-alerts.md` and route them to the on-call channel.
- [ ] Data scrubbing: keep the default scrubbers on, and add the extra fields from `sentry-alerts.md` §4. **Session replay off.**

### Step 8: Postmark (day 3)

- [ ] Create a production server with sender signature `hello@thuluth.app` and the DKIM and return-path DNS records. Ask Postmark to approve the account (new accounts are in test mode).
- [ ] Put the server token in `POSTMARK_SERVER_TOKEN`, and set Supabase Auth SMTP to the same server.
- [ ] Test: request an account export with a test account and check that "Your Thuluth data is ready to download" arrives in `en` and in `ur`.

### Step 9: status checks and uptime (T13, day 3)

- [ ] On Better Stack (or an equivalent), add a monitor on `GET https://api.thuluth.app/functions/v1/health` every 60 s from two EU regions. Alert on HTTP 503, on a timeout over 10 s, or on a body that does not contain `"status":"ok"` for 3 checks in a row. A body with `degraded` raises a low-priority alert.
- [ ] Add a second monitor on `GET https://thuluth.app/.well-known/apple-app-site-association`, which must return 200 with JSON.
- [ ] Publish the status page at `status.thuluth.app` with the components "App and sync", "AI assistant" and "Notifications". Link it from the app's help section.
- [ ] Monitor the support inbox `support@thuluth.app`. The on-call rota in `on-call-rota.md` names who owns it.

### Step 10: backups and drill (T1, before launch)

- [ ] Follow `backups-and-pitr.md`: confirm PITR, configure the `production-backup` environment, run `backup-prod.yml` once by hand, then do the first restore drill and record the RTO.

### Step 11: EAS (T12, before the store builds)

- [ ] Create the EAS channels and branches: `eas channel:create production`, then `eas channel:edit production --branch production`. `eas.json` already maps the `production` build profile to channel `production` and EAS environment `production`.
- [ ] Add the EAS environment variables in `secrets.md` §5. Then run `eas credentials` for iOS and Android production.
- [ ] Rehearse a rollback (T12) on staging. Steps are in `launch-runbook.md` §6.

## 3. Verifying the environment matches the code

| Check | Command | Expect |
|---|---|---|
| Migrations applied | `supabase migration list --linked` | local and remote columns identical |
| Functions deployed | `supabase functions list --project-ref <ref>` | every folder in `supabase/functions` except `_shared` |
| Function secrets present | `supabase secrets list --project-ref <ref>` | every "Required for launch" name in `secrets.md` §1 |
| Vault | `select name from vault.secrets order by 1;` | `audit_ip_salt`, `cron_secret`, `project_url` |
| Health | `curl -s https://api.thuluth.app/functions/v1/health` | `"status":"ok"` |
| Smoke | `API_BASE_URL=… SUPABASE_PUBLISHABLE_KEY=… tooling/scripts/ops/smoke.sh` | all `ok` |
