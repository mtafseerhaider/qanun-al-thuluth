import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { PlanStatus } from '@shared';

import { Text } from '@/components/ui/text';
import { cn } from '@/theme/cn';

/** Plan status pill (02 §7.6.1). Calm tones only: a failed plan is neutral, never red. */
export function PlanStatusChip({ status, testID }: { status: PlanStatus; testID?: string }) {
  const { t } = useTranslation('plan');
  return (
    <View
      className={cn(
        'self-start rounded-full border px-2 py-0.5',
        status === 'active' && 'border-primary bg-primary-soft',
        (status === 'generating' || status === 'draft') && 'border-info bg-info-soft',
        (status === 'completed' || status === 'archived' || status === 'failed') &&
          'border-line-strong bg-surface-sunken',
      )}
      {...(testID ? { testID } : {})}
    >
      <Text variant="caption" tone={status === 'active' ? 'primary' : 'neutral'}>
        {t(`status.${status}`)}
      </Text>
    </View>
  );
}
