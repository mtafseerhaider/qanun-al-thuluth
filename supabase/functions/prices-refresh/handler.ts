import { requireInternal } from '../_shared/auth.ts';
import type { InternalSecrets } from '../_shared/auth.ts';
import { jsonHandler } from '../_shared/http.ts';
import { median, repriced, screen, WINDOW_DAYS } from './screen.ts';
import type { PricesStore } from './store.ts';

export {
  PricesRefreshRequest,
  PricesRefreshResponse,
} from '@thuluth/shared/contracts/prices-refresh.ts';
import {
  PricesRefreshRequest,
  PricesRefreshResponse,
} from '@thuluth/shared/contracts/prices-refresh.ts';

/** A profile is stale when its median accepted observation is older than this (14 §16.3). */
export const STALE_AFTER_DAYS = 45;

export interface PricesRefreshDeps {
  secrets: InternalSecrets;
  store: PricesStore;
  now?: () => Date;
}

const isoDaysAgo = (now: Date, days: number) =>
  new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);

/**
 * Nightly cron (x-internal-secret). Screens user-reported observations (`screen.ts`), refreshes
 * `mv_current_prices` (the live price book, 14 §12.4) and reports which prices moved more than
 * 3 percent. Idempotent: a second run finds nothing left to change.
 */
export function createPricesRefreshHandler(deps: PricesRefreshDeps) {
  const now = deps.now ?? (() => new Date());
  return jsonHandler(PricesRefreshRequest, async ({ req, input, requestId }) => {
    requireInternal(req, deps.secrets);
    const at = now();
    const profiles = await deps.store.profiles(input.region_ids);
    const ids = profiles.map((p) => p.id);
    const since = input.since ?? isoDaysAgo(at, WINDOW_DAYS);
    const observations = await deps.store.observations(ids, since);
    const result = screen(observations);
    if (result.updates.length) await deps.store.setStatuses(result.updates);

    const before = await deps.store.currentPrices(ids);
    await deps.store.refreshViews();
    const after = await deps.store.currentPrices(ids);
    const moved = repriced(before, after);
    const profilesUpdated = new Set(moved.map((k) => k.split(':')[0]));

    const today = at.toISOString().slice(0, 10);
    const stale: string[] = [];
    for (const id of ids) {
      const ages = observations
        .filter((o) => o.price_profile_id === id && o.moderation_status === 'accepted')
        .map(
          (o) =>
            (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${o.observed_on}T00:00:00Z`)) /
            86_400_000,
        );
      // No accepted observation in the window at all is stale too.
      if (!ages.length || median(ages) > STALE_AFTER_DAYS) stale.push(id);
    }
    if (stale.length) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          scope: 'prices-refresh',
          msg: 'stale_price_profiles',
          request_id: requestId,
          profiles: stale,
        }),
      );
    }
    console.log(
      JSON.stringify({
        level: 'info',
        scope: 'prices-refresh',
        request_id: requestId,
        observations: observations.length,
        outliers_rejected: result.outliers_rejected,
        pending_accepted: result.pending_accepted,
        repriced: moved.length,
      }),
    );
    return PricesRefreshResponse.parse({
      profiles_updated: profilesUpdated.size,
      ingredients_repriced: moved.length,
      outliers_rejected: result.outliers_rejected,
      pending_accepted: result.pending_accepted,
      stale_profiles: stale,
    });
  });
}
