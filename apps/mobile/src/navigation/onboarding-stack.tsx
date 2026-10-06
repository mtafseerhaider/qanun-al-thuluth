import { createNativeStackNavigator } from '@react-navigation/native-stack';

import {
  OnboardingAssessmentScreen,
  OnboardingConsentsScreen,
  OnboardingFirstPlanScreen,
  OnboardingHouseholdScreen,
  OnboardingIntakeScreen,
  OnboardingMembersScreen,
  OnboardingPhilosophyScreen,
  OnboardingWelcomeScreen,
  routeForStep,
  useOnboardingStore,
} from '@/features/onboarding';

import type { OnboardingStackParamList } from './types';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

/**
 * Onboarding steps 1 to 4 plus consents (24 Sprint 1), step 5 intake and the assessment summary
 * (Sprint 2). Opens at the persisted step so a killed app or an RTL reload resumes where the user
 * left off (FR-ONB-01). Step 6, the first plan, joined in Sprint 3; notifications come later.
 */
export function OnboardingStack() {
  // Read once: the initial route must not change while the stack is mounted.
  const initial = routeForStep(useOnboardingStore.getState().currentStep);
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName={initial}>
      <Stack.Screen name="OnboardingWelcome" component={OnboardingWelcomeScreen} />
      <Stack.Screen name="OnboardingPhilosophy" component={OnboardingPhilosophyScreen} />
      <Stack.Screen name="OnboardingConsents" component={OnboardingConsentsScreen} />
      <Stack.Screen name="OnboardingHousehold" component={OnboardingHouseholdScreen} />
      <Stack.Screen name="OnboardingMembers" component={OnboardingMembersScreen} />
      <Stack.Screen name="IntakeWizard" component={OnboardingIntakeScreen} />
      <Stack.Screen name="AssessmentSummary" component={OnboardingAssessmentScreen} />
      <Stack.Screen name="FirstPlanGeneration" component={OnboardingFirstPlanScreen} />
    </Stack.Navigator>
  );
}
