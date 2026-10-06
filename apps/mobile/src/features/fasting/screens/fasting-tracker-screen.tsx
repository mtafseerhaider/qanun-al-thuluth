import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { voluntaryFastsOn } from '@shared/prayer/voluntary-fasts';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipGroup } from '@/components/ui/chip';
import { ProgressRing } from '@/components/ui/progress-ring';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { QueuedBadge, useHouseholdClock } from '@/features/meals';
import { track } from '@/lib/analytics/track';
import { addDays } from '@/lib/dates/local-date';
import type { MoreScreenProps } from '@/navigation/types';
import {
  selectCanEdit,
  selectIsOwner,
  useActiveHouseholdStore,
} from '@/stores/use-active-household-store';
import { usePreferencesStore } from '@/stores/use-preferences-store';
import { useSessionStore } from '@/stores/use-session-store';
import { cn } from '@/theme/cn';

import { EligibilityNotice } from '../components/fasting-notices';
import {
  removeFast,
  useFastingLogs,
  useFastingMembers,
  useFastingSafety,
  useFastingTimes,
} from '../hooks/use-fasting';
import {
  canSeePrivateFasting,
  defaultRamadanYear,
  fastingEligibility,
  NO_SAFETY,
  qadaBalance,
  ramadanDates,
  ramadanGrid,
  type RamadanDayStatus,
} from '../utils/fasting-rules';
import { fastProgress } from '../utils/prayer';

const STATUS_CLASS: Record<RamadanDayStatus, string> = {
  fasted: 'bg-primary border-primary',
  practice: 'bg-primary-soft border-primary',
  exempt: 'bg-info-soft border-info',
  missed: 'bg-surface-sunken border-line-strong',
  none: 'bg-surface-raised border-line',
  future: 'bg-surface border-line',
};

/**
 * M3 Fasting tracker (02 §7.12.4, 24 S4-11, FR-FAST-01 to -03, -05 to -07): log fasts by kind,
 * today's suhoor and iftar from the prayer module, the Ramadan grid, a private qada counter, child
 * age rules and safety blocks with a clinician card.
 */
export function FastingTrackerScreen({ navigation, route }: MoreScreenProps<'FastingTracker'>) {
  const { t } = useTranslation('fasting');
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const canEdit = useActiveHouseholdStore(selectCanEdit);
  const isOwner = useActiveHouseholdStore(selectIsOwner);
  const userId = useSessionStore((s) => s.userId);
  const tradition = usePreferencesStore((s) => s.traditionPreference);
  const clock = useHouseholdClock(householdId);
  const members = useFastingMembers(householdId);
  const safety = useFastingSafety(householdId);
  const logs = useFastingLogs(householdId);
  const times = useFastingTimes(householdId, clock.today);
  const [selected, setSelected] = useState<string | null>(route.params?.familyMemberId ?? null);
  const [ramadanYear, setRamadanYear] = useState(() => defaultRamadanYear(clock.today));

  const member = members.find((m) => m.id === selected) ?? members[0] ?? null;
  const eligibility = member
    ? fastingEligibility(member, safety.data?.[member.id] ?? NO_SAFETY, clock.today)
    : null;
  const canLog = canEdit && (eligibility?.mode === 'full' || eligibility?.mode === 'practice');
  const privateOk = member ? canSeePrivateFasting(member, { userId, isOwner }) : false;
  const mine = member ? logs.data.filter((l) => l.familyMemberId === member.id) : [];
  const todayLog = mine.find((l) => l.fastDate === clock.today && l.completed) ?? null;
  const progress = todayLog && times ? fastProgress(times, new Date()) : null;
  const grid = member
    ? ramadanGrid(ramadanDates(ramadanYear), logs.data, member.id, clock.today)
    : [];
  const qada = member ? qadaBalance(logs.data, member.id) : null;
  const upcoming =
    eligibility?.mode === 'full'
      ? Array.from({ length: 8 }, (_, i) => addDays(clock.today, i))
          .flatMap((d) => voluntaryFastsOn(d, { tradition }))
          .slice(0, 1)[0]
      : undefined;

  const openLog = () => {
    if (!member) return;
    navigation.navigate('FastLogSheet', { familyMemberId: member.id, date: clock.today });
  };

  return (
    <Screen testID="fasting.screen">
      <ChipGroup
        label={t('member')}
        single
        options={members.map((m) => ({ value: m.id, label: m.name }))}
        selected={member ? [member.id] : []}
        onToggle={(id) => {
          setSelected(id);
          const m = members.find((x) => x.id === id);
          const e = m ? fastingEligibility(m, safety.data?.[m.id] ?? NO_SAFETY, clock.today) : null;
          if (e?.mode === 'under_7') track('fasting_blocked', { reason: 'under_7' });
          if (e?.mode === 'blocked') track('fasting_blocked', { reason: 'clinician' });
        }}
        testID="fasting.member"
      />

      {times ? (
        <Card variant="filled" testID="fasting.times">
          <View className="flex-row justify-between gap-3">
            <View>
              <Text variant="caption" tone="muted">
                {t('times.suhoorEnds')}
              </Text>
              <Text variant="bodyStrong" testID="fasting.times.suhoor">
                {times.suhoorEnd}
              </Text>
            </View>
            <View>
              <Text variant="caption" tone="muted">
                {t('times.iftar')}
              </Text>
              <Text variant="bodyStrong" testID="fasting.times.iftar">
                {times.iftar}
              </Text>
            </View>
          </View>
          <Text variant="caption" tone="muted">
            {t('times.note')}
          </Text>
        </Card>
      ) : (
        <Text variant="caption" tone="muted" testID="fasting.times.unknown">
          {t('times.unknown')}
        </Text>
      )}

      {member && eligibility ? (
        <EligibilityNotice eligibility={eligibility} name={member.name} />
      ) : null}

      {progress ? (
        <View className="items-center gap-2" testID="fasting.timer">
          <ProgressRing
            value={progress.progress}
            tone="secondary"
            accessibilityLabel={t('timer.a11y', { minutes: progress.minutesLeft })}
            centerSlot={
              <View className="items-center">
                <Text variant="heading">
                  {t('timer.left', {
                    hours: Math.floor(progress.minutesLeft / 60),
                    minutes: progress.minutesLeft % 60,
                  })}
                </Text>
                <Text variant="caption" tone="muted">
                  {t('timer.toIftar')}
                </Text>
              </View>
            }
          />
        </View>
      ) : null}

      {canLog ? (
        <Button label={t('log.open')} onPress={openLog} fullWidth testID="fasting.log" />
      ) : null}

      {upcoming ? (
        <Text tone="muted" testID="fasting.upcoming">
          {t('upcoming', { name: t(upcoming.label_key), date: upcoming.date })}
        </Text>
      ) : null}

      {member && eligibility?.mode !== 'under_7' ? (
        <View className="gap-2" testID="fasting.ramadan">
          <View className="flex-row items-center justify-between">
            <Button
              label={t('ramadan.prev')}
              size="sm"
              variant="ghost"
              onPress={() => setRamadanYear((y) => y - 1)}
              testID="fasting.ramadan.prev"
            />
            <Text variant="heading" accessibilityRole="header">
              {t('ramadan.title', { year: ramadanYear })}
            </Text>
            <Button
              label={t('ramadan.next')}
              size="sm"
              variant="ghost"
              onPress={() => setRamadanYear((y) => y + 1)}
              testID="fasting.ramadan.next"
            />
          </View>
          <View className="flex-row flex-wrap gap-1">
            {grid.map((d) => (
              <View
                key={d.date}
                accessible
                accessibilityLabel={t('ramadan.dayA11y', {
                  day: d.day,
                  date: d.date,
                  status: t(`ramadan.status.${d.status}`),
                })}
                className={cn(
                  'h-9 w-9 items-center justify-center rounded-sm border',
                  STATUS_CLASS[d.status],
                )}
                testID={`fasting.ramadan.day-${d.day}.${d.status}`}
              >
                <Text variant="caption" tone={d.status === 'fasted' ? 'inverse' : 'neutral'}>
                  {d.day}
                </Text>
              </View>
            ))}
          </View>
          <Text variant="caption" tone="muted">
            {t('ramadan.legend')}
          </Text>
        </View>
      ) : null}

      {member && qada && privateOk && eligibility?.mode !== 'under_7' ? (
        <Card variant="outlined" testID="fasting.qada">
          {qada.permanent ? (
            <Text testID="fasting.qada.fidya">{t('qada.fidya')}</Text>
          ) : (
            <>
              <Text variant="heading" testID="fasting.qada.remaining">
                {t('qada.remaining', { count: qada.remaining })}
              </Text>
              <Text variant="caption" tone="muted">
                {t('qada.detail', { missed: qada.missed, madeUp: qada.madeUp })}
              </Text>
            </>
          )}
          <Text variant="caption" tone="muted">
            {t('qada.scholar')}
          </Text>
        </Card>
      ) : null}

      {member ? (
        <View className="gap-2" testID="fasting.recent">
          <Text variant="heading" accessibilityRole="header">
            {t('recent.title')}
          </Text>
          {mine.length === 0 ? (
            <Text tone="muted" testID="fasting.recent.empty">
              {t('recent.empty')}
            </Text>
          ) : (
            mine.slice(0, 20).map((l, i) => (
              <View
                key={l.id}
                className="flex-row items-center justify-between gap-2 border-b border-line py-2"
                testID={`fasting.recent.row-${i}`}
              >
                <View className="flex-1 gap-1">
                  <Text variant="bodyStrong">
                    {t(`kind.${l.kind}`)}
                    {l.isPracticeFast ? ` · ${t('practice.label')}` : ''}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {[
                      l.fastDate,
                      l.completed
                        ? t('outcome.completed')
                        : l.exemptionReason && privateOk
                          ? t(`exemption.${l.exemptionReason}`)
                          : t('outcome.notFasted'),
                    ].join(' · ')}
                  </Text>
                  {l.completed && !l.isPracticeFast ? (
                    <Text variant="caption" tone="primary">
                      {t('accepted')}
                    </Text>
                  ) : null}
                  {l.queued ? <QueuedBadge testID={`fasting.recent.row-${i}.queued`} /> : null}
                </View>
                {canEdit ? (
                  <Button
                    label={t('recent.delete')}
                    size="sm"
                    variant="ghost"
                    onPress={() => householdId && removeFast(householdId, l)}
                    testID={`fasting.recent.row-${i}.delete`}
                  />
                ) : null}
              </View>
            ))
          )}
        </View>
      ) : null}

      <Text variant="caption" tone="muted">
        {t('disclaimer')}
      </Text>
    </Screen>
  );
}
