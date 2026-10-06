import { useTranslation } from 'react-i18next';

import { PlaceholderScreen } from '@/components/layout/placeholder-screen';

/** O1 placeholder. */
export function OnboardingWelcomeScreen() {
  const { t } = useTranslation(['onboarding', 'common']);
  return (
    <PlaceholderScreen
      title={t('onboarding:welcome.title')}
      body={t('common:comingSoon')}
      testID="onboarding-welcome.screen"
    />
  );
}
