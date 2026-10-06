import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useFastingTimes } from '@/features/fasting';
import { localized, useDailyMeals } from '@/features/meals';
import { useMealPlans } from '@/features/plan';
import {
  DowngradeBanner,
  downgradeNotice,
  isReadOnlyPremiumArea,
  UpsellCard,
  useEntitlements,
  usePremium,
} from '@/features/subscription';
import { useFeatureFlag } from '@/hooks/use-feature-flag';
import { track } from '@/lib/analytics/track';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { MoreScreenProps } from '@/navigation/types';
import { selectCanEdit, useActiveHouseholdStore } from '@/stores/use-active-household-store';

import type { RamadanPlanView } from '../api/ramadan-api';
import { RamadanTodayCard } from '../components/ramadan-today-card';
import { useRamadanPlan, useUpcomingRamadan } from '../hooks/use-ramadan';
import {
  formatPlanDate,
  planDates,
  RAMADAN_TIPS,
  ramadanDay,
  ramadanEndDate,
} from '../utils/ramadan-rules';

/**
 * M Ramadan Planner (02 §7.12.6, 24 S5-11, FR-FAST-09): the day-by-day suhoor and iftar schedule of
 * the household's Ramadan plan (premium), and practical tips for everyone. After a downgrade an
 * existing plan stays readable but cannot be regenerated (FR-SUB-06).
 */
export function RamadanPlannerScreen({ navigation }: MoreScreenProps<'RamadanPlanner'>) {
  const { t, i18n } = useTranslation(['ramadan', 'errors']);
  const enabled = useFeatureFlag('ramadan_planner');
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const canEdit = useActiveHouseholdStore(selectCanEdit);
  const { premium, loading: premiumLoading } = usePremium(householdId);
  const entitlements = useEntitlements(householdId);
  const upcoming = useUpcomingRamadan(householdId);
  const plan = useRamadanPlan(householdId, upcoming.hijriYear);
  const readOnly = isReadOnlyPremiumArea(premium, Boolean(plan.data));

  useEffect(() => {
    if (!premiumLoading && !plan.isLoading) track('ramadan_tips_viewed', { premium });
  }, [premiumLoading, plan.isLoading, premium]);

  const start = plan.data?.startDate ?? upcoming.computedStart;
  const end = plan.data?.endDate ?? (start ? ramadanEndDate(start, upcoming.computedDays) : null);
  const openSetup = () => navigation.navigate('RamadanSetup', { hijriYear: upcoming.hijriYear });

  return (
    <Screen
      testID="ramadan.screen"
      refreshing={plan.isRefetching}
      onRefresh={() => void plan.refetch()}
    >
      <Text variant="title" accessibilityRole="header">
        {t('planner.title', { year: upcoming.hijriYear })}
      </Text>
      {start && end ? (
        <Text tone="muted" testID="ramadan.dates">
          {t('planner.dates', {
            start: formatPlanDate(start, i18n.language),
            end: formatPlanDate(end, i18n.language),
          })}
        </Text>
      ) : null}
      {!enabled ? <InlineMessage tone="info" message={t('planner.disabled')} /> : null}
      <DowngradeBanner notice={downgradeNotice(entitlements.data)} />

      <RamadanTodayCard householdId={householdId} onOpen={() => undefined} />

      {plan.isError && !plan.data ? (
        <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(plan.error)}`)} />
      ) : null}

      {plan.data ? (
        <PlanSchedule
          householdId={householdId}
          plan={plan.data}
          today={upcoming.today}
          onOpenMeal={(dailyMealId) =>
            navigation.navigate('PlanTab', { screen: 'MealDetail', params: { dailyMealId } })
          }
          onOpenProgress={(mealPlanId) =>
            navigation.navigate('PlanGenerationProgress', { mealPlanId })
          }
        />
      ) : null}

      {enabled && !plan.isLoading && !plan.data && premium && canEdit ? (
        <Card variant="outlined" testID="ramadan.setup-card">
          <Text variant="bodyStrong">{t('planner.setupTitle')}</Text>
          <Text tone="muted">{t('planner.setupBody')}</Text>
          <Button label={t('planner.setup')} onPress={openSetup} testID="ramadan.setup" />
        </Card>
      ) : null}
      {enabled && !premiumLoading && !premium && !plan.data ? (
        <UpsellCard
          trigger="ramadan_plan"
          title={t('upsell.title')}
          body={t('upsell.body')}
          {...(canEdit ? { intent: openSetup } : {})}
          testID="ramadan.upsell"
        />
      ) : null}
      {readOnly ? (
        <InlineMessage tone="info" message={t('planner.readOnly')} testID="ramadan.read-only" />
      ) : null}

      <View className="gap-3" testID="ramadan.tips">
        <Text variant="heading" accessibilityRole="header">
          {t('tips.title')}
        </Text>
        {RAMADAN_TIPS.map((tip) => (
          <Card key={tip} variant="filled" testID={`ramadan.tip.${tip}`}>
            <Text variant="bodyStrong">{t(`tips.${tip}.title`)}</Text>
            <Text tone="muted">{t(`tips.${tip}.body`)}</Text>
          </Card>
        ))}
        <Text variant="caption" tone="muted">
          {t('tips.disclaimer')}
        </Text>
      </View>
    </Screen>
  );
}

function PlanSchedule({
  householdId,
  plan,
  today,
  onOpenMeal,
  onOpenProgress,
}: {
  householdId: string | null;
  plan: RamadanPlanView;
  today: string;
  onOpenMeal: (dailyMealId: string) => void;
  onOpenProgress: (mealPlanId: string) => void;
}) {
  const { t, i18n } = useTranslation(['ramadan', 'meals']);
  const dates = planDates(plan);
  const [index, setIndex] = useState(() => Math.max(0, (ramadanDay(today, plan) ?? 1) - 1));
  const date = dates[Math.min(index, dates.length - 1)] ?? plan.startDate;
  const plans = useMealPlans(householdId);
  const mealPlan = (plans.data ?? []).find((p) => p.id === plan.mealPlanId) ?? null;
  const meals = useDailyMeals(householdId, plan.mealPlanId, date, date);
  const cached = plan.prayerTimes.find((d) => d.date === date);
  const computed = useFastingTimes(householdId, date);
  const suhoorEnd = cached?.fajr ?? computed?.suhoorEnd ?? null;
  const iftar = cached?.maghrib ?? computed?.iftar ?? null;

  useEffect(() => {
    track('ramadan_plan_viewed', { day: index + 1 });
  }, [index]);

  return (
    <View className="gap-3" testID="ramadan.schedule">
      <Text variant="heading" accessibilityRole="header">
        {t('planner.scheduleTitle')}
      </Text>
      {mealPlan?.status === 'generating' && plan.mealPlanId ? (
        <Card variant="outlined" testID="ramadan.generating">
          <Text>{t('planner.generating')}</Text>
          <Button
            label={t('planner.viewProgress')}
            size="sm"
            variant="secondary"
            className="self-start"
            onPress={() => onOpenProgress(plan.mealPlanId as string)}
          />
        </Card>
      ) : null}
      <View className="flex-row items-center justify-between gap-2">
        <Button
          label={t('planner.prevDay')}
          size="sm"
          variant="ghost"
          disabled={index <= 0}
          onPress={() => setIndex((i) => Math.max(0, i - 1))}
          testID="ramadan.prev-day"
        />
        <View className="flex-1 items-center">
          <Text variant="bodyStrong" testID="ramadan.day-label">
            {t('planner.dayN', { day: index + 1 })}
          </Text>
          <Text variant="caption" tone="muted">
            {formatPlanDate(date, i18n.language)}
          </Text>
        </View>
        <Button
          label={t('planner.nextDay')}
          size="sm"
          variant="ghost"
          disabled={index >= dates.length - 1}
          onPress={() => setIndex((i) => Math.min(dates.length - 1, i + 1))}
          testID="ramadan.next-day"
        />
      </View>
      <Card variant="filled">
        {suhoorEnd ? <Text>{t('today.suhoorEnds', { time: suhoorEnd })}</Text> : null}
        {iftar ? <Text>{t('today.iftarAt', { time: iftar })}</Text> : null}
        {!suhoorEnd && !iftar ? <Text tone="muted">{t('planner.noTimes')}</Text> : null}
      </Card>
      {meals.isLoading ? <Text tone="muted">{t('meals:loading')}</Text> : null}
      {(meals.data ?? []).map((m) => (
        <Card
          key={m.id}
          variant="outlined"
          onPress={() => onOpenMeal(m.id)}
          accessibilityLabel={`${t(`meals:mealType.${m.mealType}`)}: ${localized(m.meal.titleI18n, i18n.language, m.meal.title)}`}
          testID={`ramadan.meal.${m.mealType}`}
        >
          <Text variant="caption" tone="muted">
            {t(`meals:mealType.${m.mealType}`)}
          </Text>
          <Text variant="bodyStrong">
            {localized(m.meal.titleI18n, i18n.language, m.meal.title)}
          </Text>
        </Card>
      ))}
      {!meals.isLoading && (meals.data ?? []).length === 0 && mealPlan?.status !== 'generating' ? (
        <Text tone="muted">{t('planner.noMeals')}</Text>
      ) : null}
    </View>
  );
}
