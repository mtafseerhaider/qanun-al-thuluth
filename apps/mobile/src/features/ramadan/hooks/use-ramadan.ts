import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { RamadanGenerateRequest } from '@shared/contracts';

import {
  fastingEligibility,
  NO_SAFETY,
  ramadanDates,
  useFastingMembers,
  useFastingSafety,
  useFastingTimes,
} from '@/features/fasting';
import { useHouseholdClock } from '@/features/meals';
import { useFeatureFlag } from '@/hooks/use-feature-flag';
import { track } from '@/lib/analytics/track';
import { isSupabaseConfigured } from '@/lib/env';
import { qk } from '@/lib/query/query-keys';

import { fetchRamadanPlan, generateRamadanPlan } from '../api/ramadan-api';
import {
  countFasting,
  participationRule,
  ramadanDay,
  upcomingRamadanYear,
  type ParticipationRule,
} from '../utils/ramadan-rules';

export function useRamadanPlan(householdId: string | null, hijriYear: number) {
  return useQuery({
    queryKey: qk.household(householdId ?? 'none').ramadanPlan(hijriYear),
    queryFn: () => fetchRamadanPlan(householdId as string, hijriYear),
    enabled: Boolean(householdId) && isSupabaseConfigured,
    staleTime: 5 * 60_000,
  });
}

/** The Ramadan to plan for, with the computed dates (Umm al-Qura tables, corrected by the user). */
export function useUpcomingRamadan(householdId: string | null) {
  const clock = useHouseholdClock(householdId);
  const hijriYear = upcomingRamadanYear(clock.today);
  const dates = useMemo(() => ramadanDates(hijriYear), [hijriYear]);
  return {
    today: clock.today,
    hijriYear,
    computedStart: dates[0] ?? null,
    computedDays: (dates.length === 29 ? 29 : 30) as 29 | 30,
  };
}

/** One participation rule per member, from the shared fasting eligibility rules. */
export function useParticipationRules(householdId: string | null): {
  rules: ParticipationRule[];
  loading: boolean;
} {
  const clock = useHouseholdClock(householdId);
  const members = useFastingMembers(householdId);
  const safety = useFastingSafety(householdId);
  const rules = useMemo(
    () =>
      members.map((m) =>
        participationRule(m, fastingEligibility(m, safety.data?.[m.id] ?? NO_SAFETY, clock.today)),
      ),
    [members, safety.data, clock.today],
  );
  return { rules, loading: safety.isLoading };
}

export function useGenerateRamadanPlan(householdId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['ramadan', 'generate'],
    networkMode: 'online',
    mutationFn: ({ body, key }: { body: RamadanGenerateRequest; key: string }) =>
      generateRamadanPlan(body, key),
    onSuccess: (_accepted, { body }) => {
      const counts = countFasting(body.participants);
      track('ramadan_setup_completed', {
        members_fasting: counts.fasting,
        practice_fasts: counts.practice,
      });
      if (!householdId) return;
      void qc.invalidateQueries({
        queryKey: qk.household(householdId).ramadanPlan(body.hijri_year),
      });
      void qc.invalidateQueries({ queryKey: qk.household(householdId).mealPlans() });
    },
  });
}

/**
 * Ramadan Today (02 §7.5.1 Ramadan variant): the day counter and today's suhoor and iftar, shown
 * while today falls inside the household's plan, or the computed Ramadan when there is none.
 * Behind the `ramadan_planner` flag.
 */
export function useRamadanToday(householdId: string | null) {
  const enabled = useFeatureFlag('ramadan_planner');
  const upcoming = useUpcomingRamadan(householdId);
  const plan = useRamadanPlan(enabled ? householdId : null, upcoming.hijriYear);
  const times = useFastingTimes(householdId, upcoming.today);
  const window = plan.data
    ? { startDate: plan.data.startDate, endDate: plan.data.endDate }
    : upcoming.computedStart
      ? {
          startDate: upcoming.computedStart,
          endDate: ramadanDates(upcoming.hijriYear).at(-1) ?? upcoming.computedStart,
        }
      : null;
  const day = enabled ? ramadanDay(upcoming.today, window) : null;
  return { day, times, plan: plan.data ?? null, hijriYear: upcoming.hijriYear };
}
