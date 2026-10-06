import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import type { AcceptanceScore } from '@shared';

import { Text } from '@/components/ui/text';
import { cn } from '@/theme/cn';

import { ACCEPTANCE_OPTIONS } from '../utils/meal-rules';

/**
 * Acceptance score for a child's serving (08 §5.7, 02 §8.2, FR-TRK-04). Words describe the food
 * experience, never the child ("Not today", not "Refused"); no faces and no red-to-green scale:
 * the selected option uses the calm primary tint (03 §3.5).
 */
export function AcceptanceScorePicker({
  value,
  onChange,
  label,
  readOnly = false,
  testID = 'acceptance',
}: {
  value: AcceptanceScore | null;
  onChange: (score: AcceptanceScore) => void;
  /** Already-translated group label, e.g. "How did it go for Maryam?" */
  label: string;
  readOnly?: boolean;
  testID?: string;
}) {
  const { t } = useTranslation('meals');
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      className="gap-2"
      testID={testID}
    >
      <Text variant="label" tone="muted">
        {label}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        {ACCEPTANCE_OPTIONS.map((score) => {
          const selected = value === score;
          const word = t(`acceptance.${score}`);
          return (
            <Pressable
              key={score}
              onPress={readOnly ? undefined : () => onChange(score)}
              disabled={readOnly}
              accessibilityRole="radio"
              accessibilityLabel={word}
              accessibilityState={{ selected, checked: selected, disabled: readOnly }}
              hitSlop={4}
              className={cn(
                'min-h-control-sm justify-center rounded-full border px-3 py-1',
                selected
                  ? 'border-primary bg-primary-soft'
                  : 'border-line-strong bg-surface-raised',
              )}
              testID={`${testID}.${score}`}
            >
              <Text variant="label" tone={selected ? 'primary' : 'neutral'}>
                {word}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
