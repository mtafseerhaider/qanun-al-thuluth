import type { QueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';

import { track } from '@/lib/analytics/track';
import { registerOutboxHandler, useOutboxStore } from '@/lib/offline/outbox';
import { qk } from '@/lib/query/query-keys';

import { upsertMealLog } from '../api/meal-log-api';
import { MEAL_LOG_KIND, type MealLogWrite } from '../utils/meal-log-rules';

export function registerMealLogOutboxHandlers(qc: QueryClient): void {
  registerOutboxHandler<MealLogWrite>(MEAL_LOG_KIND, {
    run: (w) => upsertMealLog(w),
    onSuccess: (w) =>
      void qc.invalidateQueries({ queryKey: qk.household(w.householdId).mealLogs() }),
  });
}

/** Queues a meal log (offline-safe, FR-TRK-02). The id doubles as the idempotency key. */
export function logMealLog(
  input: Omit<MealLogWrite, 'id'> & { id?: string },
  analytics: 'manual' | 'photo_ai' | 'chat' = input.source,
): MealLogWrite {
  const w: MealLogWrite = { ...input, id: input.id ?? Crypto.randomUUID() };
  useOutboxStore.getState().enqueue({
    kind: MEAL_LOG_KIND,
    scope: `household:${w.householdId}`,
    dedupeKey: w.id,
    id: w.id,
    payload: w,
  });
  track('meal_log_saved', {
    source: analytics,
    has_photo: Boolean(w.photoPath),
    members_count: 1,
  });
  return w;
}
