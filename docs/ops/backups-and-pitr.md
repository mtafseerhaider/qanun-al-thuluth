# Backups, PITR and restore drills (`thuluth-prod`)

> **Story:** S7-06 (`22` §7.6 T1) · **Owner:** PO runs, backend prepares · **Related:** `19-deployment-architecture.md` §10, `10-supabase-structure.md` §15 (backup table), `20-ci-cd-pipeline.md` §9, `.github/workflows/backup-prod.yml`

## 1. Settings checklist

| # | Setting | Where | Value | Done |
|---|---|---|---|---|
| B1 | Plan | Supabase org | Pro (daily physical backups, 7 days) | [ ] |
| B2 | PITR add-on | Project > Settings > Add-ons > Point in time recovery | **7 days**. Needs Small compute or larger; prod runs Large | [ ] |
| B3 | Daily backups visible | Project > Database > Backups | latest backup within 24 h | [ ] |
| B4 | Disk autoscaling | Settings > Compute and disk | on; alert at 80 percent (04 §12.3) | [ ] |
| B5 | Offsite bucket | GCP project `thuluth-backup` (separate billing account), bucket in `europe-west3` | uniform access, **object versioning on**, lifecycle delete after 35 days, **retention policy 35 days, locked** after the first successful run, CMEK optional | [ ] |
| B6 | Workload identity federation | GCP IAM > Workload Identity Pools | pool for `token.actions.githubusercontent.com`, condition `assertion.repository == '<org>/qanun-al-thuluth' && assertion.environment == 'production-backup'`; service account with `roles/storage.objectCreator` on the bucket only (no delete) | [ ] |
| B7 | Backup DB role | psql as postgres | `create role backup_reader login password '…' bypassrls; grant pg_read_all_data to backup_reader;` Its URL becomes the `production-backup` secret `SUPABASE_DB_URL` | [ ] |
| B8 | age key pair | PO laptop, offline | `age-keygen -o thuluth-backup.key`. Store the private key **offline** (printed and in 1Password "break-glass"). The public key becomes the variable `BACKUP_AGE_PUBLIC_KEY` | [ ] |
| B9 | GitHub environment | `production-backup` | `main` only; secrets and vars as in `secrets.md` §4 | [ ] |
| B10 | First run | Actions > Nightly offsite backup (prod) > Run workflow | summary shows the `.age` object | [ ] |
| B11 | Storage sync | weekly `rclone` of `avatars`, `meal-photos`, `chat-attachments` (19 §10.2 layer 3) | **not automated yet**: needs Storage S3 credentials; do by hand weekly until then | [ ] |
| B12 | Restore drill | §3 | RTO recorded below | [ ] |

PITR does not cover Storage objects. That is why B11 exists.

## 2. Restore procedures

These are the steps from 19 §10.3, with commands.

### 2.1 PITR in place (data corruption, bad migration)

1. Declare an incident (`incident-templates.md`). Set `feature_flags['app.maintenance'].enabled = true`; the app shows the maintenance screen and `health` reports `degraded`.
2. Note the last good timestamp in UTC. To find it, look for the first bad `audit_log` row or the deploy time in the `deploy-prod.yml` run.
3. In the dashboard, go to Database > Backups > Point in time, pick that timestamp and confirm. The restore runs in place, with downtime that grows with database size.
4. Check that `supabase migration list --linked` shows no remote migration newer than the restore point. If a needed one is missing, re-run `deploy-prod.yml` on the tag; it re-applies only the missing migrations.
5. **Re-apply erasures** done after the restore point (10 §15 "Erasure versus backups"). For each `deleted_user_ledger` or `audit_log` `erasure` entry after the timestamp, take it from the offsite dump or the pre-restore export, then run `select public.execute_account_erasure('<user id>')` and delete the auth user.
6. Turn the maintenance flag off. In RevenueCat, replay webhooks for the window (Integrations > Webhooks > resend events).
7. Write the incident note within 5 working days.

### 2.2 Partial restore (one household)

Restore PITR into a **new** project at the timestamp. Export the affected rows with `\copy (select … where household_id = '…') to …`. Import them into prod in one transaction as postgres and add an `audit_log` row with action `restore`. Then delete the scratch project.

### 2.3 Offsite dump restore (region or account loss)

```bash
gcloud storage cp gs://$BACKUP_BUCKET/db/thuluth-prod-<STAMP>.tgz.age .
age -d -i thuluth-backup.key thuluth-prod-<STAMP>.tgz.age | tar xz      # roles.sql schema.sql data.sql
psql "$NEW_DB_URL" -f roles.sql && psql "$NEW_DB_URL" -f schema.sql
psql "$NEW_DB_URL" -c 'set session_replication_role = replica' -f data.sql
```

Then follow 19 §10.3 "Region or account loss": deploy the functions and secrets, set up Vault, repoint the `api.thuluth.app` CNAME, and update the RevenueCat webhook and the OAuth callbacks.

## 3. Restore drill (before launch, then quarterly)

1. Restore PITR into a scratch project (Database > Backups > "Restore to a new project") at `now() - 1 hour`. Start a timer.
2. Run row counts on both projects and compare them:
   ```sql
   select relname, n_live_tup from pg_stat_user_tables where schemaname = 'public' order by 1;
   ```
3. Run the pgTAP suite against the scratch project. Use `supabase test db --db-url <scratch>`, or `pg_prove` with the `supabase/tests/database` files.
4. Run `smoke.sh` against the scratch API URL. The health check is expected to say `degraded` (no cron there).
5. Record the drill below, then delete the scratch project.

`scripts/dr/verify-restore.ts` (19 §10.3) does not exist yet. Until it does, the SQL above is the comparison.

| Date | Type | Restore point | Elapsed (RTO) | Row-count diff | pgTAP | By |
|---|---|---|---|---|---|---|
| | PITR to new project | | | | | |
