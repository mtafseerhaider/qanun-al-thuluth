import { View } from 'react-native';

import { cn } from '@/theme/cn';

import { budgetTone } from '../utils/budget-rules';

const FILL = { success: 'bg-success', warning: 'bg-warning', danger: 'bg-danger' } as const;

/** Spend against a budget (08 §5.11): tone by share spent; a marker shows the forecast. */
export function BudgetBar({
  spentMinor,
  budgetMinor,
  forecastMinor,
  accessibilityLabel,
  testID,
}: {
  spentMinor: number;
  budgetMinor: number;
  forecastMinor?: number;
  accessibilityLabel: string;
  testID?: string;
}) {
  const tone = budgetTone(spentMinor, budgetMinor);
  const pct = budgetMinor > 0 ? Math.min(100, (spentMinor / budgetMinor) * 100) : 0;
  const forecastPct =
    forecastMinor !== undefined && budgetMinor > 0
      ? Math.min(100, (forecastMinor / budgetMinor) * 100)
      : null;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
      className="h-3 overflow-hidden rounded-full bg-surface-sunken"
      {...(testID ? { testID } : {})}
    >
      <View className={cn('h-full rounded-full', FILL[tone])} style={{ width: `${pct}%` }} />
      {forecastPct !== null && forecastPct > pct ? (
        <View
          className="absolute h-full w-0.5 bg-ink-muted"
          style={{ start: `${forecastPct}%` }}
          {...(testID ? { testID: `${testID}.forecast` } : {})}
        />
      ) : null}
    </View>
  );
}
