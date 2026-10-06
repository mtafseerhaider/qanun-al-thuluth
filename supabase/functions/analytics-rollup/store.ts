import type { SupabaseClient } from '@supabase/supabase-js';

import { check } from '../_shared/platform.ts';

/** Data access for `analytics-rollup` (06 §4.17, 18 §12). */
export interface AnalyticsStore {
  /** `refresh_analytics_views(scope)`: names of the views refreshed. */
  refresh(scope: 'hourly' | 'daily'): Promise<string[]>;
  /** `analytics_maintain_partitions()`: next months created, partitions past 13 months dropped. */
  maintainPartitions(): Promise<{ created: string[]; detached: string[] }>;
  /** Rows in `analytics_events_default` (a missing monthly partition, 10 §8). */
  defaultPartitionRows(): Promise<number>;
  /** AI spend since `since` in USD (from `ai_usage.cost_usd_micros`). */
  aiCostUsdSince(since: string): Promise<number>;
  /** Push notifications still pending more than `minutes` after they were due. */
  stalePushes(before: string): Promise<number>;
  /** `launch_kpis(since, until)` (S7-12): KPI values for the window, null where there is no data. */
  launchKpis(since: string, until: string): Promise<Record<string, number | null>>;
  /** Upserts daily KPI rows into `analytics.metric_snapshots` (non-personal aggregates). */
  saveSnapshots(rows: KpiSnapshot[]): Promise<void>;
}

export interface KpiSnapshot {
  metric: string;
  period_start: string;
  period_end: string;
  value: number;
}

export function supabaseAnalyticsStore(admin: SupabaseClient): AnalyticsStore {
  return {
    async refresh(scope) {
      return (
        (check(await admin.rpc('refresh_analytics_views', { p_scope: scope })) as
          string[] | null) ?? []
      );
    },
    async maintainPartitions() {
      const r = check(await admin.rpc('analytics_maintain_partitions')) as {
        created?: string[];
        detached?: string[];
      } | null;
      return { created: r?.created ?? [], detached: r?.detached ?? [] };
    },
    async defaultPartitionRows() {
      const { count, error } = await admin
        .from('analytics_events_default')
        .select('event', { count: 'exact', head: true });
      if (error) throw error;
      return count ?? 0;
    },
    async aiCostUsdSince(since) {
      let total = 0;
      for (let from = 0; ; from += 1000) {
        const rows = check(
          await admin
            .from('ai_usage')
            .select('cost_usd_micros')
            .gte('created_at', since)
            .order('created_at')
            .range(from, from + 999),
        ) as Array<{ cost_usd_micros: number | string | null }>;
        for (const r of rows) total += Number(r.cost_usd_micros ?? 0);
        if (rows.length < 1000) break;
      }
      return total / 1e6;
    },
    async launchKpis(since, until) {
      const raw = check(
        await admin.rpc('launch_kpis', { p_since: since, p_until: until }),
      ) as Record<string, unknown> | null;
      const out: Record<string, number | null> = {};
      for (const [k, v] of Object.entries(raw ?? {}))
        out[k] = v === null || v === undefined ? null : Number(v);
      return out;
    },
    async saveSnapshots(rows) {
      if (!rows.length) return;
      // schema analytics is not exposed through PostgREST, so the write goes through an RPC.
      check(await admin.rpc('save_kpi_snapshots', { p_rows: rows }));
    },
    async stalePushes(before) {
      const { count, error } = await admin
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending')
        .eq('channel', 'push')
        .lt('scheduled_for', before);
      if (error) throw error;
      return count ?? 0;
    },
  };
}
