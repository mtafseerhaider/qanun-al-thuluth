import { useNavigation, useRoute } from '@react-navigation/native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useHouseholdClock } from '@/features/meals';
import type { RootScreenProps } from '@/navigation/types';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';

import { PlanGenerationFlow, type GenerationJob } from '../components/plan-generation-flow';
import { useGeneratePlan, type GenerateSource } from '../hooks/use-plans';

/**
 * X13 Plan Generation Progress modal (02 §7.4.2 reused for later plans, 24 S3-07). Watches the plan
 * from the route; retry and the template fallback start a new job in place. The draft is not
 * activated automatically: "Start this plan" does it.
 */
export function PlanGenerationProgressScreen() {
  const { t } = useTranslation('plan');
  const navigation = useNavigation<RootScreenProps<'PlanGenerationProgress'>['navigation']>();
  const { params } = useRoute<RootScreenProps<'PlanGenerationProgress'>['route']>();
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const clock = useHouseholdClock(householdId);
  const generate = useGeneratePlan(householdId);
  const [job, setJob] = useState<GenerationJob>(() => ({
    mealPlanId: params.mealPlanId,
    pollAfterMs: params.pollAfterMs ?? null,
    startedAt: Date.now(),
    mode: null,
  }));

  const start = (source: GenerateSource) =>
    generate.mutate(
      { startDate: clock.today, source },
      {
        onSuccess: (accepted) =>
          setJob({
            mealPlanId: accepted.meal_plan_id,
            pollAfterMs: accepted.poll_after_ms,
            startedAt: Date.now(),
            mode: accepted.mode,
          }),
      },
    );

  return (
    <Screen testID="plan-progress.screen">
      <Text variant="title" accessibilityRole="header">
        {t('generation.titleLater')}
      </Text>
      <PlanGenerationFlow
        householdId={householdId}
        job={job}
        onStart={start}
        starting={generate.isPending}
        startError={generate.error}
        autoActivate={false}
        onFinished={() => navigation.goBack()}
        testID="plan-progress"
      />
      <Button
        label={t('generation.close')}
        variant="ghost"
        onPress={() => navigation.goBack()}
        testID="plan-progress.close"
      />
    </Screen>
  );
}
