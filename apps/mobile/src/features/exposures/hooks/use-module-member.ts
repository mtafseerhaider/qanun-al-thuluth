import { useFamilyMembers } from '@/features/family';
import { useHouseholdClock } from '@/features/meals';
import { usePremium } from '@/features/subscription';
import { selectCanEdit, useActiveHouseholdStore } from '@/stores/use-active-household-store';

import { ageInMonths } from '../utils/exposure-rules';

/** The member, age, tier and role every picky-eater and autism screen needs. */
export function useModuleMember(familyMemberId: string) {
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const canEdit = useActiveHouseholdStore(selectCanEdit);
  const clock = useHouseholdClock(householdId);
  const members = useFamilyMembers(householdId);
  const { premium } = usePremium(householdId);
  const member = (members.data ?? []).find((m) => m.id === familyMemberId) ?? null;
  const ageMonths = member?.date_of_birth ? ageInMonths(member.date_of_birth, clock.today) : null;
  return {
    householdId,
    canEdit,
    today: clock.today,
    member,
    name: member?.name ?? '',
    ageMonths,
    premium,
    loading: members.isLoading,
  };
}
