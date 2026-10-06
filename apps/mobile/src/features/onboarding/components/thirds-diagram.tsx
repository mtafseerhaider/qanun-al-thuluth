import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { cn } from '@/theme/cn';

/** Static demo of the rule of thirds (02 §7.2.2 `ThuluthMeter` demo): food, drink, breath. */
export function ThirdsDiagram() {
  const { t } = useTranslation('onboarding');
  const parts = [
    { key: 'food', className: 'bg-plate-protein' },
    { key: 'drink', className: 'bg-water' },
    { key: 'breath', className: 'bg-plate-space' },
  ] as const;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={t('philosophy.thirdsA11y')}
      className="gap-2"
      testID="onboarding-philosophy.thirds"
    >
      <View className="h-12 flex-row overflow-hidden rounded-md border-hairline border-line-strong">
        {parts.map((p) => (
          <View key={p.key} className={cn('flex-1', p.className)} />
        ))}
      </View>
      <View className="flex-row">
        {parts.map((p) => (
          <Text key={p.key} variant="label" align="center" className="flex-1">
            {t(`philosophy.thirds.${p.key}`)}
          </Text>
        ))}
      </View>
    </View>
  );
}
