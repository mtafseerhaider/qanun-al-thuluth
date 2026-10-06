import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import {
  AutismHubScreen,
  ExposureLadderDetailScreen,
  ExposureLaddersScreen,
  FirstThenScreen,
  FoodChainingScreen,
  SafeFoodsScreen,
  SensoryProfileScreen,
} from '@/features/autism';
import { FamilyManagementScreen } from '@/features/family';
import { GrowthDashboardScreen } from '@/features/growth';
import { CaregiversScreen } from '@/features/household';
import {
  AcceptanceAnalyticsScreen,
  DivisionOfResponsibilityScreen,
  ExposureLogScreen,
  PickyEaterHubScreen,
} from '@/features/picky';

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
      <Stack.Screen
        name="GrowthDashboard"
        component={GrowthDashboardScreen}
        options={{ title: t('screens.growth') }}
      />
      <Stack.Screen
        name="PickyEaterHub"
        component={PickyEaterHubScreen}
        options={{ title: t('screens.pickyHub') }}
      />
      <Stack.Screen
        name="DivisionOfResponsibility"
        component={DivisionOfResponsibilityScreen}
        options={{ title: t('screens.dor') }}
      />
      <Stack.Screen
        name="ExposureLog"
        component={ExposureLogScreen}
        options={{ title: t('screens.exposureLog') }}
      />
      <Stack.Screen
        name="AcceptanceAnalytics"
        component={AcceptanceAnalyticsScreen}
        options={{ title: t('screens.acceptanceAnalytics') }}
      />
      <Stack.Screen
        name="AutismHub"
        component={AutismHubScreen}
        options={{ title: t('screens.autismHub') }}
      />
      <Stack.Screen
        name="SafeFoods"
        component={SafeFoodsScreen}
        options={{ title: t('screens.safeFoods') }}
      />
      <Stack.Screen
        name="SensoryProfile"
        component={SensoryProfileScreen}
        options={{ title: t('screens.sensoryProfile') }}
      />
      <Stack.Screen
        name="ExposureLadders"
        component={ExposureLaddersScreen}
        options={{ title: t('screens.exposureLadders') }}
      />
      <Stack.Screen
        name="ExposureLadderDetail"
        component={ExposureLadderDetailScreen}
        options={{ title: t('screens.exposureLadder') }}
      />
      <Stack.Screen
        name="FoodChaining"
        component={FoodChainingScreen}
        options={{ title: t('screens.ladderEditor') }}
      />
      <Stack.Screen
        name="FirstThen"
        component={FirstThenScreen}
        options={{ title: t('screens.firstThen') }}
      />
    </Stack.Navigator>
  );
}
