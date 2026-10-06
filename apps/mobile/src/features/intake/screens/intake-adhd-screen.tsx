import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { medicationFlagsFor } from '@shared/domain/intake';
import type { MedicationDraft, MemberIntakeAnswers } from '@shared/intake/questions';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { RadioCardGroup } from '@/components/ui/radio-card-group';
import type { IntakeStackParamList } from '@/navigation/types';

import { saveMedications, saveMemberColumns } from '../api/intake-api';
import { IntakeStepScaffold } from '../components/intake-step-scaffold';
import { useMemberStep } from '../hooks/use-intake-member';
import { newRowId } from '../utils/form-helpers';

type Props = NativeStackScreenProps<IntakeStackParamList, 'IntakeModuleAdhd'>;

const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Applies the ADHD answers to the shared medications list and lifestyle: the stimulant is a
 * `medications` row (flag `stimulant_appetite_suppression` from its name), a lower lunch appetite is
 * `lifestyle.appetite_pattern = 'low_midday'` (01 §7.6).
 */
export function applyAdhd(a: MemberIntakeAnswers, stimulantName: string): MemberIntakeAnswers {
  const adhd = a.adhd ?? {};
  const meds = a.medications?.items ?? [];
  const medId = adhd.medicationId ?? newRowId();
  const others = meds.filter((m) => m.id !== adhd.medicationId);
  const name = stimulantName.trim();
  const items: MedicationDraft[] =
    adhd.stimulant === 'yes' && name
      ? [
          ...others,
          {
            id: medId,
            name,
            frequency: adhd.doseTime ? `once_daily ${adhd.doseTime}` : 'once_daily',
            food_interaction_flags: medicationFlagsFor(name),
          },
        ]
      : others;
  const lifestyle = { ...(a.lifestyle ?? {}) };
  if (adhd.lowLunchAppetite) lifestyle.appetite_pattern = 'low_midday';
  else if (lifestyle.appetite_pattern === 'low_midday') delete lifestyle.appetite_pattern;
  return {
    ...a,
    adhd: { ...adhd, ...(adhd.stimulant === 'yes' && name ? { medicationId: medId } : {}) },
    medications: { none: items.length === 0 && (a.medications?.none ?? false), items },
    lifestyle,
  };
}

/** I13 ADHD routine (02 §7.3.13, 24 S2-06). */
export function IntakeAdhdScreen({ route }: Props) {
  const { familyMemberId } = route.params;
  const { t } = useTranslation('intake');
  const s = useMemberStep('adhd', familyMemberId);
  const name = s.member?.name ?? '';
  const adhd = s.answers.adhd ?? {};
  const currentMed = s.answers.medications?.items.find((m) => m.id === adhd.medicationId);
  const stimulantName = currentMed?.name ?? '';
  const setAdhd = (
    patch: Partial<NonNullable<MemberIntakeAnswers['adhd']>>,
    medName = stimulantName,
  ) => s.update(applyAdhd({ ...s.answers, adhd: { ...adhd, ...patch } }, medName));
  const doseInvalid = Boolean(adhd.doseTime) && !HH_MM.test(adhd.doseTime ?? '');

  return (
    <IntakeStepScaffold
      memberName={name}
      index={s.index}
      total={s.total}
      score={s.score}
      title={t('adhd.title', { name })}
      subtitle={t('adhd.helper')}
      nextDisabled={doseInvalid}
      onNext={() =>
        void s.next(async () => {
          const a = s.answers;
          await saveMedications(
            { householdId: s.householdId as string, familyMemberId },
            a.medications?.none ? [] : (a.medications?.items ?? []),
          );
          await saveMemberColumns(familyMemberId, { lifestyle: a.lifestyle ?? {} });
        })
      }
      onBack={s.back}
      onFinishLater={s.finishLater}
      saving={s.saving}
      error={s.error}
      testID="intake-adhd.screen"
    >
      <RadioCardGroup
        label={t('adhd.stimulant', { name })}
        options={(['yes', 'no', 'not_sure'] as const).map((v) => ({
          value: v,
          title: t(`adhd.stimulantOptions.${v}`),
        }))}
        value={adhd.stimulant ?? null}
        onChange={(stimulant) => setAdhd({ stimulant })}
        inline
        testID="intake-adhd.stimulant"
      />
      {adhd.stimulant === 'yes' ? (
        <View className="gap-3">
          <Input
            label={t('adhd.medicationName')}
            value={stimulantName}
            onChangeText={(medName) => setAdhd({}, medName)}
            maxLength={120}
            testID="intake-adhd.medication-name"
          />
          <Input
            label={t('adhd.doseTime')}
            helperText={t('adhd.doseTimeHelper')}
            {...(doseInvalid ? { errorText: t('adhd.doseTimeError') } : {})}
            value={adhd.doseTime ?? ''}
            onChangeText={(doseTime) => setAdhd({ doseTime })}
            placeholder={t('common.timePlaceholder')}
            maxLength={5}
            keyboardType="numbers-and-punctuation"
            testID="intake-adhd.dose-time"
          />
        </View>
      ) : null}
      <Checkbox
        label={t('adhd.lowLunch')}
        checked={adhd.lowLunchAppetite === true}
        onChange={(lowLunchAppetite) => setAdhd({ lowLunchAppetite })}
        testID="intake-adhd.low-lunch"
      />
      <Checkbox
        label={t('adhd.snacks')}
        checked={adhd.scheduledSnacks === true}
        onChange={(scheduledSnacks) => setAdhd({ scheduledSnacks })}
        testID="intake-adhd.snacks"
      />
    </IntakeStepScaffold>
  );
}
