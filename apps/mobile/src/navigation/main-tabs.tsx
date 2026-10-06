import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTranslation } from 'react-i18next';

import { useUiScript } from '@/hooks/use-ui-script';
import { fontFamilies } from '@/theme/tokens';
import { useThemeColors } from '@/theme/use-theme-colors';

import { ChatStack } from './stacks/chat-stack';
import { FamilyStack } from './stacks/family-stack';
import { MoreStack } from './stacks/more-stack';
import { PlanStack } from './stacks/plan-stack';
import { TodayStack } from './stacks/today-stack';
import type { MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

/** Five tabs from 02 §3.2. Labels are always visible; icons arrive with the icon set in Sprint 1. */
export function MainTabs() {
  const { t } = useTranslation('navigation');
  const colors = useThemeColors();
  const script = useUiScript();

  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors['ink-muted'],
        tabBarStyle: { backgroundColor: colors['surface-raised'], borderTopColor: colors.line },
        tabBarIconStyle: { display: 'none' },
        tabBarLabelStyle:
          script === 'urdu'
            ? { fontFamily: fontFamilies.urdu[400], fontSize: 14, lineHeight: 28, paddingTop: 2 }
            : { fontFamily: fontFamilies.ui[500], fontSize: 13 },
        tabBarLabelPosition: 'below-icon',
      }}
    >
      <Tab.Screen
        name="TodayTab"
        component={TodayStack}
        options={{ title: t('tabs.today'), tabBarButtonTestID: 'tab.today' }}
      />
      <Tab.Screen
        name="PlanTab"
        component={PlanStack}
        options={{ title: t('tabs.plan'), tabBarButtonTestID: 'tab.plan' }}
      />
      <Tab.Screen
        name="ChatTab"
        component={ChatStack}
        options={{ title: t('tabs.chat'), tabBarButtonTestID: 'tab.chat' }}
      />
      <Tab.Screen
        name="FamilyTab"
        component={FamilyStack}
        options={{ title: t('tabs.family'), tabBarButtonTestID: 'tab.family' }}
      />
      <Tab.Screen
        name="MoreTab"
        component={MoreStack}
        options={{ title: t('tabs.more'), tabBarButtonTestID: 'tab.more' }}
      />
    </Tab.Navigator>
  );
}
