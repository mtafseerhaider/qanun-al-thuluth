import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Card } from '@/components/ui/card';
import { ChipGroup } from '@/components/ui/chip';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { acceptanceIndex, useExposures } from '@/features/exposures';
import { useFamilyMembers } from '@/features/family';
import { memberAge } from '@/features/meal-log';
import { useHouseholdClock } from '@/features/meals';
import { UpsellCard, usePremium } from '@/features/subscription';
import { track } from '@/lib/analytics/track';
import { isSupabaseConfigured } from '@/lib/env';
import { qk } from '@/lib/query/query-keys';
import type { MoreScreenProps } from '@/navigation/types';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';

import { fetchFamilyInsights } from '../api/insights-api';
import { pct, trend, type WeeklyInsight } from '../utils/insights-rules';

const RANGES = { '7d': 1, '30d': 4, '90d': 12 } as const;
type Range = keyof typeof RANGES;

function MemberAcceptance({
  householdId,
  memberId,
  name,
  today,
}: {
  householdId: string;
  memberId: string;
  name: string;
  today: string;
}) {
  const { t } = useTranslation('insights');
  const exposures = useExposures(householdId, memberId, today);
  const index = acceptanceIndex(exposures.rows, today);
  return (
    <Text testID={`insights.member.${memberId}`}>
      {index === null ? t('member.none', { name }) : t('member.index', { name, value: index })}
    </Text>
  );
}

/**
 * Insights (02 §7.12.6, FR-INS-01; premium). Weekly family numbers come from the server's
 * `get_family_insights`; the per-child acceptance index is computed on this device from the
 * child's own food tries, and the screen says so. No calories or weights are shown for children.
 */
export function NutritionInsightsScreen({
  route,
  navigation,
}: MoreScreenProps<'NutritionInsights'>) {
  const { t } = useTranslation('insights');
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const { premium } = usePremium(householdId);
  const clock = useHouseholdClock(householdId);
  const members = useFamilyMembers(householdId);
  const range: Range = route.params?.range ?? '30d';
  const weeks = RANGES[range];
  const query = useQuery({
    queryKey: qk.household(householdId ?? 'none').insights(weeks),
    queryFn: () => fetchFamilyInsights(householdId as string, weeks),
    enabled: premium && Boolean(householdId) && isSupabaseConfigured,
  });
  const rows: WeeklyInsight[] = query.data ?? [];
  const latest = rows[rows.length - 1] ?? null;
  const kids = useMemo(
    () =>
      (members.data ?? []).filter(
        (m) =>
          memberAge(m, clock.today).minor &&
          (m.special_modules ?? []).some((s) => s === 'picky_eater' || s === 'autism'),
      ),
    [members.data, clock.today],
  );

  useEffect(() => {
    track('insights_viewed', { premium, source: query.isError ? 'device' : 'server' });
    // Once per screen open and tier.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [premium]);

  if (!premium)
    return (
      <Screen testID="insights.screen">
        <Text variant="title" accessibilityRole="header">
          {t('title')}
        </Text>
        <UpsellCard
          trigger="insights"
          title={t('upsellTitle')}
          body={t('upsellBody')}
          testID="insights.upsell"
        />
      </Screen>
    );

  const metric = (
    key: 'meals' | 'water' | 'thirds',
    value: number | null,
    tr: ReturnType<typeof trend>,
  ) => (
    <View key={key} className="gap-0.5" testID={`insights.metric.${key}`}>
      <Text variant="bodyStrong">{t(`metrics.${key}`)}</Text>
      <Text>
        {value === null ? t('noData') : t('percentLine', { value, trend: t(`trend.${tr}`) })}
      </Text>
    </View>
  );

  return (
    <Screen
      testID="insights.screen"
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
    >
      <Text variant="title" accessibilityRole="header">
        {t('title')}
      </Text>
      <ChipGroup
        label={t('range')}
        single
        options={(Object.keys(RANGES) as Range[]).map((r) => ({
          value: r,
          label: t(`ranges.${r}`),
        }))}
        selected={[range]}
        onToggle={(r) => navigation.setParams({ range: r })}
        testID="insights.range"
      />
      {query.isError ? (
        <InlineMessage
          tone="info"
          message={t('serverUnavailable')}
          testID="insights.server-unavailable"
        />
      ) : null}
      {latest ? (
        <Card variant="elevated" testID="insights.family">
          <Text variant="heading" accessibilityRole="header">
            {t('familyTitle')}
          </Text>
          {metric('meals', pct(latest.mealAdherence), trend(rows.map((r) => r.mealAdherence)))}
          {metric('water', pct(latest.hydrationRatio), trend(rows.map((r) => r.hydrationRatio)))}
          {metric('thirds', pct(latest.adultThuluthAvg), trend(rows.map((r) => r.adultThuluthAvg)))}
          <Text>{t('newFoods', { count: rows.reduce((a, r) => a + r.newFoodsAccepted, 0) })}</Text>
          <Text variant="caption" tone="muted">
            {t('serverNote')}
          </Text>
        </Card>
      ) : !query.isLoading && !query.isError ? (
        <Text tone="muted" testID="insights.empty">
          {t('empty')}
        </Text>
      ) : null}
      {kids.length > 0 && householdId ? (
        <Card variant="outlined" testID="insights.children">
          <Text variant="heading" accessibilityRole="header">
            {t('childrenTitle')}
          </Text>
          {kids.map((k) => (
            <MemberAcceptance
              key={k.id}
              householdId={householdId}
              memberId={k.id}
              name={k.name}
              today={clock.today}
            />
          ))}
          <Text variant="caption" tone="muted" testID="insights.device-note">
            {t('deviceNote')}
          </Text>
        </Card>
      ) : null}
    </Screen>
  );
}
