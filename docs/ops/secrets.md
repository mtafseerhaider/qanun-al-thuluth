# Secrets and configuration inventory (production)

> **Story:** S7-06 · **Owner:** PO (sets values), backend (keeps this list current) · **Related:** `19-deployment-architecture.md` §8, `20-ci-cd-pipeline.md` §10 and §11, `production-environment.md`

This page lists **names only**. It never holds values. The master copy of every value lives in the 1Password vault "Thuluth Platform" (19 §8). Agents never receive production values.

Each row says where the value is set, which code reads it, and what happens while it is missing. The code names come from a search of `supabase/functions`, `packages/ai-core`, `apps/mobile/app.config.ts` and `.github/workflows` on 2026-10-06. If you add a secret, add its row here in the same PR.

## 1. Supabase Edge Function secrets (`supabase secrets set --project-ref <prod-ref> --env-file …`)

Set these from 1Password with `supabase secrets set --env-file ./.env.functions.prod`. The file is never committed; delete it afterwards. `supabase secrets list` shows digests only.

| Name | Read by | Required for launch | While unset | Rotation |
|---|---|---|---|---|
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | `_shared/clients.ts` | auto-injected by Supabase | n/a | Revoke and reissue keys in the dashboard on suspicion |
| `APP_ENV` = `production` | `_shared/env.ts`, `health` | yes (set by `deploy-prod.yml`) | treated as `development` | n/a |
| `GIT_SHA` | `health` (release), Sentry release (future) | yes (set by `deploy-prod.yml`) | `unknown` | every deploy |
| `INTERNAL_CRON_SECRET` | `_shared/auth.ts` `requireInternal` (all cron and worker routes) | **yes** | every cron and worker call gets 401, so plans never generate and notifications never send | 90 days, with `INTERNAL_CRON_SECRET_NEXT` (19 §8.1). Must equal the Vault `cron_secret` |
| `INTERNAL_CRON_SECRET_NEXT` | same, during rotation only | no | n/a | removed after promotion |
| `ANTHROPIC_API_KEY` | `packages/ai-core` providers | **yes** | AI routes fall back to other providers or `AI_UNAVAILABLE` | 90 days, prod-only key with a spend limit |
| `OPENAI_API_KEY` | `packages/ai-core` (fallback routes, transcription) | yes | fallbacks fail, `ai-transcribe` unavailable | 90 days |
| `GEMINI_API_KEY` | `packages/ai-core` (fallback routes) | yes | the last fallback is unavailable | 90 days. 19 §8 calls it `GOOGLE_AI_API_KEY`; the code reads `GEMINI_API_KEY` |
| `REVENUECAT_WEBHOOK_SECRET` | `revenuecat-webhook` | **yes** | every webhook is refused (401) and no subscription syncs | 180 days, with `REVENUECAT_WEBHOOK_SECRET_NEXT` |
| `REVENUECAT_WEBHOOK_SECRET_NEXT` | same, during rotation | no | n/a | n/a |
| `REVENUECAT_SECRET_API_KEY` | `revenuecat-webhook` `/sync`, `account-delete` (subscriber delete) | **yes** | lazy entitlement sync is off; erasure reports `not_configured` for RevenueCat | 180 days |
| `ONESIGNAL_APP_ID` | `notifications-dispatch`, `account-delete` | **yes** (the **Thuluth Prod** app) | pushes are not sent | n/a (identifier) |
| `ONESIGNAL_REST_API_KEY` | `notifications-dispatch`, `account-delete` | **yes** | pushes are not sent; erasure reports `not_configured` for OneSignal | 180 days |
| `POSTMARK_SERVER_TOKEN` | `household-invite`, `account-delete`, `account-export` (`_shared/integrations/email.ts`, `account-emails.ts`) | **yes** | invites fall back to share links; account emails are skipped and logged | 180 days. The S7 brief calls it `POSTMARK_TOKEN`; the code reads `POSTMARK_SERVER_TOKEN` |
| `GOTENBERG_URL`, `GOTENBERG_TOKEN` | `export-pdf`, `account-export` PDFs | yes | PDF exports fail (`export-pdf`) or are skipped in the data export | 180 days |
| `AI_DAILY_COST_ALERT_USD` | `analytics-rollup` | no (default 50) | 50 USD per day threshold | n/a |

Not used by the code yet, though 19 §8 lists them: `LOG_SALT`, `SENTRY_SALT` and `SENTRY_DSN` (edge). The Edge Functions have no Sentry SDK today. Their alerting runs through the health monitor and a log drain instead (`sentry-alerts.md` §3). Do not set these until code reads them.

## 2. Supabase Vault (database-side secrets: `tooling/scripts/ops/vault-secrets.sh`)

| Vault name | Read by | Value | While unset |
|---|---|---|---|
| `project_url` | `private.invoke_edge_function` (every pg_cron job) | `https://api.thuluth.app`, or `https://<ref>.supabase.co` before the custom domain is live | every cron job logs a warning and does nothing |
| `cron_secret` | `private.invoke_edge_function` (sent as `x-internal-secret`) | the same value as `INTERNAL_CRON_SECRET` | same as above |
| `audit_ip_salt` | `request_ip_hash`, erasure ledger | 32+ random bytes, hex | IP hashes are unsalted (weak) |

`supabase/seed/local/000_local_vault.sql` holds throwaway values for local and CI only. It must never run against a hosted project. This is why neither `deploy-prod.yml` nor `deploy-dev.yml` uses `--include-seed`; both apply `seed/catalog/*` with `tooling/scripts/ops/apply-catalog-seeds.sh`.

## 3. Supabase project settings (dashboard: Authentication, Settings)

| Setting | Where | Notes |
|---|---|---|
| Google OAuth client id and secret (`GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_SECRET` in `config.toml` terms) | Auth > Providers > Google | prod OAuth client; callback `https://api.thuluth.app/auth/v1/callback` |
| Apple Services ID `app.thuluth.mobile`, key-based client secret (`APPLE_OAUTH_SECRET`) | Auth > Providers > Apple | the Apple secret JWT expires after 6 months at most: add a calendar reminder |
| `HCAPTCHA_SECRET` | Auth > Bot and abuse protection | CAPTCHA on OTP request (S1-15); the site key goes to the app |
| SMTP (Postmark production server: host, user and password are the server token) | Auth > SMTP | OTP emails; sender `hello@thuluth.app` |
| Database password | Settings > Database | stored in 1Password; the same value is the GitHub secret `SUPABASE_DB_PASSWORD` |

## 4. GitHub environments (Settings > Environments)

| Environment | Protection (owner sets) | Secrets | Variables | Used by |
|---|---|---|---|---|
| `production-readonly` | deployment branches and tags: `v*` | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` | `SUPABASE_PROJECT_REF` | `deploy-prod.yml` plan job |
| `production` | required reviewer: Tafseer; prevent self-review; tags `v*` and `main` | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_URL` (postgres role, pooler session mode port 5432), `EXPO_TOKEN`, `SENTRY_AUTH_TOKEN`, `PLAY_SERVICE_ACCOUNT_JSON` | `SUPABASE_PROJECT_REF`, `API_BASE_URL` (`https://api.thuluth.app`), `SUPABASE_PUBLISHABLE_KEY`, `SENTRY_ORG` | `deploy-prod.yml`, `rollback-prod.yml` |
| `production-backup` | deployment branch: `main` only | `SUPABASE_DB_URL` (**read-only** `backup_reader` role) | `GCP_WIF_PROVIDER`, `GCP_BACKUP_SA`, `BACKUP_BUCKET`, `BACKUP_AGE_PUBLIC_KEY` | `backup-prod.yml` |
| `development` (exists) | none | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_URL` (dev, postgres role, pooler session mode; catalog seeds are skipped until it is set), `EXPO_TOKEN` | `SUPABASE_PROJECT_REF`, `EAS_PROJECT_ID`, `EXPO_PUBLIC_*` | `deploy-dev.yml` |

Use a separate Supabase personal access token for each environment, made from a machine account where possible. Never use the PO's own token.

## 5. EAS environment variables (`eas env:create --environment production …`)

All of these are public client configuration (visibility "plain text" or "sensitive"), except `SENTRY_AUTH_TOKEN`.

| Name | Read by | Notes |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `app.config.ts` | `https://api.thuluth.app` (the custom domain, so DR can repoint it) |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `app.config.ts` | the prod publishable key |
| `EXPO_PUBLIC_SENTRY_DSN` | `app.config.ts` | Sentry project `thuluth-mobile` |
| `EXPO_PUBLIC_ONESIGNAL_APP_ID` | `app.config.ts` | **Thuluth Prod** OneSignal app id |
| `EXPO_PUBLIC_RC_IOS_KEY`, `EXPO_PUBLIC_RC_ANDROID_KEY` | `app.config.ts` | RevenueCat public SDK keys (production app entries) |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | `app.config.ts` | prod OAuth clients |
| `EAS_PROJECT_ID` | `app.config.ts` | the EAS project id |
| `SENTRY_AUTH_TOKEN` (secret visibility) | Sentry config plugin during EAS Build | source map upload |

EAS credentials (not variables): the Apple distribution certificate, provisioning profile, APNs key and App Store Connect API key, all managed with `eas credentials`. The Play upload key is also managed by EAS.

## 6. Third-party consoles (no values in the repo)

| Console | What is configured there | Where the matching secret goes |
|---|---|---|
| RevenueCat (production apps) | webhook URL `https://api.thuluth.app/functions/v1/revenuecat-webhook`, environment filter **production**, Authorization header `Bearer <REVENUECAT_WEBHOOK_SECRET>` | function secret §1 |
| OneSignal "Thuluth Prod" | APNs `.p8` key (production), FCM v1 service account | function secrets §1, EAS §5 |
| Postmark | production server, sender signature and DKIM/return-path for `thuluth.app` | function secret §1, Auth SMTP §3 |
| Sentry | org `thuluth`, projects `thuluth-mobile` and `thuluth-edge`, alert rules (`sentry-alerts.md`) | EAS §5, GitHub §4 |
| Google Cloud (backup project) | GCS bucket with retention lock, WIF pool for GitHub OIDC, service account | GitHub `production-backup` vars |
| Uptime monitor / status page (Better Stack or equal) | monitor on `GET https://api.thuluth.app/functions/v1/health` | none (public endpoint) |
| Cloudflare DNS | 19 §9.1 records | none |
