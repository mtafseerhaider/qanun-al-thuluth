# Password manager (1Password): configuration runbook

> **Environments:** all (one vault holds dev, staging and prod items, named by environment) · **Time:** ~45 min to set up, then 2 minutes per new secret · **Needs:** a 1Password Teams or Business account, the 1Password desktop app and CLI (`op`) on the PO's laptop, a printer for the Emergency Kit · **Related:** [`docs/ops/secrets.md`](../ops/secrets.md) (the canonical list of secret names), [supabase-secrets-and-vault.md](supabase-secrets-and-vault.md) (turning items into Supabase secrets with `op inject`), [offsite-backups-gcp.md](offsite-backups-gcp.md), [auth-providers.md](auth-providers.md), [`19-deployment-architecture.md`](../19-deployment-architecture.md) §8, [`docs/ops/on-call-rota.md`](../ops/on-call-rota.md)

## What this configures

1Password vault **"Thuluth Platform"** is the master copy of every secret and every account login Thuluth uses (19 §8, `secrets.md`). Supabase, GitHub, EAS and the third-party consoles only hold copies. If a copy is lost or must be rotated, you start from 1Password. A second vault, **"Thuluth Break-glass"**, holds the few things that must survive the loss of everything else.

While this is missing, secrets end up in chat messages, notes and laptops, nobody can rotate a key without hunting for it, and the Apple client secret expires unnoticed after 6 months, which breaks Sign in with Apple's web flow.

Menu names in 1Password may differ slightly from the labels below.

## Before you start

- [ ] Decide who the **secondary** person is (`on-call-rota.md`), if there is one. They are the only other human who may see production values.
- [ ] Have a printer ready for the Emergency Kit.

## Steps

### 1. Create the account

1. Create a **1Password Teams** (Teams Starter Pack is enough for up to 10 people) or **Business** account at https://1password.com, owned by the PO. Business adds per-item activity logs and is worth it once someone else joins.
2. Use a long, unique account password. Turn on two-factor authentication, preferably with a hardware key or passkey.
3. Print the **Emergency Kit** (account settings > Emergency Kit), fill in the password by hand and keep it with the paper `age` key from [offsite-backups-gcp.md](offsite-backups-gcp.md) step 5.
4. Install the desktop app and the CLI. Turn on the CLI integration (Settings > Developer > "Integrate with 1Password CLI"), so `op` unlocks with the desktop app and never stores a session token in a file.

### 2. Create the vaults and decide access

| Vault | Holds | Who has access | Permissions |
|---|---|---|---|
| **Thuluth Platform** | every item in step 4, for dev, staging and prod | Tafseer (PO); the appointed secondary, if any | PO: manage. Secondary: view and edit, no manage |
| **Thuluth Break-glass** | "prod age-backup-private-key", the 1Password Emergency Kit scan, recovery codes for the accounts in step 4.6 | Tafseer only | manage |
| **Thuluth Non-prod** (optional) | copies of dev and staging items only | contractors or developers who set up dev or staging | view |

Rules:

- Nobody else is added to "Thuluth Platform". A contractor who needs a dev or staging value gets it from "Thuluth Non-prod", or as a one-time 1Password share link that expires.
- Database passwords live in "Thuluth Platform" too (10 §11, 19 §8). Do not create a separate vault for them.
- Review the member list of every vault whenever the on-call rota changes, and remove leavers the same day.

### 3. Name every item the same way

**Item title:** `<env> <NAME>`

- `<env>` is `dev`, `staging`, `prod` or `shared` (one value used by every environment, such as an account login or the Apple Team ID).
- `<NAME>` is the **exact** name from `secrets.md` when one exists (`ANTHROPIC_API_KEY`, `POSTMARK_SERVER_TOKEN`, `SUPABASE_DB_PASSWORD`). Otherwise a short lowercase name with dashes (`apns-p8-key`, `cloudflare-login`).
- Examples: `prod ANTHROPIC_API_KEY`, `staging POSTMARK_SERVER_TOKEN`, `shared apple-team-id`.

**Item contents:**

| Field | Content |
|---|---|
| `credential` | the secret value itself (use the "API Credential" item type; for files such as `.p8` or JSON keys, attach the file **and** paste the text into `credential`) |
| `where-set` | where the copy lives, using the exact names from `secrets.md`, for example "Supabase function secret `POSTMARK_SERVER_TOKEN`, project thuluth-prod; Auth SMTP username/password" |
| `rotate-every` | `90d`, `180d`, `1y`, `on suspicion` or the hard expiry date |
| `expires` | the date for items that stop working on their own (1Password's built-in expiry field, so Watchtower warns you) |
| notes | the console URL, key IDs, the date it was created and by whom |

**Tags:** `env/prod` (or `env/staging`, `env/dev`, `env/shared`) and `kind/function-secret`, `kind/github`, `kind/eas`, `kind/dashboard`, `kind/login` or `kind/key-file`.

**CLI references** use the same names: `op://Thuluth Platform/prod POSTMARK_SERVER_TOKEN/credential`. Quote the whole reference in shell commands because of the spaces.

When you rotate, rename the old item to `<title> (old <YYYY-MM-DD>)` and archive it after the new value is confirmed. Never keep two live items with the same title.

### 4. Create the items

Create each item as you reach it in the other runbooks. The list below is the full inventory. Names in code style are the names in `secrets.md`. Rotation comes from `secrets.md` and 19 §8.

#### 4.1 Supabase Edge Function secrets (`secrets.md` §1), per environment

| Item | Set by runbook | Rotate |
|---|---|---|
| `<env> INTERNAL_CRON_SECRET` (the same value is the Vault `cron_secret`) | [supabase-secrets-and-vault.md](supabase-secrets-and-vault.md) | 90 days, with `<env> INTERNAL_CRON_SECRET_NEXT` during the switch |
| `<env> ANTHROPIC_API_KEY` | [ai-providers.md](ai-providers.md) | 90 days |
| `<env> OPENAI_API_KEY` | [ai-providers.md](ai-providers.md) | 90 days |
| `<env> GEMINI_API_KEY` | [ai-providers.md](ai-providers.md) | 90 days |
| `<env> REVENUECAT_WEBHOOK_SECRET` | [revenuecat.md](revenuecat.md) | 180 days, with `<env> REVENUECAT_WEBHOOK_SECRET_NEXT` |
| `<env> REVENUECAT_SECRET_API_KEY` | [revenuecat.md](revenuecat.md) | 180 days |
| `<env> ONESIGNAL_APP_ID` (identifier, not secret) | [onesignal-and-firebase.md](onesignal-and-firebase.md) | n/a |
| `<env> ONESIGNAL_REST_API_KEY` | [onesignal-and-firebase.md](onesignal-and-firebase.md) | 180 days |
| `<env> POSTMARK_SERVER_TOKEN` (also the Auth SMTP password) | [postmark-email.md](postmark-email.md) | 180 days |
| `<env> GOTENBERG_URL` (not secret), `<env> GOTENBERG_TOKEN` | [pdf-renderer-gotenberg.md](pdf-renderer-gotenberg.md) | token 180 days |

Not stored: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` are injected by Supabase; `APP_ENV` and `GIT_SHA` are set by the deploy workflows; `AI_DAILY_COST_ALERT_USD` is a plain number. Do not create items for `LOG_SALT`, `SENTRY_SALT` or the edge `SENTRY_DSN`: no code reads them (`secrets.md` §1).

#### 4.2 Supabase Vault and project settings (`secrets.md` §2 and §3), per environment

| Item | Rotate |
|---|---|
| `<env> VAULT_AUDIT_IP_SALT` (Vault `audit_ip_salt`) | on suspicion only: a new salt makes old and new IP hashes impossible to compare |
| `<env> SUPABASE_DB_PASSWORD` | 90 days (19 §8) |
| `<env> SUPABASE_DB_URL` (postgres role, session pooler) | with the password |
| `prod backup-reader-db-url` (read-only `backup_reader` role) | with the database password, 90 days |
| `<env> SUPABASE_SERVICE_ROLE_KEY` (for trusted scripts such as the load test, never for apps) | on suspicion |
| `<env> GOOGLE_OAUTH_CLIENT_ID` (not secret), `<env> GOOGLE_OAUTH_SECRET`, `<env> google-ios-client-id` | on suspicion |
| `prod APPLE_OAUTH_SECRET` (client secret JWT) | **expires after 6 months at most**: regenerate at 5 months ([auth-providers.md](auth-providers.md) step 6) |
| `prod apple-signin-p8-key` (signs the JWT above) | yearly (19 §8 "Apple key yearly") |
| `<env> HCAPTCHA_SECRET`, `<env> hcaptcha-site-key` | on suspicion |

#### 4.3 GitHub environments (`secrets.md` §4)

| Item | GitHub name and environment | Rotate |
|---|---|---|
| `dev SUPABASE_ACCESS_TOKEN`, `prod SUPABASE_ACCESS_TOKEN`, `prod SUPABASE_ACCESS_TOKEN-readonly` (one token per GitHub environment, from a machine account where possible) | `SUPABASE_ACCESS_TOKEN` in `development`, `production` and `production-readonly` ([github-environments.md](github-environments.md) step 1) | 90 days (19 §8) |
| `<env> SUPABASE_DB_PASSWORD`, `<env> SUPABASE_DB_URL` | `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_URL` | 90 days |
| `prod backup-reader-db-url` | `SUPABASE_DB_URL` in `production-backup` | 90 days |
| `shared EXPO_TOKEN` | `EXPO_TOKEN` | 180 days |
| `shared SENTRY_AUTH_TOKEN` | `SENTRY_AUTH_TOKEN` (and EAS) | 180 days |
| `prod PLAY_SERVICE_ACCOUNT_JSON` | `PLAY_SERVICE_ACCOUNT_JSON` | yearly (19 §8) |
| `prod gcp-backup-config` (project id, bucket, provider, service account; not secret) | variables `GCP_WIF_PROVIDER`, `GCP_BACKUP_SA`, `BACKUP_BUCKET`, `BACKUP_AGE_PUBLIC_KEY` | n/a (no keys) |

#### 4.4 EAS (`secrets.md` §5)

Public client values do not need to be secret, but keep them in 1Password so every build uses the same ones: `shared EAS_PROJECT_ID`, `shared EXPO_PUBLIC_SENTRY_DSN`, `<env> EXPO_PUBLIC_RC_IOS_KEY`, `<env> EXPO_PUBLIC_RC_ANDROID_KEY`, `<env> ONESIGNAL_APP_ID`, `<env> GOOGLE_OAUTH_CLIENT_ID`, `<env> google-ios-client-id`, `<env> hcaptcha-site-key` (EAS `EXPO_PUBLIC_HCAPTCHA_SITE_KEY`). The only secret is `shared SENTRY_AUTH_TOKEN`.

#### 4.5 Key files and store credentials

| Item | Rotate or expiry |
|---|---|
| `shared apple-team-id` (not secret) | n/a |
| `shared apns-p8-key` (with Key ID) | does not expire; on suspicion |
| `shared asc-api-key` (with Key ID and Issuer ID) | yearly (19 §8) |
| `shared asc-iap-key-revenuecat`, `shared asc-api-key-revenuecat` | on suspicion |
| `prod asc-app-id`, `staging asc-app-id` (not secret) | n/a |
| `shared apple-distribution-certificate` (EAS backup) | **expires yearly**; EAS renews it, keep the backup current |
| `prod android-upload-keystore` (EAS backup) | never expires; losing it needs a Play upload-key reset |
| `prod play-service-account-revenuecat` | yearly |
| `prod fcm-service-account-json`, `staging fcm-service-account-json` | yearly |
| `prod play-signing-fingerprints` (not secret) | n/a |
| `<env> GOTENBERG_TOKEN` | 180 days |

#### 4.6 Account logins (`shared ...-login`)

`shared cloudflare-login`, `shared registrar-login` (if not Cloudflare), `shared postmark-login`, `shared betterstack-login`, `shared expo-account`, plus the Supabase, GitHub, Apple Developer, Google Play Console, Google Cloud, RevenueCat, OneSignal, Sentry and AI provider logins when they are not the PO's personal accounts. Store each account's **recovery codes** in "Thuluth Break-glass". Test accounts: `prod reviewer-account`, `shared apple-sandbox-tester-1` and so on.

#### 4.7 Break-glass vault

`prod age-backup-private-key` ([offsite-backups-gcp.md](offsite-backups-gcp.md) step 5), the Emergency Kit scan, account recovery codes. Nothing in this vault is ever exported to a file except during a restore drill.

When you add a secret to the code, add its row to `secrets.md` in the same PR (`secrets.md` header) and its item here.

### 5. Move values out of 1Password safely

- **Supabase function secrets:** use a template of `op://` references and `op inject`, exactly as in [supabase-secrets-and-vault.md](supabase-secrets-and-vault.md). The generated `.env.functions.<env>` file is deleted straight after `supabase secrets set`.
- **One value into a command:** `op read "op://Thuluth Platform/prod GOTENBERG_TOKEN/credential" | ...`, or `export NAME="$(op read '...')"` in a shell you close afterwards. Never type a value inline, because it would land in shell history.
- **Dashboards (GitHub, Supabase Auth, Postmark):** copy from the 1Password app and paste. 1Password clears the clipboard after 90 seconds (Settings > Security).
- **Key files:** download the attachment to a temporary file, upload it, delete it (`rm -P` on macOS).
- Never paste a value into chat, email, an issue, a PR, a commit, a spreadsheet or a Claude session.

### 6. Keep agents away from production values

`secrets.md` and 19 §8 say agents never receive production values. In practice:

1. Claude Code and other agent sessions never run on a machine or in a session where `op` is signed in to "Thuluth Platform", and never get the 1Password account password.
2. Agents work against the local stack (`supabase start`) with the throwaway values in `supabase/seed/local/000_local_vault.sql`, or against dev with values a human set in that project. They read secret **names** from `secrets.md`, never values.
3. Production changes reach production only through the GitHub `production` environment (required reviewer Tafseer; prevent self-review is turned on once a second maintainer exists) or through commands the PO runs himself. An agent may prepare the command; the PO runs it with values from 1Password.
4. GitHub secrets are write-only, Supabase `secrets list` shows digests only, and EAS "secret" variables are hidden, so an agent with read access to those consoles still cannot see values. Do not give agents those console logins anyway.
5. If a production value is ever pasted into an agent session, a chat or a PR, treat it as leaked: rotate it at once (step 7) and note it in the incident log (`incident-templates.md`).

### 7. Rotate a secret

The steps are the same for every item; each service's runbook has the details under "Rotate or revoke".

1. Create the new value in the service (most allow two live keys at once).
2. Rename the old 1Password item to `<title> (old <YYYY-MM-DD>)`, create the new item with the original title, set `expires` or the next rotation date.
3. Update every copy listed in the item's `where-set` field.
4. Run the service runbook's **Verify** section.
5. Revoke the old value in the service, then archive the old item.
6. Move the calendar reminder (step 8).

For `INTERNAL_CRON_SECRET` and `REVENUECAT_WEBHOOK_SECRET` use the `_NEXT` overlap described in [supabase-secrets-and-vault.md](supabase-secrets-and-vault.md) and [revenuecat.md](revenuecat.md), so nothing breaks during the switch.

### 8. Keep the expiry and rotation calendar

Create a calendar called **"Thuluth renewals"** (Google Calendar is fine) shared with the secondary. For each row below, add an event two weeks **before** the due date with the 1Password item name in the title. Set the first date from the day you create the item.

**Hard expiries** (things stop working on that date):

| Item or account | Lifetime | Reminder | What breaks |
|---|---|---|---|
| `prod APPLE_OAUTH_SECRET` (Apple client secret JWT) | **6 months at most** (15,777,000 s) | at **5 months** after creation | Supabase's Apple provider OAuth flow and any Apple token revocation |
| Apple Developer Program membership | 1 year | 1 month before | the app can no longer be updated; certificates are revoked |
| `shared apple-distribution-certificate` and provisioning profiles | 1 year | 1 month before | new iOS builds fail until EAS makes new ones |
| `thuluth.app` domain | 1 year (auto-renew on) | 1 month before: check the card | the site, `api`, email and invites all stop |
| `security.txt` `Expires` field | at most 1 year | 1 month before | the file is treated as stale |
| Any token created with an expiry date (Supabase access tokens, Expo, Sentry) | as set | 2 weeks before | the CI job using it fails |

**Rotation cadences** (from `secrets.md` and 19 §8):

| Cadence | Items |
|---|---|
| 90 days | `INTERNAL_CRON_SECRET`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` with `SUPABASE_DB_URL` and `backup-reader-db-url` |
| 180 days | `REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_SECRET_API_KEY`, `ONESIGNAL_REST_API_KEY`, `POSTMARK_SERVER_TOKEN`, `GOTENBERG_TOKEN`, `EXPO_TOKEN`, `SENTRY_AUTH_TOKEN` |
| yearly | `asc-api-key`, `PLAY_SERVICE_ACCOUNT_JSON`, `apple-signin-p8-key` |
| on suspicion only | service role key, `VAULT_AUDIT_IP_SALT`, `age` key pair, Google OAuth secret, hCaptcha secret, APNs key |

To keep this manageable, rotate in batches: one "90-day" session and one "180-day" session per cycle, each at a quiet hour (Pakistan night). Avoid rotating during the first two weeks of Ramadan or a launch week.

Turn on **Watchtower** (1Password > Watchtower) so items with an `expires` date and reused or weak passwords are flagged.

## Where the values go

This runbook is the source, not a destination. Each item's `where-set` field says where its copies go, using the names in `secrets.md` §1 to §6.

## Verify

- `op vault list` shows "Thuluth Platform" and "Thuluth Break-glass".
- `op item list --vault "Thuluth Platform" --tags env/prod` lists one item for every "Required for launch" row of `secrets.md` §1 that is configured so far.
- `op read "op://Thuluth Platform/prod POSTMARK_SERVER_TOKEN/credential" >/dev/null && echo ok` prints `ok` (it does not print the value).
- "Thuluth Break-glass" > People shows only the PO.
- The "Thuluth renewals" calendar has an event for every hard expiry above.

## Rotate or revoke

- **1Password account password and 2FA:** change at once if you suspect anything, and on staff change. Then reprint the Emergency Kit.
- **A person leaves:** remove them from every vault and the team the same day. Then rotate every prod item they could view (start with the 90-day group and the database password).
- **Lost laptop:** deauthorise the device (Settings > Devices), change the account password, and rotate any value that was in a local `.env.functions.*` file or shell history on that laptop.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `op read` says "isn't an item" | Item title differs from the reference (spaces, case, `prod` vs `production`) | Rename the item to the exact `<env> <NAME>` form. |
| `op inject` writes empty values | Field is not named `credential` | Rename the field, or change the reference to the field's real name. |
| `op` asks for a password in a script | CLI integration with the desktop app is off | Turn on Settings > Developer > Integrate with 1Password CLI. |
| Two items with the same title | A rotation left the old item unrenamed | Rename the old one with `(old <date>)` and archive it. |
| Sign in with Apple's web flow stops working one day | `APPLE_OAUTH_SECRET` reached 6 months | Regenerate it ([auth-providers.md](auth-providers.md) step 6) and set the next reminder at 5 months. |
