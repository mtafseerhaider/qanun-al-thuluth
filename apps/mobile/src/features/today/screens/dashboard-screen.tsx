import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import {
  KnowledgeEmptyState,
  RecommendationById,
  useVerifiedRecommendationIds,
} from '@/features/knowledge';
import {
  cardServings,
  cardTags,
  isFullyLogged,
  localized,
  logEveryoneAte,
  loggedCount,
  MealCard,
  pickNextMeal,
  sortMeals,
  UndoBar,
  useDailyMeals,
  useHouseholdClock,
  useMemberLookup,
  useUndo,
  type DailyMealView,
} from '@/features/meals';
import { PushPrePrompt } from '@/features/notifications';
import { useActivePlan, useGeneratePlan, useMealPlans } from '@/features/plan';
import { RamadanTodayCard } from '@/features/ramadan';
import { useIsOnline } from '@/hooks/use-is-online';
import { useProfile } from '@/hooks/use-profile';
import { track } from '@/lib/analytics/track';
import { dayNumber } from '@/lib/dates/local-date';
import { useOutboxStore } from '@/lib/offline/outbox';
import { useStartupMark } from '@/lib/perf/startup';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { TodayScreenProps } from '@/navigation/types';
import { selectCanEdit, useActiveHouseholdStore } from '@/stores/use-active-household-store';

import {
  NotificationBell,
  TodayBudgetLine,
  TodayFastingLine,
  TodayHydrationCard,
} from '../components/today-trackers';
import {
  formatHijriDate,
  formatLongDate,
  formatUpdatedAt,
  greetingFor,
  tipForDay,
} from '../utils/dashboard-rules';

/**
 * T1 Today (02 §7.5.1, 24 S3-11, FR-DASH-01 to -05): greeting and dates, the next meal, today's
 * meals with one-tap "Everyone ate", quick actions, the tip of the day (verified recommendations
 * only) and the alpha feedback entry. Sprint 4 adds the notification bell, the push pre-prompt, the
 * family hydration ring (FR-DASH-03), who is fasting today, the budget line and shortcuts to water,
 * the grocery list and the daily reflection. Everything renders from the persisted query cache, so it works
 * offline; logs queue in the outbox and show as "Saved, will sync".
 */
export function DashboardScreen() {
  const { t, i18n } = useTranslation(['today', 'meals', 'errors']);
  const navigation = useNavigation<TodayScreenProps<'Dashboard'>['navigation']>();
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const canEdit = useActiveHouseholdStore(selectCanEdit);
  const profile = useProfile();
  const clock = useHouseholdClock(householdId);
  const online = useIsOnline();
  const active = useActivePlan(householdId);
  const plans = useMealPlans(householdId);
  const generate = useGeneratePlan(householdId);
  const meals = useDailyMeals(householdId, active.data?.id, clock.today, clock.today);
  const members = useMemberLookup(householdId);
  const tips = useVerifiedRecommendationIds();
  const pendingCount = useOutboxStore((s) => s.entries.length);
  const undo = useUndo();
  const lang = i18n.language;
  // Cold-start budget point (01 §9.1): Today shows the plan state from cache or the network.
  useStartupMark('today_interactive', !active.isLoading && !meals.isLoading);

  const generating = (plans.data ?? []).find((p) => p.status === 'generating') ?? null;
  const latest = plans.data?.[0] ?? null;
  const failed = !active.data && latest?.status === 'failed' ? latest : null;
  const todays = sortMeals(meals.data ?? []);
  const next = pickNextMeal(todays, clock.nowMinutes);
  const allDone = todays.length > 0 && todays.every(isFullyLogged);
  const servingsTotal = todays.reduce((n, m) => n + m.servings.length, 0);
  const servingsLogged = todays.reduce((n, m) => n + loggedCount(m), 0);
  const tipId = tipForDay(tips.data ?? [], dayNumber(clock.today));
  const hijri = formatHijriDate(clock.today, lang);
  const updatedAt = formatUpdatedAt(meals.dataUpdatedAt);
  const name = profile.data?.display_name?.split(' ')[0] ?? '';

  const openMeal = (m: DailyMealView) => {
    track('dashboard_section_tapped', { section: 'meals' });
    navigation.navigate('MealDetail', { dailyMealId: m.id });
  };
  const everyoneAte = (m: DailyMealView) => {
    if (!householdId) return;
    const revert = logEveryoneAte(householdId, m, 'dashboard');
    undo.offer(t('meals:bulk.done'), revert);
  };
  const createPlan = () =>
    generate.mutate(
      { startDate: clock.today, source: 'plans' },
      {
        onSuccess: (accepted) =>
          navigation.navigate('PlanGenerationProgress', {
            mealPlanId: accepted.meal_plan_id,
            pollAfterMs: accepted.poll_after_ms,
          }),
      },
    );

  const card = (m: DailyMealView, testID: string, current = false) => (
    <MealCard
      key={m.id}
      mealType={m.mealType}
      title={localized(m.meal.titleI18n, lang, m.meal.title)}
      scheduledTime={m.scheduledTime}
      plateSplit={m.meal.plateSplit}
      servings={cardServings(m, members, meals.pending)}
      tags={cardTags(m)}
      current={current}
      onPress={() => openMeal(m)}
      onEveryoneAte={canEdit ? () => everyoneAte(m) : undefined}
      onSwap={
        canEdit ? () => navigation.navigate('SwapMealSheet', { dailyMealId: m.id }) : undefined
      }
      testID={testID}
    />
  );

  return (
    <Screen
      edges={['top']}
      testID="today-dashboard.screen"
      refreshing={meals.isRefetching}
      onRefresh={() => {
        void active.refetch();
        void meals.refetch();
      }}
    >
      <View className="gap-1" testID="today.header">
        <View className="flex-row items-start justify-between gap-2">
          <Text variant="title" accessibilityRole="header" className="flex-1">
            {name
              ? t(`today:greetingNamed.${greetingFor(clock.nowMinutes)}`, { name })
              : t(`today:greeting.${greetingFor(clock.nowMinutes)}`)}
          </Text>
          <NotificationBell onOpen={() => navigation.navigate('NotificationsCenter')} />
        </View>
        <Text tone="muted" testID="today.date">
          {formatLongDate(clock.today, lang)}
        </Text>
        {hijri ? (
          <Text variant="caption" tone="muted" testID="today.hijri">
            {hijri}
          </Text>
        ) : null}
      </View>

      {!online ? (
        <InlineMessage
          tone="info"
          message={updatedAt ? t('today:offlineUpdated', { time: updatedAt }) : t('today:offline')}
          testID="today.offline"
        />
      ) : null}

      <PushPrePrompt hasPlan={Boolean(active.data)} />

      {generating && !active.data ? (
        <Card
          variant="filled"
          onPress={() =>
            navigation.navigate('PlanGenerationProgress', { mealPlanId: generating.id })
          }
          accessibilityLabel={t('today:plan.generating')}
          testID="today.plan-generating"
        >
          <Text variant="bodyStrong">{t('today:plan.generating')}</Text>
          <Text tone="muted">{t('today:plan.generatingBody')}</Text>
        </Card>
      ) : null}

      {failed && !generating ? (
        <Card variant="outlined" testID="today.plan-failed">
          <Text variant="bodyStrong">{t('today:plan.failedTitle')}</Text>
          <Text tone="muted">{t('today:plan.failedBody')}</Text>
          {canEdit ? (
            <Button
              label={t('today:plan.tryAgain')}
              size="sm"
              disabled={!online}
              loading={generate.isPending}
              onPress={createPlan}
              testID="today.plan-failed.retry"
            />
          ) : null}
        </Card>
      ) : null}

      {!active.data && !generating && !failed && !active.isLoading ? (
        <Card variant="filled" testID="today.empty">
          <Text variant="bodyStrong">{t('today:empty.title')}</Text>
          <Text tone="muted">{t('today:empty.body')}</Text>
          {canEdit ? (
            <Button
              label={t('today:empty.create')}
              disabled={!online}
              loading={generate.isPending}
              onPress={createPlan}
              testID="today.empty.create"
            />
          ) : null}
          {generate.isError ? (
            <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(generate.error)}`)} />
          ) : null}
        </Card>
      ) : null}

      {active.data ? (
        <>
          {next ? (
            <View className="gap-2" testID="today.next-meal">
              <Text variant="overline" tone="muted">
                {t('today:nextMeal')}
              </Text>
              {card(next, 'today.next-meal.card', true)}
            </View>
          ) : null}
          {allDone ? (
            <Card variant="filled" testID="today.all-done">
              <Text variant="bodyStrong">{t('today:allDone')}</Text>
            </Card>
          ) : null}

          <View className="gap-3" testID="today.meals">
            <View className="flex-row items-center justify-between gap-2">
              <Text variant="heading" accessibilityRole="header">
                {t('today:todaysMeals')}
              </Text>
              {servingsTotal > 0 ? (
                <Text variant="caption" tone="muted" testID="today.summary">
                  {t('today:summary', { logged: servingsLogged, total: servingsTotal })}
                </Text>
              ) : null}
            </View>
            {meals.isLoading ? <Text tone="muted">{t('meals:loading')}</Text> : null}
            {meals.isError && !meals.data ? (
              <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(meals.error)}`)} />
            ) : null}
            {!meals.isLoading && todays.length === 0 && !meals.isError ? (
              <Text tone="muted" testID="today.no-meals">
                {t('today:noMealsToday')}
              </Text>
            ) : null}
            {todays.filter((m) => m.id !== next?.id).map((m, i) => card(m, `today.meal-${i}`))}
          </View>
        </>
      ) : null}

      <RamadanTodayCard
        householdId={householdId}
        onOpen={() =>
          navigation.navigate('MoreTab', { screen: 'RamadanPlanner', params: {}, initial: false })
        }
      />
      <TodayFastingLine
        householdId={householdId}
        today={clock.today}
        onOpen={() =>
          navigation.navigate('MoreTab', { screen: 'FastingTracker', params: {}, initial: false })
        }
      />
      <TodayHydrationCard
        householdId={householdId}
        onOpen={() =>
          navigation.navigate('MoreTab', { screen: 'HydrationTracker', params: {}, initial: false })
        }
      />
      <TodayBudgetLine
        householdId={householdId}
        onOpen={() =>
          navigation.navigate('MoreTab', { screen: 'BudgetDashboard', params: {}, initial: false })
        }
      />

      <UndoBar
        pending={undo.pending}
        onUndo={() => {
          undo.pending?.undo();
          undo.clear();
        }}
        testID="today.undo"
      />

      <Card variant="outlined" testID="today.quick-log">
        <Text variant="overline" tone="muted">
          {t('today:quick.title')}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {next && canEdit ? (
            <Button
              label={t('today:quick.logMeal')}
              size="sm"
              onPress={() => {
                track('dashboard_section_tapped', { section: 'quick_log' });
                navigation.navigate('MealDetail', { dailyMealId: next.id });
              }}
              testID="today.quick-log.meal"
            />
          ) : null}
          {canEdit ? (
            <Button
              label={t('today:quick.water')}
              size="sm"
              variant="secondary"
              onPress={() => {
                track('dashboard_section_tapped', { section: 'hydration' });
                navigation.navigate('MoreTab', {
                  screen: 'HydrationTracker',
                  params: {},
                  initial: false,
                });
              }}
              testID="today.quick-log.water"
            />
          ) : null}
          <Button
            label={t('today:quick.grocery')}
            size="sm"
            variant="secondary"
            onPress={() => {
              track('dashboard_section_tapped', { section: 'grocery' });
              navigation.navigate('PlanTab', { screen: 'GroceryLists', initial: false });
            }}
            testID="today.quick-log.grocery"
          />
          {canEdit ? (
            <Button
              label={t('today:quick.reflect')}
              size="sm"
              variant="secondary"
              onPress={() => navigation.navigate('DailyReflection', {})}
              testID="today.quick-log.reflect"
            />
          ) : null}
          <Button
            label={t('today:quick.askThuluth')}
            size="sm"
            variant="secondary"
            onPress={() => navigation.navigate('ChatTab', { screen: 'ChatThread', params: {} })}
            testID="today.quick-log.chat"
          />
          {active.data ? (
            <Button
              label={t('today:quick.openPlan')}
              size="sm"
              variant="ghost"
              onPress={() => {
                track('dashboard_section_tapped', { section: 'plan' });
                navigation.navigate('PlanTab', {
                  screen: 'MealPlanDetail',
                  params: { mealPlanId: active.data?.id ?? '' },
                });
              }}
              testID="today.quick-log.plan"
            />
          ) : null}
        </View>
        {pendingCount > 0 ? (
          <Text variant="caption" tone="muted" testID="today.pending-sync">
            {t('today:pendingSync', { count: pendingCount })}
          </Text>
        ) : null}
      </Card>

      <View className="gap-2" testID="today.tip">
        <Text variant="heading" accessibilityRole="header">
          {t('today:tipTitle')}
        </Text>
        {tipId ? (
          <RecommendationById id={tipId} testID="today.tip.card" />
        ) : tips.isLoading ? null : (
          <KnowledgeEmptyState testID="today.tip.empty" />
        )}
      </View>

      <Card
        variant="filled"
        onPress={() => {
          track('dashboard_section_tapped', { section: 'feedback' });
          navigation.navigate('MoreTab', { screen: 'AlphaFeedback' });
        }}
        accessibilityLabel={t('today:feedback.title')}
        testID="today.feedback"
      >
        <Text variant="bodyStrong">{t('today:feedback.title')}</Text>
        <Text tone="muted">{t('today:feedback.body')}</Text>
      </Card>

      <Text variant="caption" tone="muted">
        {t('meals:disclaimer')}
      </Text>
    </Screen>
  );
}
