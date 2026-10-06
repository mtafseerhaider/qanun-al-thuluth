import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { medicationFlagsFor } from '@shared/domain/intake';
import {
  COMMON_SUPPLEMENTS,
  conditionByCode,
  MEDICATION_FREQUENCIES,
  searchConditions,
} from '@shared/intake/catalog';
import {
  hasFastingMedicationRisk,
  isQuestionVisible,
  type ListAnswer,
  type MedicationDraft,
  type MemberIntakeAnswers,
  type SupplementDraft,
} from '@shared/intake/questions';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { InlineMessage } from '@/components/ui/inline-message';
import { Input } from '@/components/ui/input';
import { RadioCardGroup } from '@/components/ui/radio-card-group';
import { Text } from '@/components/ui/text';
import type { IntakeStackParamList } from '@/navigation/types';

import { saveHealth } from '../api/intake-api';
import { IntakeStepScaffold } from '../components/intake-step-scaffold';
import { AddTextRow } from '../components/text-list-editor';
import { boolToYesNo, YesNo } from '../components/yes-no';
import { useMemberStep } from '../hooks/use-intake-member';
import { newRowId, numberText, parseInteger, parseNumber } from '../utils/form-helpers';

type Props = NativeStackScreenProps<IntakeStackParamList, 'IntakeMemberHealth'>;

const emptyList = <T,>(): ListAnswer<T> => ({ none: false, items: [] });

/**
 * I5 Health (02 §7.3.5, 24 S2-05): conditions search, medications with interaction flags,
 * supplements, and the red-flag screening questions for this member (01 §7.6).
 */
export function IntakeHealthScreen({ route }: Props) {
  const { familyMemberId } = route.params;
  const { t } = useTranslation('intake');
  const s = useMemberStep('health', familyMemberId);
  const { answers, ctx, member, update } = s;
  const [query, setQuery] = useState('');
  const name = member?.name ?? '';

  const conditions = answers.conditions ?? emptyList();
  const medications = answers.medications ?? emptyList<MedicationDraft>();
  const supplements = answers.supplements ?? emptyList<SupplementDraft>();
  const screening = answers.screening ?? {};
  const setScreening = (patch: MemberIntakeAnswers['screening']) =>
    update({ screening: { ...screening, ...patch } });

  const conditionLabel = (key: string) => t(`conditions.${key}`);
  const matches = searchConditions(query, (c) => conditionLabel(c.key));
  const selectedCodes = new Set(conditions.items.map((c) => c.condition_code).filter(Boolean));

  const toggleCondition = (snomed: string, label: string) => {
    const items = selectedCodes.has(snomed)
      ? conditions.items.filter((c) => c.condition_code !== snomed)
      : [...conditions.items, { id: newRowId(), condition_code: snomed, label }];
    update({ conditions: { none: false, items } });
  };

  const fastingRisk = hasFastingMedicationRisk(answers);
  const visible = (id: Parameters<typeof isQuestionVisible>[0]) =>
    ctx ? isQuestionVisible(id, ctx, answers) : false;

  const weightChange = screening.unintended_weight_change;
  const weightChoice =
    weightChange === undefined ? null : weightChange === null ? ('no' as const) : ('yes' as const);

  const onNext = () =>
    void s.next(async () => {
      const a = answers;
      await saveHealth(
        { householdId: s.householdId as string, familyMemberId },
        {
          conditions: a.conditions?.none ? [] : (a.conditions?.items ?? []),
          medications: a.medications?.none ? [] : (a.medications?.items ?? []),
          supplements: a.supplements?.none ? [] : (a.supplements?.items ?? []),
        },
      );
    });

  return (
    <IntakeStepScaffold
      memberName={name}
      index={s.index}
      total={s.total}
      score={s.score}
      title={t('health.title', { name })}
      subtitle={t('health.helper')}
      onNext={onNext}
      onBack={s.back}
      onFinishLater={s.finishLater}
      saving={s.saving}
      error={s.error}
      testID="intake-health.screen"
    >
      {/* Conditions */}
      <View className="gap-3" testID="intake-health.conditions">
        <Text variant="heading" accessibilityRole="header">
          {t('health.conditions.title')}
        </Text>
        <Checkbox
          label={t('health.conditions.none')}
          checked={conditions.none}
          onChange={(none) => update({ conditions: { none, items: none ? [] : conditions.items } })}
          testID="intake-health.conditions.none"
        />
        {!conditions.none ? (
          <>
            <Input
              label={t('health.conditions.search')}
              value={query}
              onChangeText={setQuery}
              variant="search"
              autoCorrect={false}
              testID="intake-health.conditions.search"
            />
            <View className="flex-row flex-wrap gap-2">
              {matches.map((c) => (
                <Chip
                  key={c.key}
                  label={conditionLabel(c.key)}
                  selected={selectedCodes.has(c.snomed)}
                  onPress={() => toggleCondition(c.snomed, c.label)}
                  testID={`intake-health.condition.${c.key}`}
                />
              ))}
            </View>
            {conditions.items
              .filter((c) => !conditionByCode(c.condition_code))
              .map((c) => (
                <Chip
                  key={c.id}
                  label={c.label}
                  selected
                  onPress={() =>
                    update({
                      conditions: {
                        none: false,
                        items: conditions.items.filter((x) => x.id !== c.id),
                      },
                    })
                  }
                  accessibilityHint={t('common.tapToRemove')}
                />
              ))}
            <AddTextRow
              label={t('health.conditions.other')}
              onAdd={(label) =>
                update({
                  conditions: {
                    none: false,
                    items: [...conditions.items, { id: newRowId(), condition_code: null, label }],
                  },
                })
              }
              testID="intake-health.conditions.other"
            />
          </>
        ) : null}
        {fastingRisk ? (
          <InlineMessage
            tone="info"
            message={t('health.fastingRiskBanner', { name })}
            testID="intake-health.fasting-risk"
          />
        ) : null}
      </View>

      {/* Medications */}
      <View className="gap-3" testID="intake-health.medications">
        <Text variant="heading" accessibilityRole="header">
          {t('health.medications.title')}
        </Text>
        <Checkbox
          label={t('health.medications.none')}
          checked={medications.none}
          onChange={(none) =>
            update({ medications: { none, items: none ? [] : medications.items } })
          }
          testID="intake-health.medications.none"
        />
        {!medications.none ? (
          <>
            {medications.items.map((m, i) => (
              <MedicationRow
                key={m.id}
                med={m}
                index={i}
                onChange={(next) =>
                  update({
                    medications: {
                      none: false,
                      items: medications.items.map((x) => (x.id === m.id ? next : x)),
                    },
                  })
                }
                onRemove={() =>
                  update({
                    medications: {
                      none: false,
                      items: medications.items.filter((x) => x.id !== m.id),
                    },
                  })
                }
              />
            ))}
            <AddTextRow
              label={t('health.medications.add')}
              helper={t('health.medications.helper')}
              onAdd={(medName) =>
                update({
                  medications: {
                    none: false,
                    items: [
                      ...medications.items,
                      {
                        id: newRowId(),
                        name: medName,
                        food_interaction_flags: medicationFlagsFor(medName),
                      },
                    ],
                  },
                })
              }
              testID="intake-health.medications.new"
            />
          </>
        ) : null}
      </View>

      {/* Supplements */}
      <View className="gap-3" testID="intake-health.supplements">
        <Text variant="heading" accessibilityRole="header">
          {t('health.supplements.title')}
        </Text>
        <Checkbox
          label={t('health.supplements.none')}
          checked={supplements.none}
          onChange={(none) =>
            update({ supplements: { none, items: none ? [] : supplements.items } })
          }
          testID="intake-health.supplements.none"
        />
        {!supplements.none ? (
          <>
            <ChipGroup
              label={t('health.supplements.common')}
              options={COMMON_SUPPLEMENTS.map((x) => ({
                value: x.label,
                label: t(`supplements.${x.key}`),
              }))}
              selected={supplements.items.map((x) => x.name)}
              onToggle={(label) =>
                update({
                  supplements: {
                    none: false,
                    items: supplements.items.some((x) => x.name === label)
                      ? supplements.items.filter((x) => x.name !== label)
                      : [...supplements.items, { id: newRowId(), name: label }],
                  },
                })
              }
              testID="intake-health.supplements.common"
            />
            {supplements.items
              .filter((x) => !COMMON_SUPPLEMENTS.some((c) => c.label === x.name))
              .map((x) => (
                <Chip
                  key={x.id}
                  label={x.name}
                  selected
                  accessibilityHint={t('common.tapToRemove')}
                  onPress={() =>
                    update({
                      supplements: {
                        none: false,
                        items: supplements.items.filter((y) => y.id !== x.id),
                      },
                    })
                  }
                />
              ))}
            <AddTextRow
              label={t('health.supplements.other')}
              onAdd={(supplementName) =>
                update({
                  supplements: {
                    none: false,
                    items: [...supplements.items, { id: newRowId(), name: supplementName }],
                  },
                })
              }
              testID="intake-health.supplements.other"
            />
          </>
        ) : null}
      </View>

      {/* Red-flag screening (01 §7.6) */}
      <View className="gap-4" testID="intake-health.screening">
        <Text variant="heading" accessibilityRole="header">
          {t('health.screening.title')}
        </Text>
        <Text variant="caption" tone="muted">
          {t('health.screening.helper')}
        </Text>
        <YesNo
          label={t('health.screening.weightChange', { name })}
          value={weightChoice}
          onChange={(v) =>
            setScreening({ unintended_weight_change: v === 'yes' ? { kg: 0, months: 3 } : null })
          }
          testID="intake-health.weight-change"
        />
        {weightChange ? (
          <WeightChangeFields
            kg={weightChange.kg}
            months={weightChange.months}
            onChange={(kg, months) => setScreening({ unintended_weight_change: { kg, months } })}
          />
        ) : null}
        {visible('screen.eating_concern') ? (
          <View className="gap-2">
            <YesNo
              label={t('health.screening.eatingConcern', { name })}
              value={screening.eating_disorder_history ?? null}
              onChange={(v) => setScreening({ eating_disorder_history: v })}
              withPreferNot
              testID="intake-health.eating-concern"
            />
            {screening.eating_disorder_history === 'yes' ? (
              <InlineMessage
                tone="info"
                title={t('health.screening.eatingSupportTitle')}
                message={t('health.screening.eatingSupport', { name })}
                testID="intake-health.eating-support"
              />
            ) : null}
          </View>
        ) : null}
        {visible('screen.food_groups') ? (
          <YesNo
            label={t('health.screening.foodGroups', { name })}
            value={boolToYesNo(screening.refuses_food_groups_with_weight_loss)}
            onChange={(v) => setScreening({ refuses_food_groups_with_weight_loss: v === 'yes' })}
            testID="intake-health.food-groups"
          />
        ) : null}
        {visible('screen.gagging') ? (
          <YesNo
            label={t('health.screening.gagging', { name })}
            value={boolToYesNo(screening.gags_on_most_textures)}
            onChange={(v) => setScreening({ gags_on_most_textures: v === 'yes' })}
            testID="intake-health.gagging"
          />
        ) : null}
        {visible('screen.intends_to_fast') ? (
          <YesNo
            label={t('health.screening.intendsToFast', { name })}
            value={boolToYesNo(screening.intends_to_fast)}
            onChange={(v) => setScreening({ intends_to_fast: v === 'yes' })}
            testID="intake-health.intends-to-fast"
          />
        ) : null}
        {fastingRisk && screening.intends_to_fast === true ? (
          <InlineMessage
            tone="warning"
            title={t('health.screening.clinicianFirstTitle')}
            message={t('health.screening.clinicianFirst', { name })}
            testID="intake-health.red-flag"
          />
        ) : null}
        {visible('screen.fasting_symptoms') ? (
          <YesNo
            label={t('health.screening.fastingSymptoms', { name })}
            value={boolToYesNo(screening.faint_or_dark_urine_when_fasting)}
            onChange={(v) => setScreening({ faint_or_dark_urine_when_fasting: v === 'yes' })}
            testID="intake-health.fasting-symptoms"
          />
        ) : null}
      </View>
    </IntakeStepScaffold>
  );
}

function MedicationRow({
  med,
  index,
  onChange,
  onRemove,
}: {
  med: MedicationDraft;
  index: number;
  onChange: (m: MedicationDraft) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation('intake');
  const flags = medicationFlagsFor(med.name);
  return (
    <Card variant="outlined" testID={`intake-health.medication-${index}`}>
      <Text variant="bodyStrong">{med.name}</Text>
      <Input
        label={t('health.medications.dose')}
        value={med.dose ?? ''}
        onChangeText={(dose) => onChange({ ...med, dose: dose || null })}
        maxLength={40}
        testID={`intake-health.medication-${index}.dose`}
      />
      <RadioCardGroup
        label={t('health.medications.frequency')}
        options={MEDICATION_FREQUENCIES.map((f) => ({
          value: f,
          title: t(`health.medications.frequencies.${f}`),
        }))}
        value={
          (MEDICATION_FREQUENCIES as readonly string[]).includes(med.frequency ?? '')
            ? (med.frequency as (typeof MEDICATION_FREQUENCIES)[number])
            : null
        }
        onChange={(frequency) => onChange({ ...med, frequency })}
        inline
        testID={`intake-health.medication-${index}.frequency`}
      />
      {flags.length > 0 ? (
        <View className="gap-1" testID={`intake-health.medication-${index}.flags`}>
          <Text variant="label" tone="muted">
            {t('health.medications.flagsTitle')}
          </Text>
          {flags.map((f) => (
            <InlineMessage
              key={f}
              tone="info"
              message={t(`medicationFlags.${f}`)}
              testID={`intake-health.medication-${index}.flag.${f}`}
            />
          ))}
        </View>
      ) : null}
      <Button
        label={t('common.remove')}
        variant="link"
        size="sm"
        className="self-start px-0"
        onPress={onRemove}
        testID={`intake-health.medication-${index}.remove`}
      />
    </Card>
  );
}

function WeightChangeFields({
  kg,
  months,
  onChange,
}: {
  kg: number;
  months: number;
  onChange: (kg: number, months: number) => void;
}) {
  const { t } = useTranslation('intake');
  const [amount, setAmount] = useState(kg === 0 ? '' : numberText(Math.abs(kg)));
  const direction = kg > 0 ? 'gained' : 'lost';
  const set = (dir: 'lost' | 'gained', text: string, m: number) => {
    const n = Math.min(100, Math.abs(parseNumber(text) ?? 0));
    onChange(dir === 'lost' ? -n : n, m);
  };
  return (
    <View className="gap-3">
      <RadioCardGroup
        label={t('health.screening.direction')}
        options={[
          { value: 'lost', title: t('health.screening.lost') },
          { value: 'gained', title: t('health.screening.gained') },
        ]}
        value={direction}
        onChange={(d) => set(d, amount, months)}
        inline
        testID="intake-health.weight-change.direction"
      />
      <Input
        label={t('health.screening.kg')}
        value={amount}
        onChangeText={(text) => {
          setAmount(text);
          set(direction, text, months);
        }}
        variant="numeric"
        unit={t('common.kg')}
        testID="intake-health.weight-change.kg"
      />
      <Input
        label={t('health.screening.months')}
        value={numberText(months)}
        onChangeText={(text) => {
          const m = Math.max(1, Math.min(24, parseInteger(text) ?? 1));
          onChange(kg, m);
        }}
        variant="numeric"
        testID="intake-health.weight-change.months"
      />
    </View>
  );
}
