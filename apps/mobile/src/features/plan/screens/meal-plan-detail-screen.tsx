import { useNavigation, useRoute } from '@react-navigation/native';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Card } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Disclosure } from '@/components/ui/disclosure';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { RecommendationList } from '@/features/knowledge';
import {
  AdaptationBadge,
  cardServings,
  cardTags,
  localized,
  MealCard,
  portionLabel,
  sortMeals,
  useDailyMeals,
  useHouseholdClock,
  useMemberLookup,
  type DailyMealView,
  type MemberLite,
} from '@/features/meals';
import { addDays, dateRange } from '@/lib/dates/local-date';
import { track } from '@/lib/analytics/track';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { PlanScreenProps } from '@/navigation/types';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';

import { PlanStatusChip } from '../components/plan-status-chip';
import { useMealPlan, usePlanRecommendationIds } from '../hooks/use-plans';
import { planTitle } from './meal-plans-screen';

type PlanViewMode = 'week' | 'day';

/**
 * P2 Meal Plan Detail (02 §7.6.2, 24 S3-08): week view (a compact grid, one row per day), day view
 * (date chips, each meal with per-member portions and adaptation badges), the weekly theme and
 * "Why this plan" (rationale plus the plan's verified recommendations). Reads from the persisted
 * cache offline.
 */
export function MealPlanDetailScreen() {
  const { t, i18n } = useTranslation(['plan', 'meals', 'errors']);
  const navigation = useNavigation<PlanScreenProps<'MealPlanDetail'>['navigation']>();
  const { params } = useRoute<PlanScreenProps<'MealPlanDetail'>['route']>();
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const plan = useMealPlan(householdId, params.mealPlanId);
  const clock = useHouseholdClock(householdId);
  const members = useMemberLookup(householdId);
  const recIds = usePlanRecommendationIds(householdId, params.mealPlanId);
  const p = plan.data ?? null;

  const weekCount = Math.max(1, p?.weekCount ?? 1);
  const [weekIndex, setWeekIndex] = useState(Math.min(params.weekIndex ?? 0, weekCount - 1));
  const [mode, setMode] = useState<PlanViewMode>('day');
  const weekStart = p ? addDays(p.startDate, weekIndex * 7) : '';
  const weekEnd = p ? minDate(addDays(weekStart, 6), p.endDate) : '';
  const days = useMemo(() => (p ? dateRange(weekStart, weekEnd) : []), [p, weekStart, weekEnd]);
  const initialDay = days.includes(clock.today) ? clock.today : (days[0] ?? '');
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const day = selectedDay && days.includes(selectedDay) ? selectedDay : initialDay;

  const meals = useDailyMeals(householdId, p?.id, weekStart, weekEnd);
  const byDay = useMemo(() => groupByDay(meals.data ?? []), [meals.data]);

  useEffect(() => {
    if (p) track('plan_viewed', { kind: p.kind, week_index: weekIndex });
  }, [p?.id, weekIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!p) {
    return (
      <Screen testID="plan-detail.screen">
        {plan.isError ? (
          <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(plan.error)}`)} />
        ) : (
          <Card variant="filled" testID="plan-detail.loading">
            <Text tone="muted">{t('plan:loading')}</Text>
          </Card>
        )}
      </Screen>
    );
  }

  const lang = i18n.language;
  const theme = p.weeklyThemes.find((w) => w.week === weekIndex + 1);
  const openMeal = (m: DailyMealView) => navigation.navigate('MealDetail', { dailyMealId: m.id });

  return (
    <Screen testID="plan-detail.screen">
      <View className="gap-1">
        <View className="flex-row flex-wrap items-center gap-2">
          <Text variant="title" accessibilityRole="header" className="flex-shrink">
            {planTitle(t, p)}
          </Text>
          <PlanStatusChip status={p.status} testID="plan-detail.status" />
        </View>
        <Text tone="muted">{t('plan:plans.dates', { from: p.startDate, to: p.endDate })}</Text>
      </View>

      {weekCount > 1 ? (
        <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
          {Array.from({ length: weekCount }, (_, i) => (
            <Chip
              key={i}
              role="radio"
              label={t('plan:detail.week', { number: i + 1 })}
              selected={i === weekIndex}
              onPress={() => setWeekIndex(i)}
              testID={`plan-detail.week-${i}`}
            />
          ))}
        </View>
      ) : null}

      {theme ? (
        <Card variant="filled" testID="plan-detail.theme">
          <Text variant="overline" tone="muted">
            {t('plan:detail.theme')}
          </Text>
          <Text variant="bodyStrong">{localized(theme.titleI18n, lang, theme.key)}</Text>
          {theme.bodyI18n ? <Text tone="muted">{localized(theme.bodyI18n, lang, '')}</Text> : null}
        </Card>
      ) : null}

      <View className="flex-row gap-2" accessibilityRole="radiogroup">
        <Chip
          role="radio"
          label={t('plan:detail.dayView')}
          selected={mode === 'day'}
          onPress={() => setMode('day')}
          testID="plan-detail.mode-day"
        />
        <Chip
          role="radio"
          label={t('plan:detail.weekView')}
          selected={mode === 'week'}
          onPress={() => setMode('week')}
          testID="plan-detail.mode-week"
        />
      </View>

      {meals.isError && !meals.data ? (
        <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(meals.error)}`)} />
      ) : null}
      {meals.isLoading ? <Text tone="muted">{t('plan:loading')}</Text> : null}

      {mode === 'week' ? (
        <View className="gap-3" testID="plan-detail.week">
          {days.map((d, di) => (
            <View key={d} className="gap-1" testID={`plan-detail.week.day-${di}`}>
              <Text variant="label" tone={d === clock.today ? 'primary' : 'muted'}>
                {formatDay(d, lang)}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {sortMeals(byDay.get(d) ?? []).map((m, mi) => (
                  <View key={m.id} className="min-w-[30%] flex-1">
                    <MealCard
                      density="cell"
                      mealType={m.mealType}
                      title={localized(m.meal.titleI18n, lang, m.meal.title)}
                      servings={cardServings(m, members, meals.pending)}
                      onPress={() => openMeal(m)}
                      testID={`plan-detail.week.day-${di}.meal-${mi}`}
                    />
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      ) : (
        <View className="gap-3" testID="plan-detail.day">
          <View className="flex-row flex-wrap gap-2" accessibilityRole="radiogroup">
            {days.map((d, di) => (
              <Chip
                key={d}
                role="radio"
                label={formatDay(d, lang)}
                selected={d === day}
                onPress={() => setSelectedDay(d)}
                testID={`plan-detail.day-${di}`}
              />
            ))}
          </View>
          {sortMeals(byDay.get(day) ?? []).map((m, mi) => (
            <View key={m.id} className="gap-2">
              <MealCard
                mealType={m.mealType}
                title={localized(m.meal.titleI18n, lang, m.meal.title)}
                scheduledTime={m.scheduledTime}
                plateSplit={m.meal.plateSplit}
                servings={cardServings(m, members, meals.pending)}
                tags={cardTags(m)}
                onPress={() => openMeal(m)}
                testID={`plan-detail.meal-${mi}`}
              />
              <MemberPortions
                meal={m}
                members={members}
                testID={`plan-detail.meal-${mi}.portions`}
              />
            </View>
          ))}
          {!meals.isLoading && (byDay.get(day) ?? []).length === 0 ? (
            <Text tone="muted" testID="plan-detail.day-empty">
              {t('plan:detail.noMeals')}
            </Text>
          ) : null}
        </View>
      )}

      <Disclosure
        title={t('plan:detail.why')}
        showHint={t('plan:detail.showHint')}
        hideHint={t('plan:detail.hideHint')}
        testID="plan-detail.why"
      >
        <View className="gap-3">
          {p.rationale ? <Text testID="plan-detail.rationale">{p.rationale}</Text> : null}
          <RecommendationList
            ids={recIds.data ?? []}
            max={3}
            testID="plan-detail.recommendations"
          />
        </View>
      </Disclosure>
      <Text variant="caption" tone="muted">
        {t('plan:disclaimer')}
      </Text>
    </Screen>
  );
}

/** Per-member portion lines: household measures only, children never see numbers (02 §1.1). */
function MemberPortions({
  meal,
  members,
  testID,
}: {
  meal: DailyMealView;
  members: ReadonlyMap<string, MemberLite>;
  testID: string;
}) {
  const { t, i18n } = useTranslation('meals');
  if (meal.servings.length === 0) return null;
  return (
    <View className="gap-1 ps-4" testID={testID}>
      {meal.servings.map((s, i) => {
        const member = members.get(s.familyMemberId);
        const portion = portionLabel(s.portion, i18n.language);
        return (
          <View
            key={s.id}
            className="flex-row flex-wrap items-center gap-2"
            testID={`${testID}.row-${i}`}
          >
            <Text variant="caption" className="font-semibold">
              {member?.name ?? ''}
            </Text>
            {portion ? (
              <Text variant="caption" tone="muted">
                {portion}
              </Text>
            ) : null}
            {s.adaptation !== 'none' ? (
              <AdaptationBadge adaptation={s.adaptation} testID={`${testID}.row-${i}.adaptation`} />
            ) : null}
            {s.adaptedMeal ? (
              <Text variant="caption" tone="muted">
                {t('serving.adaptedMeal', {
                  title: localized(s.adaptedMeal.titleI18n, i18n.language, s.adaptedMeal.title),
                })}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function groupByDay(meals: readonly DailyMealView[]): Map<string, DailyMealView[]> {
  const out = new Map<string, DailyMealView[]>();
  for (const m of meals) out.set(m.planDate, [...(out.get(m.planDate) ?? []), m]);
  return out;
}

function minDate(a: string, b: string): string {
  return a < b ? a : b;
}

/** Short weekday and day of month in the UI locale; falls back to the ISO date. */
export function formatDay(date: string, locale: string): string {
  try {
    const d = new Date(`${date}T12:00:00Z`);
    return new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(d);
  } catch {
    return date;
  }
}
