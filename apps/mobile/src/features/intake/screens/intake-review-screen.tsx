import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { intakeContext, intakeRedFlags, visibleSteps } from '@shared/intake/questions';
import type { SpecialModule } from '@shared';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { Text } from '@/components/ui/text';
import { useFamilyMembers } from '@/features/family';
import { track } from '@/lib/analytics/track';
import type { IntakeStackParamList } from '@/navigation/types';

import { IntakeStepScaffold } from '../components/intake-step-scaffold';
import { useIntakeFlow } from '../hooks/intake-flow-context';
import { memberProfile, useIntakeHouseholdId } from '../hooks/use-intake-member';
import { useIntakeDraftStore } from '../store/use-intake-draft-store';
import { memberStepTarget } from '../utils/intake-routes';
import { summarizeMembers } from './intake-members-screen';

type Props = NativeStackScreenProps<IntakeStackParamList, 'IntakeReview'>;

/**
 * I15 Review (02 §7.3.15): a summary per member with "Edit", a `RedFlagNotice` listing members
 * whose answers need a clinician first, and "See our assessment".
 */
export function IntakeReviewScreen({ navigation }: Props) {
  const { t } = useTranslation('intake');
  const flow = useIntakeFlow();
  const householdId = useIntakeHouseholdId();
  const members = useFamilyMembers(householdId);
  const drafts = useIntakeDraftStore((s) => s.members);
  const summaries = summarizeMembers(members.data ?? [], drafts);
  const flagged = summaries
    .map((x) => ({
      x,
      flags: intakeRedFlags(intakeContext(memberProfile(x.member), x.answers), x.answers),
    }))
    .filter((f) => f.flags.length > 0);

  const edit = (memberId: string) => {
    const x = summaries.find((s) => s.member.id === memberId);
    if (!x) return;
    const ctx = intakeContext(memberProfile(x.member), x.answers);
    const step = visibleSteps(ctx, x.answers)[0] ?? 'health';
    useIntakeDraftStore.getState().setView('member', { memberId, step });
    const target = memberStepTarget(step, memberId, ctx.modules);
    navigation.push(target.name, target.params as never);
  };

  const onSubmit = () => {
    const modules = new Set<SpecialModule>();
    for (const x of summaries)
      for (const m of intakeContext(memberProfile(x.member), x.answers).modules) modules.add(m);
    track('intake_completed', {
      members: summaries.length,
      modules: [...modules],
      has_red_flags: flagged.length > 0,
    });
    useIntakeDraftStore.getState().setView('review', null);
    flow.onComplete();
  };

  return (
    <IntakeStepScaffold
      index={3}
      total={3}
      title={t('review.title')}
      subtitle={t('review.helper')}
      nextLabel={t('review.submit')}
      nextDisabled={summaries.length === 0}
      onNext={onSubmit}
      onBack={() =>
        navigation.canGoBack() ? navigation.goBack() : navigation.replace('IntakeMembers')
      }
      testID="intake-review.screen"
    >
      {flagged.length > 0 ? (
        <InlineMessage
          tone="warning"
          title={t('review.redFlagTitle')}
          message={t('review.redFlagBody', {
            names: flagged.map((f) => f.x.member.name).join(t('common.listSeparator')),
          })}
          testID="intake-review.red-flags"
        />
      ) : null}
      <View className="gap-3">
        {summaries.map((x, i) => {
          const f = flagged.find((y) => y.x.member.id === x.member.id);
          return (
            <Card key={x.member.id} variant="outlined" testID={`intake-review.member-${i}`}>
              <Text variant="bodyStrong">{x.member.name}</Text>
              <Text variant="caption" tone="muted">
                {x.status === 'later'
                  ? t('review.skipped')
                  : t('common.completeness', { score: x.score })}
              </Text>
              {f
                ? f.flags.map((flag) => (
                    <Text
                      key={flag}
                      variant="caption"
                      tone="warning"
                      testID={`intake-review.member-${i}.flag.${flag}`}
                    >
                      {t(`redFlags.${flag}`)}
                    </Text>
                  ))
                : null}
              <Button
                label={t('review.edit')}
                variant="link"
                size="sm"
                className="self-start px-0"
                onPress={() => edit(x.member.id)}
                testID={`intake-review.member-${i}.edit`}
              />
            </Card>
          );
        })}
      </View>
    </IntakeStepScaffold>
  );
}
