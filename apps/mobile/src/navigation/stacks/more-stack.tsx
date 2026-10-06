import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { BudgetDashboardScreen, BudgetSettingsScreen } from '@/features/budget';
import { DebugScreen, useDebugMenuEnabled } from '@/features/debug';
import { FastingTrackerScreen } from '@/features/fasting';
import { AlphaFeedbackScreen } from '@/features/help';
import { HydrationTrackerScreen } from '@/features/hydration';
import { SettingsNotificationsScreen } from '@/features/notifications';
import { MoreHomeScreen, SettingsProfileScreen, SettingsScreen } from '@/features/settings';
import { WeightLogScreen } from '@/features/tracking';

import type { MoreStackParamList } from '../types';

const Stack = createNativeStackNavigator<MoreStackParamList>();

export function MoreStack() {
  const { t } = useTranslation('navigation');
  const debugEnabled = useDebugMenuEnabled();
  return (
    <Stack.Navigator>
      <Stack.Screen name="MoreHome" component={MoreHomeScreen} options={{ headerShown: false }} />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ title: t('screens.settings') }}
      />
      <Stack.Screen
        name="SettingsProfile"
        component={SettingsProfileScreen}
        options={{ title: t('screens.settingsProfile') }}
      />
      <Stack.Screen
        name="AlphaFeedback"
        component={AlphaFeedbackScreen}
        options={{ title: t('screens.alphaFeedback') }}
      />
      <Stack.Screen
        name="HydrationTracker"
        component={HydrationTrackerScreen}
        options={{ title: t('screens.hydration') }}
      />
      <Stack.Screen
        name="FastingTracker"
        component={FastingTrackerScreen}
        options={{ title: t('screens.fasting') }}
      />
      <Stack.Screen
        name="BudgetDashboard"
        component={BudgetDashboardScreen}
        options={{ title: t('screens.budget') }}
      />
      <Stack.Screen
        name="BudgetSettings"
        component={BudgetSettingsScreen}
        options={{ title: t('screens.budgetSettings') }}
      />
      <Stack.Screen
        name="WeightLog"
        component={WeightLogScreen}
        options={{ title: t('screens.weightLog') }}
      />
      <Stack.Screen
        name="SettingsNotifications"
        component={SettingsNotificationsScreen}
        options={{ title: t('screens.settingsNotifications') }}
      />
      {debugEnabled ? (
        <Stack.Screen
          name="Debug"
          component={DebugScreen}
          options={{ title: t('screens.debug') }}
        />
      ) : null}
    </Stack.Navigator>
  );
}
