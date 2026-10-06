import type { ReactNode } from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { cn } from '@/theme/cn';
import type { ColorToken } from '@/theme/tokens';
import { useThemeColors } from '@/theme/use-theme-colors';

import type { BaseProps } from './types';

export interface ProgressRingProps extends BaseProps {
  /** 0..1; values above 1 render a full ring plus a thin overflow arc (03 §10.4, no celebration). */
  value: number;
  size?: number;
  strokeWidth?: number;
  /** Colour token for the arc, e.g. `water` for hydration or `secondary` for fasting. */
  tone?: ColorToken;
  /** Dims the arc (fasting state of HydrationRing). */
  dimmed?: boolean;
  centerSlot?: ReactNode;
  /** Required: the value as text, e.g. "Water: 1.2 of 1.8 litres" (08 §4.8). */
  accessibilityLabel: string;
}

/**
 * ProgressRing (08 §4.8): an arc on a `surface-sunken` track. Drawn with react-native-svg; the arc
 * starts at the top and runs clockwise in both directions (charts keep their direction in RTL,
 * 08 §10). Static (no animation yet), which also satisfies reduce motion and sensory-calm.
 */
export function ProgressRing({
  value,
  size = 120,
  strokeWidth = 10,
  tone = 'water',
  dimmed = false,
  centerSlot,
  accessibilityLabel,
  className,
  testID,
}: ProgressRingProps) {
  const colors = useThemeColors();
  const safe = Number.isFinite(value) ? Math.max(0, value) : 0;
  const main = Math.min(1, safe);
  const overflow = Math.min(1, Math.max(0, safe - 1));
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  const center = size / 2;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(main * 100) }}
      style={{ width: size, height: size }}
      className={cn('items-center justify-center', className)}
      {...(testID ? { testID } : {})}
    >
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        <Circle
          cx={center}
          cy={center}
          r={r}
          stroke={colors['surface-sunken']}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {main > 0 ? (
          <Circle
            cx={center}
            cy={center}
            r={r}
            stroke={colors[tone]}
            strokeOpacity={dimmed ? 0.45 : 1}
            strokeWidth={strokeWidth}
            strokeDasharray={`${c * main} ${c}`}
            strokeLinecap="round"
            fill="none"
            transform={`rotate(-90 ${center} ${center})`}
          />
        ) : null}
        {overflow > 0 ? (
          <Circle
            cx={center}
            cy={center}
            r={Math.max(1, r - strokeWidth)}
            stroke={colors[tone]}
            strokeOpacity={0.6}
            strokeWidth={Math.max(2, strokeWidth / 4)}
            strokeDasharray={`${2 * Math.PI * Math.max(1, r - strokeWidth) * overflow} ${c}`}
            fill="none"
            transform={`rotate(-90 ${center} ${center})`}
          />
        ) : null}
      </Svg>
      {centerSlot}
    </View>
  );
}
