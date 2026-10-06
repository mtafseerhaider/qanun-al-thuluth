import type { SupabaseClient } from '@supabase/supabase-js';

import { check, selectAll } from '../_shared/platform.ts';
import type { Observation, StatusUpdate } from './screen.ts';

/** Data access for `prices-refresh` (06 §4.16), so the job can be tested without a database. */
export interface PricesStore {
  profiles(regionIds?: readonly string[]): Promise<Array<{ id: string; region_id: string }>>;
  /** Observations with `unit_grams` observed on or after `since`, any status. */
  observations(profileIds: readonly string[], since: string): Promise<Observation[]>;
  setStatuses(updates: readonly StatusUpdate[]): Promise<void>;
  /** `mv_current_prices` keyed `${price_profile_id}:${ingredient_id}` → price per kg (minor). */
  currentPrices(profileIds: readonly string[]): Promise<Map<string, number>>;
  /** `refresh_ingredient_prices()`: both price materialized views. */
  refreshViews(): Promise<void>;
}

export function supabasePricesStore(admin: SupabaseClient): PricesStore {
  return {
    async profiles(regionIds) {
      let q = admin.from('price_profiles').select('id, region_id');
      if (regionIds?.length) q = q.in('region_id', regionIds as string[]);
      return check(await q) as Array<{ id: string; region_id: string }>;
    },
    async observations(profileIds, since) {
      if (!profileIds.length) return [];
      const rows = (await selectAll<unknown>((a, b) =>
        admin
          .from('price_observations')
          .select(
            'id, price_profile_id, ingredient_id, amount_minor, unit_grams, observed_on, source, reporter_user_id, moderation_status',
          )
          .in('price_profile_id', profileIds as string[])
          .gte('observed_on', since)
          .not('unit_grams', 'is', null)
          .order('id')
          .range(a, b),
      )) as Array<Observation & { amount_minor: number | string; unit_grams: number | string }>;
      return rows.map((r) => ({
        ...r,
        amount_minor: Number(r.amount_minor),
        unit_grams: Number(r.unit_grams),
      }));
    },
    async setStatuses(updates) {
      for (const status of ['accepted', 'rejected_outlier'] as const) {
        const ids = updates.filter((u) => u.status === status).map((u) => u.id);
        for (let i = 0; i < ids.length; i += 500) {
          check(
            await admin
              .from('price_observations')
              .update({ moderation_status: status })
              .in('id', ids.slice(i, i + 500))
              .eq('source', 'user_report'),
          );
        }
      }
    },
    async currentPrices(profileIds) {
      if (!profileIds.length) return new Map();
      const rows = (await selectAll<unknown>((a, b) =>
        admin
          .from('mv_current_prices')
          .select('price_profile_id, ingredient_id, price_per_kg_minor')
          .in('price_profile_id', profileIds as string[])
          .order('price_profile_id')
          .order('ingredient_id')
          .range(a, b),
      )) as Array<{
        price_profile_id: string;
        ingredient_id: string;
        price_per_kg_minor: number | string;
      }>;
      return new Map(
        rows.map((r) => [`${r.price_profile_id}:${r.ingredient_id}`, Number(r.price_per_kg_minor)]),
      );
    },
    async refreshViews() {
      check(await admin.rpc('refresh_ingredient_prices'));
    },
  };
}
