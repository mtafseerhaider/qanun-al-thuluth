import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import {
  useCoachingTips,
  useLadders,
  NavRow,
  useModuleMember,
  useSafeFoods,
} from '@/features/exposures';
import { SensoryCalmToggle } from '@/features/settings';
import { UpsellCard } from '@/features/subscription';
import { track } from '@/lib/analytics/track';
import type { FamilyScreenProps } from '@/navigation/types';
import { useFeatureFlag } from '@/hooks/use-feature-flag';

/**
 * Autism module hub (02 §7.10, 15 §3; FR-AUT-01 to -05). Safe foods and first-then cards are free;
 * the sensory profile editor, exposure ladders and food chaining are premium. Predictable, calm
 * screens: no animation, no timers, plain words.
 */
export function AutismHubScreen({ route, navigation }: FamilyScreenProps<'AutismHub'>) {
  const { familyMemberId } = route.params;
  const { t } = useTranslation('autism');
  const m = useModuleMember(familyMemberId);
  const safe = useSafeFoods(m.householdId, familyMemberId);
  const ladders = useLadders(m.householdId, m.premium ? familyMemberId : null);
  const tips = useCoachingTips('autism', m.ageMonths);
  const chainingOn = useFeatureFlag('autism.food_chaining');
  const active = (ladders.data ?? []).filter((l) => l.status === 'active');

  useEffect(() => {
    track('autism_hub_viewed', {});
  }, []);

  const premiumBadge = m.premium ? {} : { badge: t('premium') };
  return (
    <Screen testID="autism.hub">
      <Text variant="title" accessibilityRole="header">
        {t('hub.title', { name: m.name })}
      </Text>
      <Text tone="muted">{t('hub.intro', { name: m.name })}</Text>
      <Card variant="elevated" testID="autism.summary">
        <Text>{t('hub.safeCount', { count: safe.data?.length ?? 0 })}</Text>
        {m.premium ? <Text>{t('hub.activeLadders', { count: active.length })}</Text> : null}
      </Card>
      {/* 02 §7.10: Sensory-calm is offered where the autism module is used, not only in Settings. */}
      <Card variant="outlined" testID="autism.calm">
        <SensoryCalmToggle testID="autism.calm-toggle" />
      </Card>
      <View>
        <NavRow
          label={t('hub.safeFoods')}
          hint={t('hub.safeFoodsHint')}
          onPress={() => navigation.navigate('SafeFoods', { familyMemberId })}
          testID="autism.nav.safe"
        />
        <NavRow
          label={t('hub.firstThen')}
          hint={t('hub.firstThenHint')}
          onPress={() => navigation.navigate('FirstThen', { familyMemberId })}
          testID="autism.nav.first-then"
        />
        <NavRow
          label={t('hub.sensory')}
          hint={t('hub.sensoryHint')}
          {...premiumBadge}
          onPress={() => navigation.navigate('SensoryProfile', { familyMemberId })}
          testID="autism.nav.sensory"
        />
        <NavRow
          label={t('hub.ladders')}
          hint={chainingOn ? t('hub.laddersHintChain') : t('hub.laddersHint')}
          {...premiumBadge}
          onPress={() => navigation.navigate('ExposureLadders', { familyMemberId })}
          testID="autism.nav.ladders"
        />
        <NavRow
          label={t('hub.log')}
          hint={t('hub.logHint')}
          onPress={() => navigation.navigate('ExposureLog', { familyMemberId })}
          testID="autism.nav.log"
        />
      </View>
      <Text variant="heading" accessibilityRole="header">
        {t('hub.tipsTitle')}
      </Text>
      {m.premium ? (
        tips.tips.length === 0 ? (
          <Text tone="muted">{t('hub.tipsNone')}</Text>
        ) : (
          tips.tips.slice(0, 5).map((tip) => (
            <Card key={tip.id} variant="filled" testID="autism.tip">
              <Text>{tip.body}</Text>
            </Card>
          ))
        )
      ) : (
        <UpsellCard
          trigger="exposure_ladder"
          title={t('hub.upsellTitle')}
          body={t('hub.upsellBody')}
          testID="autism.upsell"
        />
      )}
      <Text variant="caption" tone="muted">
        {t('disclaimer')}
      </Text>
    </Screen>
  );
}
