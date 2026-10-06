import { createNativeStackNavigator } from '@react-navigation/native-stack';

import {
  OnboardingConsentsScreen,
  OnboardingHouseholdScreen,
  OnboardingMembersScreen,
  OnboardingPhilosophyScreen,
  OnboardingWelcomeScreen,
  routeForStep,
  useOnboardingStore,
} from '@/features/onboarding';

import type { OnboardingStackParamList } from './types';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

/**
 * Onboarding steps 1 to 4 plus consents (24 Sprint 1). Opens at the persisted step so a killed app
 * or an RTL reload resumes where the user left off (FR-ONB-01). Notifications, intake and the first
 * plan join in Sprints 2 and 3.
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
    </Stack.Navigator>
  );
}
