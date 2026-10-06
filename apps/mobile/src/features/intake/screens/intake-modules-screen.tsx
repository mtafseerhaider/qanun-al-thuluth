import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { moduleOptionsFor, toggleModule } from '@shared/intake/questions';
import type { SpecialModule } from '@shared';

import { Checkbox } from '@/components/ui/checkbox';
import { Text } from '@/components/ui/text';
import { qk } from '@/lib/query/query-keys';
import type { IntakeStackParamList } from '@/navigation/types';

import { removeOneLive, saveMemberColumns, saveSafeFoods } from '../api/intake-api';
import { IntakeStepScaffold } from '../components/intake-step-scaffold';
import { useMemberStep } from '../hooks/use-intake-member';

type Props = NativeStackScreenProps<IntakeStackParamList, 'IntakeMemberModules'>;

/**
 * I9 Special modules (02 §7.3.9, 24 S2-06): only modules the member is eligible for by age and sex
 * are offered. Deselecting a module removes its saved profile rows. Saving refreshes the cached
 * family members, so Family shows the module links and turning on autism brings up the one-time
 * Sensory-calm suggestion (02 §7.10) straight away.
 */
export function IntakeModulesScreen({ route }: Props) {
  const { familyMemberId } = route.params;
  const { t } = useTranslation('intake');
  const qc = useQueryClient();
  const s = useMemberStep('modules', familyMemberId);
  const name = s.member?.name ?? '';
  const options = s.ctx ? moduleOptionsFor(s.ctx) : [];
  const selected = (s.answers.modules ?? []).filter((m) => options.includes(m));

  const save = async () => {
    const modules: SpecialModule[] = selected;
    // Persist an explicit "none" so the step counts as answered.
    s.update({ modules });
    const ref = { householdId: s.householdId as string, familyMemberId };
    await saveMemberColumns(familyMemberId, { special_modules: modules });
    if (!modules.includes('pregnancy')) await removeOneLive('pregnancy_profiles', ref);
    if (!modules.includes('autism')) await removeOneLive('sensory_profiles', ref);
    if (!modules.includes('autism') && !modules.includes('picky_eater'))
      await saveSafeFoods(ref, []);
    void qc.invalidateQueries({ queryKey: qk.household(ref.householdId).familyMembers() });
  };

  return (
    <IntakeStepScaffold
      memberName={name}
      index={s.index}
      total={s.total}
      score={s.score}
      title={t('modules.title', { name })}
      subtitle={t('modules.helper')}
      onNext={() => void s.next(save)}
      onBack={s.back}
      onFinishLater={s.finishLater}
      saving={s.saving}
      error={s.error}
      testID="intake-modules.screen"
    >
      <View className="gap-1" testID="intake-modules.list">
        {options.map((m) => (
          <Checkbox
            key={m}
            label={t(`modules.${m}.title`)}
            description={t(`modules.${m}.description`)}
            checked={selected.includes(m)}
            onChange={() => s.update({ modules: toggleModule(selected, m) })}
            testID={`intake-modules.${m}`}
          />
        ))}
      </View>
      <Text variant="caption" tone="muted">
        {selected.length === 0 ? t('modules.noneNote') : t('modules.selectedNote')}
      </Text>
    </IntakeStepScaffold>
  );
}
