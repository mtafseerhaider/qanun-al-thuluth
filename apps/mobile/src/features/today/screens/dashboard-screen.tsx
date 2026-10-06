import { useTranslation } from 'react-i18next';

import { PlaceholderScreen } from '@/components/layout/placeholder-screen';

/** Sprint 0 placeholder for `Dashboard` (02 §3.2). */
export function DashboardScreen() {
  const { t } = useTranslation(['navigation', 'common']);
  return (
    <PlaceholderScreen
      title={t('navigation:screens.dashboard')}
      body={t('common:comingSoon')}
      testID="today-dashboard.screen"
    />
  );
}
