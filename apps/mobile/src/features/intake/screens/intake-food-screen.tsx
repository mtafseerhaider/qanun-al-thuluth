import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import type { IntakeStackParamList } from '@/navigation/types';

import { saveDislikes, saveLikes } from '../api/intake-api';
import {
  DislikeListEditor,
  PreferenceListEditor,
  withoutLabels,
} from '../components/food-list-editor';
import { IntakeStepScaffold } from '../components/intake-step-scaffold';
import { useMemberStep } from '../hooks/use-intake-member';

type Props = NativeStackScreenProps<IntakeStackParamList, 'IntakeMemberFood'>;

/** I7 Food likes and dislikes (02 §7.3.7). An item cannot be both liked and disliked. */
export function IntakeFoodScreen({ route }: Props) {
  const { familyMemberId } = route.params;
  const { t } = useTranslation('intake');
  const s = useMemberStep('food', familyMemberId);
  const name = s.member?.name ?? '';
  const likes = s.answers.likes ?? [];
  const dislikes = s.answers.dislikes ?? [];
  const ref = { householdId: s.householdId as string, familyMemberId };

  return (
    <IntakeStepScaffold
      memberName={name}
      index={s.index}
      total={s.total}
      score={s.score}
      title={t('food.title', { name })}
      {...(s.ctx?.minor ? { subtitle: t('food.childHelper') } : {})}
      onNext={() =>
        void s.next(async () => {
          await saveLikes(ref, likes);
          await saveDislikes(ref, dislikes);
        })
      }
      onBack={s.back}
      onFinishLater={s.finishLater}
      saving={s.saving}
      error={s.error}
      testID="intake-food.screen"
    >
      <PreferenceListEditor
        label={t('food.likes')}
        items={likes}
        onChange={(next) => s.update({ likes: next, dislikes: withoutLabels(dislikes, next) })}
        testID="intake-food.likes"
      />
      <DislikeListEditor
        label={t('food.dislikes')}
        items={dislikes}
        onChange={(next) => s.update({ dislikes: next, likes: withoutLabels(likes, next) })}
        testID="intake-food.dislikes"
      />
    </IntakeStepScaffold>
  );
}
