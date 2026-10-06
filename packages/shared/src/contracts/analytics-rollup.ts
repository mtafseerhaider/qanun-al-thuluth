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
  duration_ms: z.number().int().nonnegative(),
});
export type AnalyticsRollupResponse = z.infer<typeof AnalyticsRollupResponse>;
