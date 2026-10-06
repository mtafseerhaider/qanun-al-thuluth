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
import { useStackMotion } from '../motion';

const Stack = createNativeStackNavigator<MoreStackParamList>();

export function MoreStack() {
  const motion = useStackMotion();
  const { t } = useTranslation('navigation');
  const debugEnabled = useDebugMenuEnabled();
  return (
    <Stack.Navigator screenOptions={motion}>
      <Stack.Screen
        name="MoreHome"
        getComponent={() => MoreHomeScreen}
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="Settings"
        getComponent={() => SettingsScreen}
        options={{ title: t('screens.settings') }}
      />
      <Stack.Screen
        name="SettingsProfile"
        getComponent={() => SettingsProfileScreen}
        options={{ title: t('screens.settingsProfile') }}
      />
      <Stack.Screen
        name="AlphaFeedback"
        getComponent={() => AlphaFeedbackScreen}
        options={{ title: t('screens.alphaFeedback') }}
      />
      <Stack.Screen
        name="HydrationTracker"
        getComponent={() => HydrationTrackerScreen}
        options={{ title: t('screens.hydration') }}
      />
      <Stack.Screen
        name="FastingTracker"
        getComponent={() => FastingTrackerScreen}
        options={{ title: t('screens.fasting') }}
      />
      <Stack.Screen
        name="BudgetDashboard"
        getComponent={() => BudgetDashboardScreen}
        options={{ title: t('screens.budget') }}
      />
      <Stack.Screen
        name="BudgetSettings"
        getComponent={() => BudgetSettingsScreen}
        options={{ title: t('screens.budgetSettings') }}
      />
      <Stack.Screen
        name="WeightLog"
        getComponent={() => WeightLogScreen}
        options={{ title: t('screens.weightLog') }}
      />
      <Stack.Screen
        name="SettingsNotifications"
        getComponent={() => SettingsNotificationsScreen}
        options={{ title: t('screens.settingsNotifications') }}
      />
      <Stack.Screen
        name="RamadanPlanner"
        getComponent={() => RamadanPlannerScreen}
        options={{ title: t('screens.ramadanPlanner') }}
      />
      <Stack.Screen
        name="Subscription"
        getComponent={() => SubscriptionScreen}
        options={{ title: t('screens.subscription') }}
      />
      <Stack.Screen
        name="SettingsMemory"
        getComponent={() => MemoryManagementScreen}
        options={{ title: t('screens.settingsMemory') }}
      />
      <Stack.Screen
        name="SettingsPrivacy"
        getComponent={() => PrivacySettingsScreen}
        options={{ title: t('screens.settingsPrivacy') }}
      />
      <Stack.Screen
        name="DeleteAccount"
        getComponent={() => DeleteAccountScreen}
        options={{ title: t('screens.deleteAccount') }}
      />
      <Stack.Screen
        name="HelpCenter"
        getComponent={() => HelpCenterScreen}
        options={{ title: t('screens.helpCenter') }}
      />
      <Stack.Screen
        name="HelpArticle"
        getComponent={() => HelpArticleScreen}
        options={{ title: t('screens.helpArticle') }}
      />
      <Stack.Screen
        name="ContactSupport"
        getComponent={() => ContactSupportScreen}
        options={{ title: t('screens.contactSupport') }}
      />
      <Stack.Screen
        name="About"
        getComponent={() => AboutScreen}
        options={{ title: t('screens.about') }}
      />
      <Stack.Screen
        name="Exports"
        getComponent={() => ExportsScreen}
        options={{ title: t('screens.exports') }}
      />
      <Stack.Screen
        name="NutritionInsights"
        getComponent={() => NutritionInsightsScreen}
        options={{ title: t('screens.insights') }}
      />
      {debugEnabled ? (
        <Stack.Screen
          name="Debug"
          getComponent={() => DebugScreen}
          options={{ title: t('screens.debug') }}
        />
      ) : null}
    </Stack.Navigator>
  );
}
