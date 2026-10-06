import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import {
  groupByFood,
  pairsThisWeek,
  useCoachingTips,
  useExposurePairs,
  useExposures,
  NavRow,
  useModuleMember,
} from '@/features/exposures';
import { UpsellCard } from '@/features/subscription';
import { track } from '@/lib/analytics/track';
import type { FamilyScreenProps } from '@/navigation/types';

/**
 * Picky-eater hub (02 §7.11, FR-PCK-01 to -06). This week's exposure pair from the plan (one new
 * food next to a familiar one), a quick "log a try", the Division of Responsibility guide, the
 * exposure log and, for premium, coaching tips and acceptance analytics. No calories, targets or
 * clean-plate language anywhere: the parent decides what, when and where; the child decides
 * whether and how much.
 */
export function PickyEaterHubScreen({ route, navigation }: FamilyScreenProps<'PickyEaterHub'>) {
  const { familyMemberId } = route.params;
  const { t } = useTranslation('picky');
  const m = useModuleMember(familyMemberId);
  const pairs = useExposurePairs(m.householdId);
  const mine = useMemo(
    () => pairsThisWeek(pairs.data ?? [], familyMemberId, m.today),
    [pairs.data, familyMemberId, m.today],
  );
  const exposures = useExposures(m.householdId, familyMemberId, m.today);
  const foods = useMemo(() => groupByFood(exposures.rows, m.today), [exposures.rows, m.today]);
  const tips = useCoachingTips('picky', m.ageMonths);

  useEffect(() => {
    track('picky_hub_viewed', { has_pair: mine.length > 0 });
    // Once per member.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familyMemberId]);

  const logTry = (ingredientId?: string | null, foodLabel?: string) =>
    navigation.navigate('LogExposureSheet', {
      familyMemberId,
      module: 'picky',
      ...(ingredientId ? { ingredientId } : {}),
      ...(foodLabel ? { foodLabel } : {}),
    });

  return (
    <Screen testID="picky.hub">
      <Text variant="title" accessibilityRole="header">
        {t('hub.title', { name: m.name })}
      </Text>
      <Text tone="muted">{t('hub.intro', { name: m.name })}</Text>

      <Card variant="elevated" testID="picky.pair">
        <Text variant="heading" accessibilityRole="header">
          {t('hub.pairTitle')}
        </Text>
        {mine.length === 0 ? (
          <Text tone="muted" testID="picky.pair.none">
            {t('hub.pairNone')}
          </Text>
        ) : (
          mine.map((p) => (
            <View key={`${p.newFood}-${p.week}`} className="gap-1">
              <Text>{t('hub.pairLine', { food: p.newFood, familiar: p.familiarLabel })}</Text>
              {p.slots.length > 0 ? (
                <Text variant="caption" tone="muted">
                  {t('hub.pairSlots', {
                    slots: p.slots
                      .map(
                        (s) =>
                          `${s.planDate} ${t(`meals:mealType.${s.mealType}`, { defaultValue: s.mealType })}`,
                      )
                      .join(', '),
                  })}
                </Text>
              ) : null}
              {m.canEdit && p.newIngredientId ? (
                <Button
                  label={t('hub.logPair', { food: p.newFood })}
                  size="sm"
                  variant="secondary"
                  onPress={() => logTry(p.newIngredientId, p.newFood)}
                  testID="picky.pair.log"
                />
              ) : null}
            </View>
          ))
        )}
        <Text variant="caption" tone="muted">
          {t('hub.pairNote')}
        </Text>
      </Card>

      {m.canEdit ? (
        <Button label={t('hub.logTry')} onPress={() => logTry()} fullWidth testID="picky.log" />
      ) : (
        <InlineMessage tone="info" message={t('log.viewer')} />
      )}

      <Card variant="outlined">
        <Text variant="bodyStrong">{t('hub.recentTitle')}</Text>
        {foods.length === 0 ? (
          <Text tone="muted">{t('hub.recentEmpty', { name: m.name })}</Text>
        ) : (
          <Text testID="picky.recent">
            {t('hub.recentLine', { count: foods.length, tries: exposures.rows.length })}
          </Text>
        )}
      </Card>

      <View>
        <NavRow
          label={t('hub.dor')}
          hint={t('hub.dorHint')}
          onPress={() => navigation.navigate('DivisionOfResponsibility')}
          testID="picky.nav.dor"
        />
        <NavRow
          label={t('hub.log')}
          hint={t('hub.logHint')}
          onPress={() => navigation.navigate('ExposureLog', { familyMemberId })}
          testID="picky.nav.log"
        />
        <NavRow
          label={t('hub.analytics')}
          hint={t('hub.analyticsHint')}
          {...(m.premium ? {} : { badge: t('premium') })}
          onPress={() => navigation.navigate('AcceptanceAnalytics', { familyMemberId })}
          testID="picky.nav.analytics"
        />
      </View>

      <Text variant="heading" accessibilityRole="header">
        {t('hub.tipsTitle')}
      </Text>
      {m.premium ? (
        tips.tips.length === 0 ? (
          <Text tone="muted" testID="picky.tips.none">
            {t('hub.tipsNone')}
          </Text>
        ) : (
          tips.tips.slice(0, 5).map((tip) => (
            <Card key={tip.id} variant="filled" testID="picky.tip">
              <Text>{tip.body}</Text>
            </Card>
          ))
        )
      ) : (
        <UpsellCard
          trigger="picky_coaching"
          title={t('hub.upsellTitle')}
          body={t('hub.upsellBody', { name: m.name })}
          testID="picky.upsell"
        />
      )}
      <Text variant="caption" tone="muted">
        {t('disclaimer')}
      </Text>
    </Screen>
  );
}
