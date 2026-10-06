import { useTranslation } from 'react-i18next';

import { PlaceholderScreen } from '@/components/layout/placeholder-screen';

/** Sprint 0 placeholder for `FamilyManagement` (02 §3.2). */
export function FamilyManagementScreen() {
  const { t } = useTranslation(['navigation', 'common']);
  return (
    <PlaceholderScreen
      title={t('navigation:screens.familyManagement')}
      body={t('common:comingSoon')}
      testID="family-management.screen"
    />
  );
}
