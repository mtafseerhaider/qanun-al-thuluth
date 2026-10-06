import { z } from 'zod';

/**
 * `health` Edge Function (S7-06 status checks; 04 §12 synthetic checks). Public `GET`, no JWT:
 * an uptime monitor polls it every minute. It reports only coarse status (no counts, hosts or
 * versions beyond the deployed git SHA) so it is safe to expose.
 *
 * - `ok`: database reachable and every check passed.
 * - `degraded`: database reachable but a non-critical check failed (e.g. cron backlog); HTTP 200 so
 *   the status page shows "degraded" rather than "down".
 * - `down`: the database query failed or timed out; HTTP 503.
 */
export const HealthCheckName = z.enum(['database', 'feature_flags', 'cron', 'maintenance']);
export const HealthCheckStatus = z.enum(['ok', 'degraded', 'down']);

export const HealthResponse = z.object({
  status: HealthCheckStatus,
  checks: z.record(HealthCheckName, z.enum(['ok', 'fail', 'skipped'])),
  env: z.enum(['development', 'staging', 'production']),
  release: z.string().max(64),
  time: z.string().datetime({ offset: true }),
  duration_ms: z.number().int().nonnegative(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
