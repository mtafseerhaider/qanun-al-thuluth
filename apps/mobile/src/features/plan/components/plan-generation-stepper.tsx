import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { cn } from '@/theme/cn';

import { GENERATION_STAGES, type StageView } from '../utils/generation-rules';

/**
 * `PlanGenerationStepper` (03 §10.4 proposed): six stages, the current one with a calm progress bar.
 * No spinner animation (sensory-calm by default); stage changes are announced politely.
 */
export function PlanGenerationStepper({
  stage,
  testID = 'plan-stepper',
}: {
  stage: StageView;
  testID?: string;
}) {
  const { t } = useTranslation('plan');
  const current = GENERATION_STAGES.indexOf(stage.stage);
  return (
    <View
      className="gap-2"
      accessibilityLiveRegion="polite"
      accessible
      accessibilityLabel={t('generation.stageA11y', {
        stage: t(`generation.stages.${stage.stage}`),
      })}
      testID={testID}
    >
      {GENERATION_STAGES.map((s, i) => (
        <View key={s} className="flex-row items-center gap-3" testID={`${testID}.${s}`}>
          <View
            className={cn(
              'h-3 w-3 rounded-full border',
              i < current && 'border-primary bg-primary',
              i === current && 'border-2 border-primary',
              i > current && 'border-line-strong',
            )}
          />
          <Text
            variant={i === current ? 'bodyStrong' : 'body'}
            tone={i > current ? 'muted' : 'neutral'}
          >
            {t(`generation.stages.${s}`)}
          </Text>
        </View>
      ))}
      <View
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: stage.percent }}
        className="h-2 overflow-hidden rounded-full bg-line"
      >
        <View className="h-2 bg-primary" style={{ width: `${stage.percent}%` }} />
      </View>
    </View>
  );
}

export const TIP_KEYS = ['water', 'plate', 'pace', 'children', 'bismillah', 'seconds'] as const;
const ROTATE_MS = 8_000;

/**
 * One short educational line at a time while the plan is made (02 §7.4.2). Rotation pauses when a
 * screen reader is on; "Next tip" always works.
 */
export function GenerationTips({ testID = 'plan-tips' }: { testID?: string }) {
  const { t } = useTranslation('plan');
  const [index, setIndex] = useState(0);
  const [screenReader, setScreenReader] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isScreenReaderEnabled()
      .then((on) => mounted && setScreenReader(on))
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (screenReader) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % TIP_KEYS.length), ROTATE_MS);
    return () => clearInterval(id);
  }, [screenReader]);

  const key = TIP_KEYS[index] ?? 'water';
  return (
    <Card variant="filled" testID={testID}>
      <Text variant="overline" tone="muted">
        {t('generation.tipTitle')}
      </Text>
      <Text testID={`${testID}.text`}>{t(`generation.tips.${key}`)}</Text>
      <Button
        label={t('generation.nextTip')}
        variant="link"
        size="sm"
        className="self-start px-0"
        onPress={() => setIndex((i) => (i + 1) % TIP_KEYS.length)}
        testID={`${testID}.next`}
      />
    </Card>
  );
}
