import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';

/**
 * Plate method (00 §2 rule 1, 02 §7.2.2 `PlateDiagram`): half vegetables and fruit, a quarter
 * protein, a quarter whole grains. Drawn with views so it mirrors in RTL; full text alternative.
 */
export function PlateDiagram() {
  const { t } = useTranslation('onboarding');
  return (
    <View className="gap-3" testID="onboarding-philosophy.plate">
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={t('philosophy.plateA11y')}
        style={{ width: 160, height: 160 }}
        className="flex-row self-center overflow-hidden rounded-full border-2 border-line-strong"
      >
        <View className="flex-1 bg-plate-veg" />
        <View className="flex-1">
          <View className="flex-1 bg-plate-protein" />
          <View className="flex-1 bg-plate-carb" />
        </View>
      </View>
      <View className="gap-1">
        <Text variant="caption">{t('philosophy.plate.veg')}</Text>
        <Text variant="caption">{t('philosophy.plate.protein')}</Text>
        <Text variant="caption">{t('philosophy.plate.carb')}</Text>
      </View>
    </View>
  );
}
