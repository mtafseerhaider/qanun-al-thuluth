import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { Text } from '@/components/ui/text';
import { useIsOnline } from '@/hooks/use-is-online';
import { track } from '@/lib/analytics/track';
import { isAppError } from '@/lib/supabase/app-error';
import { errorKeyFor } from '@/lib/supabase/error-mapping';

import { useActivatePlan, usePlanGenerationWatch, type GenerateSource } from '../hooks/use-plans';
import { failureCode } from '../utils/generation-rules';
import { GenerationTips, PlanGenerationStepper } from './plan-generation-stepper';

export interface GenerationJob {
  mealPlanId: string;
  pollAfterMs: number | null;
  startedAt: number;
  mode: 'full' | 'template_personalize' | null;
}

/**
 * Generation progress, ready and failure states (02 §7.4.2, 24 S3-07). Used by onboarding step 6
 * (`FirstPlanGeneration`, which activates the first plan automatically) and by the
 * `PlanGenerationProgress` modal (later plans: "Start this plan"). The parent owns starting a job
 * and remembering it, so a killed app resumes watching the same plan.
 */
export function PlanGenerationFlow({
  householdId,
  job,
  onStart,
  starting,
  startError,
  autoActivate,
  onFinished,
  finishing = false,
  finishError = null,
  testID,
}: {
  householdId: string | null;
  job: GenerationJob | null;
  onStart: (source: GenerateSource) => void;
  starting: boolean;
  startError: unknown;
  autoActivate: boolean;
  onFinished: () => void;
  finishing?: boolean;
  finishError?: unknown;
  testID: string;
}) {
  const { t } = useTranslation(['plan', 'errors']);
  const online = useIsOnline();
  const watch = usePlanGenerationWatch({
    householdId,
    mealPlanId: job?.mealPlanId ?? null,
    pollAfterMs: job?.pollAfterMs ?? null,
    startedAt: job?.startedAt ?? null,
  });
  const activate = useActivatePlan(householdId);
  const activatedFor = useRef<string | null>(null);
  const reported = useRef<string | null>(null);
  const plan = watch.plan;

  // First plan: activate the draft automatically (02 §5.4).
  useEffect(() => {
    if (!autoActivate || !plan || plan.status !== 'draft') return;
    if (activatedFor.current === plan.id) return;
    activatedFor.current = plan.id;
    activate.mutate(plan.id, { onSuccess: () => void watch.query.refetch() });
  }, [autoActivate, plan, activate, watch.query]);

  // Analytics once per plan outcome.
  useEffect(() => {
    if (!plan || !job || reported.current === plan.id) return;
    if (watch.outcome === 'ready') {
      reported.current = plan.id;
      track('plan_generation_completed', {
        duration_ms: Math.max(0, Math.round(Date.now() - job.startedAt)),
        status: plan.status === 'active' ? 'active' : 'draft',
        mode: job.mode ?? 'unknown',
      });
    } else if (watch.outcome === 'failed') {
      reported.current = plan.id;
      track('plan_generation_failed', { code: failureCode(plan.progress) });
    }
  }, [plan, job, watch.outcome]);

  const ready = watch.outcome === 'ready' && (!autoActivate || plan?.status === 'active');
  const failed = watch.outcome === 'failed';
  const alreadyActive = isAppError(startError) && startError.code === 'PLAN_ALREADY_ACTIVE';

  // Not started (or the start request failed before a plan existed).
  if (!job) {
    return (
      <View className="gap-4" testID={`${testID}.start`}>
        {!online ? (
          <InlineMessage
            tone="info"
            title={t('plan:generation.offlineTitle')}
            message={t('plan:generation.offlineBody')}
            testID={`${testID}.offline`}
          />
        ) : null}
        {startError && !alreadyActive ? (
          <View className="gap-1" testID={`${testID}.start-error`}>
            <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(startError)}`)} />
            {isAppError(startError) ? (
              <Text variant="caption" tone="muted">
                {t('plan:generation.errorCode', { code: startError.code })}
              </Text>
            ) : null}
          </View>
        ) : null}
        {starting ? (
          <Card variant="filled" testID={`${testID}.starting`}>
            <Text tone="muted">{t('plan:generation.starting')}</Text>
          </Card>
        ) : (
          <Button
            label={t('plan:generation.create')}
            size="lg"
            fullWidth
            disabled={!online}
            onPress={() => onStart(startError ? 'retry' : 'onboarding')}
            testID={`${testID}.create`}
          />
        )}
      </View>
    );
  }

  if (failed) {
    const escalation = plan?.progress?.escalation;
    return (
      <View className="gap-4" testID={`${testID}.failed`}>
        <InlineMessage
          tone="warning"
          title={t('plan:generation.failedTitle')}
          message={t('plan:generation.failedBody')}
        />
        {escalation ? (
          <Card variant="outlined" testID={`${testID}.escalation`}>
            <Text variant="bodyStrong">{t('plan:generation.clinicianTitle')}</Text>
            <Text>{escalation.message}</Text>
          </Card>
        ) : null}
        <Text variant="caption" tone="muted">
          {t('plan:generation.errorCode', { code: failureCode(plan?.progress) })}
        </Text>
        <Button
          label={t('plan:generation.retry')}
          fullWidth
          disabled={!online}
          loading={starting}
          onPress={() => onStart('retry')}
          testID={`${testID}.retry`}
        />
        <Button
          label={t('plan:generation.template')}
          variant="secondary"
          fullWidth
          disabled={!online || starting}
          onPress={() => onStart('template')}
          testID={`${testID}.template`}
        />
      </View>
    );
  }

  if (ready) {
    return (
      <View className="gap-4" testID={`${testID}.ready`}>
        <Card variant="elevated">
          <Text variant="heading" accessibilityRole="header">
            {t('plan:generation.readyTitle')}
          </Text>
          {plan?.rationale ? <Text tone="muted">{plan.rationale}</Text> : null}
          {job.mode === 'template_personalize' ? (
            <Text variant="caption" tone="muted" testID={`${testID}.template-note`}>
              {t('plan:generation.templateNote')}
            </Text>
          ) : null}
        </Card>
        {finishError ? (
          <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(finishError)}`)} />
        ) : null}
        <Button
          label={autoActivate ? t('plan:generation.seeToday') : t('plan:generation.startPlan')}
          size="lg"
          fullWidth
          loading={finishing || activate.isPending}
          onPress={
            autoActivate || !plan || plan.status === 'active'
              ? onFinished
              : () => activate.mutate(plan.id, { onSuccess: onFinished })
          }
          testID={`${testID}.done`}
        />
      </View>
    );
  }

  // Generating (or activating the draft).
  return (
    <View className="gap-4" testID={`${testID}.generating`}>
      <PlanGenerationStepper stage={watch.stage} testID={`${testID}.stepper`} />
      {watch.timedOut ? (
        <View className="gap-2" testID={`${testID}.timeout`}>
          <InlineMessage tone="info" message={t('plan:generation.timeout')} />
          <Button
            label={t('plan:generation.template')}
            variant="secondary"
            fullWidth
            disabled={!online || starting}
            onPress={() => onStart('template')}
            testID={`${testID}.timeout-template`}
          />
        </View>
      ) : null}
      {activate.isError ? (
        <View className="gap-2">
          <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(activate.error)}`)} />
          <Button
            label={t('plan:generation.retry')}
            variant="secondary"
            onPress={() => {
              activatedFor.current = null;
              void watch.query.refetch();
            }}
          />
        </View>
      ) : null}
      <GenerationTips testID={`${testID}.tips`} />
    </View>
  );
}
