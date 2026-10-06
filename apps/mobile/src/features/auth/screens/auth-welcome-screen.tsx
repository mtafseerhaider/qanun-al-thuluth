import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { LanguageToggle } from '@/features/settings';
import { track } from '@/lib/analytics/track';
import { isDevelopment } from '@/lib/env';
import type { AuthScreenProps } from '@/navigation/types';
import { useSessionStore } from '@/stores/use-session-store';

import { InviteBanner } from '../components/invite-banner';

/** B2 Auth Welcome (02 §7.1.2). Development builds keep the Sprint 0 guest shortcut. */
export function AuthWelcomeScreen({ navigation }: AuthScreenProps<'AuthWelcome'>) {
  const { t } = useTranslation(['auth', 'common']);
  const enterDevGuest = useSessionStore((s) => s.enterDevGuest);

  return (
    <Screen
      edges={['top', 'bottom']}
      testID="auth-welcome.screen"
      contentClassName="flex-grow justify-between"
    >
      <LanguageToggle compact />
      <View className="gap-3">
        <InviteBanner />
        <Text variant="display" accessibilityRole="header">
          {t('auth:welcome.title')}
        </Text>
        <Text tone="muted">{t('auth:welcome.body')}</Text>
      </View>
      <View className="gap-3">
        <Button
          label={t('auth:welcome.getStarted')}
          onPress={() => {
            track('auth_welcome_cta', { cta: 'get_started' });
            navigation.navigate('Login', { mode: 'sign_up' });
          }}
          size="lg"
          testID="auth-welcome.get-started-button"
          fullWidth
        />
        <Button
          label={t('auth:welcome.signIn')}
          variant="secondary"
          size="lg"
          onPress={() => {
            track('auth_welcome_cta', { cta: 'sign_in' });
            navigation.navigate('Login', { mode: 'sign_in' });
          }}
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
        <Text variant="caption" tone="subtle" align="center">
          {t('auth:welcome.legal')}
        </Text>
      </View>
    </Screen>
  );
}
