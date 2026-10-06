# Sentry, log and KPI alert rules

> **Stories:** S7-06 (Sentry alerts, status checks), S7-12 (crash-free KPI) · **Owner:** PO creates the rules, backend and mobile own the thresholds · **Related:** `04-system-architecture.md` §12.3, `19-deployment-architecture.md` §12, `20-ci-cd-pipeline.md` §12, `22-mvp-roadmap.md` §8, `analytics-launch-dashboard.md`

Sentry rules are configured in the Sentry UI. They are written below as exact settings so they can be re-created or reviewed (Sentry has no repo-native config we use). Every alert routes to the **on-call channel** (the WhatsApp or Slack group named in `on-call-rota.md`) and to email for the primary on-call.

## 1. Mobile (`thuluth-mobile`, release health on)

| # | Rule | Type | Condition | Filter | Action | Severity |
|---|---|---|---|---|---|---|
| M1 | Crash-free sessions below gate | Metric alert, crash-free session rate | **critical < 99.3 percent**, warning < 99.5 percent, 1 h window | environment `production`, latest release | on-call + PO; pause rollout per `launch-runbook.md` §5 | SEV2 |
| M2 | Crash-free users | Metric alert, crash-free user rate | critical < 99.0 percent, 1 h window | `production` | on-call | SEV2 |
| M3 | New issue in new release | Issue alert | "A new issue is created" **and** "event is seen in the latest release" **and** "issue has happened at least 20 times in 1 h affecting at least 20 users" | `production` | on-call | SEV3 (escalate to SEV2 if on a launch path) |
| M4 | Regression | Issue alert | "issue changes state from resolved to unresolved" | `production` | on-call | SEV3 |
| M5 | OTA update group crash spike | Metric alert, number of errors | > 3x the 7-day baseline for 30 min, grouped by tag `eas_update_id` | `production` | on-call: consider `republish-ota` | SEV2. Needs the app to set the Sentry tags `eas_update_id` and `eas_channel` (20 §12). `apps/mobile/src/lib/sentry` does not set them yet (mobile follow-up) |
| M6 | Startup failures | Issue alert | error message contains `Updates` or `expo-updates` **and** > 10 users in 1 h | `production` | on-call | SEV2 |

**Crash-free sessions (G-QUAL-1, at least 99.5 percent)** is read from Sentry, not from Postgres. Open Releases > `app.thuluth.mobile@1.0.0+<build>` > "Crash Free Sessions", with environment `production` and the last 7 days. Record the value in the go/no-go sheet with the dashboard KPIs (`analytics-launch-dashboard.md` §4). For beta, use environment `staging` on the preview builds.

## 2. Edge Functions (`thuluth-edge`)

The functions do not send events to Sentry yet. `_shared/sentry.ts`, named in 19 §7, does not exist; the functions log JSON lines (`level`, `scope`, `request_id`, `msg`) to Supabase function logs. So until a Sentry Deno SDK is added (a follow-up story), edge alerting comes from two sources:

| # | Rule | Source | Condition | Action |
|---|---|---|---|---|
| E1 | API down | uptime monitor on `GET /functions/v1/health` | HTTP 503 or a 10 s timeout, 3 checks in a row | page the on-call (phone), status page "major outage" |
| E2 | Degraded | same monitor | body has `"status":"degraded"` for 10 min | on-call message (no page); check `checks.cron` / `checks.maintenance` |
| E3 | Edge 5xx rate | Supabase log drain to Better Stack (Logs > Alerts), or Supabase dashboard > Reports > Edge Functions | more than 2 percent 5xx over 5 min for any function (04 §12.3) | on-call |
| E4 | Error log lines | same log drain | `level = "error"` count above 20 in 5 min | on-call |
| E5 | `analytics-rollup` alerts | same log drain | line with `scope = "analytics-rollup"` and `level = "warn"` with a non-empty `alerts_raised` | on-call (business hours); see §3 |
| E6 | Cron failures | `health.checks.cron = fail` (E2), plus `select * from cron.job_run_details where status = 'failed' order by start_time desc limit 20;` | any failure | on-call |

When the Sentry Deno SDK lands, add the 20 §12 release step (`getsentry/action-release` in `deploy-prod.yml`). Then copy E3 and E4 into Sentry metric alerts on `thuluth-edge`, keeping the same thresholds.

## 3. KPI and operational alerts (`analytics-rollup`)

`analytics-rollup` runs hourly and daily. It returns `alerts_raised` and logs one `warn` line when any alert fires. The rules live in code: `LAUNCH_KPI_ALERTS` in `packages/shared/src/contracts/analytics-rollup.ts`, plus the three S6 checks.

| Alert | Scope | Condition (minimum samples) | Gate | First response |
|---|---|---|---|---|
| `analytics_default_partition_not_empty` | hourly, daily | rows in `analytics_events_default` | n/a | run `select public.analytics_maintain_partitions();` |
| `ai_cost_daily_high` | hourly, daily | AI spend today above `AI_DAILY_COST_ALERT_USD` (default 50) | 04 §12.3 | check `v_admin_ai_cost_daily` by route; consider `chat.free_route` or caps in `feature_flags['ai.caps']` |
| `push_lag` | hourly, daily | pushes pending more than 10 min past due | 04 §12.3 | check `notifications-dispatch` logs, OneSignal status |
| `kpi_notification_on_time_low` | hourly (last hour), daily (7 days) | on-time rate below 99 percent (20 due) | G-OPS-1 | same as `push_lag`; during Ramadan the target is 99.9 percent for suhoor and iftar (01 §9) |
| `kpi_plan_generation_success_low` | daily | `plan.generate` calls without fallback below 95 percent (20 calls) | G-QUAL-2 | `v_admin_plan_generation_daily`, provider status, `ai_model_routes` |
| `kpi_ai_cost_per_active_user_high` | daily | premium AI cost per active user per week above USD 0.35 (20 users) | G-COST-1 | `v_admin_ai_cost_per_active_user_weekly`; AI lane cost pass (S7-02) |
| `kpi_onboarding_completion_low` | daily | onboarding completion below 60 percent (20 signups) | G-UX-1 | funnel review (`v_admin_activation_funnel_weekly`) |
| `kpi_activation_low` | daily | households active on 3+ days in week 1 below 40 percent (20 households) | G-ENG-1 | funnel review |

The AI provider consoles add a second guard on spend (T2): set monthly spend limits and email alerts on the production Anthropic, OpenAI and Google keys. Use roughly 2x the expected launch-month spend from `04` §11.

## 4. Privacy settings (both projects)

- Data scrubbing: default scrubbers **on**, plus "Use default scrubbers" for IP addresses.
- Additional sensitive fields: `email`, `name`, `display_name`, `notes`, `text`, `body`, `description`, `allergies`, `conditions`, `weight`, `height`, `token`, `authorization`, `apikey`.
- Session replay **off**. Performance sample rate 10 percent in production (19 §14).
- Data retention 90 days. EU data region.
