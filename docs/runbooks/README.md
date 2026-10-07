# Configuration runbooks

These runbooks are click-by-click instructions for setting up every external service and configuration area Thuluth depends on, for each environment (dev, staging, prod). They are written for the product owner, or whoever he hires, and assume no DevOps background. Each one follows the same template: what it configures, what you need first, the steps, where each value goes, how to verify it, how to rotate it, and troubleshooting.

Two pages in `docs/ops/` sit next to them:

- [`../ops/production-environment.md`](../ops/production-environment.md) is the **production tick-list**: the order in which the owner stands up `thuluth-prod`, with a box to tick per step. It links back here for the detail.
- [`../ops/secrets.md`](../ops/secrets.md) is the **name inventory**: every secret and configuration name, where it is set and what breaks while it is missing. It never holds values. Every name in these runbooks matches it.

Every value lives first in 1Password vault "Thuluth Platform", with item names as set out in [password-manager.md](password-manager.md) (`<env> <NAME>`, for example `prod POSTMARK_SERVER_TOKEN`). Third-party console menu names change often, so each runbook says once that its labels may differ slightly.

## Setup order

Do the runbooks in this order. Start the slow account approvals (Apple, Google Play, Postmark) early, because they take days, and carry on with the rest while you wait. Within each runbook, set up dev first, then staging, then prod, unless the runbook says otherwise.

| # | Runbook | Depends on | Notes |
|---|---|---|---|
| 1 | [password-manager.md](password-manager.md) | nothing | Every later runbook saves its values here. |
| 2 | [domain-and-dns.md](domain-and-dns.md) steps 1, 2 and 8 | 1 | Domain, Cloudflare zone and mail routing for the role addresses (`hello@`, `support@`, `privacy@`). The `.well-known` files (step 4) and the API domain (step 6) come later. |
| 3 | [apple-app-store.md](apple-app-store.md) step 1 and [google-play.md](google-play.md) step 1 | 1, 2 | Start enrolment now: Apple takes 2 to 14 days, Google 2 to 7 days. Both need a D-U-N-S number for an organisation account. |
| 4 | [supabase-projects.md](supabase-projects.md) | 1 | One project per environment. Prod's custom domain needs step 2 done. |
| 5 | [postmark-email.md](postmark-email.md) | 2, 4 | Postmark approval takes 1 to 2 working days. Custom SMTP must be on before the Auth email rate limit can be raised. |
| 6 | [auth-providers.md](auth-providers.md) | 4; Apple Developer account from 3 | Google and Apple sign-in. hCaptcha keys are made here, but CAPTCHA is turned on in Supabase last (step 4 there). |
| 7 | [ai-providers.md](ai-providers.md) | 1, 4 | Anthropic, OpenAI and Gemini keys and spend limits. Prices ship in the seed. |
| 8 | [apple-app-store.md](apple-app-store.md) steps 2 to 10 and [google-play.md](google-play.md) steps 2 to 8 | 3 approved; 13 for the first builds | App IDs, keys, store records, subscriptions. Play needs a first build uploaded by hand before subscriptions can be created. |
| 9 | [onesignal-and-firebase.md](onesignal-and-firebase.md) | APNs key from 8 | Push for each environment. |
| 10 | [revenuecat.md](revenuecat.md) | 8 (store records and products), 4 | Purchases and the webhook. |
| 11 | [pdf-renderer-gotenberg.md](pdf-renderer-gotenberg.md) | 1 | PDF exports on Cloud Run. |
| 12 | [supabase-secrets-and-vault.md](supabase-secrets-and-vault.md) | 4; keys from 5, 7, 9, 10, 11 | Function secrets and the three Vault values. A missing key only keeps that feature off, so you can run it early and again later. |
| 13 | [sentry.md](sentry.md) and [eas-builds.md](eas-builds.md) | 4, 6, 8, 9, 10 | Sentry DSN and token first, then the EAS project, variables, credentials and first builds. |
| 14 | [github-environments.md](github-environments.md) | 4, 13 (`EAS_PROJECT_ID`, Expo token); 16 for `production-backup` | Turns on `deploy-dev.yml`, then the first `deploy-prod.yml` run from a `v*` tag. |
| 15 | [feature-flags-and-app-config.md](feature-flags-and-app-config.md) | 4 (seeds applied) | `app.environment` on dev and staging; launch values on prod. |
| 16 | [offsite-backups-gcp.md](offsite-backups-gcp.md) | prod deployed (14) | Nightly encrypted backup, then the first restore drill. |
| 17 | [domain-and-dns.md](domain-and-dns.md) steps 3 to 7 | Apple Team ID and Android fingerprints from 8 and 13 | Website, `.well-known` files for invite links, API custom domain, email and status records. |
| 18 | [uptime-and-status-page.md](uptime-and-status-page.md) | prod deployed (14), 17 | Monitors, paging and `status.thuluth.app`. |

## All runbooks

| Runbook | Configures | Environments | Rough time |
|---|---|---|---|
| [password-manager.md](password-manager.md) | 1Password vaults, item names, rotation calendar | all | 45 min, then 2 min per secret |
| [domain-and-dns.md](domain-and-dns.md) | `thuluth.app`, Cloudflare DNS and Pages, `.well-known` files, legal pages, API custom domains, mail routing | one domain; `api` (prod), `api.staging` (staging) | 90 min plus DNS waiting |
| [apple-app-store.md](apple-app-store.md) | Apple Developer account, App IDs, keys, App Store Connect, subscriptions, TestFlight | App IDs for all; store records for staging and prod | 2 to 14 days waiting, then 90 min prod, 45 min staging |
| [google-play.md](google-play.md) | Play Console, app signing, subscriptions, service accounts, Data safety | prod; staging optional | 2 to 7 days waiting, then 90 min |
| [supabase-projects.md](supabase-projects.md) | Projects, billing, add-ons, Auth settings, email templates, sign-up guard hook, migrations, seeds, accounts | dev, staging, prod | 90 min per environment |
| [supabase-secrets-and-vault.md](supabase-secrets-and-vault.md) | Edge Function secrets, Vault, pg_cron check | dev, staging, prod | 30 min per environment |
| [auth-providers.md](auth-providers.md) | Google, Apple and hCaptcha | dev, staging, prod | 60 min first, 20 min each further |
| [ai-providers.md](ai-providers.md) | Anthropic, OpenAI, Gemini keys and limits; model routes and prices; cost alert | dev, staging, prod | 45 min per environment |
| [postmark-email.md](postmark-email.md) | Postmark servers, domain, invite templates, Auth SMTP and code templates | dev, staging, prod | 45 min, 1 to 2 days approval, then 20 min per environment |
| [onesignal-and-firebase.md](onesignal-and-firebase.md) | Firebase (FCM), OneSignal apps, push test | dev, staging, prod | 30 min Firebase, 30 min per OneSignal app |
| [revenuecat.md](revenuecat.md) | RevenueCat project, store apps, products, entitlement, offering, webhook | dev and staging (sandbox), prod | 60 min prod, 30 min each other |
| [pdf-renderer-gotenberg.md](pdf-renderer-gotenberg.md) | Gotenberg on Cloud Run for PDF exports | dev, staging, prod | 60 min first, 20 min each further |
| [sentry.md](sentry.md) | Sentry organisation, projects, privacy, tokens, alert rules | one org for all | 45 min |
| [eas-builds.md](eas-builds.md) | EAS project, environment variables, channels, credentials, builds, submit, OTA | dev, staging, prod | 60 min, then 20 min per environment plus builds |
| [github-environments.md](github-environments.md) | GitHub environments, protections, secrets, tag ruleset, first deploys | dev, prod | 45 min |
| [feature-flags-and-app-config.md](feature-flags-and-app-config.md) | Feature flags, AI caps, maintenance mode, forced upgrade, `app.environment` | dev, staging, prod | 20 min per environment |
| [offsite-backups-gcp.md](offsite-backups-gcp.md) | GCS bucket with retention lock, workload identity, `age` keys, `backup_reader` | prod | 75 min plus a 60 min drill |
| [uptime-and-status-page.md](uptime-and-status-page.md) | Uptime monitors, paging, status page | prod; staging optional | 45 min |

## Per environment checklist

**dev** (`thuluth-dev`, bundle id `app.thuluth.mobile.dev`, EAS environment `development`)

- [ ] Supabase project, Auth settings, email templates, sign-up guard hook, `app.environment = 'development'`, catalog seeds ([supabase-projects.md](supabase-projects.md))
- [ ] Function secrets and Vault with dev values ([supabase-secrets-and-vault.md](supabase-secrets-and-vault.md))
- [ ] Postmark "Thuluth Dev" server (Live type) as Auth SMTP ([postmark-email.md](postmark-email.md))
- [ ] Google clients, Apple client ID `app.thuluth.mobile.dev`, hCaptcha keys ([auth-providers.md](auth-providers.md))
- [ ] AI keys with a $100 monthly limit ([ai-providers.md](ai-providers.md))
- [ ] OneSignal "Thuluth Dev", Firebase `thuluth-nonprod`; RevenueCat dev apps (optional)
- [ ] EAS `development` variables and a dev client build ([eas-builds.md](eas-builds.md))
- [ ] GitHub `development` environment; `deploy-dev.yml` runs without "skipping" notices ([github-environments.md](github-environments.md))
- [ ] Flags: `catalog.include_in_review`, `allow_sandbox_premium`, `ramadan_planner` on ([feature-flags-and-app-config.md](feature-flags-and-app-config.md))

**staging** (`thuluth-staging`, bundle id `app.thuluth.mobile.staging`, EAS environment `preview`)

- [ ] Supabase project as for dev, with `app.environment = 'staging'` and `APP_ENV=staging` set by hand (there is no staging workflow; deploy by hand)
- [ ] Optional custom domain `api.staging.thuluth.app` ([domain-and-dns.md](domain-and-dns.md))
- [ ] Function secrets and Vault with **new** staging values
- [ ] Postmark "Thuluth Staging" server; Google and Apple clients for `.staging`; hCaptcha keys
- [ ] AI keys with a $300 monthly limit
- [ ] OneSignal "Thuluth Staging"; RevenueCat staging apps with a Sandbox-only webhook; staging App Store record and products if you test purchases on TestFlight
- [ ] EAS `preview` variables and a `preview` build; sandbox purchase test passes ([revenuecat.md](revenuecat.md) step 11)
- [ ] Flags as for dev; optional staging uptime monitor with no paging

**prod** (`thuluth-prod`, bundle id `app.thuluth.mobile`, EAS environment `production`)

Follow [`../ops/production-environment.md`](../ops/production-environment.md) step by step. In short:

- [ ] Supabase project on Large compute, PITR 7 days, `api.thuluth.app`, SSL on, spend cap off with alerts, network restrictions off (19 §6), JWT signing keys, exposed schema `public` only
- [ ] Auth settings, email templates, sign-up guard hook, rate limits; Google and Apple prod clients; CAPTCHA on only after the minimum supported build sends tokens
- [ ] Function secrets and Vault with **new** prod values
- [ ] GitHub `production-readonly`, `production`, `production-backup`; first `deploy-prod.yml` run started from the tag
- [ ] Store records, subscriptions approved, RevenueCat Production-only webhook, OneSignal "Thuluth Prod", Sentry rules, EAS `production` variables and credentials
- [ ] Launch flag values, offsite backup with a first restore drill, uptime monitors and status page

## Decisions still needed

These are open product-owner decisions found while writing the runbooks.

- **Apple token revocation on account deletion.** Apple requires apps that offer Sign in with Apple to revoke the user's Apple tokens when the account is deleted. `account-delete` has a `revokeApple` hook, but nothing wires it up and no function reads an Apple key, so deletion logs `apple_revoke_not_configured`. Decide before App Review whether to build it (it needs the key and Services ID from [auth-providers.md](auth-providers.md) step 6).
- **Status page link in the app.** `production-environment.md` Step 9 asks for `status.thuluth.app` in the in-app help, but the help content does not link it yet. Decide whether to add it for launch.
- **Gotenberg health probe.** Gotenberg may answer its `/health` endpoint with 401 when basic auth is on, which would fail the Cloud Run startup probe in `tooling/gotenberg/service.yaml`. Verify on the first deploy and, if it fails, switch the probe to a TCP check ([pdf-renderer-gotenberg.md](pdf-renderer-gotenberg.md) Troubleshooting).
- **OpenAI and Gemini model ids and prices.** `gpt-5`, `gpt-4o-transcribe`, `gemini-2.5-pro` and `gemini-2.5-flash` are placeholders in the seed, and their prices are list prices to confirm. Confirm both against the provider consoles before staging ([ai-providers.md](ai-providers.md) step 6).

Default decisions taken on 2026-10-06 that the PO can override: Supabase network restrictions stay off on prod at launch (19 §6), and prevent self-review on the GitHub `production` environment stays off until a second maintainer exists (`secrets.md` §4).
