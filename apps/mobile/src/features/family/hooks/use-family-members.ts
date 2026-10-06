import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { FamilyMemberInput, LifeStage } from '@shared';

import { track } from '@/lib/analytics/track';
import { isSupabaseConfigured } from '@/lib/env';
import { qk } from '@/lib/query/query-keys';

import {
  insertFamilyMember,
  listFamilyMembers,
  removeFamilyMember,
  updateFamilyMember,
} from '../api/family-members-api';

export function useFamilyMembers(householdId: string | null) {
  return useQuery({
    queryKey: qk.household(householdId ?? 'none').familyMembers(),
    queryFn: () => listFamilyMembers(householdId as string),
    enabled: Boolean(householdId) && isSupabaseConfigured,
  });
}

export function useSaveFamilyMember(householdId: string, source: 'intake' | 'family') {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['family-members', 'save'],
    mutationFn: async (v: {
      /** Existing member to update. */
      id?: string;
      /** Client id for a new member, generated once per form so a retry never duplicates. */
      newId: string;
      input: FamilyMemberInput;
      lifeStage: LifeStage;
    }): Promise<string> => {
      if (v.id) {
        await updateFamilyMember(v.id, v.input);
        return v.id;
      }
      await insertFamilyMember(v.newId, householdId, v.input);
      track('family_member_added', { life_stage: v.lifeStage, source });
      return v.newId;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.household(householdId).familyMembers() });
      void qc.invalidateQueries({ queryKey: qk.household(householdId).detail() });
    },
  });
}

export function useRemoveFamilyMember(householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['family-members', 'remove'],
    mutationFn: (id: string) => removeFamilyMember(id),
    onSuccess: () => {
      track('family_member_removed', {});
      void qc.invalidateQueries({ queryKey: qk.household(householdId).familyMembers() });
    },
  });
}
