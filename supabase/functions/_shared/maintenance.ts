import type { SupabaseClient } from '@supabase/supabase-js';

import { errorResponse, HttpError } from './errors.ts';
import { requestIdOf } from './http.ts';

/**
 * Maintenance mode (19 §11, launch-runbook): while the `app.maintenance` kill switch is enabled,
 * every user-facing function answers 503 FEATURE_DISABLED with `details.reason = 'maintenance'`
 * before doing any work, and the app shows its maintenance screen.
 *
 * Not wrapped (they keep running during maintenance): `health` (reports `degraded` instead), the
 * cron-only functions (`ai-reassess`, `analytics-rollup`, `notifications-dispatch`,
 * `prices-refresh`) and `revenuecat-webhook` (store events must still be accepted). Inside a wrapped
 * function, internal calls pass through too: requests carrying `x-internal-secret` (the handlers
 * route on that header and verify the secret themselves) and the `/worker` and `/execute` routes.
 */

export const MAINTENANCE_FLAG = 'app.maintenance';
/** Per-isolate cache of the flag; flipping it takes effect within this time. */
export const MAINTENANCE_CACHE_MS = 15_000;

/** Resolves true while maintenance is on. */
export type MaintenanceProbe = () => Promise<boolean>;

/**
 * Caches `read` per isolate for `ttlMs`; concurrent requests share one lookup. A failed lookup counts
 * as "not in maintenance" (fail open: the flag is an operator tool, not a security control, and the
 * handler's own database calls surface a real outage) and is cached for the same time.
 */
export function cachedMaintenanceProbe(
  read: () => Promise<boolean>,
  opts: { ttlMs?: number; now?: () => number } = {},
): MaintenanceProbe {
  const ttlMs = opts.ttlMs ?? MAINTENANCE_CACHE_MS;
  const now = opts.now ?? Date.now;
  let cached: { at: number; on: Promise<boolean> } | null = null;
  return () => {
    const t = now();
    if (cached && t - cached.at < ttlMs) return cached.on;
    const on = read().catch((err) => {
      console.error(
        JSON.stringify({
          level: 'error',
          scope: 'maintenance',
          msg: 'maintenance_flag_read_failed',
          error: String(err),
        }),
      );
      return false;
    });
    cached = { at: t, on };
    return on;
  };
}

/** Reads `feature_flags.app.maintenance`; a missing row means maintenance is off. */
export function maintenanceFlagReader(admin: SupabaseClient): () => Promise<boolean> {
  return async () => {
    const { data, error } = await admin
      .from('feature_flags')
      .select('enabled')
      .eq('key', MAINTENANCE_FLAG)
      .maybeSingle();
    if (error) throw error;
    return data?.enabled === true;
  };
}

let shared: MaintenanceProbe | undefined;

/** Per-isolate singleton probe over the service-role client. */
export function maintenanceProbe(admin: SupabaseClient): MaintenanceProbe {
  shared ??= cachedMaintenanceProbe(maintenanceFlagReader(admin));
  return shared;
}

/** Internal calls (cron, queue workers) that keep running during maintenance. */
export function isInternalRequest(req: Request): boolean {
  if (req.headers.has('x-internal-secret')) return true;
  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  return path.endsWith('/worker') || path.endsWith('/execute');
}

/** Wraps a function's handler with the maintenance check (see the module comment). */
export function withMaintenance(
  handler: (req: Request) => Promise<Response>,
  probe: MaintenanceProbe,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === 'OPTIONS' || isInternalRequest(req)) return handler(req);
    if (await probe()) {
      return errorResponse(
        new HttpError(
          'FEATURE_DISABLED',
          'Thuluth is down for maintenance. Please try again soon.',
          {
            reason: 'maintenance',
            flag: MAINTENANCE_FLAG,
          },
        ),
        requestIdOf(req),
        { 'retry-after': '300' },
      );
    }
    return handler(req);
  };
}
