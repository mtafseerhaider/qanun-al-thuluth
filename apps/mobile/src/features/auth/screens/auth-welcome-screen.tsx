import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { isDevelopment } from '@/lib/env';
import type { AuthScreenProps } from '@/navigation/types';
import { useSessionStore } from '@/stores/use-session-store';

/** B2 placeholder. Real sign-in arrives in Sprint 1; development builds get a guest shortcut. */
export function AuthWelcomeScreen({ navigation }: AuthScreenProps<'AuthWelcome'>) {
  const { t } = useTranslation(['auth', 'common']);
  const enterDevGuest = useSessionStore((s) => s.enterDevGuest);

  return (
    <Screen
      edges={['top', 'bottom']}
      testID="auth-welcome.screen"
      contentClassName="flex-grow justify-center"
    >
      <View className="gap-3">
        <Text variant="display" accessibilityRole="header">
          {t('auth:welcome.title')}
        </Text>
        <Text tone="muted">{t('auth:welcome.body')}</Text>
        <Text variant="caption" tone="subtle">
          {t('common:tagline')}
        </Text>
      </View>
      <View className="gap-3">
        <Button
          label={t('auth:welcome.getStarted')}
          onPress={() => navigation.navigate('Login', { mode: 'sign_up' })}
          testID="auth-welcome.get-started-button"
          fullWidth
        />
        <Button
          label={t('auth:welcome.signIn')}
          variant="secondary"
          onPress={() => navigation.navigate('Login', { mode: 'sign_in' })}
          testID="auth-welcome.sign-in-button"
          fullWidth
        />
        {isDevelopment && __DEV__ ? (
          <Button
            label={t('auth:welcome.devGuest')}
            accessibilityHint={t('auth:welcome.devGuestHint')}
            variant="ghost"
            onPress={enterDevGuest}
            testID="auth-welcome.dev-guest-button"
            fullWidth
          />
        ) : null}
      </View>
    </Screen>
  );
}
