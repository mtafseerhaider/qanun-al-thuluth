# Launch runbook (v1.0.0)

> **Story:** S7-11 · **Owner:** lead (agent) prepares, PO decides · **Related:** `19-deployment-architecture.md` §5, §12, §13, `20-ci-cd-pipeline.md` §7 and §13, `22-mvp-roadmap.md` §7 to §10, `production-environment.md`, `on-call-rota.md`, `incident-templates.md`, `sentry-alerts.md`, `analytics-launch-dashboard.md`

All times are PKT (UTC+5). Launch target: **Monday 1 February 2027**. Ramadan 1448 is expected around 8 February. The Ramadan freeze (19 §5) starts 7 days before: no store releases from about 1 February except hotfixes; OTA fixes are allowed outside the iftar window (17:00 to 20:00 PKT).

## 1. Roles on launch day

| Role | Who | Decides |
|---|---|---|
| Release captain | PO (Tafseer) | go/no-go, store release buttons, approval of the `production` GitHub environment, status page posts |
| Primary on-call | per `on-call-rota.md` | first response, runs playbooks, opens incidents |
| Backend agent | backend lane | migrations, functions, cron, KPIs |
| Mobile agent | mobile lane | OTA, Sentry triage, hotfix branches |
| AI agent | ai lane | routes, prompts, cost |

Agents prepare commands and PRs. Only the PO approves production environments and store actions.

## 2. T-7 to T-1 days

- [ ] Every `production-environment.md` step is done and its §3 verification table is green.
- [ ] Backups configured and one restore drill recorded (`backups-and-pitr.md` §3).
- [ ] `v_admin_launch_kpis` reviewed on beta data. Crash-free sessions read in Sentry. Go/no-go sheet filled in (§3).
- [ ] Rollback rehearsed on staging: republish an update group, pin the channel, redeploy functions from a tag (§6).
- [ ] On-call rota published, phones tested with a fake page from the uptime monitor.
- [ ] Status page components live. Incident templates ready.
- [ ] Feature flags for prod: `ramadan_planner` on, kill switches on, `app.min_supported_version = 1.0.0`, `app.maintenance` off.
- [ ] Store builds approved (S7-08). iOS: "Release automatically after approval: No", phased release on. Android: production track, draft.
- [ ] Support inbox `support@thuluth.app` and canned replies (en, ur) ready.

## 3. Go/no-go (29 January 2027)

The PO records the decision in the S7 sprint issue using the 22 §8 gates:

| Gate | Source | Value | Status |
|---|---|---|---|
| G-SAFE-1 to 4 | eval reports, red-team sign-off (S7-10) | | |
| G-QUAL-1 crash-free at least 99.5 percent | Sentry release health, environment `staging`, 7 days | | |
| G-QUAL-2, G-UX-1, G-UX-2, G-ENG-1, G-COST-1, G-OPS-1 | `select * from v_admin_launch_kpis` (as admin) | | |
| G-QUAL-3 Sev-1 / Sev-2 | issue tracker | | |
| G-PERF-1 to 3 | S7-01 / S7-02 reports, Sentry performance | | |
| G-STORE-1, G-CONTENT-1 | stores, content track | | |

Safety gates are stop-ship. For the rest, a PO-approved launch is allowed when at most two non-safety gates are amber and none is red.

## 4. Launch day timeline (Monday 1 February 2027)

| Time | Step | Command or place | Check |
|---|---|---|---|
| 08:00 | On-call shift starts; quiet channel | rota | |
| 08:15 | Backend is already on the release tag (deployed at T-2). If anything changed since: Actions > **Deploy production backend** > `ref = v1.0.0` > approve | `deploy-prod.yml` | smoke green, `health` ok |
| 08:30 | Freeze the launch JS as the channel-pinning target (§6.3): from the `v1.0.0` tag, in `apps/mobile` | `eas update --branch production-v1.0.0 --environment production --message "v1.0.0 launch freeze"` | `eas update:list --branch production-v1.0.0` |
| 09:00 | **Android:** start the staged rollout at 20 percent (S7-13) | Play Console > Production > Release > rollout 20 percent | release live |
| 09:00 | **iOS:** release manually, phased release day 1 | App Store Connect | "Ready for Sale" |
| 09:30 | Status page: "Thuluth 1.0 is live" (optional) | status page | |
| 09:00 to 13:00 | Watch: Sentry crash-free (M1), new issues (M3), the `health` monitor, Edge 5xx (E3), `v_admin_notification_on_time_daily` for today, sign-ups in `v_admin_activation_funnel_weekly` | | thresholds in `sentry-alerts.md` |
| 13:00 | Mid-day check; decide whether Android stays at 20 percent | | crash-free at least 99.5 percent, no SEV1 or SEV2 |
| 17:00 to 20:00 | iftar window (from Ramadan): **no OTA publishes** | | |
| 21:00 | End-of-day report in the sprint issue: crash-free, sign-ups, activation so far, pushes on time, AI cost today, incidents | | |
| Day 2 to 7 | Android 20 to 50 to 100 percent and iOS phased release, per 19 §12.3. Pause criteria: crash-free below 99.3 percent, a SEV2, or a store rejection | | |

## 5. Pausing a rollout

| What | How |
|---|---|
| iOS phased release | App Store Connect > the version > Phased Release > **Pause** (up to 30 days) |
| Android staged rollout | Play Console > Production > **Halt rollout**. Play cannot roll back a binary: roll forward with a higher `versionCode`. |
| OTA rollout | Actions > **Production rollout and rollback** > `advance-ota` with a lower percent, or `republish-ota` (§6) |
| A feature | flip its flag or kill switch in `feature_flags` (seconds to 5 minutes for clients to refresh) |
| Everything (data incident) | `update public.feature_flags set enabled = true where key = 'app.maintenance';` The app shows the maintenance screen and `health` shows `degraded`. |

## 6. Rollback playbooks

Run all of these through `rollback-prod.yml` (Actions > **Production rollout and rollback**). The workflow needs the PO's approval and leaves an audit trail. The CLI commands are listed so they can be run from a laptop in an emergency with `EXPO_TOKEN` and `SUPABASE_ACCESS_TOKEN` exported. Check flags with `eas <command> --help` on the installed eas-cli, since EAS renames flags between major versions.

### 6.1 Bad OTA update, partially rolled out

```bash
eas update:list --branch production --limit 5          # find the bad and the last good group ids
eas update:edit --branch production --rollout-percentage 0   # stop new downloads of the rolling-out update
# or revert the in-progress rollout entirely (newer eas-cli):
eas update:revert-update-rollout --branch production
```

### 6.2 Bad OTA update, fully rolled out: republish the last good group

```bash
eas update:republish --group <last-good-group-id> --branch production \
  --message "rollback to <last-good-group-id>" --non-interactive
# workflow: action = republish-ota, group_id = <last-good-group-id>
```

Users get it on their next launch. expo-updates already falls back to the embedded bundle after a failed launch, but republishing stops new downloads of the bad update. If the bad update crashes on launch, also set `app.critical_update` to the republished group id so idle clients reload (19 §4.2).

### 6.3 Channel pinning (freeze production on a known-good branch)

Channel `production` normally serves branch `production`. To serve a frozen known-good branch instead (for example during an incident while the team works on `production`):

```bash
eas channel:edit production --branch production-v1.0.0     # pin
eas channel:view production                               # confirm
# ... after the fix is verified on staging and published to branch production:
eas channel:edit production --branch production           # unpin
# workflow: action = pin-channel, branch = production-v1.0.0 (then branch = production)
```

The `production-vX.Y.Z` branches are created at each launch or store release (§4, 08:30). Because the runtime version policy is `fingerprint` (19 §4.2), a pinned branch only serves binaries whose fingerprint matches. Pinning can never deliver incompatible JS. To drop all OTA updates and run the code inside the binary, use `eas update:roll-back-to-embedded --branch production --runtime-version <fingerprint>` (newer eas-cli).

### 6.4 Edge Functions

```bash
# workflow: action = redeploy-functions, ref = v1.0.0 (the last good tag)
git checkout v1.0.0 && supabase functions deploy --project-ref "$PROJECT_REF"
```

Functions must tolerate one schema version back (expand and contract), so redeploying older functions over newer migrations is safe.

### 6.5 Database

There is no automated rollback.

- **Non-destructive bad migration:** ship a forward-fix migration through a hotfix PR, then `deploy-prod.yml`.
- **Data loss or corruption:** PITR (`backups-and-pitr.md` §2.1).

### 6.6 AI regression

Disable the new `ai_model_routes` row, or flip `prompt_templates.is_active` back, through a migration PR. In an emergency, use admin SQL with an `audit_log` row. Kill switches: `ai.chat.enabled`, `plan.generate.enabled`, `ai.vision.enabled`, `ai.voice.enabled`.

## 7. Escalation

| Severity (16 §17, extended to availability) | Examples | Response | Status page | Who is told |
|---|---|---|---|---|
| SEV1 | API down (health 503), data loss, safety violation in production output, personal data breach | page immediately; 15 min acknowledgement; all hands | "Major outage" within 30 min | PO at once; breach: assess within 24 h, regulator within 72 h (19 §10.4) |
| SEV2 | crash-free below 99.3 percent, a broken flow for many users, push on-time below 95 percent, payments not syncing | 30 min acknowledgement | "Degraded" | PO within 1 h |
| SEV3 | single-feature bug with a workaround, KPI amber | next working day | none | sprint issue |

Every SEV1 or SEV2 gets an incident note in `docs/incidents/YYYY-MM-DD-title.md` within 5 working days (template in `incident-templates.md`).

## 8. First 30 days

Follow 22 §10. Daily: AI cost (`v_admin_ai_cost_per_active_user_weekly`), push on-time around suhoor and iftar, safety sampling. Weekly: funnel (`v_admin_activation_funnel_weekly`), retention (`v_admin_retention_weekly`), paywall conversion.
