import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { InlineMessage } from '@/components/ui/inline-message';
import { RadioCardGroup } from '@/components/ui/radio-card-group';
import type { IntakeStackParamList } from '@/navigation/types';

import { saveDislikes, saveSafeFoods } from '../api/intake-api';
import {
  DislikeListEditor,
  PreferenceListEditor,
  withoutLabels,
} from '../components/food-list-editor';
import { IntakeStepScaffold } from '../components/intake-step-scaffold';
import { boolToYesNo, YesNo } from '../components/yes-no';
import { useMemberStep } from '../hooks/use-intake-member';

type Props = NativeStackScreenProps<IntakeStackParamList, 'IntakeModulePicky'>;

export const MIN_SAFE_FOODS = 3;

/**
 * I12 Safe foods (02 §7.3.12, 15 §4.4, 24 S2-06): used by both the picky eater and the autism
 * modules. Fewer than 3 safe foods is fine, with a gentle note.
 */
export function IntakePickyScreen({ route }: Props) {
  const { familyMemberId } = route.params;
  const { t } = useTranslation('intake');
  const s = useMemberStep('picky', familyMemberId);
  const name = s.member?.name ?? '';
  const safe = s.answers.safeFoods ?? [];
  const dislikes = s.answers.dislikes ?? [];
  const picky = s.answers.picky ?? {};
  const isPicky = s.ctx?.modules.includes('picky_eater') ?? false;
  const ref = { householdId: s.householdId as string, familyMemberId };

  return (
    <IntakeStepScaffold
      memberName={name}
      index={s.index}
      total={s.total}
      score={s.score}
      title={t('picky.title', { name })}
      subtitle={t('picky.helper')}
      onNext={() =>
        void s.next(async () => {
          await saveSafeFoods(ref, safe);
          await saveDislikes(ref, dislikes);
        })
      }
      onBack={s.back}
      onFinishLater={s.finishLater}
      saving={s.saving}
      error={s.error}
      testID="intake-picky.screen"
    >
      <PreferenceListEditor
        label={t('picky.safeFoods', { name })}
        items={safe}
        isSafeFood
        onChange={(next) => s.update({ safeFoods: next, dislikes: withoutLabels(dislikes, next) })}
        testID="intake-picky.safe-foods"
      />
      {safe.length > 0 && safe.length < MIN_SAFE_FOODS ? (
        <InlineMessage
          tone="info"
          message={t('picky.fewSafeFoods', { name })}
          testID="intake-picky.few-safe-foods"
        />
      ) : null}
      <DislikeListEditor
        label={t('picky.hardFoods')}
        items={dislikes}
        onChange={(next) => s.update({ dislikes: next, safeFoods: withoutLabels(safe, next) })}
        testID="intake-picky.hard-foods"
      />
      <RadioCardGroup
        label={t('picky.mealtimes')}
        options={(['calm', 'sometimes_hard', 'often_stressful'] as const).map((m) => ({
          value: m,
          title: t(`picky.mealtimeOptions.${m}`),
        }))}
        value={picky.mealtimes ?? null}
        onChange={(mealtimes) => s.update({ picky: { ...picky, mealtimes } })}
        testID="intake-picky.mealtimes"
      />
      {isPicky ? (
        <YesNo
          label={t('picky.growthConcern')}
          value={boolToYesNo(picky.doctorGrowthConcern)}
          onChange={(v) => s.update({ picky: { ...picky, doctorGrowthConcern: v === 'yes' } })}
          testID="intake-picky.growth-concern"
        />
      ) : null}
    </IntakeStepScaffold>
  );
}
