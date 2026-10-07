import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';

/**
 * "We'll be right back" (19 §11 `app.maintenance`): shown while the kill switch is on, or after an
 * Edge Function answered FEATURE_DISABLED with details.reason 'maintenance'.
 */
export function MaintenanceScreen({
  onRetry,
  retrying = false,
}: {
  onRetry: () => void;
  retrying?: boolean;
}) {
  const { t } = useTranslation('common');
  return (
    <Screen
      title={t('appStatus.maintenance.title')}
      edges={['top', 'bottom']}
      testID="app-status.maintenance.screen"
    >
      <Text>{t('appStatus.maintenance.body')}</Text>
      <Button
        label={t('appStatus.maintenance.retry')}
        variant="secondary"
        fullWidth
        loading={retrying}
        onPress={onRetry}
        testID="app-status.maintenance.retry"
      />
    </Screen>
  );
}
