import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { AcceptanceScore, MealStatus } from '@shared';

import { Chip } from '@/components/ui/chip';
import { Text } from '@/components/ui/text';

import type { Adaptation } from '../api/meals-api';
import { isMinorStage, MEAL_STATUS_OPTIONS, type MemberLite } from '../utils/meal-rules';
import { AcceptanceScorePicker } from './acceptance-score-picker';
import { AdaptationBadge, QueuedBadge } from './meal-badges';

/**
 * One member's serving with status chips (08 §5.6, 02 §7.5.2). Children see the household measure
 * and "Seconds welcome" only: grams and kcal are never passed for them (02 §1.1). The acceptance
 * picker shows for children once the serving is logged (24 S3-12).
 */
export function MealServingRow({
  member,
  portionLabel,
  adaptation,
  adaptedMealTitle,
  status,
  acceptance,
  showAcceptance,
  queued,
  onStatusChange,
  onAcceptanceChange,
  disabled = false,
  testID,
}: {
  member: MemberLite;
  portionLabel: string | null;
  adaptation: Adaptation;
  adaptedMealTitle?: string | null;
  status: MealStatus;
  acceptance: AcceptanceScore | null;
  showAcceptance: boolean;
  queued: boolean;
  onStatusChange: (status: MealStatus) => void;
  onAcceptanceChange?: (score: AcceptanceScore) => void;
  disabled?: boolean;
  testID: string;
}) {
  const { t } = useTranslation('meals');
  const minor = isMinorStage(member.lifeStage);
  const groupLabel = t('serving.statusGroup', { name: member.name });
  return (
    <View className="gap-2 border-t border-line pt-3" testID={testID}>
      <View className="flex-row flex-wrap items-center gap-2">
        <Text variant="bodyStrong">{member.name}</Text>
        {adaptation !== 'none' ? (
          <AdaptationBadge adaptation={adaptation} testID={`${testID}.adaptation`} />
        ) : null}
        {queued ? <QueuedBadge testID={`${testID}.queued`} /> : null}
      </View>
      {portionLabel ? <Text testID={`${testID}.portion`}>{portionLabel}</Text> : null}
      {adaptedMealTitle ? (
        <Text variant="caption" tone="muted">
          {t('serving.adaptedMeal', { title: adaptedMealTitle })}
        </Text>
      ) : null}
      {minor ? (
        <Text variant="caption" tone="muted" testID={`${testID}.seconds`}>
          {t('serving.secondsWelcome')}
        </Text>
      ) : null}
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={groupLabel}
        className="flex-row flex-wrap gap-2"
      >
        {MEAL_STATUS_OPTIONS.map((s) => (
          <Chip
            key={s}
            label={t(`status.${s}`)}
            selected={status === s}
            role="radio"
            disabled={disabled}
            onPress={() => onStatusChange(status === s ? 'planned' : s)}
            testID={`${testID}.status.${s}`}
          />
        ))}
      </View>
      {showAcceptance && status !== 'planned' && onAcceptanceChange ? (
        <AcceptanceScorePicker
          value={acceptance}
          onChange={onAcceptanceChange}
          label={t('acceptance.question', { name: member.name })}
          readOnly={disabled}
          testID={`${testID}.acceptance`}
        />
      ) : null}
    </View>
  );
}
