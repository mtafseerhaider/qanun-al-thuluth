import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipGroup } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useFamilyMembers } from '@/features/family';
import { QueuedBadge, useHouseholdClock } from '@/features/meals';
import type { TodayScreenProps } from '@/navigation/types';
import { selectCanEdit, useActiveHouseholdStore } from '@/stores/use-active-household-store';

import { saveJournal, useJournal } from '../hooks/use-tracking';
import { journalShowsAdherence } from '../utils/tracking-rules';

const SCALE = ['1', '2', '3', '4', '5'] as const;
const ADHERENCE = ['0', '1', '2', '3'] as const;
type Score = (typeof SCALE)[number];

/**
 * T3 Daily reflection, the nutrition journal (02 §7.5.4, 24 S4-16): mood, energy and digestion on
 * a 1 to 5 scale, notes, and for adults how close the day was to the thirds (0 to 3). Children are
 * never scored on their eating. One entry per member and day, queued through the outbox.
 */
export function DailyReflectionScreen({ route, navigation }: TodayScreenProps<'DailyReflection'>) {
  const { t } = useTranslation('tracking');
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const canEdit = useActiveHouseholdStore(selectCanEdit);
  const clock = useHouseholdClock(householdId);
  const date = route.params?.date ?? clock.today;
  const members = useFamilyMembers(householdId);
  const list = useMemo(
    () =>
      (members.data ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        dateOfBirth: m.date_of_birth,
        lifeStage: m.life_stage,
      })),
    [members.data],
  );
  const [selected, setSelected] = useState<string | null>(route.params?.familyMemberId ?? null);
  const memberId = selected ?? list[0]?.id ?? null;
  const member = list.find((m) => m.id === memberId) ?? null;
  const adult = member ? journalShowsAdherence(member, clock.today) : false;
  const journal = useJournal(householdId, memberId, clock.today);
  const existing = journal.data.find((j) => j.journalDate === date);

  const [mood, setMood] = useState<Score | null>(null);
  const [energy, setEnergy] = useState<Score | null>(null);
  const [digestion, setDigestion] = useState<Score | null>(null);
  const [adherence, setAdherence] = useState<string | null>(null);
  const [notes, setNotes] = useState('');

  useEffect(() => {
    const s = (v: number | null | undefined) => (v ? (String(v) as Score) : null);
    setMood(s(existing?.mood));
    setEnergy(s(existing?.energy));
    setDigestion(s(existing?.digestion));
    setAdherence(
      existing?.thuluthAdherence !== null && existing?.thuluthAdherence !== undefined
        ? String(existing.thuluthAdherence)
        : null,
    );
    setNotes(existing?.notes ?? '');
    // Reload the form when the member or the saved entry changes.
  }, [memberId, existing?.id, existing]);

  const any = mood || energy || digestion || adherence || notes.trim();
  const save = () => {
    if (!householdId || !member) return;
    saveJournal(
      {
        householdId,
        familyMemberId: member.id,
        journalDate: date,
        mood: mood ? Number(mood) : null,
        energy: energy ? Number(energy) : null,
        digestion: digestion ? Number(digestion) : null,
        thuluthAdherence: adult && adherence !== null ? Number(adherence) : null,
        notes: notes.trim() || null,
        ...(existing ? { existingId: existing.id } : {}),
      },
      !adult,
    );
    navigation.goBack();
  };

  const scale = (
    key: 'mood' | 'energy' | 'digestion',
    value: Score | null,
    set: (v: Score) => void,
  ) => (
    <ChipGroup
      label={t(`journal.${key}`)}
      hint={t(`journal.${key}Hint`)}
      single
      options={SCALE.map((v) => ({ value: v, label: t(`journal.scale.${v}`) }))}
      selected={value ? [value] : []}
      onToggle={set}
      testID={`journal.${key}`}
    />
  );

  return (
    <Screen testID="journal.screen">
      <ChipGroup
        label={t('journal.member')}
        single
        options={list.map((m) => ({ value: m.id, label: m.name }))}
        selected={memberId ? [memberId] : []}
        onToggle={setSelected}
        testID="journal.member"
      />
      <Text tone="muted">{t('journal.date', { date })}</Text>
      {member && canEdit ? (
        <Card testID="journal.form">
          {scale('mood', mood, setMood)}
          {scale('energy', energy, setEnergy)}
          {scale('digestion', digestion, setDigestion)}
          {adult ? (
            <ChipGroup
              label={t('journal.adherence')}
              hint={t('journal.adherenceHint')}
              single
              options={ADHERENCE.map((v) => ({
                value: v,
                label: t(`journal.adherenceScale.${v}`),
              }))}
              selected={adherence !== null ? [adherence] : []}
              onToggle={setAdherence}
              testID="journal.adherence"
            />
          ) : (
            <Text variant="caption" tone="muted" testID="journal.child-note">
              {t('journal.childNote')}
            </Text>
          )}
          <Input
            label={t('journal.notes')}
            value={notes}
            onChangeText={setNotes}
            variant="multiline"
            maxLength={4000}
            testID="journal.notes"
          />
          <Button
            label={existing ? t('journal.update') : t('journal.save')}
            onPress={save}
            disabled={!any}
            testID="journal.save"
          />
        </Card>
      ) : null}
      {journal.data.length > 0 ? (
        <Card testID="journal.recent">
          <Text variant="heading">{t('journal.recent')}</Text>
          {journal.data.slice(0, 14).map((j, i) => (
            <View key={j.id} className="gap-0.5" testID={`journal.row-${i}`}>
              <View className="flex-row items-center gap-2">
                <Text variant="bodyStrong">{j.journalDate}</Text>
                {j.queued ? <QueuedBadge testID={`journal.row-${i}.queued`} /> : null}
              </View>
              <Text variant="caption" tone="muted">
                {[
                  j.mood ? t('journal.summary.mood', { value: j.mood }) : null,
                  j.energy ? t('journal.summary.energy', { value: j.energy }) : null,
                  j.digestion ? t('journal.summary.digestion', { value: j.digestion }) : null,
                  j.thuluthAdherence !== null
                    ? t('journal.summary.adherence', { value: j.thuluthAdherence })
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              {j.notes ? <Text variant="caption">{j.notes}</Text> : null}
            </View>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
