import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
  completeness,
  householdCompleteness,
  intakeContext,
  visibleSteps,
  type MemberIntakeAnswers,
} from '@shared/intake/questions';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { StepProgress } from '@/components/ui/step-progress';
import { Text } from '@/components/ui/text';
import { useFamilyMembers, type FamilyMember } from '@/features/family';
import type { IntakeStackParamList } from '@/navigation/types';

import { IntakeStepScaffold } from '../components/intake-step-scaffold';
import { memberProfile, useIntakeHouseholdId } from '../hooks/use-intake-member';
import { useIntakeDraftStore, type MemberDraft } from '../store/use-intake-draft-store';
import { memberStepTarget } from '../utils/intake-routes';

type Props = NativeStackScreenProps<IntakeStackParamList, 'IntakeMembers'>;

export type MemberStatus = 'not_started' | 'in_progress' | 'complete' | 'later';

export interface MemberSummary {
  member: FamilyMember;
  answers: MemberIntakeAnswers;
  score: number;
  status: MemberStatus;
}

/** Status and score per member, from the draft and the engine (shared with Review). */
export function summarizeMembers(
  members: readonly FamilyMember[],
  drafts: Record<string, MemberDraft>,
): MemberSummary[] {
  return members.map((member) => {
    const draft = drafts[member.id];
    const answers = draft?.answers ?? {};
    const ctx = intakeContext(memberProfile(member), answers);
    const c = completeness(ctx, answers);
    const steps = visibleSteps(ctx, answers);
    const allDone = steps.every((st) => draft?.completed.includes(st));
    const status: MemberStatus = draft?.skipped
      ? 'later'
      : allDone
        ? 'complete'
        : (draft?.completed.length ?? 0) > 0
          ? 'in_progress'
          : 'not_started';
    return { member, answers, score: c.score, status };
  });
}

/**
 * Intake roster (02 §7.3.2 I2, adapted: members were added in onboarding step 4). Shows each
 * member's progress and completeness, lets the parent start, continue or finish a member later, and
 * leads to Review once everyone is done or set aside.
 */
export function IntakeMembersScreen({ navigation }: Props) {
  const { t } = useTranslation('intake');
  const householdId = useIntakeHouseholdId();
  const members = useFamilyMembers(householdId);
  const drafts = useIntakeDraftStore((s) => s.members);
  const summaries = summarizeMembers(members.data ?? [], drafts);
  const household = householdCompleteness(summaries.map((x) => x.score));
  const nextUp = summaries.find((x) => x.status === 'not_started' || x.status === 'in_progress');

  const open = (x: MemberSummary) => {
    const ctx = intakeContext(memberProfile(x.member), x.answers);
    const steps = visibleSteps(ctx, x.answers);
    const draft = drafts[x.member.id];
    const step = steps.find((st) => !draft?.completed.includes(st)) ?? steps[0] ?? 'health';
    const store = useIntakeDraftStore.getState();
    if (draft?.skipped) store.setSkipped(x.member.id, false);
    store.setView('member', { memberId: x.member.id, step });
    const target = memberStepTarget(step, x.member.id, ctx.modules);
    navigation.push(target.name, target.params as never);
  };

  // Resume a killed app inside a member's steps with this roster underneath (FR-ONB-01).
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !members.data) return;
    resumed.current = true;
    const { view, position } = useIntakeDraftStore.getState();
    if (view !== 'member' || !position) return;
    const member = members.data.find((m) => m.id === position.memberId);
    if (!member) return;
    const answers = useIntakeDraftStore.getState().members[member.id]?.answers ?? {};
    const ctx = intakeContext(memberProfile(member), answers);
    const step = visibleSteps(ctx, answers).includes(position.step) ? position.step : 'health';
    const target = memberStepTarget(step, member.id, ctx.modules);
    navigation.push(target.name, target.params as never);
  }, [members.data, navigation]);

  const toReview = () => {
    useIntakeDraftStore.getState().setView('review', null);
    navigation.push('IntakeReview');
  };

  return (
    <IntakeStepScaffold
      index={2}
      total={3}
      title={t('members.title')}
      subtitle={t('members.helper')}
      nextLabel={
        nextUp ? t('members.continueWith', { name: nextUp.member.name }) : t('members.review')
      }
      nextDisabled={summaries.length === 0}
      onNext={() => (nextUp ? open(nextUp) : toReview())}
      onBack={() =>
        navigation.canGoBack() ? navigation.goBack() : navigation.replace('IntakeHousehold')
      }
      testID="intake-members.screen"
    >
      <StepProgress
        current={Math.round(household / 10)}
        total={10}
        label={t('members.householdScore', { score: household })}
        testID="intake-members.household-score"
      />
      <View className="gap-3">
        {members.isLoading ? <Text tone="muted">{t('common.loading')}</Text> : null}
        {summaries.map((x, i) => (
          <Card key={x.member.id} variant="outlined" testID={`intake-members.row-${i}`}>
            <View className="flex-row items-center justify-between gap-3">
              <Text variant="bodyStrong" className="flex-1">
                {x.member.name}
              </Text>
              <Text variant="caption" tone="muted" testID={`intake-members.row-${i}.status`}>
                {t(`members.status.${x.status}`)}
              </Text>
            </View>
            <Text variant="caption" tone="muted">
              {t('common.completeness', { score: x.score })}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              <Button
                label={t(
                  x.status === 'not_started'
                    ? 'members.start'
                    : x.status === 'complete'
                      ? 'members.edit'
                      : 'members.continue',
                )}
                size="sm"
                variant={x === nextUp ? 'primary' : 'secondary'}
                onPress={() => open(x)}
                testID={`intake-members.row-${i}.open`}
              />
              {x.status !== 'complete' && x.status !== 'later' ? (
                <Button
                  label={t('common.finishLater')}
                  size="sm"
                  variant="ghost"
                  onPress={() => useIntakeDraftStore.getState().setSkipped(x.member.id, true)}
                  testID={`intake-members.row-${i}.later`}
                />
              ) : null}
            </View>
          </Card>
        ))}
      </View>
      {!nextUp && summaries.length > 0 ? (
        <Button
          label={t('members.review')}
          variant="secondary"
          onPress={toReview}
          testID="intake-members.review"
        />
      ) : null}
      {nextUp ? (
        <Button
          label={t('members.skipToReview')}
          variant="link"
          size="sm"
          className="self-start px-0"
          onPress={toReview}
          testID="intake-members.skip-to-review"
        />
      ) : null}
    </IntakeStepScaffold>
  );
}
