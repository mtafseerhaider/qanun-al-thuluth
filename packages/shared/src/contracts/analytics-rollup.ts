import { z } from 'zod';

/** 06 §4.17. Internal (`x-internal-secret`): hourly and nightly cron. */
export const AnalyticsRollupRequest = z.object({
  scope: z.enum(['hourly', 'daily']).default('hourly'),
});
export type AnalyticsRollupRequest = z.infer<typeof AnalyticsRollupRequest>;

export const AnalyticsRollupResponse = z.object({
  refreshed: z.array(z.string()),
  partitions_created: z.array(z.string()),
  partitions_detached: z.array(z.string()),
  alerts_raised: z.array(z.string()),
  /** S7-12: launch KPI values checked this run (`launch_kpis`); hourly carries the on-time rate only. */
  kpis: z.record(z.number().nullable()).optional(),
  duration_ms: z.number().int().nonnegative(),
});
export type AnalyticsRollupResponse = z.infer<typeof AnalyticsRollupResponse>;

/**
 * S7-12 launch KPI alert thresholds (22 section 8 gates). An alert is raised only when the window has
 * at least `min` samples in the metric's denominator, so a quiet hour cannot page anyone.
 */
export const LAUNCH_KPI_ALERTS = [
  {
    alert: 'kpi_notification_on_time_low',
    metric: 'notification_on_time_rate',
    sample: 'notifications_due',
    op: 'lt',
    threshold: 0.99,
    min: 20,
    hourly: true,
  },
  {
    alert: 'kpi_plan_generation_success_low',
    metric: 'plan_generation_success_rate',
    sample: 'plan_generation_calls',
    op: 'lt',
    threshold: 0.95,
    min: 20,
    hourly: false,
  },
  {
    alert: 'kpi_ai_cost_per_active_user_high',
    metric: 'ai_cost_per_active_premium_user_week_usd',
    sample: 'active_users',
    op: 'gt',
    threshold: 0.35,
    min: 20,
    hourly: false,
  },
  {
    alert: 'kpi_onboarding_completion_low',
    metric: 'onboarding_completion_rate',
    sample: 'signups',
    op: 'lt',
    threshold: 0.6,
    min: 20,
    hourly: false,
  },
  {
    alert: 'kpi_activation_low',
    metric: 'activation_rate',
    sample: 'households_past_week1',
    op: 'lt',
    threshold: 0.4,
    min: 20,
    hourly: false,
  },
] as const;
