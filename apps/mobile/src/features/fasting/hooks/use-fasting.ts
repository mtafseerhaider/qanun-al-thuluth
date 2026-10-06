import { useQuery, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useFamilyMembers } from '@/features/family';
import { useHousehold } from '@/features/household';
import { useHouseholdClock } from '@/features/meals';
import { track } from '@/lib/analytics/track';
import { addDays } from '@/lib/dates/local-date';
import { isSupabaseConfigured } from '@/lib/env';
import { registerOutboxHandler, useOutboxStore, type OutboxEntry } from '@/lib/offline/outbox';
import { qk } from '@/lib/query/query-keys';
import { usePreferencesStore } from '@/stores/use-preferences-store';

import {
  deleteFastingLog,
  fetchFastingLogs,
  fetchFastingSafety,
  upsertFastingLog,
} from '../api/fasting-api';
import {
  applyPendingFasting,
  FASTING_DELETE_KIND,
  FASTING_LOG_KIND,
  isFastingOn,
  type FastingDeleteWrite,
  type FastingLogView,
  type FastingLogWrite,
  type FastingMember,
} from '../utils/fasting-rules';
import { householdFastingTimes } from '../utils/prayer';

export function registerFastingOutboxHandlers(qc: QueryClient): void {
  const refresh = (householdId: string) =>
    void qc.invalidateQueries({ queryKey: qk.household(householdId).fastingLogs() });
  registerOutboxHandler<FastingLogWrite>(FASTING_LOG_KIND, {
    run: (w) => upsertFastingLog(w),
    onSuccess: (w) => refresh(w.householdId),
  });
  registerOutboxHandler<FastingDeleteWrite>(FASTING_DELETE_KIND, {
    run: (w) => deleteFastingLog(w),
    onSuccess: (w) => refresh(w.householdId),
  });
}

const selectEntries = (s: { entries: OutboxEntry[] }) => s.entries;

/** About 14 months of logs (this and last Ramadan, qada) with queued writes overlaid. */
export function useFastingLogs(householdId: string | null) {
  const clock = useHouseholdClock(householdId);
  const since = addDays(clock.today, -430);
  const query = useQuery({
    queryKey: qk.household(householdId ?? 'none').fastingLogs(),
    queryFn: () => fetchFastingLogs(householdId as string, since),
    enabled: Boolean(householdId) && isSupabaseConfigured,
  });
  const entries = useOutboxStore(selectEntries);
  const data = useMemo(
    () =>
      applyPendingFasting(
        query.data ?? [],
        entries.filter((e) => e.scope === `household:${householdId}`),
      ),
    [query.data, entries, householdId],
  );
  return { ...query, data };
}

export function useFastingSafety(householdId: string | null) {
  return useQuery({
    queryKey: qk.household(householdId ?? 'none').fastingSafety(),
    queryFn: () => fetchFastingSafety(householdId as string),
    enabled: Boolean(householdId) && isSupabaseConfigured,
    staleTime: 5 * 60_000,
  });
}

/** Members as the fasting rules see them. */
export function useFastingMembers(householdId: string | null): FastingMember[] {
  const members = useFamilyMembers(householdId);
  return useMemo(
    () =>
      (members.data ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        dateOfBirth: m.date_of_birth,
        lifeStage: m.life_stage,
        specialModules: m.special_modules ?? [],
        linkedUserId: m.linked_user_id,
      })),
    [members.data],
  );
}

/** Who is fasting today (02 §7.5.1 `useFastingToday`), for Today and the hydration state. */
export function useFastingToday(householdId: string | null) {
  const clock = useHouseholdClock(householdId);
  const logs = useFastingLogs(householdId);
  return useMemo(() => {
    const today = logs.data.filter((l) => isFastingOn(l, clock.today));
    return { logs: today, memberIds: new Set(today.map((l) => l.familyMemberId)) };
  }, [logs.data, clock.today]);
}

/** Suhoor end and iftar for a date in the household's city (FR-FAST-05). */
export function useFastingTimes(householdId: string | null, date: string) {
  const household = useHousehold(householdId);
  const tradition = usePreferencesStore((s) => s.traditionPreference);
  return useMemo(
    () => householdFastingTimes(date, household.data ?? null, tradition),
    [date, household.data, tradition],
  );
}

/** Queues a fast; an edit of the same member, date and kind keeps the existing row id. */
export function logFast(
  write: FastingLogWrite,
  existing?: Pick<FastingLogView, 'id'> | null,
): void {
  const w = existing ? { ...write, id: existing.id } : write;
  useOutboxStore.getState().enqueue({
    kind: FASTING_LOG_KIND,
    scope: `household:${w.householdId}`,
    dedupeKey: `${w.familyMemberId}:${w.fastDate}:${w.kind}`,
    payload: w,
  });
  track('fast_logged', {
    kind: w.kind,
    completed: w.completed,
    has_exemption: Boolean(w.exemptionReason),
    practice: w.isPracticeFast,
  });
}

export function removeFast(
  householdId: string,
  log: Pick<FastingLogView, 'id' | 'familyMemberId' | 'fastDate' | 'kind'>,
): void {
  const store = useOutboxStore.getState();
  const key = `${log.familyMemberId}:${log.fastDate}:${log.kind}`;
  const queued = store.entries.find((e) => e.kind === FASTING_LOG_KIND && e.dedupeKey === key);
  if (queued) store.remove(queued.id);
  store.enqueue({
    kind: FASTING_DELETE_KIND,
    scope: `household:${householdId}`,
    dedupeKey: log.id,
    payload: { id: log.id, householdId } satisfies FastingDeleteWrite,
  });
}
