import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { OnboardingWelcomeScreen } from '@/features/onboarding';

import type { OnboardingStackParamList } from './types';

const Stack = createNativeStackNavigator<OnboardingStackParamList>();

/** Placeholder: O1 to O6, intake and first plan generation land in Sprints 1 and 2. */
export function OnboardingStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="OnboardingWelcome" component={OnboardingWelcomeScreen} />
    </Stack.Navigator>
  );
}
