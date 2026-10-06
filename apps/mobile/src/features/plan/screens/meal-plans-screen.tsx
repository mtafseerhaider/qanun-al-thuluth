import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useHouseholdClock } from '@/features/meals';
import { useIsOnline } from '@/hooks/use-is-online';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { PlanScreenProps } from '@/navigation/types';
import { selectCanEdit, useActiveHouseholdStore } from '@/stores/use-active-household-store';

import type { MealPlanView } from '../api/plan-api';
import { PlanStatusChip } from '../components/plan-status-chip';
import { useGeneratePlan, useMealPlans } from '../hooks/use-plans';

/**
 * P1 Meal Plans (02 §7.6.1, 24 S3-08): the active plan, plans being generated and history; "New
 * plan" starts `ai-generate-plan` and opens the progress modal. Free households replace their one
 * active plan after confirming (FR-PLAN-02).
 */
export function MealPlansScreen() {
  const { t } = useTranslation(['plan', 'errors']);
  const navigation = useNavigation<PlanScreenProps<'MealPlans'>['navigation']>();
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const canEdit = useActiveHouseholdStore(selectCanEdit);
  const plans = useMealPlans(householdId);
  const generate = useGeneratePlan(householdId);
  const clock = useHouseholdClock(householdId);
  const online = useIsOnline();
  const [confirmReplace, setConfirmReplace] = useState(false);

  const all = plans.data ?? [];
  const active = all.find((p) => p.status === 'active') ?? null;
  const inProgress = all.filter((p) => p.status === 'generating' || p.status === 'draft');
  const history = all.filter((p) => p !== active && !inProgress.includes(p));

  const startNew = (replaceActive: boolean) =>
    generate.mutate(
      { startDate: clock.today, source: 'plans', replaceActive },
      {
        onSuccess: (accepted) => {
          setConfirmReplace(false);
          navigation.navigate('PlanGenerationProgress', {
            mealPlanId: accepted.meal_plan_id,
            pollAfterMs: accepted.poll_after_ms,
          });
        },
      },
    );

  const openPlan = (p: MealPlanView) =>
    p.status === 'generating'
      ? navigation.navigate('PlanGenerationProgress', { mealPlanId: p.id })
      : navigation.navigate('MealPlanDetail', { mealPlanId: p.id });

  return (
    <Screen
      title={t('plan:plans.title')}
      edges={['top']}
      testID="plan-meal-plans.screen"
      refreshing={plans.isRefetching}
      onRefresh={() => void plans.refetch()}
      headerRight={
        canEdit ? (
          <Button
            label={t('plan:plans.new')}
            size="sm"
            disabled={!online}
            loading={generate.isPending && !confirmReplace}
            onPress={() => (active ? setConfirmReplace(true) : startNew(false))}
            testID="plan-meal-plans.new"
          />
        ) : undefined
      }
    >
      {confirmReplace ? (
        <Card variant="outlined" testID="plan-meal-plans.confirm">
          <Text>{t('plan:plans.replaceConfirm')}</Text>
          <View className="flex-row gap-2">
            <Button
              label={t('plan:plans.replace')}
              size="sm"
              loading={generate.isPending}
              onPress={() => startNew(true)}
              testID="plan-meal-plans.confirm-replace"
            />
            <Button
              label={t('plan:plans.cancel')}
              size="sm"
              variant="ghost"
              onPress={() => setConfirmReplace(false)}
            />
          </View>
        </Card>
      ) : null}
      {generate.isError ? (
        <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(generate.error)}`)} />
      ) : null}
      {plans.isError && !plans.data ? (
        <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(plans.error)}`)} />
      ) : null}
      {plans.isLoading ? (
        <Card variant="filled" testID="plan-meal-plans.loading">
          <Text tone="muted">{t('plan:loading')}</Text>
        </Card>
      ) : null}
      {!plans.isLoading && all.length === 0 && !plans.isError ? (
        <Card variant="filled" testID="plan-meal-plans.empty">
          <Text variant="bodyStrong">{t('plan:plans.emptyTitle')}</Text>
          <Text tone="muted">{t('plan:plans.emptyBody')}</Text>
        </Card>
      ) : null}
      {active ? (
        <Card
          variant="elevated"
          onPress={() => openPlan(active)}
          accessibilityLabel={t('plan:plans.openA11y', { title: planTitle(t, active) })}
          testID="plan-meal-plans.active"
        >
          <Text variant="overline" tone="muted">
            {t('plan:plans.active')}
          </Text>
          <Text variant="heading">{planTitle(t, active)}</Text>
          <Text tone="muted">
            {t('plan:plans.dates', { from: active.startDate, to: active.endDate })}
          </Text>
          {active.version > 1 ? (
            <Text variant="caption" tone="muted">
              {t('plan:plans.version', { version: active.version })}
            </Text>
          ) : null}
        </Card>
      ) : null}
      {inProgress.map((p, i) => (
        <PlanRow
          key={p.id}
          plan={p}
          onPress={() => openPlan(p)}
          testID={`plan-meal-plans.progress-${i}`}
        />
      ))}
      {history.length > 0 ? (
        <View className="gap-2">
          <Text variant="heading" accessibilityRole="header">
            {t('plan:plans.history')}
          </Text>
          {history.map((p, i) => (
            <PlanRow
              key={p.id}
              plan={p}
              onPress={() => openPlan(p)}
              testID={`plan-meal-plans.history-${i}`}
            />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

type T = ReturnType<typeof useTranslation>['t'];

export function planTitle(t: T, p: Pick<MealPlanView, 'title' | 'kind'>): string {
  return p.title ?? t(`plan:kinds.${p.kind}`);
}

function PlanRow({
  plan,
  onPress,
  testID,
}: {
  plan: MealPlanView;
  onPress: () => void;
  testID: string;
}) {
  const { t } = useTranslation('plan');
  return (
    <Card
      variant="outlined"
      onPress={onPress}
      accessibilityLabel={t('plans.openA11y', { title: planTitle(t, plan) })}
      testID={testID}
    >
      <View className="flex-row flex-wrap items-center gap-2">
        <Text variant="bodyStrong">{planTitle(t, plan)}</Text>
        <PlanStatusChip status={plan.status} />
        {plan.version > 1 ? (
          <Text variant="caption" tone="muted">
            {t('plans.version', { version: plan.version })}
          </Text>
        ) : null}
      </View>
      <Text variant="caption" tone="muted">
        {t('plans.dates', { from: plan.startDate, to: plan.endDate })}
      </Text>
    </Card>
  );
}
