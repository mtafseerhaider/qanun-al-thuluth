import * as Crypto from 'expo-crypto';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { FastKind } from '@shared';
import { EXEMPTION_REASONS } from '@shared/domain/tracking';

import { Button } from '@/components/ui/button';
import { ChipGroup } from '@/components/ui/chip';
import { InlineMessage } from '@/components/ui/inline-message';
import { Input } from '@/components/ui/input';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useHouseholdClock } from '@/features/meals';
import { addDays } from '@/lib/dates/local-date';
import type { RootScreenProps } from '@/navigation/types';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';

import { EligibilityNotice } from '../components/fasting-notices';
import {
  logFast,
  useFastingLogs,
  useFastingMembers,
  useFastingSafety,
  useFastingTimes,
} from '../hooks/use-fasting';
import {
  availableKinds,
  buildFastingWrite,
  defaultRamadanYear,
  fastingEligibility,
  NO_SAFETY,
  PRACTICE_PATTERNS,
  validateFastForm,
  type ExemptionReason,
  type FastFormError,
  type FastOutcome,
  type PracticePattern,
} from '../utils/fasting-rules';

const OUTCOMES: readonly FastOutcome[] = ['completed', 'broke_early', 'exempt'];

/**
 * X17 Fast log sheet (02 §7.12.5, FR-FAST-01): member, date (yesterday, today, tomorrow), kind
 * filtered by age and safety, outcome, optional private exemption reason, practice pattern for
 * children, notes. Blocked members see the clinician card instead of the form (FR-FAST-07).
 */
export function FastLogSheet({ navigation, route }: RootScreenProps<'FastLogSheet'>) {
  const { t } = useTranslation('fasting');
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const clock = useHouseholdClock(householdId);
  const members = useFastingMembers(householdId);
  const safety = useFastingSafety(householdId);
  const logs = useFastingLogs(householdId);
  const [memberId, setMemberId] = useState<string | null>(route.params?.familyMemberId ?? null);
  const [date, setDate] = useState(route.params?.date ?? clock.today);
  const [kind, setKind] = useState<FastKind | null>(route.params?.kind ?? null);
  const [outcome, setOutcome] = useState<FastOutcome>('completed');
  const [reason, setReason] = useState<ExemptionReason | null>(null);
  const [pattern, setPattern] = useState<PracticePattern | null>('until_dhuhr');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<FastFormError | null>(null);
  const times = useFastingTimes(householdId, date);

  const member = members.find((m) => m.id === memberId) ?? null;
  const eligibility = member
    ? fastingEligibility(member, safety.data?.[member.id] ?? NO_SAFETY, clock.today)
    : null;
  const kinds = eligibility ? availableKinds(eligibility) : [];
  const chosenKind = kind && kinds.includes(kind) ? kind : (kinds[0] ?? null);
  const dates = [addDays(clock.today, -1), clock.today, addDays(clock.today, 1)];

  const save = () => {
    if (!householdId || !member || !eligibility || !chosenKind) return;
    const values = {
      memberId: member.id,
      date,
      kind: chosenKind,
      outcome,
      exemptionReason: outcome === 'exempt' ? reason : null,
      practicePattern: eligibility.mode === 'practice' ? pattern : null,
      notes,
      startedAt: times?.fajrIso ?? null,
      endedAt: times?.maghribIso ?? null,
      qadaForHijriYear: chosenKind === 'qada' ? defaultRamadanYear(clock.today) : null,
    };
    const err = validateFastForm(values, eligibility, clock.today);
    setError(err);
    if (err) return;
    const write = buildFastingWrite(values, { id: Crypto.randomUUID(), householdId, eligibility });
    const existing = logs.data.find(
      (l) => l.familyMemberId === member.id && l.fastDate === date && l.kind === chosenKind,
    );
    logFast(write, existing ?? null);
    navigation.goBack();
  };

  return (
    <Screen testID="fast-log.screen">
      <Text variant="title" accessibilityRole="header">
        {t('log.title')}
      </Text>
      <ChipGroup
        label={t('member')}
        single
        options={members.map((m) => ({ value: m.id, label: m.name }))}
        selected={memberId ? [memberId] : []}
        onToggle={(id) => {
          setMemberId(id);
          setKind(null);
          setError(null);
        }}
        testID="fast-log.member"
      />
      {member && eligibility ? (
        <EligibilityNotice eligibility={eligibility} name={member.name} />
      ) : null}

      {member && kinds.length > 0 ? (
        <>
          <ChipGroup
            label={t('log.date')}
            single
            options={dates.map((d, i) => ({
              value: d,
              label: t(`log.day.${['yesterday', 'today', 'tomorrow'][i]}`),
            }))}
            selected={[date]}
            onToggle={setDate}
            testID="fast-log.date"
          />
          <ChipGroup
            label={t('log.kind')}
            single
            options={kinds.map((k) => ({ value: k, label: t(`kind.${k}`) }))}
            selected={chosenKind ? [chosenKind] : []}
            onToggle={setKind}
            testID="fast-log.kind"
          />
          {chosenKind === 'intermittent' ? (
            <Text variant="caption" tone="muted" testID="fast-log.intermittent-note">
              {t('log.intermittentNote')}
            </Text>
          ) : null}
          {eligibility?.mode === 'practice' ? (
            <ChipGroup
              label={t('practice.pattern')}
              single
              options={PRACTICE_PATTERNS.map((p) => ({ value: p, label: t(`practice.${p}`) }))}
              selected={pattern ? [pattern] : []}
              onToggle={setPattern}
              testID="fast-log.pattern"
            />
          ) : null}
          <ChipGroup
            label={t('log.outcome')}
            single
            options={OUTCOMES.map((o) => ({ value: o, label: t(`outcome.${o}`) }))}
            selected={[outcome]}
            onToggle={setOutcome}
            testID="fast-log.outcome"
          />
          {outcome === 'exempt' ? (
            <ChipGroup
              label={t('log.reason')}
              hint={t('log.reasonPrivate')}
              single
              options={EXEMPTION_REASONS.map((r) => ({ value: r, label: t(`exemption.${r}`) }))}
              selected={reason ? [reason] : []}
              onToggle={setReason}
              testID="fast-log.reason"
            />
          ) : null}
          <Input
            label={t('log.notes')}
            value={notes}
            onChangeText={setNotes}
            variant="multiline"
            maxLength={280}
            testID="fast-log.notes"
          />
          {error ? (
            <InlineMessage
              tone="danger"
              message={t(`log.error.${error}`)}
              testID="fast-log.error"
            />
          ) : null}
          <Button label={t('log.save')} onPress={save} fullWidth testID="fast-log.save" />
        </>
      ) : null}
    </Screen>
  );
}
