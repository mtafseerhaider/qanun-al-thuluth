import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { PregnancyDraft } from '@shared/intake/questions';

import { InlineMessage } from '@/components/ui/inline-message';
import { Input } from '@/components/ui/input';
import { RadioCardGroup } from '@/components/ui/radio-card-group';
import { Text } from '@/components/ui/text';
import type { IntakeStackParamList } from '@/navigation/types';

import { savePregnancy } from '../api/intake-api';
import { IntakeStepScaffold } from '../components/intake-step-scaffold';
import { boolToYesNo, YesNo } from '../components/yes-no';
import { useMemberStep } from '../hooks/use-intake-member';
import { newRowId, numberText, parseInteger } from '../utils/form-helpers';

type Props = NativeStackScreenProps<IntakeStackParamList, 'IntakeModulePregnancy'>;

const DAY = 24 * 3600 * 1000;

/** Due date must be from today to 42 weeks ahead (02 §7.3.10). */
export function dueDateError(dueDate: string, today = new Date()): 'format' | 'range' | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(dueDate))) return 'format';
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const days = (Date.parse(dueDate) - start) / DAY;
  return days < 0 || days > 42 * 7 ? 'range' : null;
}

/** Trimester from a due date (40-week pregnancy): weeks 0 to 13, 14 to 27, 28+. */
export function trimesterFor(dueDate: string, today = new Date()): 1 | 2 | 3 {
  const weeksToGo = (Date.parse(dueDate) - today.getTime()) / (7 * DAY);
  const weeks = 40 - weeksToGo;
  return weeks < 14 ? 1 : weeks < 28 ? 2 : 3;
}

/** I10 Pregnancy / breastfeeding (02 §7.3.10, 24 S2-05). No calorie cutting is ever planned. */
export function IntakePregnancyScreen({ route }: Props) {
  const { familyMemberId, module } = route.params;
  const { t } = useTranslation('intake');
  const s = useMemberStep('pregnancy', familyMemberId);
  const name = s.member?.name ?? '';
  const isPregnancy = module === 'pregnancy';
  const p: PregnancyDraft = s.answers.pregnancy ?? { id: newRowId() };
  const bf = s.answers.breastfeeding ?? {};
  const screening = s.answers.screening ?? {};
  const [due, setDue] = useState(p.due_date ?? '');
  const [dueError, setDueError] = useState<'format' | 'range' | null>(null);
  const setP = (patch: Partial<PregnancyDraft>) => s.update({ pregnancy: { ...p, ...patch } });

  const onDue = (text: string) => {
    setDue(text);
    setDueError(null);
    if (text.length === 10 && !dueDateError(text))
      setP({ due_date: text, trimester: trimesterFor(text) });
  };

  const onNext = () => {
    if (isPregnancy && due) {
      const e = dueDateError(due);
      if (e) {
        setDueError(e);
        return;
      }
    }
    void s.next(async () => {
      if (isPregnancy)
        await savePregnancy({ householdId: s.householdId as string, familyMemberId }, p);
    });
  };

  return (
    <IntakeStepScaffold
      memberName={name}
      index={s.index}
      total={s.total}
      score={s.score}
      title={t(isPregnancy ? 'pregnancy.title' : 'breastfeeding.title', { name })}
      subtitle={t('pregnancy.congrats', { name })}
      onNext={onNext}
      onBack={s.back}
      onFinishLater={s.finishLater}
      saving={s.saving}
      error={s.error}
      testID="intake-pregnancy.screen"
    >
      {isPregnancy ? (
        <View className="gap-4">
          <Input
            label={t('pregnancy.dueDate')}
            helperText={t('pregnancy.dueDateHelper')}
            {...(dueError ? { errorText: t(`pregnancy.dueDateErrors.${dueError}`) } : {})}
            value={due}
            onChangeText={onDue}
            placeholder={t('common.datePlaceholder')}
            maxLength={10}
            keyboardType="numbers-and-punctuation"
            testID="intake-pregnancy.due-date"
          />
          <RadioCardGroup
            label={t('pregnancy.trimester')}
            options={(['1', '2', '3'] as const).map((n) => ({
              value: n,
              title: t(`pregnancy.trimesters.${n}`),
            }))}
            value={p.trimester ? (String(p.trimester) as '1' | '2' | '3') : null}
            onChange={(v) => setP({ trimester: Number(v) })}
            inline
            testID="intake-pregnancy.trimester"
          />
          <YesNo
            label={t('pregnancy.gestationalDiabetes')}
            value={boolToYesNo(p.gestational_diabetes)}
            onChange={(v) => setP({ gestational_diabetes: v === 'yes' })}
            testID="intake-pregnancy.gestational-diabetes"
          />
          <RadioCardGroup
            label={t('pregnancy.nausea')}
            options={(['none', 'mild', 'severe'] as const).map((n) => ({
              value: n,
              title: t(`pregnancy.nauseaLevels.${n}`),
            }))}
            value={p.nausea ?? null}
            onChange={(nausea) => setP({ nausea })}
            inline
            testID="intake-pregnancy.nausea"
          />
          <YesNo
            label={t('pregnancy.vomiting', { name })}
            value={boolToYesNo(screening.pregnancy_vomiting_cannot_keep_fluids)}
            onChange={(v) =>
              s.update({
                screening: { ...screening, pregnancy_vomiting_cannot_keep_fluids: v === 'yes' },
              })
            }
            testID="intake-pregnancy.vomiting"
          />
          {screening.pregnancy_vomiting_cannot_keep_fluids ? (
            <InlineMessage
              tone="warning"
              title={t('pregnancy.vomitingTitle')}
              message={t('pregnancy.vomitingBody')}
              testID="intake-pregnancy.red-flag"
            />
          ) : null}
        </View>
      ) : (
        <View className="gap-4">
          <RadioCardGroup
            label={t('breastfeeding.feeding')}
            options={(['exclusive', 'partial'] as const).map((f) => ({
              value: f,
              title: t(`breastfeeding.${f}`),
            }))}
            value={bf.feeding ?? null}
            onChange={(feeding) => s.update({ breastfeeding: { ...bf, feeding } })}
            inline
            testID="intake-pregnancy.feeding"
          />
          <Input
            label={t('breastfeeding.babyAge')}
            value={numberText(bf.babyAgeMonths)}
            onChangeText={(x) => {
              const n = parseInteger(x);
              const next = { ...bf };
              if (n === undefined) delete next.babyAgeMonths;
              else next.babyAgeMonths = Math.max(0, Math.min(36, n));
              s.update({ breastfeeding: next });
            }}
            variant="numeric"
            unit={t('common.months')}
            testID="intake-pregnancy.baby-age"
          />
        </View>
      )}
      <Text variant="caption" tone="muted" testID="intake-pregnancy.scholar-notice">
        {t('pregnancy.scholarNotice')}
      </Text>
    </IntakeStepScaffold>
  );
}
