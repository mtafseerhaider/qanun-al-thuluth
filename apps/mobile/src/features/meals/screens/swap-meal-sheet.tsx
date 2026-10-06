import * as Crypto from 'expo-crypto';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { UpsellCard } from '@/features/subscription';
import { useFeatureFlag } from '@/hooks/use-feature-flag';
import { useIsOnline } from '@/hooks/use-is-online';
import { isAppError } from '@/lib/supabase/app-error';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { RootStackParamList } from '@/navigation/types';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';

import { localized } from '../utils/meal-parsing';
import { swapAccess } from '../utils/swap-rules';
import {
  useAiSwap,
  useDailyMeal,
  useHouseholdPremium,
  useMealAlternatives,
  useSwapMeal,
} from '../hooks/use-meals';

/**
 * X7 Swap Meal sheet (02 §5.5, 24 S3-13, FR-PLAN-12). Free: catalog alternatives from
 * `meal_alternatives` (verified only), swapped through PostgREST. Premium (and the `ai.plan.enabled`
 * flag): "Ask AI for another idea" through `ai-adjust-plan`. Free users see a calm upsell (P9); a
 * `PREMIUM_REQUIRED` from the server switches to the same state. Swaps need a connection.
 */
export function SwapMealSheet() {
  const { t, i18n } = useTranslation(['meals', 'errors']);
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<RootStackParamList, 'SwapMealSheet'>>();
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const meal = useDailyMeal(householdId, params.dailyMealId).data ?? null;
  const alternatives = useMealAlternatives(meal?.meal.id);
  const premium = useHouseholdPremium(householdId);
  const aiFlag = useFeatureFlag('ai.plan.enabled');
  const swap = useSwapMeal(householdId);
  const ai = useAiSwap(householdId);
  const [premiumRequired, setPremiumRequired] = useState(false);
  const aiKey = useRef(Crypto.randomUUID());
  const online = useIsOnline();

  const access = swapAccess({
    premium: premium.data === true,
    aiFlag,
    serverSaidPremiumRequired: premiumRequired,
  });
  const lang = i18n.language;
  const title = meal ? localized(meal.meal.titleI18n, lang, meal.meal.title) : '';

  const askAi = () => {
    if (!meal) return;
    ai.preview.mutate(
      {
        mealPlanId: meal.mealPlanId,
        planDate: meal.planDate,
        mealType: meal.mealType,
        changeRequest: t('meals:swap.aiRequest', { title: meal.meal.title }),
      },
      {
        onError: (e) => {
          if (isAppError(e) && e.code === 'PREMIUM_REQUIRED') setPremiumRequired(true);
        },
      },
    );
  };
  const applyAi = () => {
    if (!meal) return;
    ai.apply.mutate(
      {
        mealPlanId: meal.mealPlanId,
        planDate: meal.planDate,
        mealType: meal.mealType,
        changeRequest: t('meals:swap.aiRequest', { title: meal.meal.title }),
        idempotencyKey: aiKey.current,
      },
      {
        onSuccess: () => navigation.goBack(),
        onError: (e) => {
          if (isAppError(e) && e.code === 'PREMIUM_REQUIRED') setPremiumRequired(true);
        },
      },
    );
  };

  const suggestion =
    ai.preview.data?.kind === 'completed'
      ? ai.preview.data.diff.find((d) => d.after)?.after?.title
      : undefined;

  return (
    <Screen testID="swap-meal.screen">
      <Text variant="title" accessibilityRole="header">
        {t('meals:swap.title')}
      </Text>
      {meal ? (
        <Text tone="muted" testID="swap-meal.current">
          {t('meals:swap.current', { title })}
        </Text>
      ) : null}
      {!online ? (
        <InlineMessage tone="info" message={t('meals:swap.offline')} testID="swap-meal.offline" />
      ) : null}

      <View className="gap-3" testID="swap-meal.alternatives">
        <Text variant="heading" accessibilityRole="header">
          {t('meals:swap.catalogTitle')}
        </Text>
        {alternatives.isLoading ? <Text tone="muted">{t('meals:loading')}</Text> : null}
        {alternatives.data && alternatives.data.length === 0 ? (
          <Card variant="filled" testID="swap-meal.empty">
            <Text tone="muted">{t('meals:swap.empty')}</Text>
          </Card>
        ) : null}
        {(alternatives.data ?? []).map((alt, i) => (
          <Card
            key={alt.id}
            variant="outlined"
            onPress={() =>
              online &&
              meal &&
              swap.mutate(
                { dailyMealId: meal.id, alternativeMealId: alt.meal.id, reason: alt.reason },
                { onSuccess: () => navigation.goBack() },
              )
            }
            accessibilityLabel={t('meals:swap.pickA11y', {
              title: localized(alt.meal.titleI18n, lang, alt.meal.title),
            })}
            testID={`swap-meal.alternative-${i}`}
          >
            <Text variant="bodyStrong">{localized(alt.meal.titleI18n, lang, alt.meal.title)}</Text>
            <Text variant="caption" tone="muted">
              {t(`meals:swap.reason.${alt.reason}`)}
            </Text>
            {alt.notes ? <Text variant="caption">{alt.notes}</Text> : null}
          </Card>
        ))}
        {swap.isError ? (
          <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(swap.error)}`)} />
        ) : null}
      </View>

      <View className="gap-3" testID="swap-meal.ai">
        <Text variant="heading" accessibilityRole="header">
          {t('meals:swap.aiTitle')}
        </Text>
        {access === 'upsell' ? (
          <UpsellCard
            trigger="plan_adjust"
            title={t('meals:swap.upsellTitle')}
            body={t('meals:swap.upsellBody')}
            testID="swap-meal.upsell"
          />
        ) : null}
        {access === 'disabled' ? (
          <Text tone="muted" testID="swap-meal.ai-disabled">
            {t('meals:swap.aiPaused')}
          </Text>
        ) : null}
        {access === 'ai' ? (
          <>
            <Button
              label={t('meals:swap.askAi')}
              variant="secondary"
              disabled={!online || !meal}
              loading={ai.preview.isPending}
              onPress={askAi}
              testID="swap-meal.ask-ai"
            />
            {suggestion ? (
              <Card variant="outlined" testID="swap-meal.ai-suggestion">
                <Text variant="bodyStrong">{suggestion}</Text>
                {ai.preview.data?.kind === 'completed' ? (
                  <Text variant="caption" tone="muted">
                    {ai.preview.data.rationale}
                  </Text>
                ) : null}
                <Button
                  label={t('meals:swap.useAi')}
                  loading={ai.apply.isPending}
                  onPress={applyAi}
                  testID="swap-meal.use-ai"
                />
              </Card>
            ) : null}
            {ai.preview.isError && !premiumRequired ? (
              <InlineMessage
                tone="danger"
                message={t(`errors:${errorKeyFor(ai.preview.error)}`)}
                testID="swap-meal.ai-error"
              />
            ) : null}
          </>
        ) : null}
      </View>
    </Screen>
  );
}
