import type { OnboardingStackParamList } from '@/navigation/types';

import type { OnboardingStep } from '../store/use-onboarding-store';

type Route = Extract<
  keyof OnboardingStackParamList,
  | 'OnboardingWelcome'
  | 'OnboardingPhilosophy'
  | 'OnboardingConsents'
  | 'OnboardingHousehold'
  | 'OnboardingMembers'
  | 'IntakeWizard'
  | 'AssessmentSummary'
  | 'FirstPlanGeneration'
>;

export const ROUTE_FOR_STEP: Record<Exclude<OnboardingStep, 'done'>, Route> = {
  welcome: 'OnboardingWelcome',
  philosophy: 'OnboardingPhilosophy',
  consents: 'OnboardingConsents',
  household: 'OnboardingHousehold',
  members: 'OnboardingMembers',
  intake: 'IntakeWizard',
  assessment: 'AssessmentSummary',
  first_plan: 'FirstPlanGeneration',
};

/** Where a resumed onboarding opens (FR-ONB-01). `done` resumes on the last step until the server agrees. */
export function routeForStep(step: OnboardingStep): Route {
  return step === 'done' ? 'FirstPlanGeneration' : ROUTE_FOR_STEP[step];
}
