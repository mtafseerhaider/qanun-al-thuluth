# docs/ops: production operations

Operations docs for Sprint 7 (S7-06, S7-11, S7-12). The design docs (`../19-deployment-architecture.md`, `../20-ci-cd-pipeline.md`, `../22-mvp-roadmap.md`) say *what* the system should be. These pages say *how the owner makes production that way*, and what to do when it breaks.

| Page | Use it for |
|---|---|
| [production-environment.md](production-environment.md) | Standing up `thuluth-prod`: what is code, and the owner's steps in order (Supabase, GitHub, OneSignal, RevenueCat, Sentry, Postmark, status page, EAS) |
| [secrets.md](secrets.md) | Every secret and config name, and where it is set (no values) |
| [backups-and-pitr.md](backups-and-pitr.md) | Backup settings checklist, restore procedures, restore drill log |
| [sentry-alerts.md](sentry-alerts.md) | Alert rules (Sentry, uptime, logs, KPI) and Sentry privacy settings |
| [analytics-launch-dashboard.md](analytics-launch-dashboard.md) | `track_events` ingestion, the event catalog, launch KPI views and alerts |
| [load-testing.md](load-testing.md) | Ramadan iftar spike load test on staging (`scripts/load/iftar.js`, k6): preparation, run, thresholds |
| [launch-runbook.md](launch-runbook.md) | Go/no-go, launch-day timeline, pausing rollouts, rollback commands (EAS channel pinning) |
| [on-call-rota.md](on-call-rota.md) | Rota template, hours, channels, handover |
| [incident-templates.md](incident-templates.md) | Declaration, status page text (en/ur), incident note, breach assessment |

Workflows: `.github/workflows/deploy-prod.yml`, `rollback-prod.yml`, `backup-prod.yml`. Scripts: `tooling/scripts/ops/`.
