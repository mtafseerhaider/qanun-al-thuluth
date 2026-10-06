import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ADULT_STOP_POINT_PERCENT, FLUID_TIMING, MEAL_DURATION_MINUTES } from '@shared';

import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';

/**
 * Thuluth guidance per main meal (24 S3-10, FR-PLAN-08, 00 §2). Two variants as a discriminated
 * union so the child variant cannot be given adult-only inputs:
 *
 * - `adult`: water timing (20 to 30 min before, sips during, freely 30 to 60 min after), a
 *   20-minute pace, and the stop point at about 70 to 80 percent full with the self-check question.
 * - `child`: rhythm and mindful eating only (meal time, sitting together, Bismillah, slowing down,
 *   seconds welcome). It never mentions stopping, fullness, restriction or any number (02 §1.1,
 *   13 §11 rule 6).
 */
export type ThuluthGuidanceProps =
  | { variant: 'adult'; compact?: boolean; testID?: string }
  | { variant: 'child'; compact?: boolean; testID?: string };

export function ThuluthGuidance(props: ThuluthGuidanceProps) {
  return props.variant === 'adult' ? (
    <AdultGuidance compact={props.compact ?? false} testID={props.testID ?? 'guidance.adult'} />
  ) : (
    <ChildGuidance compact={props.compact ?? false} testID={props.testID ?? 'guidance.child'} />
  );
}

function AdultGuidance({ compact, testID }: { compact: boolean; testID: string }) {
  const { t } = useTranslation('meals');
  const lines = [
    t('guidance.adult.waterBefore', {
      min: FLUID_TIMING.preMealMinutes.min,
      max: FLUID_TIMING.preMealMinutes.max,
    }),
    t('guidance.adult.sipsDuring'),
    t('guidance.adult.waterAfter', {
      min: FLUID_TIMING.postMealMinutes.min,
      max: FLUID_TIMING.postMealMinutes.max,
    }),
    t('guidance.adult.pace', { minutes: MEAL_DURATION_MINUTES }),
    t('guidance.adult.stopPoint', {
      min: ADULT_STOP_POINT_PERCENT.min,
      max: ADULT_STOP_POINT_PERCENT.max,
    }),
  ];
  return (
    <Card variant="filled" padding="sm" testID={testID}>
      <Text variant="overline" tone="muted">
        {t('guidance.adult.title')}
      </Text>
      {(compact ? lines.slice(0, 1) : lines).map((line, i) => (
        <Text key={i} variant="caption" testID={`${testID}.line-${i}`}>
          {line}
        </Text>
      ))}
      {compact ? null : (
        <View className="gap-1">
          <Text variant="bodyStrong" testID={`${testID}.check`}>
            {t('guidance.adult.checkQuestion')}
          </Text>
          <Text variant="caption" tone="muted">
            {t('guidance.adult.seconds')}
          </Text>
        </View>
      )}
    </Card>
  );
}

function ChildGuidance({ compact, testID }: { compact: boolean; testID: string }) {
  const { t } = useTranslation('meals');
  const lines = [
    t('guidance.child.together'),
    t('guidance.child.bismillah'),
    t('guidance.child.water'),
    t('guidance.child.slow'),
    t('guidance.child.seconds'),
  ];
  return (
    <Card variant="filled" padding="sm" testID={testID}>
      <Text variant="overline" tone="muted">
        {t('guidance.child.title')}
      </Text>
      {(compact ? lines.slice(0, 2) : lines).map((line, i) => (
        <Text key={i} variant="caption" testID={`${testID}.line-${i}`}>
          {line}
        </Text>
      ))}
    </Card>
  );
}
