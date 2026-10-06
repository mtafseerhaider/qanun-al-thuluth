import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { MemberAssessment } from '@shared/contracts';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Disclosure } from '@/components/ui/disclosure';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useFamilyMembers } from '@/features/family';
import { RecommendationList } from '@/features/knowledge';
import { track } from '@/lib/analytics/track';
import { isAppError } from '@/lib/supabase/app-error';
import { errorKeyFor } from '@/lib/supabase/error-mapping';

import { useIntakeHydrated } from '../hooks/use-intake-hydrated';
import { useIntakeHouseholdId } from '../hooks/use-intake-member';
import { useRunIntakeAssessment } from '../hooks/use-intake-assessment';
import { useIntakeDraftStore } from '../store/use-intake-draft-store';
import {
  childSafeLines,
  energyRange,
  formatNumber,
  hydrationDisplay,
  isMinorStage,
  memberSummaryText,
  riskFlagKey,
} from '../utils/assessment-display';

/**
 * O7 Assessment Summary (02 §7.4.1, 24 S2-15). Calls `ai-intake-assess` once (the result is kept in
 * the encrypted draft), then shows per-member cards: adults with an energy range, TDEE and
 * macros; children with growth-first copy and cups of water, never a calorie number, with the
 * parents' guidance collapsed (Q-08). Risk flags show as banners and a clinician card.
 */
export function AssessmentSummaryScreen({
  onContinue,
  onEdit,
  continuing = false,
  continueError = null,
}: {
  onContinue: () => void;
  onEdit: () => void;
  continuing?: boolean;
  continueError?: unknown;
}) {
  const { t } = useTranslation(['intake', 'errors']);
  const householdId = useIntakeHouseholdId();
  const assessment = useIntakeDraftStore((s) => s.assessment);
  const run = useRunIntakeAssessment(householdId);
  const members = useFamilyMembers(householdId);
  const hydrated = useIntakeHydrated();
  const started = useRef(false);

  useEffect(() => {
    if (started.current || !hydrated || assessment || !householdId) return;
    started.current = true;
    run.mutate();
  }, [assessment, hydrated, householdId, run]);

  useEffect(() => {
    if (assessment) track('assessment_viewed', { members: assessment.assessments.length });
  }, [assessment]);

  const nameOf = (id: string) => members.data?.find((m) => m.id === id)?.name ?? '';
  const allIds = assessment?.assessments.flatMap((a) => a.recommendation_ids) ?? [];

  return (
    <Screen edges={['top', 'bottom']} testID="assessment.screen">
      <Text variant="title" accessibilityRole="header">
        {t('intake:assessment.title')}
      </Text>
      {!assessment && (run.isPending || run.isIdle) ? (
        <Card variant="filled" testID="assessment.loading">
          <Text variant="bodyStrong">{t('intake:assessment.loading')}</Text>
          <Text tone="muted">{t('intake:assessment.loadingBody')}</Text>
        </Card>
      ) : null}
      {!assessment && run.isError ? (
        <View className="gap-2" testID="assessment.error">
          <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(run.error)}`)} />
          {isAppError(run.error) ? (
            <Text variant="caption" tone="muted">
              {t('intake:assessment.errorCode', { code: run.error.code })}
            </Text>
          ) : null}
          <Button
            label={t('intake:common.retry')}
            variant="secondary"
            onPress={() => run.mutate()}
            testID="assessment.retry"
          />
        </View>
      ) : null}
      {assessment ? (
        <>
          <View className="gap-3" testID="assessment.members">
            {assessment.assessments.map((a, i) => (
              <MemberAssessmentCard
                key={a.assessment_id}
                assessment={a}
                name={nameOf(a.family_member_id)}
                testID={`assessment.member-${i}`}
              />
            ))}
          </View>
          <Text variant="heading" accessibilityRole="header">
            {t('intake:assessment.recommendations')}
          </Text>
          <RecommendationList ids={allIds} testID="assessment.recommendations" />
        </>
      ) : null}
      <Text variant="caption" tone="muted" testID="assessment.disclaimer">
        {t('intake:assessment.disclaimer')}
      </Text>
      {continueError ? (
        <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(continueError)}`)} />
      ) : null}
      <View className="gap-2">
        <Button
          label={t('intake:assessment.continue')}
          size="lg"
          fullWidth
          disabled={!assessment}
          loading={continuing}
          onPress={onContinue}
          testID="assessment.continue"
        />
        <Button
          label={t('intake:assessment.notRight')}
          variant="ghost"
          fullWidth
          onPress={onEdit}
          testID="assessment.edit"
        />
      </View>
    </Screen>
  );
}

export function MemberAssessmentCard({
  assessment: a,
  name,
  testID,
}: {
  assessment: MemberAssessment;
  name: string;
  testID: string;
}) {
  const { t, i18n } = useTranslation('intake');
  const minor = isMinorStage(a.life_stage);
  const water = hydrationDisplay(a.hydration_target_ml);
  const n = (x: number) => formatNumber(x, i18n.language);
  // Adults only: the contract already nulls these for under-18s; `minor` is a second guard.
  const energy = !minor ? a.energy_targets : null;
  const macros = !minor ? a.macro_targets : null;
  const guidance = minor ? childSafeLines(a.child_guidance) : [];

  return (
    <Card variant="elevated" testID={testID}>
      <Text variant="heading">{name}</Text>
      <Text>{memberSummaryText(a)}</Text>
      {minor ? (
        <View className="gap-1" testID={`${testID}.child`}>
          <Text variant="bodyStrong">{t('assessment.childGoal')}</Text>
          <Text>{t('assessment.childPortions')}</Text>
          <Text testID={`${testID}.water`}>
            {t('assessment.waterCups', { count: water.count, litres: water.litres })}
          </Text>
        </View>
      ) : (
        <View className="gap-1" testID={`${testID}.adult`}>
          {energy ? (
            <Text testID={`${testID}.energy`}>
              {t('assessment.energyRange', {
                low: n(energyRange(energy.kcal_per_day).low),
                high: n(energyRange(energy.kcal_per_day).high),
              })}
            </Text>
          ) : null}
          {energy?.tdee_kcal !== undefined ? (
            <Text variant="caption" tone="muted" testID={`${testID}.tdee`}>
              {t('assessment.tdee', { kcal: n(energy.tdee_kcal) })}
            </Text>
          ) : null}
          {macros ? (
            <Text variant="caption" tone="muted" testID={`${testID}.macros`}>
              {t('assessment.macros', {
                protein: n(macros.protein_g),
                carbs: n(macros.carbs_g),
                fat: n(macros.fat_g),
                fiber: n(macros.fiber_g),
              })}
            </Text>
          ) : null}
          <Text testID={`${testID}.water`}>
            {t('assessment.waterGlasses', { count: water.count, litres: water.litres })}
          </Text>
        </View>
      )}
      {a.risk_flags.map((f) => (
        <InlineMessage
          key={f}
          tone="warning"
          message={t(riskFlagKey(f), { name })}
          testID={`${testID}.risk.${f}`}
        />
      ))}
      {a.escalation ? (
        <Card variant="outlined" testID={`${testID}.clinician`}>
          <Text variant="bodyStrong">{t('assessment.clinician.title')}</Text>
          <Text>{a.escalation.message}</Text>
          <Text variant="caption" tone="muted">
            {t(`assessment.clinician.recommend.${a.escalation.recommend}`)}
          </Text>
          <Text variant="caption" tone="muted">
            {t('assessment.clinician.planNote', { name })}
          </Text>
        </Card>
      ) : null}
      {minor && guidance.length > 0 ? (
        <Disclosure
          title={t('assessment.forParents')}
          showHint={t('common.show')}
          hideHint={t('common.hide')}
          testID={`${testID}.parents`}
        >
          {guidance.map((g, j) => (
            <Text key={j} variant="caption">
              {g}
            </Text>
          ))}
        </Disclosure>
      ) : null}
    </Card>
  );
}
