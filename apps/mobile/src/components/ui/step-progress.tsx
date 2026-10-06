import { View } from 'react-native';

import { cn } from '@/theme/cn';

import { Text } from './text';
import type { BaseProps } from './types';

export interface StepProgressProps extends BaseProps {
  current: number;
  total: number;
  /** Already-translated "Step 2 of 5". */
  label: string;
}

/** Wizard progress: segments fill from the start edge, so RTL fills from the right (FR-L10N-09). */
export function StepProgress({ current, total, label, className, testID }: StepProgressProps) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 1, max: total, now: current }}
      className={cn('gap-2', className)}
      {...(testID ? { testID } : {})}
    >
      <View className="flex-row gap-1">
        {Array.from({ length: total }, (_, i) => (
          <View
            key={i}
            className={cn('h-1.5 flex-1 rounded-full', i < current ? 'bg-primary' : 'bg-line')}
          />
        ))}
      </View>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
    </View>
  );
}
