import { HealthResponse } from '@thuluth/shared/contracts/health.ts';

import type { AppEnv } from '../_shared/env.ts';
import type { HealthStore, OpsHealth } from './store.ts';

/** The status page and uptime monitor time out at 10 s; answer well before that. */
export const DB_TIMEOUT_MS = 3000;
/**
 * S7-SEC-14: the endpoint is public, so the database probe result is cached per isolate. However often
 * it is polled, each isolate sends at most one `ops_health()` call per CACHE_MS. A failed probe is
 * cached for the same time, so a flood during an outage cannot pile onto the database.
 */
export const CACHE_MS = 20_000;

export interface HealthDeps {
  store: HealthStore;
  env: AppEnv;
  /** Deployed git SHA (`GIT_SHA`, set by the deploy workflows); `unknown` locally. */
  release: string;
  now?: () => Date;
  timeoutMs?: number;
  /** Probe cache lifetime; 0 disables (tests). */
  cacheMs?: number;
}

const headers = {
  'content-type': 'application/json',
  'cache-control': 'no-store',
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
};

function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      t = setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

/**
 * `health` (S7-06 status checks; 04 §12 synthetic checks). Public `GET /functions/v1/health`, no JWT,
 * polled every minute by the uptime monitor behind `status.thuluth.app`. One RPC (`ops_health`)
 * proves the function runtime, the service key and the database; feature flags must be readable;
 * a cron failure in the last hour, a push stuck pending for 10 minutes or the maintenance flag
 * turn the status to `degraded` (HTTP 200). A failed or slow database answers `down` (HTTP 503).
 * Never returns counts, hosts or error text, so it is safe to expose publicly.
 */
export function createHealthHandler(deps: HealthDeps) {
  const now = deps.now ?? (() => new Date());
  const ms = deps.timeoutMs ?? DB_TIMEOUT_MS;
  const cacheMs = deps.cacheMs ?? CACHE_MS;
  let cached: { at: number; ops: Promise<OpsHealth | null> } | null = null;

  /** One shared in-flight probe per cache window (concurrent requests reuse it). */
  function probe(): Promise<OpsHealth | null> {
    const t = now().getTime();
    if (cached && t - cached.at < cacheMs) return cached.ops;
    const ops = timeout(deps.store.opsHealth(), ms).catch((err) => {
      console.error(
        JSON.stringify({
          level: 'error',
          scope: 'health',
          msg: 'ops_health_failed',
          error: String(err),
        }),
      );
      return null;
    });
    cached = { at: t, ops };
    return ops;
  }
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return new Response(null, { status: 405, headers: { ...headers, allow: 'GET, HEAD' } });
    const started = Date.now();
    const ops = await probe();
    const checks: HealthResponse['checks'] = ops
      ? {
          database: 'ok',
          feature_flags: ops.feature_flags > 0 ? 'ok' : 'fail',
          cron:
            ops.cron_failures_1h === null
              ? ops.stale_pushes > 0
                ? 'fail'
                : 'skipped'
              : ops.cron_failures_1h > 0 || ops.stale_pushes > 0
                ? 'fail'
                : 'ok',
          maintenance: ops.maintenance ? 'fail' : 'ok',
        }
      : { database: 'fail', feature_flags: 'skipped', cron: 'skipped', maintenance: 'skipped' };
    const status: HealthResponse['status'] = !ops
      ? 'down'
      : Object.values(checks).includes('fail')
        ? 'degraded'
        : 'ok';
    const body = HealthResponse.parse({
      status,
      checks,
      env: deps.env,
      release: deps.release.slice(0, 64),
      time: now().toISOString(),
      duration_ms: Date.now() - started,
    });
    if (status !== 'ok')
      console.warn(JSON.stringify({ level: 'warn', scope: 'health', status, checks }));
    return new Response(req.method === 'HEAD' ? null : JSON.stringify(body), {
      status: status === 'down' ? 503 : 200,
      headers,
    });
  };
}
