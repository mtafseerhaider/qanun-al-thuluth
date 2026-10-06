import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { CONSENT_VERSIONS, type ConsentKind } from '@shared';

import { track } from '@/lib/analytics/track';
import { isSupabaseConfigured } from '@/lib/env';
import { qk } from '@/lib/query/query-keys';
import { useSessionStore } from '@/stores/use-session-store';

import { fetchLiveConsents, grantConsents } from '../api/consents-api';
import { hasCurrentConsent, missingRequiredConsents } from '../utils/consent-rules';

export function useConsents() {
  const userId = useSessionStore((s) => s.userId);
  return useQuery({
    queryKey: qk.consents(),
    queryFn: () => fetchLiveConsents(userId as string),
    enabled: Boolean(userId) && isSupabaseConfigured,
    select: (live) => ({ live, missingRequired: missingRequiredConsents(live) }),
  });
}

/** Writes grants with the current CONSENT_VERSIONS; `child_data` must carry the household id. */
export function useGrantConsents() {
  const qc = useQueryClient();
  const userId = useSessionStore((s) => s.userId);
  return useMutation({
    mutationKey: ['consents', 'grant'],
    mutationFn: async (v: { kinds: ConsentKind[]; householdId?: string }) => {
      await grantConsents(
        userId as string,
        v.kinds.map((kind) => ({
          kind,
          version: CONSENT_VERSIONS[kind],
          household_id: kind === 'child_data' ? (v.householdId ?? null) : null,
        })),
      );
    },
    onSuccess: (_r, v) => {
      v.kinds.forEach((kind) => track('consent_updated', { kind, granted: true }));
      void qc.invalidateQueries({ queryKey: qk.consents() });
    },
  });
}

/** Child-data consent for one household (11 §13.2), used by the member form when a minor is added. */
export function useChildDataConsent(householdId: string | null) {
  const consents = useConsents();
  const grant = useGrantConsents();
  const granted =
    householdId !== null && hasCurrentConsent(consents.data?.live ?? [], 'child_data', householdId);
  return {
    granted,
    loading: consents.isLoading,
    granting: grant.isPending,
    error: grant.error,
    grant: () =>
      householdId
        ? grant.mutateAsync({ kinds: ['child_data'], householdId })
        : Promise.resolve(undefined),
  };
}
