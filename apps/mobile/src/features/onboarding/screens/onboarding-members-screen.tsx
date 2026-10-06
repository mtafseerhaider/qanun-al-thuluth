import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { FamilyMembersEditor, useFamilyMembers } from '@/features/family';
import { useMyHouseholds } from '@/features/household';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import { selectCanEdit, useActiveHouseholdStore } from '@/stores/use-active-household-store';

import { OnboardingScaffold } from '../components/onboarding-scaffold';
import { useOnboardingFlow } from '../hooks/use-onboarding-flow';
import { useOnboardingStore } from '../store/use-onboarding-store';

/**
 * Step 4 Add members (02 §7.3.2, 24 S1-11): everyone the family cooks for, with derived life stage,
 * "This is me" linking (`linked_user_id`), edit and remove, child-data consent before the first minor
 * and upgrade copy on `LIMIT_REACHED`. Continue leads to the step 5 intake (Sprint 2).
 */
export function OnboardingMembersScreen() {
  const { t } = useTranslation(['onboarding', 'errors']);
  const flow = useOnboardingFlow('members');
  useMyHouseholds();
  const created = useOnboardingStore((s) => s.createdHouseholdId);
  const joined = useOnboardingStore((s) => s.joinedByInvite);
  const activeId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const canEdit =
    useActiveHouseholdStore(selectCanEdit) || (created !== null && created === activeId);
  const householdId = created ?? activeId;
  const members = useFamilyMembers(householdId);
  const count = members.data?.length ?? 0;
  const needsMember = !joined && count === 0;

  return (
    <OnboardingScaffold
      step={flow.stepNumber}
      total={flow.totalSteps}
      title={t('onboarding:members.title')}
      subtitle={t('onboarding:members.body')}
      primaryLabel={t('onboarding:common.continue')}
      onPrimary={() => flow.goNext({ memberCount: count })}
      primaryDisabled={needsMember}
      primaryLoading={flow.finishing}
      onBack={flow.goBack}
      error={flow.finishError ? t(`errors:${errorKeyFor(flow.finishError)}`) : null}
      testID="onboarding-members.screen"
    >
      {householdId ? (
        <FamilyMembersEditor householdId={householdId} source="intake" canEdit={canEdit} />
      ) : (
        <Card variant="filled">
          <Text tone="muted">{t('onboarding:members.noHousehold')}</Text>
        </Card>
      )}
      {needsMember ? (
        <Text variant="caption" tone="muted">
          {t('onboarding:members.needOne')}
        </Text>
      ) : null}
    </OnboardingScaffold>
  );
}
