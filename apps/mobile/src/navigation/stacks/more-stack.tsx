import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { BudgetDashboardScreen, BudgetSettingsScreen } from '@/features/budget';
import { MemoryManagementScreen } from '@/features/chat';
import { DebugScreen, useDebugMenuEnabled } from '@/features/debug';
import { FastingTrackerScreen } from '@/features/fasting';
import { ExportsScreen } from '@/features/exports';
import {
  AboutScreen,
  AlphaFeedbackScreen,
  ContactSupportScreen,
  HelpArticleScreen,
  HelpCenterScreen,
} from '@/features/help';
import { HydrationTrackerScreen } from '@/features/hydration';
import { NutritionInsightsScreen } from '@/features/insights';
import { SettingsNotificationsScreen } from '@/features/notifications';
import { DeleteAccountScreen, PrivacySettingsScreen } from '@/features/privacy';
import { RamadanPlannerScreen } from '@/features/ramadan';
import { MoreHomeScreen, SettingsProfileScreen, SettingsScreen } from '@/features/settings';
import { SubscriptionScreen } from '@/features/subscription';
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
      <Stack.Screen
        name="RamadanPlanner"
        component={RamadanPlannerScreen}
        options={{ title: t('screens.ramadanPlanner') }}
      />
      <Stack.Screen
        name="Subscription"
        component={SubscriptionScreen}
        options={{ title: t('screens.subscription') }}
      />
      <Stack.Screen
        name="SettingsMemory"
        component={MemoryManagementScreen}
        options={{ title: t('screens.settingsMemory') }}
      />
      <Stack.Screen
        name="SettingsPrivacy"
        component={PrivacySettingsScreen}
        options={{ title: t('screens.settingsPrivacy') }}
      />
      <Stack.Screen
        name="DeleteAccount"
        component={DeleteAccountScreen}
        options={{ title: t('screens.deleteAccount') }}
      />
      <Stack.Screen
        name="HelpCenter"
        component={HelpCenterScreen}
        options={{ title: t('screens.helpCenter') }}
      />
      <Stack.Screen
        name="HelpArticle"
        component={HelpArticleScreen}
        options={{ title: t('screens.helpArticle') }}
      />
      <Stack.Screen
        name="ContactSupport"
        component={ContactSupportScreen}
        options={{ title: t('screens.contactSupport') }}
      />
      <Stack.Screen name="About" component={AboutScreen} options={{ title: t('screens.about') }} />
      <Stack.Screen
        name="Exports"
        component={ExportsScreen}
        options={{ title: t('screens.exports') }}
      />
      <Stack.Screen
        name="NutritionInsights"
        component={NutritionInsightsScreen}
        options={{ title: t('screens.insights') }}
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
