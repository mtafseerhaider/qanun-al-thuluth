import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { MealStatus } from '@shared';

import { Text } from '@/components/ui/text';
import { cn } from '@/theme/cn';

import type { Adaptation } from '../api/meals-api';

/** Small status pill. Tone is never red for food (03 §3.5). */
export function Badge({
  label,
  tone = 'neutral',
  testID,
}: {
  label: string;
  tone?: 'neutral' | 'primary' | 'info';
  testID?: string | undefined;
}) {
  return (
    <View
      className={cn(
        'self-start rounded-full border px-2 py-0.5',
        tone === 'primary' && 'border-primary bg-primary-soft',
        tone === 'info' && 'border-info bg-info-soft',
        tone === 'neutral' && 'border-line-strong bg-surface-sunken',
      )}
      {...(testID ? { testID } : {})}
    >
      <Text variant="caption" tone={tone === 'primary' ? 'primary' : 'neutral'}>
        {label}
      </Text>
    </View>
  );
}

/** Adaptation reason badge (02 §7.5.3: autism, picky, allergy, pregnancy). */
export function AdaptationBadge({
  adaptation,
  testID,
}: {
  adaptation: Exclude<Adaptation, 'none'>;
  testID?: string;
}) {
  const { t } = useTranslation('meals');
  return <Badge label={t(`adaptation.${adaptation}`)} tone="info" testID={testID} />;
}

/** "Saved on this device, will sync" (09 §4.4, 02 §4.1 `QueuedBadge`). */
export function QueuedBadge({ testID = 'queued' }: { testID?: string }) {
  const { t } = useTranslation('meals');
  return <Badge label={t('queued')} testID={testID} />;
}

const GLYPH: Record<MealStatus, string> = {
  planned: '○',
  eaten: '✓',
  partly_eaten: '◐',
  skipped: '–',
  swapped: '⇄',
};

/** Status glyph with its word for assistive tech (03 §3.5: neutral colours, no red X). */
export function StatusGlyph({ status, name }: { status: MealStatus; name: string }) {
  const { t } = useTranslation('meals');
  return (
    <View
      accessible
      accessibilityLabel={t('serving.statusA11y', { name, status: t(`status.${status}`) })}
      className="flex-row items-center gap-1"
    >
      <Text
        variant="caption"
        tone={status === 'eaten' ? 'success' : status === 'swapped' ? 'info' : 'muted'}
      >
        {GLYPH[status]}
      </Text>
      <Text variant="caption" tone="muted">
        {name}
      </Text>
    </View>
  );
}

/** Plate split as a tiny diagram (03 §10.4 `PlateDiagram` size 32); text alternative included. */
export function PlateMini({
  split,
  size = 32,
}: {
  split: { veg_fruit: number; protein: number; carb: number };
  size?: number;
}) {
  const { t } = useTranslation('meals');
  const pct = (x: number) => Math.round(x * 100);
  const rest = split.protein + split.carb || 1;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={t('plateA11y', {
        veg: pct(split.veg_fruit),
        protein: pct(split.protein),
        carb: pct(split.carb),
      })}
      style={{ width: size, height: size }}
      className="flex-row overflow-hidden rounded-full border border-line-strong"
    >
      <View style={{ flex: Math.max(split.veg_fruit, 0.01) }} className="bg-plate-veg" />
      <View style={{ flex: Math.max(rest, 0.01) }}>
        <View style={{ flex: Math.max(split.protein, 0.01) }} className="bg-plate-protein" />
        <View style={{ flex: Math.max(split.carb, 0.01) }} className="bg-plate-carb" />
      </View>
    </View>
  );
}
