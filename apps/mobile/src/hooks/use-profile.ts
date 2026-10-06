import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ProfileUpdate } from '@shared';

import { fetchProfile, updateProfile, type Profile } from '@/lib/auth/profile';
import { isSupabaseConfigured } from '@/lib/env';
import { definedOnly } from '@/lib/object/defined-only';
import { qk } from '@/lib/query/query-keys';
import { useSessionStore } from '@/stores/use-session-store';

/** The signed-in user's `users` row (09 §3 `qk.profile()`). */
export function useProfile() {
  const userId = useSessionStore((s) => s.userId);
  return useQuery({
    queryKey: qk.profile(),
    queryFn: () => fetchProfile(userId as string, { retries: 1 }),
    enabled: Boolean(userId) && isSupabaseConfigured,
    staleTime: 5 * 60_000,
  });
}

/** Optimistically patches `qk.profile()` so changes apply immediately (FR-SET-01). */
export function useUpdateProfile() {
  const qc = useQueryClient();
  const userId = useSessionStore((s) => s.userId);
  return useMutation({
    mutationKey: ['profile', 'update'],
    mutationFn: (
      patch: ProfileUpdate & { onboarding_completed_at?: string; age_attested_at?: string },
    ) => updateProfile(userId as string, patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: qk.profile() });
      const previous = qc.getQueryData<Profile>(qk.profile());
      if (previous) qc.setQueryData<Profile>(qk.profile(), { ...previous, ...definedOnly(patch) });
      return { previous };
    },
    onError: (_e, _patch, ctx) => {
      if (ctx?.previous) qc.setQueryData(qk.profile(), ctx.previous);
    },
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.profile() }),
  });
}
