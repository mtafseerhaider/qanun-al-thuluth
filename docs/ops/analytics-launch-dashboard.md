# Analytics ingestion and the launch dashboard

> **Stories:** S7-12 (FR-ANL-03, `22` §7.6 T14) and the Sprint 6 leftover (05 §22.10 24.2, `track_events`) · **Owner:** backend · **Related:** `18-exports-and-analytics.md` §8 to §14, `22-mvp-roadmap.md` §8, `sentry-alerts.md` §3

## 1. Event ingestion

| Piece | Path |
|---|---|
| Event registry (source of truth) | `packages/shared/src/analytics/events.ts` (moved from `apps/mobile/src/lib/analytics/events.ts`) |
| Catalog derivation, privacy lint, seed SQL | `packages/shared/src/analytics/catalog.ts` |
| Generator | `deno run --config supabase/functions/deno.json --allow-read --allow-write tooling/scripts/gen-analytics-catalog.ts` (`--check` in CI) |
| Catalog seed (generated) | `supabase/seed/catalog/170_analytics_event_catalog.sql` |
| Table and RPCs | migration `20261006150000_analytics_ingestion.sql`: `analytics_event_catalog`, `analytics_filter_props`, `track_events` |
| Client contract | `packages/shared/src/contracts/track-events.ts` (`TrackEventsArgs`, `TRACK_EVENTS_MAX_BATCH = 50`, `TRACK_EVENTS_HOURLY_LIMIT = 600`) |
| Tests | `supabase/tests/database/functions/150_analytics_ingestion_launch_kpis.test.sql`, `supabase/tests/functions/analytics-catalog.test.ts` |

`track_events(p_events jsonb)` stores only catalogued, enabled events. It keeps only allow-listed scalar props, with strings cut to 40 characters. It skips a `household_id` the caller is not a member of. It takes `locale` and `country_code` from `users`, and `app_version` and `platform` from the `x-app-version` and `x-platform` headers. It clamps `occurred_at` to the last 7 days, ignores duplicate `event_id`s, and stops accepting after 600 events per user per hour. Opted-out and processing-restricted users get `0` and nothing is stored. Server events (`revenuecat-webhook`, `export-pdf`) still insert directly with the service role and `platform = 'server'`; the catalog governs client ingestion only.

**Adding an event:** add it to `events.ts`, run the generator, and commit the seed. CI fails if the seed is stale. The privacy lint (18 §14) also fails CI on a prop name containing `allerg`, `condition`, `medic`, `weight`, `height`, `bmi`, `z_`, `percentile`, `exemption`, `notes`, `text` or `description`. `has_*` booleans are allowed. Catalog changes reach production through `deploy-prod.yml` (the catalog seeds step), not through a migration.

### Client migration (mobile lane)

1. Re-export the shared registry: `apps/mobile/src/lib/analytics/events.ts` becomes `export * from '@shared/analytics/events';`. Until then `analytics-catalog.test.ts` keeps the two copies identical.
2. In `track.ts`, replace the `supabaseTransport` body with `supabase.rpc('track_events', { p_events })`, where `p_events` uses the `TrackEventInput` shape (`event_id`, `event`, `props`, `occurred_at`, `session_id`, `household_id`). Move `event_id`, `session_id` and `locale` out of `props` and to the top level (or drop them). Send the `x-app-version` and `x-platform` headers through the Supabase client's `global.headers`.
3. Keep batches at 50 at most (already `maxBatch = 50`). The RPC returns the accepted count; a rejected batch (`22023`) means it was too large.
4. After every supported build calls the RPC (`app.min_supported_version`), a later migration revokes the Sprint 0 direct-insert policy `analytics_events_insert_own`. Until then both paths work.

## 2. Event-name alignment (fix to the S6 views)

The S6 materialized views used the 18 §9 names. The app emits different ones, so DAU missed logging activity, the paywall funnel was always empty, and retention had no cohorts (nothing sends `signup_completed`). Migration `20261006150100` recreates them:

| View | Change |
|---|---|
| `analytics.mv_dau` | also counts `meal_serving_logged`, `meal_log_saved` |
| `analytics.mv_paywall_funnel_daily` | `paywall_viewed` or `paywall_shown` leads to `paywall_purchase_succeeded` or `purchase_completed` within 30 min in the same session |
| `analytics.mv_retention_weekly` | cohort = `users.created_at` week (domain fact) instead of the `signup_completed` event |

The admin views over them (`v_admin_kpi_daily`, `v_admin_paywall_funnel_daily`, `v_admin_retention_weekly`) are recreated unchanged.

## 3. Launch dashboard views

All are `public.v_admin_*` views. They run with the owner's rights, return rows only when `public.is_admin()`, hold aggregates only, and read the domain tables live. Internal and test accounts (`users.is_internal`) are excluded. Point Metabase (18 §13.2) at these views with an admin JWT, or query them in the SQL editor as postgres. The `where public.is_admin()` filter is false there, so read the underlying queries or call `public.launch_kpis` directly.

| View | Answers | Gate |
|---|---|---|
| `v_admin_launch_kpis` | one row per gate for the last 7 days: `gate, metric, value, comparator, threshold, status (green / amber / red / no_data)`. Amber means within 20 percent of the threshold (22 §8) | all below |
| `v_admin_activation_funnel_weekly` | per signup week: signups, households created, onboarding completed, first plan, households active on 3+ days in their first week, onboarding completion rate, median minutes to first plan | G-UX-1, G-UX-2, G-ENG-1 |
| `v_admin_ai_cost_per_active_user_weekly` | per week: active users, active premium users, AI cost, cost per active user, cost per active premium user | G-COST-1 |
| `v_admin_ai_cost_per_mau_monthly` | per month: MAU, AI cost, cost per MAU | 04 §11 cost targets |
| `v_admin_notification_on_time_daily` | per day and kind: due, sent, failed, on time (2 minutes or less), on-time rate, p95 lag | G-OPS-1 (01 §9: 99 percent; suhoor and iftar 99.9 percent in Ramadan) |
| `v_admin_plan_generation_daily` | per day: plans, failed, still generating, `plan.generate` AI calls ok / fallback / error, success without fallback | G-QUAL-2 |
| `v_admin_kpi_daily`, `v_admin_retention_weekly`, `v_admin_paywall_funnel_daily`, `v_admin_plan_completion_weekly`, `v_admin_ai_cost_daily`, `v_admin_growth_coverage` | the S6 views | FR-ANL-03 |

Not in Postgres: **crash-free sessions (G-QUAL-1)**, read in Sentry release health (`sentry-alerts.md` §1); **cold start, plan p90 and chat first token (G-PERF)**, read in Sentry performance and the S7-01 and S7-02 reports. Safety gates come from the eval reports (S7-10).

### Definitions

- **Active user:** any client event, or any AI call, in the window.
- **Activation:** the household's first 7 days (from `households.created_at`) contain 3 or more distinct local days with a serving status set, a meal log or a hydration log.
- **On time:** a push with `status = 'sent'` and `sent_at <= scheduled_for + 2 minutes`. Cancelled pushes are excluded. Pending or failed pushes count as late.
- **Success without fallback:** the share of `ai_usage` rows for route `plan.generate` with `status = 'ok'`. This is a proxy: a repaired output still counts as ok.

### Useful queries (as an admin, or as postgres without the `is_admin()` views)

```sql
-- Go/no-go tile (last 7 days)
select * from public.v_admin_launch_kpis order by gate;
-- Same numbers for any window, as postgres or service role
select jsonb_pretty(public.launch_kpis(now() - interval '7 days'));
-- Trend of the daily snapshots written by analytics-rollup
select metric, period_end, value from analytics.metric_snapshots
 where metric like 'kpi.%' order by metric, period_end desc;
-- Late pushes by kind in the last 24 h
select kind, count(*) filter (where sent_at > scheduled_for + interval '2 minutes' or status <> 'sent') as late, count(*)
  from public.notifications
 where channel = 'push' and status <> 'cancelled' and scheduled_for > now() - interval '24 hours'
 group by kind order by late desc;
```

## 4. Alerts and snapshots

`analytics-rollup` calls `launch_kpis()` every run:

- **Hourly:** the last hour, checking only the push on-time rate.
- **Daily (02:00 UTC):** the last 7 days, checking every gate. It also writes `kpi.<metric>` rows into `analytics.metric_snapshots` through `save_kpi_snapshots()`.

An alert needs at least 20 samples, so a quiet beta hour does not fire. Thresholds and responses are in `sentry-alerts.md` §3.
