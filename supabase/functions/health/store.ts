import type { SupabaseClient } from '@supabase/supabase-js';

import { check } from '../_shared/platform.ts';

/** `ops_health()` (migration 20261006150000): coarse, non-personal service signals. */
export interface OpsHealth {
  feature_flags: number;
  maintenance: boolean;
  stale_pushes: number;
  /** null when pg_cron's run log is not readable. */
  cron_failures_1h: number | null;
}

export interface HealthStore {
  opsHealth(): Promise<OpsHealth>;
}

export function supabaseHealthStore(admin: SupabaseClient): HealthStore {
  return {
    async opsHealth() {
      return check(await admin.rpc('ops_health')) as OpsHealth;
    },
  };
}
