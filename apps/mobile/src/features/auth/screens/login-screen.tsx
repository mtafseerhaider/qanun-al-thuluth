import { useTranslation } from 'react-i18next';

import { PlaceholderScreen } from '@/components/layout/placeholder-screen';

/** B3 placeholder (email OTP sign-in arrives in Sprint 1). */
export function LoginScreen() {
  const { t } = useTranslation(['auth', 'common']);
  return (
    <PlaceholderScreen
      title={t('auth:login.title')}
      body={t('common:comingSoon')}
      testID="auth-login.screen"
    />
  );
}
