import type { MemberIntakeStep } from '@shared/intake/questions';
import type { SpecialModule } from '@shared';

import type { IntakeStackParamList } from '@/navigation/types';

export type MemberStepRoute = Exclude<
  keyof IntakeStackParamList,
  'IntakeHousehold' | 'IntakeMembers' | 'IntakeMemberBody' | 'IntakeBudget' | 'IntakeReview'
>;

/** Per-member step to route (02 §3.3). The lifestyle questions (01 §7.4) live on the Routine route. */
export const ROUTE_FOR_MEMBER_STEP: Record<MemberIntakeStep, MemberStepRoute> = {
  health: 'IntakeMemberHealth',
  allergies: 'IntakeMemberAllergies',
  food: 'IntakeMemberFood',
  lifestyle: 'IntakeMemberRoutine',
  modules: 'IntakeMemberModules',
  pregnancy: 'IntakeModulePregnancy',
  sensory: 'IntakeModuleSensory',
  picky: 'IntakeModulePicky',
  adhd: 'IntakeModuleAdhd',
  goals: 'IntakeMemberGoals',
};

export type MemberStepTarget = {
  [R in MemberStepRoute]: { name: R; params: IntakeStackParamList[R] };
}[MemberStepRoute];

export function memberStepTarget(
  step: MemberIntakeStep,
  familyMemberId: string,
  modules: readonly SpecialModule[],
): MemberStepTarget {
  if (step === 'pregnancy')
    return {
      name: 'IntakeModulePregnancy',
      params: {
        familyMemberId,
        module: modules.includes('breastfeeding') ? 'breastfeeding' : 'pregnancy',
      },
    };
  return { name: ROUTE_FOR_MEMBER_STEP[step], params: { familyMemberId } } as MemberStepTarget;
}
