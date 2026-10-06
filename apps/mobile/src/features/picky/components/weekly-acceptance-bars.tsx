import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import type { WeekBucket } from '@/features/exposures';

/** Average acceptance (0 to 5) per week as bars, each with a spoken summary (no colour coding). */
export function WeeklyAcceptanceBars({
  weeks,
  testID = 'weekly-bars',
}: {
  weeks: readonly WeekBucket[];
  testID?: string;
}) {
  const { t } = useTranslation('picky');
  return (
    <View className="gap-2" testID={testID}>
      {weeks.map((w) => {
        const total = w.counts.reduce((a, b) => a + b, 0);
        const avg = total === 0 ? null : w.counts.reduce((a, c, i) => a + c * i, 0) / total;
        const label =
          avg === null
            ? t('analytics.weekNone', { week: w.weekStart })
            : t('analytics.weekLine', { week: w.weekStart, count: total, avg: avg.toFixed(1) });
        return (
          <View key={w.weekStart} accessible accessibilityLabel={label} className="gap-1">
            <Text variant="caption" tone="muted">
              {label}
            </Text>
            <View className="h-3 w-full overflow-hidden rounded-full bg-surface-sunken">
              <View
                className="h-3 rounded-full bg-primary"
                style={{ width: `${avg === null ? 0 : Math.round((avg / 5) * 100)}%` }}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}
