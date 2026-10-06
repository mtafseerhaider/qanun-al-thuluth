import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import {
  acceptanceIndex,
  easierFoods,
  useExposures,
  useModuleMember,
  usePickySummary,
  useServingAcceptance,
  weeklyAcceptance,
} from '@/features/exposures';
import { UpsellCard } from '@/features/subscription';
import { addDays } from '@/lib/dates/local-date';
import { track } from '@/lib/analytics/track';
import type { FamilyScreenProps } from '@/navigation/types';

import { WeeklyAcceptanceBars } from '../components/weekly-acceptance-bars';

const WEEKS = 8;

/**
 * Acceptance analytics (02 §7.11.5, 15 §4.7, FR-PCK-06; premium). Server numbers come from the
 * `picky_acceptance_summary` RPC; the weekly bars, the acceptance index and "getting easier" are
 * computed on the device from this member's own logs, and the screen says so.
 */
export function AcceptanceAnalyticsScreen({ route }: FamilyScreenProps<'AcceptanceAnalytics'>) {
  const { familyMemberId } = route.params;
  const { t } = useTranslation('picky');
  const m = useModuleMember(familyMemberId);
  const summary = usePickySummary(m.householdId, familyMemberId, 30, m.premium);
  const exposures = useExposures(m.householdId, m.premium ? familyMemberId : null, m.today);
  const since = addDays(m.today, -7 * WEEKS);
  const servings = useServingAcceptance(familyMemberId, since, m.premium);
  const weeks = useMemo(() => {
    const scores = [
      ...(servings.data ?? []),
      ...exposures.rows.map((e) => ({ date: e.exposedOn, acceptance: e.acceptance })),
    ];
    return weeklyAcceptance(scores, m.today, WEEKS);
  }, [servings.data, exposures.rows, m.today]);
  const index = acceptanceIndex(exposures.rows, m.today);
  const easier = easierFoods(exposures.rows, m.today).slice(0, 5);

  useEffect(() => {
    track('acceptance_analytics_viewed', { premium: m.premium });
  }, [m.premium]);

  if (!m.premium)
    return (
      <Screen testID="acceptance.screen">
        <Text variant="title" accessibilityRole="header">
          {t('analytics.title', { name: m.name })}
        </Text>
        <UpsellCard
          trigger="picky_coaching"
          title={t('analytics.upsellTitle')}
          body={t('analytics.upsellBody')}
          testID="acceptance.upsell"
        />
      </Screen>
    );

  const s = summary.data;
  return (
    <Screen testID="acceptance.screen">
      <Text variant="title" accessibilityRole="header">
        {t('analytics.title', { name: m.name })}
      </Text>
      {summary.isError ? (
        <InlineMessage tone="info" message={t('analytics.serverUnavailable')} />
      ) : null}
      {s ? (
        <Card variant="elevated" testID="acceptance.summary">
          <Text variant="bodyStrong">{t('analytics.last30')}</Text>
          <Text>{t('analytics.acceptedFoods', { count: s.acceptedFoodCount })}</Text>
          <Text>{t('analytics.tries', { count: s.exposures })}</Text>
          <Text>{t('analytics.newAccepted', { count: s.newAccepted })}</Text>
          {s.mealAcceptanceRate !== null ? (
            <Text>
              {t('analytics.mealRate', { value: Math.round(s.mealAcceptanceRate * 100) })}
            </Text>
          ) : null}
        </Card>
      ) : null}
      <Card variant="outlined" testID="acceptance.weekly">
        <Text variant="bodyStrong" accessibilityRole="header">
          {t('analytics.weeklyTitle')}
        </Text>
        <WeeklyAcceptanceBars weeks={weeks} />
        {index !== null ? (
          <Text testID="acceptance.index">{t('analytics.index', { value: index })}</Text>
        ) : null}
      </Card>
      <Card variant="outlined" testID="acceptance.easier">
        <Text variant="bodyStrong" accessibilityRole="header">
          {t('analytics.easierTitle')}
        </Text>
        {easier.length === 0 ? (
          <Text tone="muted">{t('analytics.easierNone')}</Text>
        ) : (
          easier.map((f) => <Text key={f.ingredientId}>{f.foodLabel}</Text>)
        )}
      </Card>
      <Text variant="caption" tone="muted" testID="acceptance.device-note">
        {t('analytics.deviceNote')}
      </Text>
    </Screen>
  );
}
