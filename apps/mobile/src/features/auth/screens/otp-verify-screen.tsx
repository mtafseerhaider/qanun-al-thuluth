import { useTranslation } from 'react-i18next';

import { PlaceholderScreen } from '@/components/layout/placeholder-screen';

/** B4 placeholder. */
export function OtpVerifyScreen() {
  const { t } = useTranslation(['auth', 'common']);
  return (
    <PlaceholderScreen
      title={t('auth:otp.title')}
      body={t('common:comingSoon')}
      testID="auth-otp-verify.screen"
    />
  );
}
