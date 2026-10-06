import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { LifeStage } from '@shared';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useFamilyMembers } from '@/features/family';
import {
  RecommendationList,
  SourceCitationChip,
  usePublicSources,
  useRecommendationIdsForSources,
} from '@/features/knowledge';
import { Badge, isMinorStage, localized, portionLabel } from '@/features/meals';
import { track } from '@/lib/analytics/track';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { MealStackParamList } from '@/navigation/types';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';

import type { RecipeView } from '../api/recipes-api';
import { useRecipe, useSunnahSourceIds } from '../hooks/use-recipes';
import {
  clampServings,
  defaultServings,
  formatQuantity,
  scaleFactor,
  scaleQuantity,
} from '../utils/scaling';

const STAGE_ORDER: readonly LifeStage[] = [
  'adult',
  'older_adult',
  'teen',
  'child',
  'toddler',
  'infant',
];

/**
 * P4 Recipe Detail (02 §7.6.4, 24 S3-09): badges (kid, autism, Ramadan, Sunnah only with a verified
 * source), servings stepper (defaults to the family size), scaled ingredients with halal notes,
 * steps, portions per life stage (children: household measures only), nutrition per adult serving
 * and the verified recommendations linked to the recipe's Sunnah sources.
 */
export function RecipeDetailScreen() {
  const { t, i18n } = useTranslation(['recipes', 'errors']);
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<MealStackParamList, 'RecipeDetail'>>();
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const members = useFamilyMembers(householdId);
  const recipe = useRecipe(params.recipeId);
  const r = recipe.data ?? null;
  const sunnahIngredientIds = (r?.ingredients ?? [])
    .filter((i) => i.isSunnahFood)
    .map((i) => i.ingredientId);
  const sunnahSourceIds = useSunnahSourceIds(sunnahIngredientIds);
  const sources = usePublicSources(sunnahSourceIds.data ?? []);
  const recIds = useRecommendationIdsForSources((sources.data ?? []).map((s) => s.id));
  const [servings, setServings] = useState<number | null>(null);

  useEffect(() => {
    if (r) track('recipe_opened', { recipe_source: recipeSource(r.source) });
  }, [r?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!r) {
    return (
      <Screen testID="recipe-detail.screen">
        {recipe.isError ? (
          <View className="gap-2" testID="recipe-detail.error">
            <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(recipe.error)}`)} />
            <Button
              label={t('recipes:retry')}
              variant="secondary"
              onPress={() => void recipe.refetch()}
            />
          </View>
        ) : recipe.isLoading ? (
          <Card variant="filled" testID="recipe-detail.loading">
            <Text tone="muted">{t('recipes:loading')}</Text>
          </Card>
        ) : (
          <Card variant="filled" testID="recipe-detail.unavailable">
            <Text tone="muted">{t('recipes:unavailable')}</Text>
          </Card>
        )}
      </Screen>
    );
  }

  const lang = i18n.language;
  const target = servings ?? defaultServings(members.data?.length ?? 0, r.servings);
  const factor = scaleFactor(r.servings, target);
  const verifiedSources = sources.data ?? [];
  const hasSunnah = verifiedSources.length > 0;
  const hasHalalNote = r.ingredients.some((i) => i.halalStatus === 'depends_on_source');

  return (
    <Screen testID="recipe-detail.screen">
      <View className="gap-2">
        <Text variant="title" accessibilityRole="header" testID="recipe-detail.title">
          {localized(r.titleI18n, lang, r.title)}
        </Text>
        <Text tone="muted">{t('recipes:time', { prep: r.prepMin, cook: r.cookMin })}</Text>
        <View className="flex-row flex-wrap gap-2" testID="recipe-detail.badges">
          {r.kidFriendly ? (
            <Badge
              label={t('recipes:badges.kid')}
              tone="primary"
              testID="recipe-detail.badge-kid"
            />
          ) : null}
          {r.autismFriendly ? (
            <Badge
              label={t('recipes:badges.autism')}
              tone="info"
              testID="recipe-detail.badge-autism"
            />
          ) : null}
          {r.ramadanSuitable ? (
            <Badge label={t('recipes:badges.ramadan')} testID="recipe-detail.badge-ramadan" />
          ) : null}
          {hasSunnah ? (
            <Badge
              label={t('recipes:badges.sunnah')}
              tone="primary"
              testID="recipe-detail.badge-sunnah"
            />
          ) : null}
        </View>
        {hasSunnah ? (
          <View className="gap-1" testID="recipe-detail.sunnah-sources">
            {verifiedSources.map((s, i) => (
              <SourceCitationChip
                key={s.id}
                source={s}
                onPress={(islamicSourceId) =>
                  navigation.navigate('SourceDetailSheet', { islamicSourceId })
                }
                testID={`recipe-detail.source-${i}`}
              />
            ))}
          </View>
        ) : null}
      </View>

      {r.reviewStatus !== 'verified' ? (
        <InlineMessage
          tone="info"
          message={t('recipes:notReviewed')}
          testID="recipe-detail.not-reviewed"
        />
      ) : null}

      <ServingsStepper
        value={target}
        onChange={(n) => setServings(clampServings(n))}
        testID="recipe-detail.servings"
      />

      <View className="gap-2" testID="recipe-detail.ingredients">
        <Text variant="heading" accessibilityRole="header">
          {t('recipes:ingredients')}
        </Text>
        {r.ingredients.map((ing, i) => (
          <View
            key={ing.id}
            className="flex-row flex-wrap gap-2"
            testID={`recipe-detail.ingredient-${i}`}
          >
            <Text className="min-w-[64px]" testID={`recipe-detail.ingredient-${i}.qty`}>
              {t('recipes:quantity', {
                qty: formatQuantity(scaleQuantity(ing.quantity, factor)),
                unit: ing.unit,
              })}
            </Text>
            <Text className="flex-1">
              {localized(ing.nameI18n, lang, ing.name)}
              {ing.prepNote ? `, ${ing.prepNote}` : ''}
              {ing.optional ? ` ${t('recipes:optional')}` : ''}
              {ing.halalStatus === 'depends_on_source' ? ' *' : ''}
            </Text>
          </View>
        ))}
        {hasHalalNote ? (
          <Text variant="caption" tone="muted" testID="recipe-detail.halal-note">
            {t('recipes:halalNote')}
          </Text>
        ) : null}
      </View>

      <View className="gap-2" testID="recipe-detail.steps">
        <Text variant="heading" accessibilityRole="header">
          {t('recipes:steps')}
        </Text>
        {r.steps.map((s, i) => (
          <View key={s.n} className="flex-row gap-3" testID={`recipe-detail.step-${i}`}>
            <Text variant="bodyStrong">{t('recipes:stepNumber', { n: i + 1 })}</Text>
            <View className="flex-1 gap-1">
              <Text>{localized(s.textI18n, lang, '')}</Text>
              {s.timerMin ? (
                <Text variant="caption" tone="muted">
                  {t('recipes:timer', { minutes: s.timerMin })}
                </Text>
              ) : null}
            </View>
          </View>
        ))}
      </View>

      <PortionsTable recipe={r} testID="recipe-detail.portions" />

      <Disclosure
        title={t('recipes:nutrition.title')}
        showHint={t('recipes:showHint')}
        hideHint={t('recipes:hideHint')}
        testID="recipe-detail.nutrition"
      >
        <NutritionRows recipe={r} />
      </Disclosure>

      <View className="gap-2">
        <Text variant="heading" accessibilityRole="header">
          {t('recipes:related')}
        </Text>
        <RecommendationList
          ids={recIds.data ?? []}
          max={3}
          testID="recipe-detail.recommendations"
        />
      </View>
      <Text variant="caption" tone="muted">
        {t('recipes:disclaimer')}
      </Text>
    </Screen>
  );
}

function recipeSource(source: string): 'user' | 'curated' | 'ai_generated' {
  return source === 'user' || source === 'ai_generated' ? source : 'curated';
}

function ServingsStepper({
  value,
  onChange,
  testID,
}: {
  value: number;
  onChange: (n: number) => void;
  testID: string;
}) {
  const { t } = useTranslation('recipes');
  return (
    <View
      className="flex-row items-center gap-3"
      accessibilityRole="adjustable"
      accessibilityLabel={t('servings.a11y', { count: value })}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) =>
        onChange(e.nativeEvent.actionName === 'increment' ? value + 1 : value - 1)
      }
      testID={testID}
    >
      <Text variant="bodyStrong" className="flex-1">
        {t('servings.label', { count: value })}
      </Text>
      <Button
        label="−"
        accessibilityLabel={t('servings.less')}
        size="sm"
        variant="secondary"
        onPress={() => onChange(value - 1)}
        testID={`${testID}.less`}
      />
      <Text variant="heading" testID={`${testID}.value`}>
        {String(value)}
      </Text>
      <Button
        label="+"
        accessibilityLabel={t('servings.more')}
        size="sm"
        variant="secondary"
        onPress={() => onChange(value + 1)}
        testID={`${testID}.more`}
      />
    </View>
  );
}

/** One row per life stage: adults see the measure and grams, children the measure only (02 §1.1). */
function PortionsTable({ recipe, testID }: { recipe: RecipeView; testID: string }) {
  const { t, i18n } = useTranslation(['recipes', 'meals']);
  const rows = STAGE_ORDER.flatMap((stage) => {
    const p =
      recipe.portions.find((x) => x.lifeStage === stage && x.tier === 'standard') ??
      recipe.portions.find((x) => x.lifeStage === stage);
    return p ? [p] : [];
  });
  if (rows.length === 0) return null;
  return (
    <View className="gap-2" testID={testID}>
      <Text variant="heading" accessibilityRole="header">
        {t('recipes:portions')}
      </Text>
      {rows.map((p) => {
        const minor = isMinorStage(p.lifeStage);
        return (
          <View
            key={p.lifeStage}
            className="flex-row flex-wrap gap-2"
            testID={`${testID}.${p.lifeStage}`}
          >
            <Text variant="bodyStrong" className="min-w-[96px]">
              {t(`recipes:stages.${p.lifeStage}`)}
            </Text>
            <Text className="flex-1">
              {minor
                ? portionLabel(p, i18n.language)
                : t('recipes:portionAdult', {
                    measure: portionLabel(p, i18n.language),
                    grams: Math.round(p.grams),
                  })}
            </Text>
            {minor ? (
              <Text variant="caption" tone="muted">
                {t('meals:serving.secondsWelcome')}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function NutritionRows({ recipe }: { recipe: RecipeView }) {
  const { t } = useTranslation('recipes');
  const n = recipe.nutrition;
  const rows: Array<[string, number | null, string]> = [
    ['kcal', n.kcal, 'kcal'],
    ['protein', n.proteinG, 'g'],
    ['carbs', n.carbsG, 'g'],
    ['fiber', n.fiberG, 'g'],
    ['fat', n.fatG, 'g'],
    ['sodium', n.sodiumMg, 'mg'],
    ['iron', n.ironMg, 'mg'],
    ['calcium', n.calciumMg, 'mg'],
  ];
  return (
    <View className="gap-1">
      <Text variant="caption" tone="muted">
        {t('nutrition.perAdult')}
      </Text>
      {rows
        .filter(([, v]) => v !== null)
        .map(([key, v, unit]) => (
          <View key={key} className="flex-row justify-between gap-2">
            <Text>{t(`nutrition.${key}`)}</Text>
            <Text tone="muted">
              {t('nutrition.value', { value: Math.round((v as number) * 10) / 10, unit })}
            </Text>
          </View>
        ))}
    </View>
  );
}
