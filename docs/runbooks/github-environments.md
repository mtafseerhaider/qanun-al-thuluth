# GitHub environments and deploy workflows: configuration runbook

> **Environments:** dev (GitHub `development`) and prod (`production-readonly`, `production`, `production-backup`) · **Time:** ~45 min · **Needs:** admin access to the GitHub repository `qanun-al-thuluth`, the GitHub CLI `gh` (optional), Supabase organization access, an Expo account, access to vault "Thuluth Platform" · **Related:** [`../ops/secrets.md`](../ops/secrets.md) §4, [`../ops/production-environment.md`](../ops/production-environment.md) Step 2 and Step 4, `20-ci-cd-pipeline.md` §10 and §11, [`supabase-projects.md`](supabase-projects.md), [`supabase-secrets-and-vault.md`](supabase-secrets-and-vault.md), [`offsite-backups-gcp.md`](offsite-backups-gcp.md), [`eas-builds.md`](eas-builds.md), [`sentry.md`](sentry.md), [`google-play.md`](google-play.md), [`password-manager.md`](password-manager.md)

GitHub and Supabase menu names may differ slightly from this runbook.

## What this configures

The deploy workflows in `.github/workflows` get their credentials from GitHub **environments**. An environment holds secrets and variables, and can require an approval before a job uses them. Production deploys need the PO's approval, and the dry-run plan job and the backup job get only the access they need. While an environment is empty, `deploy-dev.yml` and `backup-prod.yml` skip with a notice (green but nothing happens), and `deploy-prod.yml` and `rollback-prod.yml` fail with a list of what is missing.

Staging has no workflow today. `20-ci-cd-pipeline.md` §10 lists `staging-readonly` and `staging` environments, and 19 §8 mentions a `staging` environment, but no workflow uses them. Do not create them until a staging workflow exists. Staging is deployed by hand ([`supabase-projects.md`](supabase-projects.md) step 6).

## Before you start

- `thuluth-dev` and `thuluth-prod` exist, and you have their project refs, database passwords and session pooler URLs in 1Password ([`supabase-projects.md`](supabase-projects.md) steps 1 and 8).
- For `production-backup`: the GCP bucket, workload identity and `backup_reader` role exist ([`offsite-backups-gcp.md`](offsite-backups-gcp.md), [`../ops/backups-and-pitr.md`](../ops/backups-and-pitr.md) B5 to B8).
- The EAS project exists ([`eas-builds.md`](eas-builds.md)), so you have `EAS_PROJECT_ID`.

## Steps

### 1. Create the Supabase access tokens

`SUPABASE_ACCESS_TOKEN` lets the CLI in the workflows link to a project and deploy. Use a separate token for each GitHub environment, so you can revoke one without breaking the others. Never use the PO's everyday token.

1. Preferably create a machine account: a separate Supabase user with its own mailbox (for example a shared ops address), invited to the Thuluth organization as **Developer**.
2. Signed in as that user, go to **Account > Access Tokens > Generate new token**. Make one per environment:

| Token name | Used by GitHub environment | 1Password item |
|---|---|---|
| `github-development` | `development` | `dev SUPABASE_ACCESS_TOKEN` |
| `github-production-readonly` | `production-readonly` | `prod SUPABASE_ACCESS_TOKEN-readonly` |
| `github-production` | `production` | `prod SUPABASE_ACCESS_TOKEN` |

On the Pro plan a token can reach every project the user can see. The separation limits what a single revoke breaks; it does not limit access.

### 2. Create the Expo token

Use the robot token from [`eas-builds.md`](eas-builds.md) step 5 (robot user `github-actions` in the `thuluth` organisation). It is one token for both GitHub environments, saved in 1Password as `shared EXPO_TOKEN` ([`password-manager.md`](password-manager.md) step 4.3).

### 3. Create the environments and their protection rules

Go to the repository **Settings > Environments > New environment**. Create each environment that does not exist yet (`development` already exists) and set its protection:

| Environment | Required reviewers | Prevent self-review | Wait timer | Deployment branches and tags |
|---|---|---|---|---|
| `development` | none | n/a | 0 | no restriction |
| `production-readonly` | none | n/a | 0 | **Selected branches and tags**: tag rule `v*` |
| `production` | **Tafseer** | **off** for now (see below) | 0 | **Selected branches and tags**: tag rule `v*` and branch `main` |
| `production-backup` | none | n/a | 0 | **Selected branches and tags**: branch `main` only |

`production` allows `main` because `rollback-prod.yml` runs from `main` for OTA rollbacks. `production-readonly` allows only tags, so `deploy-prod.yml` must be started **from the tag** (step 7).

> **Prevent self-review stays off until there is a second maintainer.** With it on, the person who starts a run cannot approve it, so Tafseer, as the only reviewer, could never approve his own deploy. The required reviewer still gives a deliberate pause and an audit trail. When a second maintainer joins, add them as a reviewer and turn prevent self-review on ([`../ops/secrets.md`](../ops/secrets.md) §4).

### 4. Add secrets and variables

Open each environment and use **Add environment secret** and **Add environment variable**. The names must be exact. These are the names the workflows read today:

**`development`** (read by `deploy-dev.yml`)

| Kind | Name | Value |
|---|---|---|
| secret | `SUPABASE_ACCESS_TOKEN` | `dev SUPABASE_ACCESS_TOKEN` |
| secret | `SUPABASE_DB_PASSWORD` | `dev SUPABASE_DB_PASSWORD` |
| secret | `SUPABASE_DB_URL` | `dev SUPABASE_DB_URL` (postgres role, session pooler, port 5432). Without it the catalog seeds are skipped |
| secret | `EXPO_TOKEN` | `shared EXPO_TOKEN` |
| variable | `SUPABASE_PROJECT_REF` | `<dev-ref>` |
| variable | `EAS_PROJECT_ID` | the EAS project id |
| variable | `EXPO_PUBLIC_SUPABASE_URL` | `https://<dev-ref>.supabase.co` |
| variable | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | the dev publishable key |
| variable | `EXPO_PUBLIC_SENTRY_DSN` | the `thuluth-mobile` DSN ([`sentry.md`](sentry.md)) |

> **Note:** `deploy-dev.yml` passes only these three `EXPO_PUBLIC_*` values to `eas update`. Dev OTA updates therefore lose `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_ONESIGNAL_APP_ID`, `EXPO_PUBLIC_RC_IOS_KEY` and `EXPO_PUBLIC_RC_ANDROID_KEY`, so Google sign-in, push and purchases stop working on dev builds after an update. Report this to the mobile lead. The workflow would need to pass them, or run `eas update --environment development`.

**`production-readonly`** (read by the `plan` job of `deploy-prod.yml`)

| Kind | Name | Value |
|---|---|---|
| secret | `SUPABASE_ACCESS_TOKEN` | `prod SUPABASE_ACCESS_TOKEN-readonly` |
| secret | `SUPABASE_DB_PASSWORD` | `prod SUPABASE_DB_PASSWORD` |
| variable | `SUPABASE_PROJECT_REF` | `<prod-ref>` |

**`production`** (read by the `deploy` job of `deploy-prod.yml`, and by `rollback-prod.yml`)

| Kind | Name | Value | Read by |
|---|---|---|---|
| secret | `SUPABASE_ACCESS_TOKEN` | `prod SUPABASE_ACCESS_TOKEN` | both |
| secret | `SUPABASE_DB_PASSWORD` | `prod SUPABASE_DB_PASSWORD` | `deploy-prod.yml` |
| secret | `SUPABASE_DB_URL` | `prod SUPABASE_DB_URL` (postgres role, session pooler, port 5432) | `deploy-prod.yml` (catalog seeds) |
| secret | `EXPO_TOKEN` | `shared EXPO_TOKEN` | `rollback-prod.yml` |
| variable | `SUPABASE_PROJECT_REF` | `<prod-ref>` | both |
| variable | `API_BASE_URL` | `https://api.thuluth.app` (or `https://<prod-ref>.supabase.co` until the custom domain is active) | smoke test |
| variable | `SUPABASE_PUBLISHABLE_KEY` | the prod publishable key | smoke test |

[`../ops/secrets.md`](../ops/secrets.md) §4 also lists `SENTRY_AUTH_TOKEN`, `PLAY_SERVICE_ACCOUNT_JSON` (secrets) and `SENTRY_ORG` (variable, `thuluth`) for `production`, marked "reserved, no workflow reads it yet". They are for the planned release workflow (20 §7). Adding them now does no harm ([`sentry.md`](sentry.md), [`google-play.md`](google-play.md)).

**`production-backup`** (read by `backup-prod.yml`; values come from [`offsite-backups-gcp.md`](offsite-backups-gcp.md))

| Kind | Name | Value |
|---|---|---|
| secret | `SUPABASE_DB_URL` | the **read-only** `backup_reader` URL (`prod backup-reader-db-url`), never the postgres one |
| variable | `GCP_WIF_PROVIDER` | the workload identity provider resource name |
| variable | `GCP_BACKUP_SA` | the backup service account email |
| variable | `BACKUP_BUCKET` | the bucket name |
| variable | `BACKUP_AGE_PUBLIC_KEY` | the `age` public key (`age1...`) |

**From the command line instead of clicking.** `gh` reads the value from standard input, so it never appears on screen or in history:

```bash
op read 'op://Thuluth Platform/prod SUPABASE_DB_PASSWORD/credential' | gh secret set SUPABASE_DB_PASSWORD --env production
gh variable set SUPABASE_PROJECT_REF --env production --body '<prod-ref>'
```

### 5. Tag ruleset for release tags

`deploy-prod.yml` deploys whatever tag you give it, so only trusted people should be able to create `v*` tags.

1. Go to **Settings > Rules > Rulesets > New ruleset > New tag ruleset**.
2. Name `release tags`, enforcement **Active**.
3. Target tags: **Include by pattern** `v*`.
4. Rules: tick **Restrict creations**, **Restrict updates** and **Restrict deletions**.
5. Bypass list: the **Maintain** and **Admin** roles. 20 §10 wants only a release bot GitHub App to create tags; no such app exists yet, so use the maintainers until it does.

### 6. First run of `deploy-dev.yml`

1. Go to **Actions > Deploy dev > Run workflow**, branch `main`, then **Run workflow**. Every merge to `main` runs it from then on.
2. Open the run. Job "Migrations + functions to thuluth-dev" should link, push migrations, apply catalog seeds and deploy functions. Job "EAS Update (development channel)" publishes an update to channel `development`.
3. If a step shows a notice such as "Supabase dev project not connected yet; skipping deploy", "SUPABASE_DB_URL not set for development; skipping catalog seeds" or "EAS project not connected yet; skipping update", the matching secret or variable is missing.

### 7. First run of `deploy-prod.yml`

Before this: [`supabase-secrets-and-vault.md`](supabase-secrets-and-vault.md) is done for prod (otherwise the smoke test passes but cron and AI do not work).

1. Make sure the release commit is on `main`. Create the tag and push it (a maintainer, because of the ruleset):

```bash
git tag v1.0.0 <commit on main>
git push origin v1.0.0
```

The tag must look exactly like `v1.2.3`. `v1.0.0-rc.1` is refused. For a beta, use a `v0.9.x` tag.

2. Go to **Actions > Deploy production backend > Run workflow**.
3. In **Use workflow from**, switch to **Tags** and pick `v1.0.0`. If you leave `main` here, the `plan` job is blocked, because `production-readonly` only accepts `v*` refs.
4. Fill in `ref` = `v1.0.0`. Leave **functions** and **seeds** ticked. Click **Run workflow**.
5. The `plan` job ("Production migration plan (dry run)") runs without approval and writes the list of migrations to the run summary. Read it.
6. The `deploy` job waits for approval. The reviewer (Tafseer, who may also have started the run while prevent self-review is off) clicks **Review deployments**, ticks `production`, and clicks **Approve and deploy**.
7. The job pushes migrations, applies catalog seeds, sets `GIT_SHA` and `APP_ENV=production`, deploys every function, then runs `tooling/scripts/ops/smoke.sh`. The run is green only if all four smoke checks pass.
8. Follow [`../ops/production-environment.md`](../ops/production-environment.md) Step 4 for the checks after the first deploy (health, RLS, cron, flags, accounts).

### How each workflow uses the environments

| Workflow (Actions name) | File | Trigger | Environment(s) | Missing config |
|---|---|---|---|---|
| PR checks | `pr.yml` | every PR and push to `main` | none (only `GITHUB_TOKEN`) | n/a |
| Deploy dev | `deploy-dev.yml` | push to `main`, manual | `development` | skips with a notice |
| Deploy production backend | `deploy-prod.yml` | manual, input `ref` = tag | `production-readonly` (plan), `production` (deploy) | fails |
| Production rollout and rollback | `rollback-prod.yml` | manual, input `action` | `production` | fails |
| Nightly offsite backup (prod) | `backup-prod.yml` | daily 23:00 UTC (04:00 PKT), manual | `production-backup` | skips with a notice |

## Where the values go

| Value | GitHub environment | Name |
|---|---|---|
| Supabase CLI token | `development`, `production-readonly`, `production` | `SUPABASE_ACCESS_TOKEN` (a different token in each) |
| Database password | `development`, `production-readonly`, `production` | `SUPABASE_DB_PASSWORD` |
| Session pooler URL, postgres role | `development`, `production` | `SUPABASE_DB_URL` |
| Session pooler URL, `backup_reader` role | `production-backup` | `SUPABASE_DB_URL` |
| Project ref | all three Supabase ones | `SUPABASE_PROJECT_REF` (variable) |
| Expo token | `development`, `production` | `EXPO_TOKEN` |
| API URL and publishable key for the smoke test | `production` | `API_BASE_URL`, `SUPABASE_PUBLISHABLE_KEY` (variables) |
| Dev app config for OTA | `development` | `EAS_PROJECT_ID`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_SENTRY_DSN` (variables) |
| Backup | `production-backup` | `GCP_WIF_PROVIDER`, `GCP_BACKUP_SA`, `BACKUP_BUCKET`, `BACKUP_AGE_PUBLIC_KEY` (variables) |

Function runtime secrets (AI keys, RevenueCat, OneSignal, Postmark, Gotenberg) never go into GitHub. They live in Supabase only (20 §11, [`supabase-secrets-and-vault.md`](supabase-secrets-and-vault.md)).

## Verify

```bash
gh api repos/mtafseerhaider/qanun-al-thuluth/environments --jq '.environments[].name'
gh secret list --env production
gh variable list --env production
gh secret list --env development
```

Expect the four environment names, and every name from step 4 for each environment. Then check that:

- the first `deploy-dev.yml` run shows no "skipping" notices;
- the first `deploy-prod.yml` run shows the dry-run plan, waits for approval, and ends with four `ok` smoke lines;
- a manual run of **Nightly offsite backup (prod)** writes "Backup thuluth-prod-....tgz.age uploaded" to its summary;
- a test push of a tag such as `v0.0.0-test` by a non-maintainer is refused (the ruleset).

## Rotate or revoke

| Secret | Cadence | How |
|---|---|---|
| `SUPABASE_ACCESS_TOKEN` (each) | 90 days (19 §8), or at once if leaked | generate a new token as the machine account, update the GitHub secret, then delete the old token in Supabase |
| `SUPABASE_DB_PASSWORD`, `SUPABASE_DB_URL` | 90 days | reset in Supabase ([`supabase-projects.md`](supabase-projects.md) "Rotate"), then update both secrets in every environment that has them |
| `EXPO_TOKEN` | 180 days | new token at expo.dev, update the secret, revoke the old one |
| `production-backup` `SUPABASE_DB_URL` | with the `backup_reader` password | `alter role backup_reader password '...'`, then update the secret |
| `SENTRY_AUTH_TOKEN`, `PLAY_SERVICE_ACCOUNT_JSON` | 180 days / yearly | [`sentry.md`](sentry.md), [`google-play.md`](google-play.md) |

After any rotation, run the workflow that uses the secret once by hand to prove it still works.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `plan` job blocked: "Tag/Branch 'main' is not allowed to deploy to production-readonly" | the run was started from `main` | step 7.3: pick the tag in "Use workflow from" |
| "ref must be a release tag like v1.0.0" | `ref` input has a suffix (`-rc.1`) or is a branch | use a plain `vX.Y.Z` tag |
| "vX.Y.Z is not on main" | the tag points at a commit that is not on `main` | tag a commit on `main` |
| "production is missing: ..." or "production-readonly is missing: ..." | a secret or variable from step 4 is not set | add it, then re-run |
| Nobody can approve the `deploy` job | prevent self-review was turned on while Tafseer is the only reviewer and he started the run | turn it off until a second maintainer exists (step 3) |
| `deploy-dev.yml` is green but nothing deployed | the `development` secrets are missing; the steps only printed notices | step 4 |
| Catalog seed step fails to connect | `SUPABASE_DB_URL` is not the session pooler URL, or prod network restrictions block GitHub runners | [`supabase-projects.md`](supabase-projects.md) step 5 note and step 8 |
| Smoke test "feature_flags hidden from anonymous callers" fails | `SUPABASE_PUBLISHABLE_KEY` belongs to another project, or grants changed | check the key; tell the backend lead if it is right |
