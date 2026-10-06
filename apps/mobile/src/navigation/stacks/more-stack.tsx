import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { DebugScreen, useDebugMenuEnabled } from '@/features/debug';
import { MoreHomeScreen, SettingsProfileScreen, SettingsScreen } from '@/features/settings';

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
