import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Text } from '@/components/ui/text';
import { moveStep, renumber, type LadderStepDraft } from '@/features/exposures';

/**
 * Step list editor: reorder with buttons (not drag, so it works with a screen reader and switch
 * control), edit what "done" looks like, and remove a step.
 */
export function LadderStepsEditor({
  steps,
  onChange,
  testID = 'ladder-steps',
}: {
  steps: readonly LadderStepDraft[];
  onChange: (steps: LadderStepDraft[]) => void;
  testID?: string;
}) {
  const { t } = useTranslation('autism');
  return (
    <View className="gap-2" testID={testID}>
      {steps.map((s, i) => {
        const name = t('ladder.stepLine', {
          stage: t(`picky:stages.${s.stage}`),
          food: s.foodLabel,
        });
        return (
          <Card
            key={`${s.stepNo}-${s.stage}-${s.foodLabel}`}
            variant="outlined"
            testID={`${testID}.${s.stepNo}`}
          >
            <Text variant="bodyStrong">{t('editor.stepTitle', { n: s.stepNo, name })}</Text>
            <Input
              label={t('editor.criteria')}
              value={s.criteria}
              onChangeText={(criteria) =>
                onChange(steps.map((x, j) => (j === i ? { ...x, criteria } : x)))
              }
              maxLength={500}
              testID={`${testID}.${s.stepNo}.criteria`}
            />
            <View className="flex-row flex-wrap gap-2">
              <Button
                label={t('editor.up')}
                size="sm"
                variant="ghost"
                disabled={i === 0}
                accessibilityLabel={t('editor.upA11y', { name })}
                onPress={() => onChange(moveStep(steps, i, -1))}
                testID={`${testID}.${s.stepNo}.up`}
              />
              <Button
                label={t('editor.down')}
                size="sm"
                variant="ghost"
                disabled={i === steps.length - 1}
                accessibilityLabel={t('editor.downA11y', { name })}
                onPress={() => onChange(moveStep(steps, i, 1))}
                testID={`${testID}.${s.stepNo}.down`}
              />
              <Button
                label={t('editor.removeStep')}
                size="sm"
                variant="ghost"
                disabled={steps.length <= 1}
                accessibilityLabel={t('editor.removeA11y', { name })}
                onPress={() => onChange(renumber(steps.filter((_, j) => j !== i)))}
                testID={`${testID}.${s.stepNo}.remove`}
              />
            </View>
          </Card>
        );
      })}
    </View>
  );
}
