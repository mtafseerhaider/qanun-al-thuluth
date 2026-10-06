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
import { useStackMotion } from '../motion';

const Stack = createNativeStackNavigator<FamilyStackParamList>();

export function FamilyStack() {
  const motion = useStackMotion();
  const { t } = useTranslation('navigation');
  return (
    <Stack.Navigator screenOptions={motion}>
      <Stack.Screen
        name="FamilyManagement"
        getComponent={() => FamilyManagementScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Caregivers"
        getComponent={() => CaregiversScreen}
        options={{ title: t('screens.caregivers') }}
      />
      <Stack.Screen
        name="GrowthDashboard"
        getComponent={() => GrowthDashboardScreen}
        options={{ title: t('screens.growth') }}
      />
      <Stack.Screen
        name="PickyEaterHub"
        getComponent={() => PickyEaterHubScreen}
        options={{ title: t('screens.pickyHub') }}
      />
      <Stack.Screen
        name="DivisionOfResponsibility"
        getComponent={() => DivisionOfResponsibilityScreen}
        options={{ title: t('screens.dor') }}
      />
      <Stack.Screen
        name="ExposureLog"
        getComponent={() => ExposureLogScreen}
        options={{ title: t('screens.exposureLog') }}
      />
      <Stack.Screen
        name="AcceptanceAnalytics"
        getComponent={() => AcceptanceAnalyticsScreen}
        options={{ title: t('screens.acceptanceAnalytics') }}
      />
      <Stack.Screen
        name="AutismHub"
        getComponent={() => AutismHubScreen}
        options={{ title: t('screens.autismHub') }}
      />
      <Stack.Screen
        name="SafeFoods"
        getComponent={() => SafeFoodsScreen}
        options={{ title: t('screens.safeFoods') }}
      />
      <Stack.Screen
        name="SensoryProfile"
        getComponent={() => SensoryProfileScreen}
        options={{ title: t('screens.sensoryProfile') }}
      />
      <Stack.Screen
        name="ExposureLadders"
        getComponent={() => ExposureLaddersScreen}
        options={{ title: t('screens.exposureLadders') }}
      />
      <Stack.Screen
        name="ExposureLadderDetail"
        getComponent={() => ExposureLadderDetailScreen}
        options={{ title: t('screens.exposureLadder') }}
      />
      <Stack.Screen
        name="FoodChaining"
        getComponent={() => FoodChainingScreen}
        options={{ title: t('screens.ladderEditor') }}
      />
      <Stack.Screen
        name="FirstThen"
        getComponent={() => FirstThenScreen}
        options={{ title: t('screens.firstThen') }}
      />
    </Stack.Navigator>
  );
}
