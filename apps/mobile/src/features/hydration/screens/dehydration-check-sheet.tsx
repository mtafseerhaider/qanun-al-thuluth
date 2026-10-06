import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ageInMonths } from '@shared';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipGroup } from '@/components/ui/chip';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useFamilyMembers } from '@/features/family';
import { useFastingToday } from '@/features/fasting';
import { useHouseholdClock } from '@/features/meals';
import { track } from '@/lib/analytics/track';
import { useOutboxStore } from '@/lib/offline/outbox';
import type { RootScreenProps } from '@/navigation/types';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';

import {
  assessSymptoms,
  SYMPTOM_CHECK_KIND,
  SYMPTOM_CHECK_SCOPE,
  symptomsFor,
  type Symptom,
  type SymptomAssessment,
  type SymptomCheckRecord,
} from '../utils/symptom-rules';

/**
 * Dehydration symptom check and red-flag sheet (24 S4-09, FR-HYD-05, 02 §7.12.2). Any red-flag sign
 * shows urgent guidance, the break-the-fast message when the person is fasting today, and clinician
 * advice. The check is queued for the server safety record (no client path exists in Sprint 4).
 */
export function DehydrationCheckSheet({
  navigation,
  route,
}: RootScreenProps<'DehydrationCheckSheet'>) {
  const { t } = useTranslation('hydration');
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const clock = useHouseholdClock(householdId);
  const members = useFamilyMembers(householdId);
  const fasting = useFastingToday(householdId);
  const [memberId, setMemberId] = useState<string | null>(route.params?.familyMemberId ?? null);
  const [symptoms, setSymptoms] = useState<Symptom[]>([]);
  const [result, setResult] = useState<SymptomAssessment | null>(null);

  const member = (members.data ?? []).find((m) => m.id === memberId) ?? null;
  let months: number | null = null;
  if (member?.date_of_birth) {
    try {
      months = ageInMonths(member.date_of_birth, clock.today);
    } catch {
      months = null;
    }
  }
  const isFasting = memberId ? fasting.memberIds.has(memberId) : false;
  const options = symptomsFor(months);

  const submit = () => {
    const a = assessSymptoms(symptoms, months);
    setResult(a);
    track('hydration_symptom_check', { red_flag: a.level === 'red_flag', fasting: isFasting });
    if (householdId && a.level !== 'none') {
      useOutboxStore.getState().enqueue({
        kind: SYMPTOM_CHECK_KIND,
        scope: SYMPTOM_CHECK_SCOPE,
        payload: {
          householdId,
          familyMemberId: memberId,
          symptoms,
          level: a.level,
          urgency: a.urgency,
          fasting: isFasting,
          checkedAt: new Date().toISOString(),
        } satisfies SymptomCheckRecord,
      });
    }
  };

  if (result?.level === 'red_flag') {
    return (
      <Screen testID="dehydration.red-flag">
        <InlineMessage
          tone="danger"
          title={t('symptoms.redFlag.title')}
          message={
            result.urgency === 'emergency_now'
              ? t('symptoms.redFlag.emergency')
              : result.youngChild
                ? t('symptoms.redFlag.youngChild')
                : t('symptoms.redFlag.sameDay')
          }
          testID="dehydration.red-flag.message"
        />
        {isFasting ? (
          <Card variant="outlined" testID="dehydration.red-flag.break-fast">
            <Text variant="bodyStrong">{t('symptoms.breakFast.title')}</Text>
            <Text>{t('symptoms.breakFast.body')}</Text>
          </Card>
        ) : null}
        <Card variant="filled" testID="dehydration.red-flag.clinician">
          <Text variant="bodyStrong">{t('symptoms.clinician.title')}</Text>
          <Text>{t('symptoms.clinician.body')}</Text>
        </Card>
        <Text variant="caption" tone="muted">
          {t('symptoms.disclaimer')}
        </Text>
        <Button
          label={t('symptoms.close')}
          onPress={() => navigation.goBack()}
          testID="dehydration.close"
        />
      </Screen>
    );
  }

  return (
    <Screen testID="dehydration.screen">
      <Text variant="title" accessibilityRole="header">
        {t('symptoms.title')}
      </Text>
      <Text tone="muted">{t('symptoms.body')}</Text>
      <ChipGroup
        label={t('symptoms.who')}
        single
        options={(members.data ?? []).map((m) => ({ value: m.id, label: m.name }))}
        selected={memberId ? [memberId] : []}
        onToggle={(id) => {
          setMemberId(id);
          setResult(null);
        }}
        testID="dehydration.member"
      />
      <ChipGroup
        label={t('symptoms.signs')}
        options={options.map((s) => ({ value: s, label: t(`symptoms.sign.${s}`) }))}
        selected={symptoms}
        onToggle={(s) => {
          setResult(null);
          setSymptoms((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
        }}
        testID="dehydration.sign"
      />
      {result?.level === 'mild' ? (
        <InlineMessage tone="info" message={t('symptoms.mild')} testID="dehydration.mild" />
      ) : null}
      {result?.level === 'none' ? (
        <InlineMessage tone="success" message={t('symptoms.none')} testID="dehydration.none" />
      ) : null}
      <View className="gap-2">
        <Button label={t('symptoms.check')} onPress={submit} testID="dehydration.submit" />
        <Text variant="caption" tone="muted">
          {t('symptoms.disclaimer')}
        </Text>
      </View>
    </Screen>
  );
}
