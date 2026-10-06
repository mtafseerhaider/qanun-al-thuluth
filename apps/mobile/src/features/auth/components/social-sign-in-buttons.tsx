import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { InlineMessage } from '@/components/ui/inline-message';
import { Text } from '@/components/ui/text';
import { AppleSignInButton } from '@/lib/auth/apple-sign-in-button';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import { useResolvedScheme } from '@/theme/use-theme-colors';

import { useSocialSignIn } from '../hooks/use-social-sign-in';

/** Apple first, then Google on iOS; Google only on Android (11 §5 rules). Renders nothing if neither. */
export function SocialSignInButtons() {
  const { t } = useTranslation(['auth', 'errors']);
  const scheme = useResolvedScheme();
  const { googleAvailable, appleAvailable, busy, error, signIn } = useSocialSignIn();
  if (!googleAvailable && !appleAvailable) return null;

  return (
    <View className="gap-3" testID="auth-login.social">
      <View className="flex-row items-center gap-3">
        <View className="h-0.5 flex-1 bg-line" />
        <Text variant="caption" tone="muted">
          {t('auth:login.or')}
        </Text>
        <View className="h-0.5 flex-1 bg-line" />
      </View>
      {appleAvailable ? (
        <AppleSignInButton
          dark={scheme === 'dark'}
          onPress={() => void signIn('apple')}
          testID="auth-login.apple-button"
        />
      ) : null}
      {googleAvailable ? (
        <Button
          label={t('auth:login.google')}
          variant="secondary"
          loading={busy === 'google'}
          disabled={busy !== null}
          onPress={() => void signIn('google')}
          testID="auth-login.google-button"
          fullWidth
        />
      ) : null}
      {error ? <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(error)}`)} /> : null}
    </View>
  );
}
