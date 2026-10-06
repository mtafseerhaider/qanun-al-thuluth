import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useLadders, useModuleMember } from '@/features/exposures';
import { UpsellCard } from '@/features/subscription';
import { useFeatureFlag } from '@/hooks/use-feature-flag';
import type { FamilyScreenProps } from '@/navigation/types';

/**
 * Exposure ladders (02 §7.10.4, FR-AUT-03; premium). Active ladders first, then paused and
 * completed ones. One active ladder per food (database rule).
 */
export function ExposureLaddersScreen({ route, navigation }: FamilyScreenProps<'ExposureLadders'>) {
  const { familyMemberId } = route.params;
  const { t } = useTranslation('autism');
  const m = useModuleMember(familyMemberId);
  const ladders = useLadders(m.householdId, m.premium ? familyMemberId : null);
  const chainingOn = useFeatureFlag('autism.food_chaining');
  const order = { active: 0, paused: 1, completed: 2, abandoned: 3 } as const;
  const rows = [...(ladders.data ?? [])].sort((a, b) => order[a.status] - order[b.status]);

  if (!m.premium)
    return (
      <Screen testID="ladders.screen">
        <Text variant="title" accessibilityRole="header">
          {t('ladders.title', { name: m.name })}
        </Text>
        <Text tone="muted">{t('ladders.intro')}</Text>
        <UpsellCard
          trigger="exposure_ladder"
          title={t('ladders.upsellTitle')}
          body={t('ladders.upsellBody')}
          testID="ladders.upsell"
        />
      </Screen>
    );

  return (
    <Screen
      testID="ladders.screen"
      refreshing={ladders.isRefetching}
      onRefresh={() => void ladders.refetch()}
    >
      <Text variant="title" accessibilityRole="header">
        {t('ladders.title', { name: m.name })}
      </Text>
      <Text tone="muted">{t('ladders.intro')}</Text>
      {m.canEdit ? (
        <View className="flex-row flex-wrap gap-2">
          <Button
            label={t('ladders.newLadder')}
            onPress={() =>
              navigation.navigate('FoodChaining', { familyMemberId, strategy: 'exposure_ladder' })
            }
            testID="ladders.new"
          />
          {chainingOn ? (
            <Button
              label={t('ladders.newChain')}
              variant="secondary"
              onPress={() =>
                navigation.navigate('FoodChaining', { familyMemberId, strategy: 'food_chaining' })
              }
              testID="ladders.new-chain"
            />
          ) : null}
        </View>
      ) : null}
      {rows.length === 0 && !ladders.isLoading ? (
        <Text tone="muted" testID="ladders.empty">
          {t('ladders.empty')}
        </Text>
      ) : null}
      {rows.map((l) => {
        const step = l.steps.find((s) => s.stepNo === l.currentStep);
        const label = t('ladders.row', {
          food: l.targetLabel,
          status: t(`ladders.status.${l.status}`),
          step: l.currentStep,
          total: l.steps.length,
        });
        return (
          <Pressable
            key={l.id}
            accessibilityRole="button"
            accessibilityLabel={label}
            onPress={() => navigation.navigate('ExposureLadderDetail', { ladderId: l.id })}
            testID="ladders.item"
          >
            <Card variant={l.status === 'active' ? 'elevated' : 'filled'}>
              <Text variant="bodyStrong">{l.targetLabel}</Text>
              <Text tone="muted">{label}</Text>
              {step && l.status === 'active' ? (
                <Text variant="caption">
                  {t('ladders.now', {
                    stage: t(`picky:stages.${step.stage}`),
                    food: step.foodLabel,
                  })}
                </Text>
              ) : null}
            </Card>
          </Pressable>
        );
      })}
    </Screen>
  );
}
