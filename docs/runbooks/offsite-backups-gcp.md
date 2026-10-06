# Offsite backups on Google Cloud: configuration runbook

> **Environments:** prod only · **Time:** ~75 min, plus ~60 min for the first restore drill · **Needs:** a Google account with a **separate billing account**, the `gcloud` CLI, `age` (`brew install age` or `apt install age`), `psql`, owner access to the GitHub repo `mtafseerhaider/qanun-al-thuluth`, the `thuluth-prod` database password, a printer, 1Password vaults "Thuluth Platform" and "Thuluth Break-glass" · **Related:** [`docs/ops/backups-and-pitr.md`](../ops/backups-and-pitr.md) (checklist B5 to B12, restore procedures, drill log), [`.github/workflows/backup-prod.yml`](../../.github/workflows/backup-prod.yml), [password-manager.md](password-manager.md), [`docs/ops/secrets.md`](../ops/secrets.md) §4, [`19-deployment-architecture.md`](../19-deployment-architecture.md) §10

## What this configures

Every night at 23:00 UTC (04:00 PKT) the GitHub workflow **"Nightly offsite backup (prod)"** (`backup-prod.yml`) dumps the `thuluth-prod` database (roles, schema, data), encrypts the dump with `age` to a public key whose private key only the PO holds offline, and uploads it to a Google Cloud Storage bucket in `europe-west3` that cannot be emptied early (retention lock). It signs in to Google without any stored key, through Workload Identity Federation (GitHub OIDC).

This is layer 2 of the backup plan (19 §10.2). It protects against losing the Supabase project or account, which PITR cannot. While it is missing, the workflow skips with the notice "production-backup not configured yet" and a Supabase account loss would lose all user data.

Menu names in the Google Cloud console and GitHub may differ slightly from the labels below.

## Before you start

- [ ] `thuluth-prod` exists and has the migrations applied (`production-environment.md` Steps 1 to 4).
- [ ] A **second Google Cloud billing account**, not the one used for the PDF renderer, so a problem with one card or account cannot delete both the service and the backups (`backups-and-pitr.md` B5).
- [ ] `gcloud auth login` done as the PO.

## Steps

Set these first:

```bash
PROJECT_ID=thuluth-backup             # if taken, add a suffix, e.g. thuluth-backup-7f3
REGION=europe-west3
BUCKET=thuluth-prod-backups-<suffix>  # globally unique; lowercase, digits and dashes
REPO=mtafseerhaider/qanun-al-thuluth   # GitHub owner/name; change if the repo moves to an org
```

### 1. Create the project

```bash
gcloud projects create "$PROJECT_ID" --name "Thuluth backup"
gcloud billing accounts list                          # pick the SEPARATE billing account
gcloud billing projects link "$PROJECT_ID" --billing-account <BACKUP_BILLING_ACCOUNT_ID>
gcloud config set project "$PROJECT_ID"
gcloud services enable storage.googleapis.com iam.googleapis.com \
  iamcredentials.googleapis.com sts.googleapis.com
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format 'value(projectNumber)')
```

Billing > Budgets and alerts: a 10 USD per month budget with an email alert. Nothing else runs in this project.

### 2. Create the bucket (B5)

```bash
gcloud storage buckets create "gs://$BUCKET" --location "$REGION" \
  --uniform-bucket-level-access --public-access-prevention --default-storage-class STANDARD
gcloud storage buckets update "gs://$BUCKET" --versioning
cat > /tmp/lifecycle.json <<'EOF'
{"rule":[
  {"action":{"type":"Delete"},"condition":{"age":35}},
  {"action":{"type":"Delete"},"condition":{"isLive":false,"age":35}}
]}
EOF
gcloud storage buckets update "gs://$BUCKET" --lifecycle-file /tmp/lifecycle.json
gcloud storage buckets update "gs://$BUCKET" --retention-period 35d
```

What each setting does:

| Setting | Effect |
|---|---|
| Uniform access, public access prevention | no object can ever be made public |
| Versioning | an overwrite keeps the old version |
| Lifecycle delete at 35 days | backups do not pile up; Google waits until the retention period has passed before deleting, so the two 35-day settings work together |
| Retention period 35 days | nobody, including the PO and Google support, can delete an object younger than 35 days. **Do not lock it yet** (step 8) |

35 days matches the promise in the account deletion email ("Backups that may still contain your data expire within 35 days", `account-emails.ts`). Keep them equal.

### 3. Create the service account (B6)

```bash
gcloud iam service-accounts create thuluth-backup-writer --display-name "GitHub nightly backup writer"
SA="thuluth-backup-writer@$PROJECT_ID.iam.gserviceaccount.com"
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member "serviceAccount:$SA" --role roles/storage.objectCreator
```

`roles/storage.objectCreator` can upload but cannot read, overwrite-delete or list. A stolen GitHub token can add files but never remove backups.

Give the PO's own Google account read access for restores:

```bash
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member "user:<po-google-account>" --role roles/storage.objectViewer
```

### 4. Set up Workload Identity Federation for GitHub (B6)

```bash
gcloud iam workload-identity-pools create github --location global --display-name "GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc github-actions \
  --location global --workload-identity-pool github \
  --display-name "GitHub OIDC" \
  --issuer-uri "https://token.actions.githubusercontent.com" \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.environment=assertion.environment" \
  --attribute-condition "assertion.repository == '$REPO' && assertion.environment == 'production-backup'"
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --role roles/iam.workloadIdentityUser \
  --member "principal://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/subject/repo:$REPO:environment:production-backup"
echo "GCP_WIF_PROVIDER=projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github-actions"
echo "GCP_BACKUP_SA=$SA"
```

Only a job in this repository that runs in the GitHub environment `production-backup` can act as the service account. No JSON key is ever created; do not create one.

### 5. Create the `age` key pair (B8)

On the PO's laptop, offline if you can (turn Wi-Fi off for this step):

```bash
age-keygen -o thuluth-backup.key
# prints: Public key: age1...
```

1. Copy the **public key** (`age1...`). It is not secret. It becomes the GitHub variable `BACKUP_AGE_PUBLIC_KEY`.
2. Print `thuluth-backup.key` on paper twice. Keep one copy at home in a safe place and one at a second trusted place.
3. Store the file's contents in 1Password vault **"Thuluth Break-glass"** as "prod age-backup-private-key" (a Secure Note or Document). Only the PO has access to that vault ([password-manager.md](password-manager.md) step 2).
4. Delete the file from the laptop: `rm -P thuluth-backup.key` on macOS (`shred -u` on Linux).

Without this private key no backup can ever be read. If it is lost, the backups are useless; if it leaks, every backup in the bucket is readable.

### 6. Create the read-only database role (B7)

Connect to `thuluth-prod` as `postgres` (Dashboard > Connect > Session pooler connection string, password from 1Password "prod SUPABASE_DB_PASSWORD"), then:

```bash
BACKUP_PW=$(openssl rand -hex 24)        # hex, so it needs no URL escaping
psql "<prod postgres session-pooler URL>" -v pw="$BACKUP_PW" <<'SQL'
create role backup_reader login password :'pw' bypassrls;
grant pg_read_all_data to backup_reader;
SQL
```

Build the connection URL from the **Session pooler** string in Dashboard > Connect (port 5432), replacing the user and password. With the Supabase pooler the user name carries the project ref:

```text
postgresql://backup_reader.<prod-ref>:<BACKUP_PW>@<pooler-host>:5432/postgres
```

Save it in 1Password as "prod backup-reader-db-url", then `unset BACKUP_PW`. Use the session pooler rather than the direct `db.<ref>.supabase.co` host, because the direct host is IPv6 only and GitHub-hosted runners have no IPv6.

Prod has no Supabase network restrictions at launch (19 §6), because GitHub-hosted runners have no fixed IP addresses and this job could not connect through an allow-list. The read-only `backup_reader` role is part of what makes that acceptable: the backup job can read but never change data. If restrictions are turned on later (with a self-hosted runner or a static-egress proxy), allow that IP before the next nightly run.

### 7. Configure the GitHub environment `production-backup` (B9)

GitHub > repo > Settings > **Environments** > New environment > `production-backup`.

1. Deployment branches and tags: **Selected branches** > add `main` only.
2. No required reviewers (the job runs every night by schedule).
3. Add exactly these names (they are what `backup-prod.yml` reads):

| Kind | Name | Value |
|---|---|---|
| Secret | `SUPABASE_DB_URL` | the `backup_reader` URL from step 6 (**not** the postgres URL) |
| Variable | `GCP_WIF_PROVIDER` | `projects/<project-number>/locations/global/workloadIdentityPools/github/providers/github-actions` |
| Variable | `GCP_BACKUP_SA` | `thuluth-backup-writer@<project-id>.iam.gserviceaccount.com` |
| Variable | `BACKUP_BUCKET` | the bucket name without `gs://` |
| Variable | `BACKUP_AGE_PUBLIC_KEY` | the `age1...` public key |

Note: the workflow's "Check configuration" step skips when `SUPABASE_DB_URL`, `GCP_WIF_PROVIDER`, `BACKUP_BUCKET` or `BACKUP_AGE_PUBLIC_KEY` is empty, but not when `GCP_BACKUP_SA` is. If you forget that one, the job fails at the Google sign-in step instead of skipping.

### 8. First manual run (B10), then lock the retention

1. GitHub > Actions > **Nightly offsite backup (prod)** > Run workflow > branch `main` > Run.
2. When it finishes, the run summary shows `Backup thuluth-prod-<STAMP>.tgz.age uploaded (<n> bytes)`.
3. Check the object and test that you can decrypt it (on the laptop, with the private key from 1Password Break-glass in a temporary file):

   ```bash
   gcloud storage ls -l "gs://$BUCKET/db/"
   gcloud storage cp "gs://$BUCKET/db/thuluth-prod-<STAMP>.tgz.age" .
   age -d -i thuluth-backup.key "thuluth-prod-<STAMP>.tgz.age" | tar tz
   # expect: roles.sql schema.sql data.sql
   rm -P thuluth-backup.key "thuluth-prod-<STAMP>.tgz.age"
   ```

4. Only after a successful run and decrypt, **lock** the retention policy. This cannot be undone: the bucket and the 35-day policy stay until every object has aged out, and the project cannot be deleted while it holds locked objects.

   ```bash
   gcloud storage buckets update "gs://$BUCKET" --lock-retention-period
   ```

5. Tick B5, B6, B8, B9 and B10 in `backups-and-pitr.md`.

### 9. Restore drill (B12)

Do the drill in `backups-and-pitr.md` §3 (PITR into a scratch project, row counts, pgTAP, smoke test) and record the RTO in its table. Once a quarter, also restore the **offsite dump** into a scratch Supabase project with the commands in `backups-and-pitr.md` §2.3, so you know the `age` key, the bucket access and the dump all work together. Delete the scratch project and the downloaded files afterwards.

## Where the values go

| Value | Where it is set | Name |
|---|---|---|
| `backup_reader` connection URL | GitHub env `production-backup` secret | `SUPABASE_DB_URL` |
| WIF provider resource name | GitHub env `production-backup` variable | `GCP_WIF_PROVIDER` |
| Service account email | GitHub env `production-backup` variable | `GCP_BACKUP_SA` |
| Bucket name | GitHub env `production-backup` variable | `BACKUP_BUCKET` |
| `age` public key | GitHub env `production-backup` variable | `BACKUP_AGE_PUBLIC_KEY` |
| `age` private key | paper (two places) and 1Password vault "Thuluth Break-glass" | "prod age-backup-private-key" |
| `backup_reader` URL | 1Password "Thuluth Platform" | "prod backup-reader-db-url" |
| GCP project id, bucket, provider | 1Password "Thuluth Platform" (not secret) | "prod gcp-backup-config" |

## Verify

- Actions > Nightly offsite backup (prod): a green run every night, each with the "uploaded" line in its summary.
- `gcloud storage ls "gs://$BUCKET/db/"` lists one object per night, none older than about 35 days once the lifecycle has started.
- `gcloud storage buckets describe "gs://$BUCKET" --format 'value(retention_policy)'` shows a 35-day period with `isLocked: true`.
- Try to delete as yourself: `gcloud storage rm "gs://$BUCKET/db/<newest>"` fails with a retention policy error.
- A job outside the environment cannot sign in: the provider condition requires `environment == 'production-backup'`.

Add a weekly calendar check of the Actions history until a heartbeat alert exists. The workflow does not ping the uptime monitor today.

## Rotate or revoke

| Item | Cadence | How |
|---|---|---|
| `backup_reader` password | with the database password, 90 days (19 §8), or on suspicion | `alter role backup_reader password '<new hex>';`, update the GitHub secret and 1Password |
| `age` key pair | only on suspicion (the private key never touches a server) | make a new pair (step 5), update `BACKUP_AGE_PUBLIC_KEY`. Keep the **old** private key until every old object has expired (35 days) |
| WIF | no keys to rotate | if the repo is renamed or moved, update `--attribute-condition` and the `principal://` binding |
| Service account | no keys | never create a JSON key for it |

If GitHub is compromised: remove the `roles/iam.workloadIdentityUser` binding (step 4) to cut access at once. Existing backups stay safe because of the lock.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Run ends green in seconds with the notice "production-backup not configured yet" | One of the four checked values is empty, or the run did not use the environment | Check the names in step 7 exactly; secrets and variables must be in the **environment**, not the repository. |
| `google-github-actions/auth` fails with "unauthorized" or "permission denied on getAccessToken" | Condition or binding does not match the repo or environment | Check `$REPO` spelling and that the job runs with `environment: production-backup`; recheck the `principal://` member in step 4. |
| `supabase db dump` cannot connect | The URL uses the direct IPv6 host, or network restrictions were turned on and block GitHub runners | Use the session pooler URL (step 6). Turn restrictions off again unless the runner has a fixed IP. |
| `permission denied` during the dump | `backup_reader` lacks `pg_read_all_data` or `bypassrls` | Re-run the grant in step 6 as `postgres`. If Supabase refuses the grant, ask Supabase support or a developer for the supported way to create a read-all role. |
| Upload fails with `storage.objects.get` or `storage.objects.delete` denied | The upload tool checks for an existing object first | Object names are unique per run, so this should not happen. If it does, add `roles/storage.objectViewer` on the bucket (reading encrypted files is harmless); never add delete rights. |
| `age -d` says "no identity matched" | The object was encrypted to a different public key | Check `BACKUP_AGE_PUBLIC_KEY` matches the private key in Break-glass. |

