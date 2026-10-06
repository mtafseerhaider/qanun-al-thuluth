import {
  useNavigation,
  useRoute,
  type CompositeNavigationProp,
  type RouteProp,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { track } from '@/lib/analytics/track';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { MealStackParamList, RootStackParamList } from '@/navigation/types';
import { selectCanEdit, useActiveHouseholdStore } from '@/stores/use-active-household-store';

import { MealPlateLegend } from '../components/meal-plate-legend';
import { MealServingsEditor } from '../components/meal-servings-editor';
import { ThuluthGuidance } from '../components/thuluth-guidance';
import { UndoBar, useUndo } from '../components/undo-bar';
import {
  logEveryoneAte,
  logServing,
  useDailyMeal,
  useHouseholdClock,
  useMealRecipeTitles,
  useMemberLookup,
} from '../hooks/use-meals';
import { localized } from '../utils/meal-parsing';
import { isFullyLogged, isMainMeal, isMinorStage } from '../utils/meal-rules';

type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<MealStackParamList>,
  NativeStackNavigationProp<RootStackParamList>
>;

/**
 * T3 Meal Detail (02 §7.5.3): the meal, its plate, the Thuluth guidance (adult and child variants,
 * FR-PLAN-08), components linking to recipes, per-member servings with logging (S3-12) and swap
 * (S3-13). Works from the persisted cache offline; logs queue in the outbox.
 */
export function MealDetailScreen() {
  const { t, i18n } = useTranslation(['meals', 'errors']);
  const navigation = useNavigation<Nav>();
  const { params } = useRoute<RouteProp<MealStackParamList, 'MealDetail'>>();
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const canEdit = useActiveHouseholdStore(selectCanEdit);
  const query = useDailyMeal(householdId, params.dailyMealId);
  const members = useMemberLookup(householdId);
  const clock = useHouseholdClock(householdId);
  const meal = query.data ?? null;
  const recipeIds = (meal?.meal.components ?? []).flatMap((c) =>
    c.kind === 'recipe' ? [c.recipeId] : [],
  );
  const recipes = useMealRecipeTitles(meal?.meal.id, recipeIds);
  const undo = useUndo();

  useEffect(() => {
    if (meal) track('meal_detail_viewed', { meal_type: meal.mealType });
    // Once per opened meal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meal?.id]);

  if (!meal) {
    return (
      <Screen testID="meal-detail.screen">
        {query.isError ? (
          <View className="gap-2" testID="meal-detail.error">
            <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(query.error)}`)} />
            <Button
              label={t('meals:retry')}
              variant="secondary"
              onPress={() => void query.refetch()}
            />
          </View>
        ) : (
          <Card variant="filled" testID="meal-detail.loading">
            <Text tone="muted">{t('meals:loading')}</Text>
          </Card>
        )}
      </Screen>
    );
  }

  const title = localized(meal.meal.titleI18n, i18n.language, meal.meal.title);
  const future = meal.planDate > clock.today;
  const canLog = canEdit && !future;
  const servingMembers = meal.servings.map((s) => members.get(s.familyMemberId));
  const hasAdult = servingMembers.some((m) => m && !isMinorStage(m.lifeStage));
  const hasChild = servingMembers.some((m) => m && isMinorStage(m.lifeStage));
  const queuedIds = new Set([...query.pending.keys()]);

  const everyoneAte = () => {
    if (!householdId) return;
    const revert = logEveryoneAte(householdId, meal, 'meal_detail');
    undo.offer(t('meals:bulk.done'), revert);
  };

  return (
    <Screen testID="meal-detail.screen">
      <View className="gap-1">
        <Text variant="overline" tone="muted">
          {t(`meals:mealType.${meal.mealType}`)}
        </Text>
        <Text variant="title" accessibilityRole="header" testID="meal-detail.title">
          {title}
        </Text>
        {future ? (
          <Text variant="caption" tone="muted" testID="meal-detail.future">
            {t('meals:detail.plannedFor', { date: meal.planDate })}
          </Text>
        ) : null}
      </View>
      {meal.meal.plateSplit ? <MealPlateLegend split={meal.meal.plateSplit} /> : null}
      {isMainMeal(meal.mealType) ? (
        <View className="gap-2" testID="meal-detail.guidance">
          {hasAdult ? <ThuluthGuidance variant="adult" /> : null}
          {hasChild ? <ThuluthGuidance variant="child" /> : null}
        </View>
      ) : null}
      {recipeIds.length > 0 ? (
        <View className="gap-2" testID="meal-detail.components">
          <Text variant="heading" accessibilityRole="header">
            {t('meals:detail.components')}
          </Text>
          {(recipes.data ?? []).map((r, i) => (
            <Button
              key={r.id}
              label={localized(r.titleI18n, i18n.language, r.title)}
              variant="link"
              className="self-start px-0"
              onPress={() =>
                navigation.navigate('RecipeDetail', { recipeId: r.id, dailyMealId: meal.id })
              }
              testID={`meal-detail.recipe-${i}`}
            />
          ))}
        </View>
      ) : null}
      <View className="gap-3">
        <Text variant="heading" accessibilityRole="header">
          {t('meals:detail.portions')}
        </Text>
        <MealServingsEditor
          meal={meal}
          members={members}
          queuedIds={queuedIds}
          disabled={!canLog}
          onStatus={(serving, member, status) =>
            householdId &&
            logServing({
              householdId,
              serving,
              status,
              acceptance: serving.acceptance,
              mealType: meal.mealType,
              lifeStage: member.lifeStage,
            })
          }
          onAcceptance={(serving, member, score) =>
            householdId &&
            logServing({
              householdId,
              serving,
              status: serving.status,
              acceptance: score,
              mealType: meal.mealType,
              lifeStage: member.lifeStage,
            })
          }
          testID="meal-detail.servings"
        />
      </View>
      <UndoBar
        pending={undo.pending}
        onUndo={() => {
          undo.pending?.undo();
          undo.clear();
        }}
        testID="meal-detail.undo"
      />
      {canEdit ? (
        <View className="gap-2">
          {canLog && !isFullyLogged(meal) ? (
            <Button
              label={t('meals:card.everyoneAte')}
              size="lg"
              fullWidth
              onPress={everyoneAte}
              testID="meal-detail.everyone-ate"
            />
          ) : null}
          <Button
            label={t('meals:card.swap')}
            variant="secondary"
            fullWidth
            onPress={() => navigation.navigate('SwapMealSheet', { dailyMealId: meal.id })}
            testID="meal-detail.swap"
          />
        </View>
      ) : (
        <Text variant="caption" tone="muted" testID="meal-detail.viewer">
          {t('meals:viewerNotice')}
        </Text>
      )}
      <Text variant="caption" tone="muted">
        {t('meals:disclaimer')}
      </Text>
    </Screen>
  );
}
