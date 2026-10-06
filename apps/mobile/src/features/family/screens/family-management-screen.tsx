import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useHousehold, useHouseholdPeople, useMyHouseholds } from '@/features/household';
import type { FamilyScreenProps } from '@/navigation/types';
import { selectCanEdit, useActiveHouseholdStore } from '@/stores/use-active-household-store';

import { FamilyMembersEditor } from '../components/family-members-editor';

/** F1 Family Management (02 §7.8.1): the household's members and who has access. */
export function FamilyManagementScreen({ navigation }: FamilyScreenProps<'FamilyManagement'>) {
  const { t } = useTranslation(['family', 'navigation']);
  useMyHouseholds();
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const canEdit = useActiveHouseholdStore(selectCanEdit);
  const household = useHousehold(householdId);
  const people = useHouseholdPeople(householdId);

  return (
    <Screen
      title={household.data?.name ?? t('navigation:screens.familyManagement')}
      edges={['top']}
      testID="family-management.screen"
    >
      {householdId ? (
        <>
          <FamilyMembersEditor householdId={householdId} source="family" canEdit={canEdit} />
          <Card>
            <Text variant="heading" accessibilityRole="header">
              {t('family:access.title')}
            </Text>
            <Text tone="muted">
              {t('family:access.count', { count: people.data?.length ?? 0 })}
            </Text>
            <View>
              <Button
                label={t('family:access.manage')}
                variant="secondary"
                onPress={() => navigation.navigate('Caregivers', { householdId })}
                testID="family-management.caregivers-button"
              />
            </View>
          </Card>
        </>
      ) : (
        <Card variant="filled">
          <Text tone="muted" testID="family-management.empty">
            {t('family:list.noHousehold')}
          </Text>
        </Card>
      )}
    </Screen>
  );
}
