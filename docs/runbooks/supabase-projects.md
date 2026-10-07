# Supabase projects: configuration runbook

> **Environments:** dev / staging / prod · **Time:** ~90 min per environment (prod longer because of the custom domain) · **Needs:** owner access to the Supabase Pro organization, the Supabase CLI 2.48.3 (the version the workflows pin), `psql`, access to 1Password vault "Thuluth Platform", Cloudflare access for prod DNS · **Related:** [`../ops/production-environment.md`](../ops/production-environment.md) Step 1, [`../ops/secrets.md`](../ops/secrets.md), [`../ops/backups-and-pitr.md`](../ops/backups-and-pitr.md), [`supabase-secrets-and-vault.md`](supabase-secrets-and-vault.md), [`auth-providers.md`](auth-providers.md), [`feature-flags-and-app-config.md`](feature-flags-and-app-config.md), [`github-environments.md`](github-environments.md), [`domain-and-dns.md`](domain-and-dns.md), [`postmark-email.md`](postmark-email.md), [`password-manager.md`](password-manager.md)

Dashboard menu names change often. The menu names in this runbook may differ slightly from what you see.

## What this configures

Supabase is the whole backend: the Postgres database, sign-in (Supabase Auth), file storage, the Edge Functions and the scheduled jobs (pg_cron). Thuluth has three hosted projects: `thuluth-dev`, `thuluth-staging` and `thuluth-prod`. They all run the same migrations and function code. Only their settings and secrets differ. Until a project exists and matches `supabase/config.toml`, the app for that environment cannot sign anyone in or store anything.

## Before you start

- You can sign in to the Supabase organization on the **Pro** plan (one org for all three projects, 19 §6).
- 1Password vault "Thuluth Platform" is set up as described in [`password-manager.md`](password-manager.md).
- You have the Supabase CLI installed: `npm i -g supabase@2.48.3` or `brew install supabase/tap/supabase`. Check it with `supabase --version`.
- You have `psql` (PostgreSQL client 15 or newer) installed.
- For prod only: you can edit the Cloudflare zone `thuluth.app` ([`domain-and-dns.md`](domain-and-dns.md)).
- For the auth step: do [`auth-providers.md`](auth-providers.md) for this environment, either in parallel or right after this runbook.

## Steps

### 1. Create the project

1. Open the Supabase dashboard, pick the Thuluth organization, then click **New project**.
2. Fill in the form with the values for your environment:

| Field | dev | staging | prod |
|---|---|---|---|
| Project name | `thuluth-dev` | `thuluth-staging` | `thuluth-prod` |
| Region | Central EU (Frankfurt), `eu-central-1` | same | same |
| Postgres version | 17 (the default for new projects; `config.toml` `major_version = 17`) | 17 | 17 |
| Compute size | Micro | Small | **Large** at launch (19 §6) |
| Database password | click **Generate a password** | same | same |

3. Before you click **Create**, save the database password in 1Password as `op://Thuluth Platform/<env> SUPABASE_DB_PASSWORD/credential` (for example `prod SUPABASE_DB_PASSWORD`).
4. Wait until the project shows "Healthy". Copy the **project ref** (the 20-letter id in the URL, `https://supabase.com/dashboard/project/<ref>`). The ref is not secret. Write it in the 1Password item notes and in the S7 sprint issue. This runbook calls it `<dev-ref>`, `<staging-ref>` or `<prod-ref>`.

### 2. Billing: spend cap and alerts

1. Go to **Organization settings > Billing > Cost control** (the spend cap).
2. Turn the spend cap **off** once prod exists (a hard cap would take production down when it is hit). The spend cap is an **organization** setting, so it is off for dev and staging too (19 §6). Their small compute sizes keep them cheap. If you ever want a hard cap on dev and staging, move them to a second organization.

3. In the same billing area, turn on the usage and billing email notifications for the owner's address.
4. Add a monthly budget alert on the card or account that pays Supabase as a second safety net.

### 3. Add-ons: PITR and custom domain

| Add-on | dev | staging | prod |
|---|---|---|---|
| Point in time recovery | off | off | **on, 7 days** ([`../ops/backups-and-pitr.md`](../ops/backups-and-pitr.md) B2) |
| Custom domain | none | `api.staging.thuluth.app` (19 §6; optional before beta) | **`api.thuluth.app`** |

**PITR (prod):** go to **Project settings > Add-ons > Point in time recovery**, pick **7 days**, confirm. PITR needs Small compute or larger. Prod runs Large, so this is fine.

**Custom domain (prod):** do this after Google and Apple know the new callback URL ([`auth-providers.md`](auth-providers.md) step 1), because activating the domain changes the OAuth callback to `https://api.thuluth.app/auth/v1/callback`.

```bash
supabase login                                   # opens the browser once
supabase domains create --project-ref <prod-ref> --custom-hostname api.thuluth.app
```

The command prints a CNAME target and a TXT verification record. Add both in Cloudflare as **DNS only (grey cloud, not proxied)**, as described in [`domain-and-dns.md`](domain-and-dns.md). Then:

```bash
supabase domains reverify --project-ref <prod-ref>   # repeat until it says verified (DNS can take minutes)
supabase domains activate --project-ref <prod-ref>
```

The old `https://<prod-ref>.supabase.co` address keeps working after activation.

### 4. Auth settings (mirror `supabase/config.toml`)

Open **Authentication** in the project. Set every row below. Every environment uses the same values unless the table says otherwise.

| Setting (dashboard location) | Value | From `config.toml` |
|---|---|---|
| URL Configuration > Site URL | `https://thuluth.app` | `site_url` |
| URL Configuration > Redirect URLs | `thuluth://auth-callback`, `https://thuluth.app/auth/callback`. On **dev only**, also `exp+thuluth://auth-callback` | `additional_redirect_urls` |
| Sign In / Providers > Allow new users to sign up | on | `enable_signup` |
| Sign In / Providers > Allow anonymous sign-ins | **off** | `enable_anonymous_sign_ins = false` |
| Sign In / Providers > Email: enabled, Confirm email on, Secure email change on, Secure password change on | as listed | `[auth.email]` |
| Sign In / Providers > Email > Email OTP length | `6` | `otp_length` |
| Sign In / Providers > Email > Email OTP expiration | `600` seconds | `otp_expiry` |
| Sign In / Providers > Email > Minimum password length | `12` | `minimum_password_length` |
| Sessions > Detect and revoke compromised refresh tokens (refresh token rotation) | on | `enable_refresh_token_rotation` |
| Sessions > Refresh token reuse interval | `10` seconds | `refresh_token_reuse_interval` |
| JWT Keys (or Auth settings) > Access token expiry | `3600` seconds | `jwt_expiry` |
| Rate Limits > emails sent | `1000` per hour (project-wide; Supabase allows raising it only after custom SMTP is set, [`postmark-email.md`](postmark-email.md) step 6) | `email_sent` |
| Rate Limits > sign-ups and sign-ins | `30` | `sign_in_sign_ups` |
| Rate Limits > token verifications | `30` | `token_verifications` |
| Rate Limits > token refreshes | `150` | `token_refresh` |
| Multi-Factor > TOTP | enroll **on**, verify **on**; max factors `10` | `[auth.mfa.totp]` |
| Attack Protection > CAPTCHA | **leave off for now**. Read [`auth-providers.md`](auth-providers.md) step 4 first | `[auth.captcha]` |
| Providers > Google, Apple | [`auth-providers.md`](auth-providers.md) | `[auth.external.*]` |
| Emails > SMTP settings | Postmark server for this environment ([`postmark-email.md`](postmark-email.md)) | prod and staging only |

Every variant uses the single scheme `thuluth` (`app.config.ts` `scheme: 'thuluth'`), and `config.toml` lists the exact URLs above (also 19 §6). The app does not send a redirect URL today (sign-in is a typed code or a native Google or Apple token), so these entries are a safety net.

**Email templates (required for OTP).** The app asks for a 6-digit code, not a link. In **Emails > Templates**, paste `supabase/templates/auth/magic-link.html` into **Magic Link** and `supabase/templates/auth/confirmation.html` into **Confirm signup**, each with the subject `Your Thuluth code / ثلث کوڈ` ([`postmark-email.md`](postmark-email.md) step 7). `config.toml` applies them only to the local stack. Without this, users receive a link that the app cannot use.

### 5. API, database and security settings

| Setting (dashboard location) | Value | Why |
|---|---|---|
| Project settings > Data API > Exposed schemas | **`public` only**. Remove `graphql_public` | `config.toml` `[api] schemas = ["public"]`, S7-SEC-13 |
| Data API > Extra search path | `public, extensions` | `extra_search_path` |
| Data API > Max rows | `1000` | `max_rows` |
| Database > Settings > SSL enforcement | **on** (all environments) | 19 §6 |
| Database > Settings > Network restrictions | **none** in every environment at launch (see below) | 19 §6 |
| Compute and disk > Disk autoscaling | on | [`../ops/backups-and-pitr.md`](../ops/backups-and-pitr.md) B4 |
| JWT Keys | **asymmetric signing key (ECC P-256 / ES256)** in use, legacy HS256 secret revoked | `production-environment.md` Step 1 security settings |
| API Keys | note the **publishable key** (`sb_publishable_...`). The app and the smoke test use it | [`../ops/secrets.md`](../ops/secrets.md) §5 |

**JWT keys:** go to **Project settings > JWT Keys**. If the project still uses the legacy JWT secret, click **Migrate JWT secret**, then **Create standby key** (ECC P-256), then **Rotate keys**. Once every client uses the new keys (on a fresh project that is immediately), **Revoke** the legacy secret. Access tokens stay valid until they expire (3600 s), even after a session is revoked.

**Network restrictions (prod):** leave them off at launch. `deploy-prod.yml` (`supabase db push`, catalog seeds) and `backup-prod.yml` connect to the database from GitHub-hosted runners, which have no fixed IP addresses, so an allow-list would break deploys and backups. Prod relies on SSL enforcement, a strong unique database password per environment, the read-only `backup_reader` role for backups and short-lived access tokens instead. This is the default decision of 2026-10-06 (19 §6); the PO can override it. Revisit it when deploys move to a self-hosted runner or a static-egress proxy, and then allow only that IP and the admin IPs.

### 6. Link the CLI and push the migrations

Run these from the repo root on a trusted machine. Export the password from 1Password so it never lands in shell history:

```bash
export SUPABASE_DB_PASSWORD="$(op read 'op://Thuluth Platform/<env> SUPABASE_DB_PASSWORD/credential')"
supabase link --project-ref <ref>
supabase db push --dry-run         # read the list: it should be every file in supabase/migrations
supabase db push                   # never add --include-seed
```

Never use `--include-seed` on a hosted project. The seed list in `config.toml` also holds `seed/local/000_local_vault.sql` (throwaway Vault values) and `seed/local/900_dev_fixtures.sql` (test users).

- **dev:** after the first manual push, `deploy-dev.yml` pushes on every merge to `main` ([`github-environments.md`](github-environments.md)).
- **staging:** there is no staging workflow in `.github/workflows`. Push by hand with the commands above for each release candidate.
- **prod:** prefer the first push through `deploy-prod.yml` so it is reviewed and logged ([`github-environments.md`](github-environments.md) step 7). A manual push is fine only if the workflow is not ready yet.

> **Note:** 20 §5 describes a `main.yml` workflow that deploys staging automatically. It does not exist in the repo yet.

### 7. Set the `app.environment` database setting (dev and staging)

The catalog review gate and sandbox premium only work when the database says it is not production ([`feature-flags-and-app-config.md`](feature-flags-and-app-config.md) step 5). Connect with `psql` (step 8 shows how to get the connection URL) and run:

```sql
-- thuluth-dev
alter database postgres set app.environment = 'development';
-- thuluth-staging
alter database postgres set app.environment = 'staging';
```

Do nothing on prod. An unset value counts as production. The setting applies to **new** connections only, so restart the project afterwards (**Project settings > General > Restart project**). Dev and staging can take the short downtime.

The code accepts only `'local'`, `'development'`, `'staging'` or `'test'` (`20261006110100_catalog_review_gating.sql`, `20261006150500_security_review_hardening.sql`, and 05 §23.1b), so use `'development'`, not `'dev'`.

### 8. Apply the catalog seeds

1. In the dashboard, click **Connect** and copy the **Session pooler** connection string (port 5432, user `postgres.<ref>`).
2. Save it in 1Password as `<env> SUPABASE_DB_URL`. This is also the GitHub secret `SUPABASE_DB_URL` for `development` and `production` ([`github-environments.md`](github-environments.md)).
3. Run the seeds:

```bash
export SUPABASE_DB_URL="$(op read 'op://Thuluth Platform/<env> SUPABASE_DB_URL/credential')"
bash tooling/scripts/ops/apply-catalog-seeds.sh --dry-run   # lists the files in supabase/seed/catalog
bash tooling/scripts/ops/apply-catalog-seeds.sh             # ends with "catalog seeds applied: 19 files"
```

The seeds are idempotent, so you can run them again safely. They never touch `seed/local/*`. Admin changes to flags and to route `enabled` survive a re-run, but route `params` are overwritten (see [`ai-providers.md`](ai-providers.md)).

### 9. Secrets, Vault and functions

Follow [`supabase-secrets-and-vault.md`](supabase-secrets-and-vault.md) for this environment, then deploy the functions:

```bash
supabase secrets set APP_ENV=<development|staging|production> --project-ref <ref>
supabase functions deploy --project-ref <ref>
```

`deploy-prod.yml` sets `APP_ENV=production` itself. For staging you must set `APP_ENV=staging` by hand: without it the functions treat the project as `development`.

### 10. Sign-up guard hook (every environment) and the store reviewer account (prod)

`11-authentication.md` §3.1.1 says people sign in only with an email code, Google or Apple, and the only password account is the store reviewer `reviewer@thuluth.app`. Migration `20261006160200_auth_signup_guard.sql` enforces this in two parts:

- `public.hook_before_user_created`, a "before user created" Auth hook that refuses any sign-up whose provider is not `email`, `google` or `apple` (403).
- `private.guard_password_auth_user`, a trigger on `auth.users` that refuses any password Supabase Auth sets on an account other than `reviewer@thuluth.app`, at sign-up and on a later password change. It needs no setting; `supabase db push` installs it.

The hook must be switched on by hand, because `config.toml` (`[auth.hook.before_user_created]`) applies only to the local stack. In **Authentication > Hooks > Add hook > Before User Created**: type **Postgres function**, schema `public`, function `hook_before_user_created`, enabled. Do this on `thuluth-dev`, `thuluth-staging` and `thuluth-prod`, after step 6 has pushed the migrations.

Then create the reviewer account on prod by following [`../store/demo-account.md`](../store/demo-account.md). In short: **Authentication > Users > Add user > Create new user**, email `reviewer@thuluth.app`, a 20+ character password generated by 1Password (item `prod reviewer-account`), **Auto confirm user** ticked. Then run the internal-account SQL in step 11.

### 11. Admin, demo and smoke accounts

Create each account (except the reviewer) by signing in once in that environment's app with an email code. Do not create them with a password: the sign-up guard (step 10) refuses a password on any address other than `reviewer@thuluth.app`. Then run the SQL as the `postgres` role (SQL Editor, or `psql "$SUPABASE_DB_URL"`).

| Account | Environments | Purpose |
|---|---|---|
| Admin (the PO's own address) | all | flags, routes, KPI views (`public.is_admin()` reads `app_metadata.role`) |
| Store reviewer `reviewer@thuluth.app` | prod | App Store and Play review (step 10) |
| Demo accounts | staging, prod | demos and screenshots |
| Smoke account (an inbox you can read) | staging, prod | manual end-to-end checks after a deploy |

Make the admin:

```sql
update auth.users
   set raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb
 where email = '<admin email>';
```

The admin must sign out and sign in again to get a token with the new role.

Mark every staff, demo, reviewer and smoke account as internal so the launch KPIs ignore them:

```sql
update public.users set is_internal = true
 where email in ('<admin email>', 'reviewer@thuluth.app', '<demo email>', '<smoke email>');
```

**Dev only:** before 2026-10-06, `deploy-dev.yml` used `--include-seed`, so `thuluth-dev` may still hold the local fixture users and the local Vault values. Check with `select email from auth.users order by created_at;` and `select name from vault.secrets;`. Delete the fixture users in **Authentication > Users** if you do not want them, and reset the Vault values ([`supabase-secrets-and-vault.md`](supabase-secrets-and-vault.md)).

## Where the values go

| Value | Where it is set | Name |
|---|---|---|
| Database password | 1Password, GitHub environment secret | `<env> SUPABASE_DB_PASSWORD`, `SUPABASE_DB_PASSWORD` |
| Session pooler URL (postgres role) | 1Password, GitHub environment secret | `<env> SUPABASE_DB_URL`, `SUPABASE_DB_URL` |
| Project ref | GitHub environment variable | `SUPABASE_PROJECT_REF` |
| Publishable key | EAS environment variable, GitHub variable | `EXPO_PUBLIC_SUPABASE_ANON_KEY` (EAS), `SUPABASE_PUBLISHABLE_KEY` (GitHub `production`) |
| API URL | EAS environment variable, GitHub variable | `EXPO_PUBLIC_SUPABASE_URL` (prod: `https://api.thuluth.app`), `API_BASE_URL` (GitHub `production`) |
| `APP_ENV` | function secret | `APP_ENV` |
| `app.environment` | database setting | `alter database postgres set app.environment = ...` |

## Verify

Run these for each environment. The expected results are on the right.

| Check | Command | Expect |
|---|---|---|
| Migrations | `supabase migration list` (after `supabase link`) | local and remote columns identical |
| Every table has RLS | `select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity;` | `0` |
| Catalog loaded | `select count(*) from public.feature_flags;` and `select count(*) from public.ai_model_routes;` | 23 flags and about 20 routes |
| Environment marker | `show app.environment;` in a new session | dev `development`, staging `staging`, prod an error or empty |
| Functions | `supabase functions list --project-ref <ref>` | every folder in `supabase/functions` except `_shared` |
| Health | `curl -s https://<ref>.supabase.co/functions/v1/health` (prod: `https://api.thuluth.app/functions/v1/health`) | `"status":"ok"`, or `degraded` until Vault and cron are set |
| Smoke | `API_BASE_URL=https://<ref>.supabase.co SUPABASE_PUBLISHABLE_KEY=<publishable key> bash tooling/scripts/ops/smoke.sh` | four `ok` lines |
| Sign-in | request a code in the app for the smoke account | an email with a 6-digit code (not a link) |
| Sign-up guard | `select tgname from pg_trigger where tgname = 'guard_password_auth_user';`, and Authentication > Hooks | one row, and the Before User Created hook enabled |
| Admin | as the admin, `select public.is_admin();` from the app or SQL with that JWT | `true` |

## Rotate or revoke

| Item | Cadence | How |
|---|---|---|
| Database password | 90 days (19 §8), and at once if leaked | **Database > Settings > Reset database password**. Then update 1Password, the GitHub secrets `SUPABASE_DB_PASSWORD` and `SUPABASE_DB_URL` for that environment, and any `.env` you use locally |
| Publishable key | only on suspicion | **API Keys**: create a new publishable key, ship it in EAS env and an app update, then revoke the old one |
| Secret key / service role | on suspicion | **API Keys**: create a new secret key, redeploy the functions (they read it automatically), revoke the old key |
| JWT signing key | on suspicion | **JWT Keys**: create standby, rotate, revoke the old one after an hour |
| Reviewer password | after each review cycle | [`../store/demo-account.md`](../store/demo-account.md) |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Users get a sign-in **link** instead of a code | default Magic Link and Confirm signup templates | step 4: paste both repo templates |
| "Database error saving new user" when adding a user with a password | the sign-up guard refuses passwords except for `reviewer@thuluth.app` | create the account by email code in the app (step 11) |
| `supabase db push` asks for a password or fails with "password authentication failed" | `SUPABASE_DB_PASSWORD` not exported, or it was reset | export it from 1Password again |
| The deploy workflow fails to connect to the database | network restrictions were turned on and GitHub runners are not allowed | step 5: turn the restriction off again (GitHub-hosted runners have no fixed IPs) |
| `in_review` recipes do not show on dev even with the flag on | `app.environment` not set, or set but the project was not restarted | step 7, then restart |
| `health` stays `degraded` | Vault values missing (cron jobs skip), or `app.maintenance` is on | [`supabase-secrets-and-vault.md`](supabase-secrets-and-vault.md), [`feature-flags-and-app-config.md`](feature-flags-and-app-config.md) |
| Google or Apple sign-in fails only on prod after the domain went live | callback URL `https://api.thuluth.app/auth/v1/callback` missing at Google or Apple | [`auth-providers.md`](auth-providers.md) step 1 |
