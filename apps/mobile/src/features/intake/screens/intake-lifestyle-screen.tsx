import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import type { z } from 'zod';

import { FREQUENCY_3, type MemberLifestyle } from '@shared/domain/intake';
import { isQuestionVisible, type QuestionId } from '@shared/intake/questions';
import type { FastKind } from '@shared';

import { Checkbox } from '@/components/ui/checkbox';
import { ChipGroup } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { RadioCardGroup } from '@/components/ui/radio-card-group';
import type { IntakeStackParamList } from '@/navigation/types';

import { saveMemberColumns } from '../api/intake-api';
import { IntakeStepScaffold } from '../components/intake-step-scaffold';
import { useMemberStep } from '../hooks/use-intake-member';
import { numberText, parseInteger, toggle } from '../utils/form-helpers';

type Props = NativeStackScreenProps<IntakeStackParamList, 'IntakeMemberRoutine'>;
type Lifestyle = z.input<typeof MemberLifestyle>;

const PATTERN_MEALS = ['breakfast', 'lunch', 'snack', 'dinner'] as const;
const FASTS: readonly FastKind[] = [
  'ramadan',
  'sunnah_monday_thursday',
  'ayyam_al_bid',
  'arafah',
  'ashura',
  'nafl',
];

const clampInt = (text: string, max: number) => {
  const n = parseInteger(text);
  return n === undefined ? undefined : Math.max(0, Math.min(max, n));
};

/** Lifestyle (01 §7.4) on the I4 Routine route: questions filtered by age (S2-06). */
export function IntakeLifestyleScreen({ route }: Props) {
  const { familyMemberId } = route.params;
  const { t } = useTranslation('intake');
  const s = useMemberStep('lifestyle', familyMemberId);
  const name = s.member?.name ?? '';
  const l: Lifestyle = s.answers.lifestyle ?? {};
  const set = (patch: { [K in keyof Lifestyle]?: Lifestyle[K] | undefined }) => {
    const next = Object.fromEntries(
      Object.entries({ ...l, ...patch }).filter(([, v]) => v !== undefined),
    );
    s.update({ lifestyle: next as Lifestyle });
  };
  const visible = (id: QuestionId) => (s.ctx ? isQuestionVisible(id, s.ctx, s.answers) : false);
  const eatsOut = l.eats_out ?? {};
  const minor = s.ctx?.minor ?? false;

  return (
    <IntakeStepScaffold
      memberName={name}
      index={s.index}
      total={s.total}
      score={s.score}
      title={t('lifestyle.title', { name })}
      subtitle={t('lifestyle.helper')}
      onNext={() => void s.next(() => saveMemberColumns(familyMemberId, { lifestyle: l }))}
      onBack={s.back}
      onFinishLater={s.finishLater}
      saving={s.saving}
      error={s.error}
      testID="intake-lifestyle.screen"
    >
      <ChipGroup
        label={t('lifestyle.mealPattern')}
        options={PATTERN_MEALS.map((m) => ({ value: m, label: t(`meals.${m}`) }))}
        selected={(l.meal_pattern ?? []).map((m) => m.meal)}
        onToggle={(meal) => {
          const current = (l.meal_pattern ?? []).map((m) => m.meal);
          set({ meal_pattern: toggle(current, meal).map((m) => ({ meal: m })) });
        }}
        testID="intake-lifestyle.meal-pattern"
      />
      {visible('lifestyle.eats_out') ? (
        <View className="gap-1" testID="intake-lifestyle.eats-out">
          {minor ? (
            <Checkbox
              label={t('lifestyle.schoolLunch')}
              checked={eatsOut.school_lunch === true}
              onChange={(v) => set({ eats_out: { ...eatsOut, school_lunch: v } })}
              testID="intake-lifestyle.school-lunch"
            />
          ) : (
            <Checkbox
              label={t('lifestyle.officeCanteen')}
              checked={eatsOut.office_canteen === true}
              onChange={(v) => set({ eats_out: { ...eatsOut, office_canteen: v } })}
              testID="intake-lifestyle.office-canteen"
            />
          )}
          <Checkbox
            label={t('lifestyle.packedLunch')}
            checked={eatsOut.packed_lunch === true}
            onChange={(v) => set({ eats_out: { ...eatsOut, packed_lunch: v } })}
            testID="intake-lifestyle.packed-lunch"
          />
          <Input
            label={t('lifestyle.takeaway')}
            value={numberText(eatsOut.takeaway_per_week)}
            onChangeText={(x) =>
              set({ eats_out: { ...eatsOut, takeaway_per_week: clampInt(x, 21) } })
            }
            variant="numeric"
            testID="intake-lifestyle.takeaway"
          />
        </View>
      ) : null}
      {visible('lifestyle.screens') ? (
        <RadioCardGroup
          label={t('lifestyle.screens')}
          options={FREQUENCY_3.map((f) => ({ value: f, title: t(`lifestyle.frequency.${f}`) }))}
          value={l.screens_at_meals ?? null}
          onChange={(screens_at_meals) => set({ screens_at_meals })}
          inline
          testID="intake-lifestyle.screens"
        />
      ) : null}
      {visible('lifestyle.water') ? (
        <Input
          label={t(minor ? 'lifestyle.waterCups' : 'lifestyle.waterGlasses')}
          value={numberText(l.water_glasses_per_day)}
          onChangeText={(x) => set({ water_glasses_per_day: clampInt(x, 30) })}
          variant="numeric"
          testID="intake-lifestyle.water"
        />
      ) : null}
      {visible('lifestyle.caffeine') ? (
        <View className="gap-1">
          <Input
            label={t('lifestyle.tea')}
            value={numberText(l.caffeine?.cups_per_day)}
            onChangeText={(x) => {
              const cups = clampInt(x, 20);
              set({
                caffeine:
                  cups === undefined
                    ? undefined
                    : { cups_per_day: cups, with_meals: l.caffeine?.with_meals ?? false },
              });
            }}
            variant="numeric"
            testID="intake-lifestyle.tea"
          />
          {l.caffeine ? (
            <Checkbox
              label={t('lifestyle.teaWithMeals')}
              checked={l.caffeine.with_meals === true}
              onChange={(v) =>
                set({ caffeine: { cups_per_day: l.caffeine?.cups_per_day ?? 0, with_meals: v } })
              }
              testID="intake-lifestyle.tea-with-meals"
            />
          ) : null}
        </View>
      ) : null}
      {visible('lifestyle.sugary_drinks') ? (
        <Input
          label={t('lifestyle.sugaryDrinks')}
          value={numberText(l.sugary_drinks_per_week)}
          onChangeText={(x) => set({ sugary_drinks_per_week: clampInt(x, 70) })}
          variant="numeric"
          testID="intake-lifestyle.sugary-drinks"
        />
      ) : null}
      {visible('lifestyle.exercise') ? (
        <Input
          label={t(minor ? 'lifestyle.activeplay' : 'lifestyle.exercise')}
          value={numberText(l.exercise_minutes_per_week)}
          onChangeText={(x) => set({ exercise_minutes_per_week: clampInt(x, 3000) })}
          variant="numeric"
          unit={t('common.minutesPerWeek')}
          testID="intake-lifestyle.exercise"
        />
      ) : null}
      {visible('lifestyle.fasting_practice') ? (
        <ChipGroup
          label={t('lifestyle.fasting')}
          hint={t(minor ? 'lifestyle.fastingChildHint' : 'lifestyle.fastingHint')}
          options={FASTS.map((f) => ({ value: f, label: t(`fasts.${f}`) }))}
          selected={l.fasting_practice ?? []}
          onToggle={(f) => set({ fasting_practice: toggle(l.fasting_practice ?? [], f) })}
          testID="intake-lifestyle.fasting"
        />
      ) : null}
    </IntakeStepScaffold>
  );
}
