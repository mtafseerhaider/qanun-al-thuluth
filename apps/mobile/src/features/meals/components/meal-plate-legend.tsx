import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';

import { PlateMini } from './meal-badges';

/** Hero plate with a text legend (02 §7.5.3 region 1); fractions as plain words, not targets. */
export function MealPlateLegend({
  split,
}: {
  split: { veg_fruit: number; protein: number; carb: number };
}) {
  const { t } = useTranslation('meals');
  return (
    <View className="flex-row items-center gap-4" testID="meal-plate">
      <PlateMini split={split} size={96} />
      <View className="flex-1 gap-1">
        <Text variant="caption">{t('plate.veg')}</Text>
        <Text variant="caption">{t('plate.protein')}</Text>
        <Text variant="caption">{t('plate.carb')}</Text>
      </View>
    </View>
  );
}
