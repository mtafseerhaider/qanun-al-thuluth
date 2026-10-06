import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
  checkWeightTarget,
  defaultGoalFor,
  goalOptionsFor,
  MAX_GOALS,
  sanitizeGoals,
  type GoalDraft,
} from '@shared/intake/questions';
import type { GoalType } from '@shared';

import { Checkbox } from '@/components/ui/checkbox';
import { InlineMessage } from '@/components/ui/inline-message';
import { Input } from '@/components/ui/input';
import { RadioCardGroup } from '@/components/ui/radio-card-group';
import { Text } from '@/components/ui/text';
import type { IntakeStackParamList } from '@/navigation/types';

import { saveGoals } from '../api/intake-api';
import { IntakeStepScaffold } from '../components/intake-step-scaffold';
import { useMemberStep } from '../hooks/use-intake-member';
import { newRowId, numberText, parseNumber } from '../utils/form-helpers';

type Props = NativeStackScreenProps<IntakeStackParamList, 'IntakeMemberGoals'>;

const WEIGHT_GOALS: readonly GoalType[] = ['weight_loss', 'weight_gain'];

/**
 * I8 Goals (02 §7.3.8, 01 §7.5, 24 S2-06). Options come from the engine: members under 18 never see
 * weight goals (the server guard also rejects them). Adults may set a target weight; a target under
 * BMI 18.5 is blocked and a pace above 1 percent a week is flagged.
 */
export function IntakeGoalsScreen({ route }: Props) {
  const { familyMemberId } = route.params;
  const { t } = useTranslation('intake');
  const s = useMemberStep('goals', familyMemberId);
  const name = s.member?.name ?? '';
  const ctx = s.ctx;
  const options = ctx ? goalOptionsFor(ctx) : [];
  const stored = s.answers.goals;
  // A draft whose goals are no longer allowed (for example a weight goal on a child) falls back to
  // the life-stage default rather than leaving nothing selected.
  const kept = ctx && stored ? sanitizeGoals(stored, ctx) : [];
  const goals: GoalDraft[] = !ctx
    ? []
    : kept.length > 0 || (stored && stored.length === 0)
      ? kept
      : [{ id: newRowId(), goal_type: defaultGoalFor(ctx), is_primary: true }];
  const [targetText, setTargetText] = useState(() =>
    numberText(goals.find((g) => WEIGHT_GOALS.includes(g.goal_type))?.target_value),
  );
  const [dateText, setDateText] = useState(
    () => goals.find((g) => WEIGHT_GOALS.includes(g.goal_type))?.target_date ?? '',
  );
  const set = (next: GoalDraft[]) => s.update({ goals: ctx ? sanitizeGoals(next, ctx) : next });

  const toggleGoal = (g: GoalType) => {
    const existing = goals.find((x) => x.goal_type === g);
    if (existing) set(goals.filter((x) => x !== existing));
    else if (goals.length < MAX_GOALS)
      set([...goals, { id: newRowId(), goal_type: g, is_primary: goals.length === 0 }]);
  };
  const setPrimary = (g: GoalType) =>
    set(goals.map((x) => ({ ...x, is_primary: x.goal_type === g })));

  const weightGoal = goals.find((g) => WEIGHT_GOALS.includes(g.goal_type));
  const target = weightGoal?.target_value ?? null;
  const check =
    weightGoal && target !== null
      ? checkWeightTarget({
          heightCm: s.member?.height_cm ?? null,
          weightKg: s.member?.weight_kg ?? null,
          targetKg: target,
          targetDate: weightGoal.target_date ?? null,
        })
      : null;

  const setWeightTarget = (patch: Partial<GoalDraft>) =>
    set(goals.map((g) => (g === weightGoal ? { ...g, ...patch } : g)));

  return (
    <IntakeStepScaffold
      memberName={name}
      index={s.index}
      total={s.total}
      score={s.score}
      title={t('goals.title', { name })}
      subtitle={ctx?.minor ? t('goals.childHeader') : t('goals.helper')}
      nextDisabled={goals.length === 0 || Boolean(check?.belowBmiFloor)}
      onNext={() =>
        void s.next(async () => {
          s.update({ goals });
          await saveGoals({ householdId: s.householdId as string, familyMemberId }, goals);
        })
      }
      onBack={s.back}
      onFinishLater={s.finishLater}
      saving={s.saving}
      error={s.error}
      testID="intake-goals.screen"
    >
      <View className="gap-1" testID="intake-goals.options">
        {options.map((g) => (
          <Checkbox
            key={g}
            label={t(`goals.types.${g}.title`)}
            description={t(`goals.types.${g}.description`)}
            checked={goals.some((x) => x.goal_type === g)}
            disabled={!goals.some((x) => x.goal_type === g) && goals.length >= MAX_GOALS}
            onChange={() => toggleGoal(g)}
            testID={`intake-goals.${g}`}
          />
        ))}
      </View>
      {ctx?.minor ? (
        <Text variant="caption" tone="muted" testID="intake-goals.child-weight-note">
          {t('goals.childWeightNote')}
        </Text>
      ) : null}
      {ctx?.eatingConcern ? (
        <InlineMessage tone="info" message={t('goals.eatingConcernNote', { name })} />
      ) : null}
      {goals.length > 1 ? (
        <RadioCardGroup
          label={t('goals.primary')}
          options={goals.map((g) => ({
            value: g.goal_type,
            title: t(`goals.types.${g.goal_type}.title`),
          }))}
          value={goals.find((g) => g.is_primary)?.goal_type ?? null}
          onChange={setPrimary}
          testID="intake-goals.primary"
        />
      ) : null}
      {weightGoal && !ctx?.minor ? (
        <View className="gap-3" testID="intake-goals.target">
          <Input
            label={t('goals.targetWeight')}
            helperText={t('goals.targetHelper')}
            {...(check?.belowBmiFloor ? { errorText: t('goals.bmiFloor') } : {})}
            value={targetText}
            onChangeText={(text) => {
              setTargetText(text);
              const n = parseNumber(text);
              setWeightTarget(
                n === undefined
                  ? { target_value: null, target_unit: null }
                  : { target_value: n, target_unit: 'kg' },
              );
            }}
            variant="numeric"
            unit={t('common.kg')}
            testID="intake-goals.target-weight"
          />
          <Input
            label={t('goals.targetDate')}
            value={dateText}
            onChangeText={(d) => {
              setDateText(d);
              setWeightTarget({ target_date: /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null });
            }}
            placeholder={t('common.datePlaceholder')}
            maxLength={10}
            keyboardType="numbers-and-punctuation"
            testID="intake-goals.target-date"
          />
          {check?.tooFast ? (
            <InlineMessage
              tone="warning"
              message={t('goals.tooFast')}
              testID="intake-goals.too-fast"
            />
          ) : null}
        </View>
      ) : null}
    </IntakeStepScaffold>
  );
}
