import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useFamilyMembers } from '@/features/family';
import { useIntakeDraftStore } from '@/features/intake';
import { useHouseholdClock } from '@/features/meals';
import {
  fetchActivePlan,
  PlanGenerationFlow,
  useGeneratePlan,
  type GenerateSource,
} from '@/features/plan';
import { isAppError } from '@/lib/supabase/app-error';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';

import { useOnboardingFlow } from '../hooks/use-onboarding-flow';
import { useOnboardingStore } from '../store/use-onboarding-store';

/**
 * Onboarding step 6, First plan (02 §7.4.2 `FirstPlanGeneration`, 24 S3-07, FR-ONB-02, -08). Starts
 * `ai-generate-plan` once, remembers the plan id so a killed app resumes watching it, activates the
 * draft automatically and only then completes onboarding (`onboarding_completed_at` is set after a
 * plan exists, AI or template fallback).
 */
export function OnboardingFirstPlanScreen() {
  const { t } = useTranslation('plan');
  const flow = useOnboardingFlow('first_plan');
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const members = useFamilyMembers(householdId);
  const clock = useHouseholdClock(householdId);
  const job = useOnboardingStore((s) => s.firstPlan);
  const generate = useGeneratePlan(householdId);
  const autoStarted = useRef(false);

  const start = (source: GenerateSource) => {
    generate.mutate(
      { startDate: clock.today, source },
      {
        onSuccess: (accepted) =>
          useOnboardingStore.getState().setFirstPlan({
            mealPlanId: accepted.meal_plan_id,
            pollAfterMs: accepted.poll_after_ms,
            startedAt: Date.now(),
            mode: accepted.mode,
          }),
        onError: async (e) => {
          // A plan already exists (for example after a reinstall): use it.
          if (!isAppError(e) || e.code !== 'PLAN_ALREADY_ACTIVE' || !householdId) return;
          const active = await fetchActivePlan(householdId).catch(() => null);
          if (active)
            useOnboardingStore.getState().setFirstPlan({
              mealPlanId: active.id,
              pollAfterMs: null,
              startedAt: Date.now(),
              mode: null,
            });
        },
      },
    );
  };

  // The assessment's "Create our first week" brought the user here: start once.
  useEffect(() => {
    if (autoStarted.current || job || !householdId) return;
    autoStarted.current = true;
    start('onboarding');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job, householdId]);

  return (
    <Screen edges={['top', 'bottom']} testID="first-plan.screen">
      <Text variant="title" accessibilityRole="header">
        {t('generation.title')}
      </Text>
      <Text tone="muted">{t('generation.body')}</Text>
      <PlanGenerationFlow
        householdId={householdId}
        job={job}
        onStart={start}
        starting={generate.isPending}
        startError={generate.error}
        autoActivate
        onFinished={() =>
          flow.goNext({
            memberCount: members.data?.length ?? 0,
            onFinished: () => {
              useIntakeDraftStore.getState().reset();
              useOnboardingStore.getState().setFirstPlan(null);
            },
          })
        }
        finishing={flow.finishing}
        finishError={flow.finishError}
        testID="first-plan"
      />
      <Text variant="caption" tone="muted">
        {t('disclaimer')}
      </Text>
    </Screen>
  );
}
