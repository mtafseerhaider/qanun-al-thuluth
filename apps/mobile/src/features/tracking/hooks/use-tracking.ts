import { useQuery, type QueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useMemo } from 'react';

import { track } from '@/lib/analytics/track';
import { addDays } from '@/lib/dates/local-date';
import { isSupabaseConfigured } from '@/lib/env';
import { registerOutboxHandler, useOutboxStore, type OutboxEntry } from '@/lib/offline/outbox';
import { qk } from '@/lib/query/query-keys';

import { fetchJournal, fetchWeights, upsertJournal, upsertWeight } from '../api/tracking-api';
import {
  applyPendingJournal,
  applyPendingWeights,
  JOURNAL_SAVE_KIND,
  WEIGHT_LOG_KIND,
  type JournalWrite,
  type WeightWrite,
} from '../utils/tracking-rules';

/** Registers the weight and journal outbox handlers (called once from the app layer). */
export function registerTrackingOutboxHandlers(qc: QueryClient): void {
  registerOutboxHandler<WeightWrite>(WEIGHT_LOG_KIND, {
    run: (w) => upsertWeight(w),
    onSuccess: (w) =>
      void qc.invalidateQueries({
        queryKey: qk.household(w.householdId).weightLogs(w.familyMemberId),
      }),
  });
  registerOutboxHandler<JournalWrite>(JOURNAL_SAVE_KIND, {
    run: (w) => upsertJournal(w),
    onSuccess: (w) =>
      void qc.invalidateQueries({
        queryKey: qk.household(w.householdId).journal(w.familyMemberId),
      }),
  });
}

const selectEntries = (s: { entries: OutboxEntry[] }) => s.entries;

export function useWeights(householdId: string | null, familyMemberId: string | null) {
  const query = useQuery({
    queryKey: qk.household(householdId ?? 'none').weightLogs(familyMemberId ?? 'none'),
    queryFn: () => fetchWeights(familyMemberId as string),
    enabled: Boolean(householdId && familyMemberId) && isSupabaseConfigured,
  });
  const outbox = useOutboxStore(selectEntries);
  const data = useMemo(
    () => (familyMemberId ? applyPendingWeights(query.data ?? [], outbox, familyMemberId) : []),
    [query.data, outbox, familyMemberId],
  );
  return { ...query, data };
}

export function useJournal(
  householdId: string | null,
  familyMemberId: string | null,
  today: string,
) {
  const since = addDays(today, -30);
  const query = useQuery({
    queryKey: qk.household(householdId ?? 'none').journal(familyMemberId ?? 'none'),
    queryFn: () => fetchJournal(familyMemberId as string, since),
    enabled: Boolean(householdId && familyMemberId) && isSupabaseConfigured,
  });
  const outbox = useOutboxStore(selectEntries);
  const data = useMemo(
    () => (familyMemberId ? applyPendingJournal(query.data ?? [], outbox, familyMemberId) : []),
    [query.data, outbox, familyMemberId],
  );
  return { ...query, data };
}

/** Queues a weight entry; the same member and day replaces the queued one (one row per day). */
export function logWeight(input: Omit<WeightWrite, 'id'> & { existingId?: string }): void {
  const { existingId, ...rest } = input;
  const payload: WeightWrite = { ...rest, id: existingId ?? Crypto.randomUUID() };
  useOutboxStore.getState().enqueue({
    kind: WEIGHT_LOG_KIND,
    scope: `household:${input.householdId}`,
    dedupeKey: `${input.familyMemberId}:${input.measuredOn}`,
    payload,
  });
  track('weight_logged', { has_waist: input.waistCm !== null });
}

export function saveJournal(
  input: Omit<JournalWrite, 'id'> & { existingId?: string },
  minor: boolean,
): void {
  const { existingId, ...rest } = input;
  const payload: JournalWrite = {
    ...rest,
    // Never stored for children, whatever the form held (division of responsibility).
    thuluthAdherence: minor ? null : rest.thuluthAdherence,
    id: existingId ?? Crypto.randomUUID(),
  };
  useOutboxStore.getState().enqueue({
    kind: JOURNAL_SAVE_KIND,
    scope: `household:${input.householdId}`,
    dedupeKey: `${input.familyMemberId}:${input.journalDate}`,
    payload,
  });
  track('reflection_saved', {
    thuluth_adherence: payload.thuluthAdherence,
    has_notes: Boolean(payload.notes),
    minor,
  });
}
