import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import type { IntakeStackParamList } from '@/navigation/types';

import { IntakeFlowContext, type IntakeFlowCallbacks } from '../hooks/intake-flow-context';
import { useIntakeHydrated } from '../hooks/use-intake-hydrated';
import { useIntakeHouseholdId } from '../hooks/use-intake-member';
import { IntakeAdhdScreen } from '../screens/intake-adhd-screen';
import { IntakeAllergiesScreen } from '../screens/intake-allergies-screen';
import { IntakeFoodScreen } from '../screens/intake-food-screen';
import { IntakeGoalsScreen } from '../screens/intake-goals-screen';
import { IntakeHealthScreen } from '../screens/intake-health-screen';
import { IntakeHouseholdScreen } from '../screens/intake-household-screen';
import { IntakeLifestyleScreen } from '../screens/intake-lifestyle-screen';
import { IntakeMembersScreen } from '../screens/intake-members-screen';
import { IntakeModulesScreen } from '../screens/intake-modules-screen';
import { IntakePickyScreen } from '../screens/intake-picky-screen';
import { IntakePregnancyScreen } from '../screens/intake-pregnancy-screen';
import { IntakeReviewScreen } from '../screens/intake-review-screen';
import { IntakeSensoryScreen } from '../screens/intake-sensory-screen';
import { useIntakeDraftStore, type IntakeView } from '../store/use-intake-draft-store';

const Stack = createNativeStackNavigator<IntakeStackParamList>();

const INITIAL_ROUTE: Record<IntakeView, keyof IntakeStackParamList> = {
  household: 'IntakeHousehold',
  // A member step resumes from the roster, which pushes the saved step on mount.
  members: 'IntakeMembers',
  member: 'IntakeMembers',
  review: 'IntakeReview',
};

/** Where the wizard reopens for a saved view (FR-ONB-01). Household preferences come first. */
export function initialIntakeRoute(view: IntakeView, preferencesSaved: boolean) {
  return preferencesSaved ? INITIAL_ROUTE[view] : 'IntakeHousehold';
}

/**
 * Onboarding step 5 intake wizard (02 §7.3, 08 §7): a nested stack that waits for the encrypted
 * draft to load, then opens at the saved position. The host passes completion callbacks.
 */
export function IntakeWizard({ onComplete, onExit }: IntakeFlowCallbacks) {
  const { t } = useTranslation('intake');
  const hydrated = useIntakeHydrated();
  const householdId = useIntakeHouseholdId();
  const value = useMemo(() => ({ onComplete, onExit }), [onComplete, onExit]);

  useEffect(() => {
    if (hydrated && householdId) useIntakeDraftStore.getState().begin(householdId);
  }, [hydrated, householdId]);

  if (!hydrated || !householdId) {
    return (
      <Screen edges={['top', 'bottom']} testID="intake.loading">
        <Text tone="muted">{t(householdId ? 'common.loading' : 'common.noHousehold')}</Text>
      </Screen>
    );
  }

  const { view, preferencesSaved, householdId: draftHousehold } = useIntakeDraftStore.getState();
  const initial =
    draftHousehold === householdId ? initialIntakeRoute(view, preferencesSaved) : 'IntakeHousehold';

  return (
    <IntakeFlowContext.Provider value={value}>
      <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName={initial}>
        <Stack.Screen name="IntakeHousehold" component={IntakeHouseholdScreen} />
        <Stack.Screen name="IntakeMembers" component={IntakeMembersScreen} />
        <Stack.Screen name="IntakeMemberHealth" component={IntakeHealthScreen} />
        <Stack.Screen name="IntakeMemberAllergies" component={IntakeAllergiesScreen} />
        <Stack.Screen name="IntakeMemberFood" component={IntakeFoodScreen} />
        <Stack.Screen name="IntakeMemberRoutine" component={IntakeLifestyleScreen} />
        <Stack.Screen name="IntakeMemberModules" component={IntakeModulesScreen} />
        <Stack.Screen name="IntakeModulePregnancy" component={IntakePregnancyScreen} />
        <Stack.Screen name="IntakeModuleSensory" component={IntakeSensoryScreen} />
        <Stack.Screen name="IntakeModulePicky" component={IntakePickyScreen} />
        <Stack.Screen name="IntakeModuleAdhd" component={IntakeAdhdScreen} />
        <Stack.Screen name="IntakeMemberGoals" component={IntakeGoalsScreen} />
        <Stack.Screen name="IntakeReview" component={IntakeReviewScreen} />
      </Stack.Navigator>
    </IntakeFlowContext.Provider>
  );
}
