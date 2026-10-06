import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { FamilyManagementScreen } from '@/features/family';
import { CaregiversScreen } from '@/features/household';

import type { FamilyStackParamList } from '../types';

const Stack = createNativeStackNavigator<FamilyStackParamList>();

export function FamilyStack() {
  const { t } = useTranslation('navigation');
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="FamilyManagement"
        component={FamilyManagementScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Caregivers"
        component={CaregiversScreen}
        options={{ title: t('screens.caregivers') }}
      />
    </Stack.Navigator>
  );
}
