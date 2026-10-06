# Supabase function secrets and Vault: configuration runbook

> **Environments:** dev / staging / prod · **Time:** ~30 min per environment once the third-party keys exist · **Needs:** Supabase CLI 2.48.3, `psql`, the 1Password CLI `op` (optional but recommended), access to vault "Thuluth Platform", a trusted machine · **Related:** [`../ops/secrets.md`](../ops/secrets.md) §1 and §2 (the canonical name list), [`../ops/production-environment.md`](../ops/production-environment.md) Step 3, 19 §8.1, [`supabase-projects.md`](supabase-projects.md), [`ai-providers.md`](ai-providers.md), [`password-manager.md`](password-manager.md)

Dashboard menu names may differ slightly from this runbook.

## What this configures

The Edge Functions read their secrets (AI keys, webhook secrets, email and push tokens) from Supabase **function secrets**. The database reads three values of its own from **Supabase Vault**: the API address and the cron secret that pg_cron uses to call the functions, and the salt for IP hashes. While these are missing, every cron and worker call is refused (401), so plans never generate, notifications never send, AI calls fail, and webhooks are refused. The full "while unset" list is in [`../ops/secrets.md`](../ops/secrets.md) §1.

## Before you start

- The project exists, migrations are pushed and the CLI is linked ([`supabase-projects.md`](supabase-projects.md) steps 1 to 6).
- The third-party values for this environment are already in 1Password: AI keys ([`ai-providers.md`](ai-providers.md)), RevenueCat ([`revenuecat.md`](revenuecat.md)), OneSignal ([`onesignal-and-firebase.md`](onesignal-and-firebase.md)), Postmark ([`postmark-email.md`](postmark-email.md)), Gotenberg ([`pdf-renderer-gotenberg.md`](pdf-renderer-gotenberg.md)). A missing value is allowed. That feature just stays off until you add it.
- Item names follow [`password-manager.md`](password-manager.md): `<env> <NAME>` with the value in the field `credential`.

## Steps

### 1. Generate the environment's own random secrets

Every environment gets **new** values. Never copy prod values to dev or staging, or the other way round.

```bash
openssl rand -hex 32   # INTERNAL_CRON_SECRET (also the Vault cron_secret)
openssl rand -hex 32   # VAULT_AUDIT_IP_SALT
```

Save them in 1Password as `<env> INTERNAL_CRON_SECRET` and `<env> VAULT_AUDIT_IP_SALT`. The RevenueCat webhook secret is made the same way in [`revenuecat.md`](revenuecat.md). Both scripts and the functions refuse values shorter than their minimum: 32 characters for Vault and 16 for the function secrets.

### 2. Write the function secrets file

Write a template that holds only 1Password references, never values. Keep it outside the repo, for example in `~/thuluth-secrets/functions.<env>.tpl`:

```text
INTERNAL_CRON_SECRET=op://Thuluth Platform/<env> INTERNAL_CRON_SECRET/credential
ANTHROPIC_API_KEY=op://Thuluth Platform/<env> ANTHROPIC_API_KEY/credential
OPENAI_API_KEY=op://Thuluth Platform/<env> OPENAI_API_KEY/credential
GEMINI_API_KEY=op://Thuluth Platform/<env> GEMINI_API_KEY/credential
REVENUECAT_WEBHOOK_SECRET=op://Thuluth Platform/<env> REVENUECAT_WEBHOOK_SECRET/credential
REVENUECAT_SECRET_API_KEY=op://Thuluth Platform/<env> REVENUECAT_SECRET_API_KEY/credential
ONESIGNAL_APP_ID=op://Thuluth Platform/<env> ONESIGNAL_APP_ID/credential
ONESIGNAL_REST_API_KEY=op://Thuluth Platform/<env> ONESIGNAL_REST_API_KEY/credential
POSTMARK_SERVER_TOKEN=op://Thuluth Platform/<env> POSTMARK_SERVER_TOKEN/credential
GOTENBERG_URL=op://Thuluth Platform/<env> GOTENBERG_URL/credential
GOTENBERG_TOKEN=op://Thuluth Platform/<env> GOTENBERG_TOKEN/credential
AI_DAILY_COST_ALERT_USD=50
```

Per-environment differences:

| Name | dev | staging | prod |
|---|---|---|---|
| `APP_ENV` | leave unset (means `development`) | add `APP_ENV=staging` | set by `deploy-prod.yml` (`production`); do not put it in the file |
| `ONESIGNAL_APP_ID` | "Thuluth Dev" app | "Thuluth Staging" app ([`onesignal-and-firebase.md`](onesignal-and-firebase.md)) | "Thuluth Prod" app (19 §1) |
| `AI_DAILY_COST_ALERT_USD` | optional | optional | `50` unless the PO picks another number ([`ai-providers.md`](ai-providers.md)) |

Do not set `SUPABASE_URL`, `SUPABASE_ANON_KEY` or `SUPABASE_SERVICE_ROLE_KEY`; Supabase injects them. Do not set `LOG_SALT`, `SENTRY_SALT` or `SENTRY_DSN` either; no code reads them yet ([`../ops/secrets.md`](../ops/secrets.md) §1). Remove any line whose 1Password item does not exist yet.

### 3. Push the function secrets

Run this from the repo root. The output file name matches `.gitignore` (`.env.*`), but delete it straight away anyway:

```bash
op inject -i ~/thuluth-secrets/functions.<env>.tpl -o .env.functions.<env>
supabase secrets set --project-ref <ref> --env-file .env.functions.<env>
rm -f .env.functions.<env>
```

Without the 1Password CLI, copy each value into `.env.functions.<env>` by hand, run the same `supabase secrets set` line, then delete the file. To add or change one secret later:

```bash
supabase secrets set --project-ref <ref> OPENAI_API_KEY="$(op read 'op://Thuluth Platform/<env> OPENAI_API_KEY/credential')"
```

New secrets reach the functions on their next cold start. No redeploy is needed.

### 4. Set the Vault values

The Vault `cron_secret` **must equal** `INTERNAL_CRON_SECRET`. pg_cron sends it as the `x-internal-secret` header through `private.invoke_edge_function`, and `requireInternal` in `supabase/functions/_shared/auth.ts` compares it with the function secret.

| Vault name | dev | staging | prod |
|---|---|---|---|
| `project_url` | `https://<dev-ref>.supabase.co` | `https://api.staging.thuluth.app` if that domain is active, else `https://<staging-ref>.supabase.co` | `https://api.thuluth.app` once the custom domain is active, else `https://<prod-ref>.supabase.co` |
| `cron_secret` | `<env> INTERNAL_CRON_SECRET` | same | same |
| `audit_ip_salt` | `<env> VAULT_AUDIT_IP_SALT` | same | same |

Run the script from a trusted machine. Prod has no network restrictions at launch (19 §6); if they are turned on later, the machine must be on an allowed IP. The values come from the environment, never from arguments:

```bash
export SUPABASE_DB_URL="$(op read 'op://Thuluth Platform/<env> SUPABASE_DB_URL/credential')"
export VAULT_PROJECT_URL='https://api.thuluth.app'      # value from the table
export VAULT_CRON_SECRET="$(op read 'op://Thuluth Platform/<env> INTERNAL_CRON_SECRET/credential')"
export VAULT_AUDIT_IP_SALT="$(op read 'op://Thuluth Platform/<env> VAULT_AUDIT_IP_SALT/credential')"
bash tooling/scripts/ops/vault-secrets.sh
unset VAULT_CRON_SECRET VAULT_AUDIT_IP_SALT SUPABASE_DB_URL
```

Expected output: `vault secret project_url set`, `vault secret cron_secret set`, `vault secret audit_ip_salt set`. Run it again whenever a value changes. It updates in place.

> The Vault name is `cron_secret`, as read by `private.invoke_edge_function` (`20261006120200_notifications_feedback_cron.sql`).

> **Dev only:** `thuluth-dev` may still hold the throwaway local values from `seed/local/000_local_vault.sql` (`project_url = http://host.docker.internal:54321`). Running the script above overwrites them.

### 5. Check pg_cron end to end

Wait two minutes after step 4 (`notifications-dispatch` runs every minute), then run in the SQL editor:

```sql
-- every job (Sprint 0 to 6); expect 24 rows, all active
select jobname, schedule, active from cron.job order by 1;

-- runs in the last hour; expect no 'failed'
select status, count(*) from cron.job_run_details
 where start_time > now() - interval '1 hour' group by 1;

-- the HTTP calls pg_cron made to the functions; expect status_code 200
select id, status_code, left(content::text, 120) as body, created
  from net._http_response order by created desc limit 20;

-- the three Vault names
select name from vault.secrets order by 1;
```

The jobs that call functions are `notifications-dispatch`, `plan-generation-sweeper` (`ai-generate-plan/worker`), `prices-refresh`, `exports-purge-expired` (`export-pdf`), `account-delete-executor`, `storage-orphan-sweep` (`account-delete`), `ai-reassess`, `analytics-rollup` and `analytics-rollup-daily`. Some only call when there is work to do, so not every one appears in `net._http_response` straight away.

## Where the values go

| Value | Where it is set | Name |
|---|---|---|
| Cron and worker secret | function secret **and** Vault | `INTERNAL_CRON_SECRET` and Vault `cron_secret` (same value) |
| Next cron secret (rotation only) | function secret | `INTERNAL_CRON_SECRET_NEXT` |
| API address for pg_cron | Vault | `project_url` |
| IP hash salt | Vault | `audit_ip_salt` (1Password item `<env> VAULT_AUDIT_IP_SALT`) |
| AI keys | function secrets | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` |
| RevenueCat | function secrets | `REVENUECAT_WEBHOOK_SECRET`, `REVENUECAT_WEBHOOK_SECRET_NEXT`, `REVENUECAT_SECRET_API_KEY` |
| OneSignal | function secrets | `ONESIGNAL_APP_ID`, `ONESIGNAL_REST_API_KEY` |
| Postmark | function secret | `POSTMARK_SERVER_TOKEN` |
| Gotenberg | function secrets | `GOTENBERG_URL`, `GOTENBERG_TOKEN` |
| AI cost alert threshold | function secret | `AI_DAILY_COST_ALERT_USD` |
| Release metadata | function secrets set by the workflow | `APP_ENV`, `GIT_SHA` |

## Verify

| Check | Command | Expect |
|---|---|---|
| Names present | `supabase secrets list --project-ref <ref>` | every name from step 2 (digests only, no values) |
| Vault | `select name from vault.secrets order by 1;` | `audit_ip_salt`, `cron_secret`, `project_url` |
| Cron reaches functions | `net._http_response` query in step 5 | `200`, no `401` |
| Cron auth is on | `API_BASE_URL=<url> SUPABASE_PUBLISHABLE_KEY=<key> bash tooling/scripts/ops/smoke.sh` | `ok   analytics-rollup rejects calls without the cron secret (401)` |
| Health | `curl -s <url>/functions/v1/health` | `"status":"ok"` (cron failures make it `degraded`) |

## Rotate or revoke

Cadences come from [`../ops/secrets.md`](../ops/secrets.md) §1: `INTERNAL_CRON_SECRET` every 90 days, RevenueCat and OneSignal and Postmark and Gotenberg every 180 days, AI keys every 90 days. Rotate at once if a value may have leaked.

**`INTERNAL_CRON_SECRET` without downtime (19 §8.1).** `requireInternal` accepts either `INTERNAL_CRON_SECRET` or `INTERNAL_CRON_SECRET_NEXT`.

1. Generate a new value with `openssl rand -hex 32` and save it in 1Password as `<env> INTERNAL_CRON_SECRET_NEXT`.
2. `supabase secrets set --project-ref <ref> INTERNAL_CRON_SECRET_NEXT="$(op read 'op://Thuluth Platform/<env> INTERNAL_CRON_SECRET_NEXT/credential')"`
3. Point Vault at the new value: `VAULT_CRON_SECRET=<new value from 1Password> ONLY=cron_secret bash tooling/scripts/ops/vault-secrets.sh` (export `SUPABASE_DB_URL` first).
4. Check the step 5 queries: still `200`.
5. After 24 hours, promote: set `INTERNAL_CRON_SECRET` to the new value, then `supabase secrets unset --project-ref <ref> INTERNAL_CRON_SECRET_NEXT`. In 1Password, move the new value into `<env> INTERNAL_CRON_SECRET` and archive the `_NEXT` item.

**`REVENUECAT_WEBHOOK_SECRET`:** same pattern with `REVENUECAT_WEBHOOK_SECRET_NEXT`. Set `_NEXT`, change the Authorization header in RevenueCat ([`revenuecat.md`](revenuecat.md)), then promote after 24 hours.

**Other keys:** create the new key in the provider console, `supabase secrets set` it, check the feature works, then revoke the old key in the console.

**`audit_ip_salt`:** do not rotate casually. Old IP hashes stop matching new ones.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `net._http_response` shows `401` for every call | Vault `cron_secret` differs from `INTERNAL_CRON_SECRET`, or the secret is shorter than 16 characters (the functions ignore it) | re-run step 4 with the same 1Password item as step 3 |
| Postgres log says `invoke_edge_function: vault secrets missing, skipping` | `project_url` or `cron_secret` not in Vault | step 4 |
| `net._http_response` shows connection errors or a localhost URL | dev still has the local `project_url` | step 4 for dev |
| `vault-secrets.sh` exits with "must be at least 32 characters" | short `VAULT_CRON_SECRET` or `VAULT_AUDIT_IP_SALT` | generate with `openssl rand -hex 32` |
| Every RevenueCat webhook gets 401 | `REVENUECAT_WEBHOOK_SECRET` unset or not matching the header in RevenueCat | [`revenuecat.md`](revenuecat.md) |
| AI chat returns `AI_UNAVAILABLE` | AI keys missing or revoked for every provider on the route | [`ai-providers.md`](ai-providers.md) |
