import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ProgressRing } from '@/components/ui/progress-ring';
import { Text } from '@/components/ui/text';
import type { BaseProps } from '@/components/ui/types';

import { mlToCups, targetCups } from '../utils/hydration-rules';

export interface HydrationRingProps extends BaseProps {
  consumedMl: number;
  targetMl: number;
  /** Kid view (FR-HYD-04): the centre shows cups ("4 of 5 cups"), never ml. */
  kid?: boolean;
  /** Fasting today: ring dimmed, "Hydrate between iftar and suhoor" (03 §10.4). */
  fasting?: boolean;
  size?: number;
  /** Shown above the numbers, e.g. a member name. */
  label?: string;
}

/** Litres with one decimal from 1 L, ml below; Western digits in both locales (03 §5.5). */
export function formatVolume(ml: number): { value: string; unit: 'l' | 'ml' } {
  if (ml >= 1000) return { value: (Math.round(ml / 100) / 10).toFixed(1), unit: 'l' };
  return { value: String(Math.round(ml)), unit: 'ml' };
}

/** HydrationRing (08 §5.3, 03 §10.4): ProgressRing in `water` with the amount in the centre. */
export function HydrationRing({
  consumedMl,
  targetMl,
  kid = false,
  fasting = false,
  size = 160,
  label,
  className,
  testID,
}: HydrationRingProps) {
  const { t } = useTranslation('hydration');
  const value = targetMl > 0 ? consumedMl / targetMl : 0;
  const small = size < 80;
  let main: string;
  let sub: string;
  let a11y: string;
  if (kid) {
    const cups = mlToCups(consumedMl);
    const total = targetCups(targetMl);
    main = String(cups);
    sub = t('ring.ofCups', { count: total });
    a11y = t('ring.kidA11y', { name: label ?? '', cups, total });
  } else {
    const c = formatVolume(consumedMl);
    const tgt = formatVolume(targetMl);
    main = t(`unit.${c.unit}`, { value: c.value });
    sub = t('ring.of', { target: t(`unit.${tgt.unit}`, { value: tgt.value }) });
    a11y = t('ring.a11y', {
      name: label ?? '',
      consumed: main,
      target: t(`unit.${tgt.unit}`, { value: tgt.value }),
    });
  }
  return (
    <View className={className ?? 'items-center gap-2'} {...(testID ? { testID } : {})}>
      <ProgressRing
        value={value}
        size={size}
        strokeWidth={small ? 5 : 12}
        tone="water"
        dimmed={fasting}
        accessibilityLabel={a11y}
        centerSlot={
          small ? null : (
            <View className="items-center">
              <Text variant="title" {...(testID ? { testID: `${testID}.value` } : {})}>
                {main}
              </Text>
              <Text variant="caption" tone="muted">
                {sub}
              </Text>
            </View>
          )
        }
        {...(testID ? { testID: `${testID}.ring` } : {})}
      />
      {fasting && !small ? (
        <Text
          variant="caption"
          tone="muted"
          align="center"
          testID={testID ? `${testID}.fasting` : undefined}
        >
          {t('ring.fasting')}
        </Text>
      ) : null}
    </View>
  );
}

/** Cup icons for the kid card (FR-HYD-04 "Child card shows cup icons"). */
export function KidCups({
  consumedMl,
  targetMl,
  testID,
}: {
  consumedMl: number;
  targetMl: number;
  testID?: string;
}) {
  const { t } = useTranslation('hydration');
  const total = Math.min(12, targetCups(targetMl));
  const filled = mlToCups(consumedMl);
  return (
    <View
      accessible
      accessibilityLabel={t('ring.cupsA11y', { cups: filled, total })}
      className="flex-row flex-wrap gap-1"
      {...(testID ? { testID } : {})}
    >
      {Array.from({ length: total }, (_, i) => {
        const state = filled >= i + 1 ? 'full' : filled >= i + 0.5 ? 'half' : 'empty';
        return (
          <View
            key={i}
            className="h-7 w-6 justify-end overflow-hidden rounded-b-md border-2 border-water"
            {...(testID ? { testID: `${testID}.cup-${i}.${state}` } : {})}
          >
            {state !== 'empty' ? (
              <View className="bg-water" style={{ height: state === 'full' ? '100%' : '50%' }} />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
