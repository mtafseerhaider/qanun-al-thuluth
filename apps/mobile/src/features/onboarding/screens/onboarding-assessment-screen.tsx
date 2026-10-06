import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { AssessmentSummaryScreen, useIntakeDraftStore } from '@/features/intake';
import { useFamilyMembers } from '@/features/family';
import type { OnboardingStackParamList } from '@/navigation/types';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';

import { useOnboardingFlow } from '../hooks/use-onboarding-flow';
import { useOnboardingStore } from '../store/use-onboarding-store';

/**
 * O7 Assessment Summary inside onboarding (02 §7.4.1, 24 S2-15). "Create our first week" moves to
 * step 6 (First plan, S3-07), which completes onboarding and clears the intake drafts once a plan
 * exists (08 §7.3).
 */
export function OnboardingAssessmentScreen() {
  const flow = useOnboardingFlow('assessment');
  const navigation = useNavigation<NativeStackNavigationProp<OnboardingStackParamList>>();
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const members = useFamilyMembers(householdId);

  const onEdit = () => {
    useOnboardingStore.getState().goTo('intake');
    useIntakeDraftStore.getState().setView('review', null);
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.replace('IntakeWizard', { screen: 'IntakeReview' });
  };

  return (
    <AssessmentSummaryScreen
      onContinue={() => flow.goNext({ memberCount: members.data?.length ?? 0 })}
      onEdit={onEdit}
      continuing={flow.finishing}
      continueError={flow.finishError}
    />
  );
}
