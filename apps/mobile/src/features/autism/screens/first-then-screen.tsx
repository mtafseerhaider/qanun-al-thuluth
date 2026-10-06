import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ChipGroup } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useLadders, useModuleMember } from '@/features/exposures';
import { track } from '@/lib/analytics/track';
import type { FamilyScreenProps } from '@/navigation/types';

export const THEN_ACTIVITIES = [
  'play',
  'story',
  'outside',
  'drawing',
  'blocks',
  'bath',
  'cuddle',
] as const;
export type ThenActivity = (typeof THEN_ACTIVITIES)[number];

/**
 * "First, then" visual cards (02 §7.10.6, FR-AUT-05; free). A large two-card board the parent shows
 * the child: first a small, known step (often the current ladder step), then a calm activity.
 * "Then" is always an activity, never a food, so food is not used as a reward (15 §3.1).
 */
export function FirstThenScreen({ route }: FamilyScreenProps<'FirstThen'>) {
  const { familyMemberId } = route.params;
  const { t } = useTranslation('autism');
  const m = useModuleMember(familyMemberId);
  const ladders = useLadders(m.householdId, m.premium ? familyMemberId : null);
  const firstOptions = useMemo(() => {
    const fromLadders = (ladders.data ?? [])
      .filter((l) => l.status === 'active')
      .flatMap((l) => {
        const s = l.steps.find((x) => x.stepNo === l.currentStep);
        return s
          ? [t('firstThen.stepText', { stage: t(`picky:stages.${s.stage}`), food: s.foodLabel })]
          : [];
      });
    return [...new Set([...fromLadders, t('firstThen.presets.sit'), t('firstThen.presets.wash')])];
  }, [ladders.data, t]);
  const [first, setFirst] = useState<string>('');
  const [custom, setCustom] = useState('');
  const [then, setThen] = useState<ThenActivity>('play');
  const firstText = custom.trim() || first || firstOptions[0] || '';

  useEffect(() => {
    track('first_then_viewed', {});
  }, []);

  return (
    <Screen testID="first-then.screen">
      <Text variant="title" accessibilityRole="header">
        {t('firstThen.title', { name: m.name })}
      </Text>
      <View
        className="flex-row gap-3"
        accessible
        accessibilityLabel={t('firstThen.boardA11y', {
          first: firstText,
          then: t(`firstThen.activities.${then}`),
        })}
        testID="first-then.board"
      >
        <View className="min-h-40 flex-1 items-center justify-center gap-2 rounded-lg border-2 border-line-strong bg-surface-raised p-4">
          <Text variant="overline" tone="muted">
            {t('firstThen.first')}
          </Text>
          <Text variant="title" align="center">
            {firstText}
          </Text>
        </View>
        <View className="min-h-40 flex-1 items-center justify-center gap-2 rounded-lg border-2 border-primary bg-surface-raised p-4">
          <Text variant="overline" tone="muted">
            {t('firstThen.then')}
          </Text>
          <Text variant="title" align="center">
            {t(`firstThen.activities.${then}`)}
          </Text>
        </View>
      </View>
      <ChipGroup
        label={t('firstThen.chooseFirst')}
        single
        options={firstOptions.map((o) => ({ value: o, label: o }))}
        selected={[first || firstOptions[0] || '']}
        onToggle={(v) => {
          setFirst(v);
          setCustom('');
        }}
        testID="first-then.first"
      />
      <Input
        label={t('firstThen.custom')}
        value={custom}
        onChangeText={setCustom}
        maxLength={60}
        testID="first-then.custom"
      />
      <ChipGroup
        label={t('firstThen.chooseThen')}
        hint={t('firstThen.thenHint')}
        single
        options={THEN_ACTIVITIES.map((a) => ({ value: a, label: t(`firstThen.activities.${a}`) }))}
        selected={[then]}
        onToggle={setThen}
        testID="first-then.then"
      />
    </Screen>
  );
}
