# Ramadan iftar load test (k6)

> **Story:** launch follow-up to S7-06 (19 §14 Ramadan readiness, 21 §13 load row, 22 §9) · **Owner:** backend runs on staging, PO approves any production run · **Script:** [`scripts/load/iftar.js`](../../scripts/load/iftar.js)

## What it models

At maghrib, `notifications-dispatch` sends the `iftar_reminder` push to every fasting household in a city in the same minute, and many of them open the app at once. The script replays what one of those opens costs the backend, using the same PostgREST calls as the app (`apps/mobile/src/features/*/api`):

1. **App shell:** `users` profile, `rpc/evaluate_feature_flags`, `households`, `family_members`.
2. **Today screen**, in parallel: the active `meal_plans` row and the plan list, the `notifications` inbox, `hydration_targets`, the last 8 days of `hydration_logs`, `fasting_logs_visible`, this month's `budget_entries`, verified `recommendations` ids, then today's `daily_meals` with servings and portions.
3. **Writes** (each with its own probability): a 250 ml `pre_meal` water log, the day's `ramadan` fast upserted as completed (same conflict key as the app's outbox), unread notifications marked read, and `rpc/track_events` (`app_opened`, `screen_viewed`).

Arrival rate (k6 `ramping-arrival-rate`, one iteration = one app open): `BASE_RATE` opens/s for `WARMUP`, a ramp to `BASE_RATE x SPIKE_MULTIPLIER` over `SPIKE_RAMP` (the minute after the adhan), a hold for `SPIKE_HOLD`, then a decay back over `DECAY`. The default multiplier is 10, the "10x normal peak" in 19 §14.

The script calls no AI function and nothing billable. Chat and plan generation load are separate (`docs/ai/s7-cost-latency.md`). The push fan-out itself (`notifications-dispatch` batches, OneSignal) is not driven by k6: watch `v_admin_notification_on_time_daily` and the function logs while the test runs.

## Thresholds (the run fails if any is missed)

| Metric | Default | Source |
|---|---|---|
| `http_req_failed` | < 1 % (`MAX_ERROR_RATE`) | 21 §13 load row |
| p95 of read requests (`kind:read`) | < 500 ms (`P95_READ_MS`) | 21 §13: CRUD-like p95 ≤ 500 ms |
| p95 of writes (`kind:write`) | < 2 x `P95_READ_MS` | |
| `today_ready_ms` p95 (shell + Today + meals, one user) | < 1500 ms (`P95_TODAY_MS`) | |
| `checks` | > 99 % | |

Also watch on the Supabase dashboard during the hold: database CPU below 70 % (21 §13), connection count below the pooler limit, and no `cron.job_run_details` failures.

## Prepare (staging only)

1. **Test users.** Create load-test accounts on **staging** (for example `loadtest+001@thuluth.test` to `+200`), each owning one household with 2 to 4 members, an active plan that covers the test date, and a few unread notifications. Do it from a trusted machine with the staging service role key from 1Password, never from CI, and never commit the key or the users' passwords. Mark the accounts `is_internal` so launch KPIs ignore them.
2. **Tokens file.** Sign each user in (`POST /auth/v1/token?grant_type=password`, or your own helper) and write `loadtest-tokens.json`, a JSON array of `{ "access_token": "...", "household_id": "<uuid>" }` (`household_id` is optional; the script looks it up). Keep the file outside the repo (it is a credential) and delete it after the run. Access tokens expire after `jwt_expiry` (1 hour), so make the file just before the run. Staging's sign-in rate limit (30 per hour per IP) may need raising for the duration of the preparation.
3. **Rate.** `BASE_RATE` is the normal evening open rate: roughly `DAU x share of DAU opening in the iftar hour / 3600`. At 20,000 DAU and 30 % that is about 2 opens/s (the default), so the spike is 20 opens/s. Scale `MAX_VUS` with the peak (about 15 VUs per open/s at a 5 to 8 s iteration).
4. Tell the team in `#thuluth-ops`. Staging alerts will fire.

## Run

```sh
# k6 >= 0.50 (https://grafana.com/docs/k6/latest/set-up/install-k6/)
k6 run \
  -e API_BASE_URL=https://api.staging.thuluth.app \
  -e SUPABASE_ANON_KEY="$STAGING_PUBLISHABLE_KEY" \
  -e TOKENS_FILE=/secure/tmp/loadtest-tokens.json \
  -e BASE_RATE=2 -e SPIKE_MULTIPLIER=10 \
  --summary-export=iftar-summary.json \
  scripts/load/iftar.js
```

- A quick smoke check of the script first: `-e WARMUP=10s -e SPIKE_RAMP=10s -e SPIKE_HOLD=20s -e DECAY=10s -e BASE_RATE=1 -e SPIKE_MULTIPLIER=2`.
- A read-only run (no rows written): `-e WRITES=0`.
- The default full run is 18 minutes.
- The anon or publishable key is public client configuration (it ships in the app). It is still read from the environment so that the script names no project.
- The script refuses `api.thuluth.app` and any host in `PRODUCTION_HOSTS` (set it to the production `<ref>.supabase.co`). A production run needs the PO's approval and `ALLOW_PRODUCTION=1`, outside the Ramadan freeze windows in `launch-runbook.md`.

## After the run

- Attach `iftar-summary.json` and screenshots of database CPU and connections to the Ramadan readiness issue (19 §14 checklist).
- Clean up on staging: delete the load-test `hydration_logs`, `fasting_logs` and `analytics_events` rows of the `loadtest+` accounts, or reset staging data as usual.
- If p95 or CPU fails: check the slow query log for the Today queries first (they are the indexed `household_id` reads), then compute size (19 §14 says to scale up one size for Ramadan).
