import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipGroup } from '@/components/ui/chip';
import { InlineMessage } from '@/components/ui/inline-message';
import { Input } from '@/components/ui/input';
import { ProgressRing } from '@/components/ui/progress-ring';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useFastingToday } from '@/features/fasting';
import { QueuedBadge } from '@/features/meals';
import { useIsOnline } from '@/hooks/use-is-online';
import { formatTime, instantTime } from '@/lib/dates/local-date';
import type { MoreScreenProps } from '@/navigation/types';
import { selectCanEdit, useActiveHouseholdStore } from '@/stores/use-active-household-store';

import { formatVolume, HydrationRing, KidCups } from '../components/hydration-ring';
import { logHydration, removeHydrationLog, useHydrationToday } from '../hooks/use-hydration';
import {
  ADULT_QUICK_SIZES,
  aboveSafeRange,
  cupsToMl,
  GLASS_ML,
  KID_QUICK_CUPS,
  lastSevenDays,
  logDate,
  mlToCups,
  nextPreMealWindow,
  usesKidCups,
  type Beverage,
  type DrinkTiming,
} from '../utils/hydration-rules';

const BEVERAGE_OPTIONS: readonly Beverage[] = ['water', 'milk', 'laban', 'juice', 'tea', 'other'];
const TIMING_OPTIONS = ['auto', 'pre_meal', 'with_meal', 'post_meal', 'other'] as const;
type TimingChoice = (typeof TIMING_OPTIONS)[number];

/**
 * M2 Hydration tracker (02 §7.12.2, 24 S4-08, FR-HYD-02 to -04): member rings, quick sizes,
 * beverage and timing, kid cup view, schedule from `hydration_targets`, and a link to the
 * dehydration check (S4-09). Logs go through the outbox, so the tracker works offline.
 */
export function HydrationTrackerScreen({ navigation, route }: MoreScreenProps<'HydrationTracker'>) {
  const { t } = useTranslation(['hydration', 'meals']);
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const canEdit = useActiveHouseholdStore(selectCanEdit);
  const online = useIsOnline();
  const day = useHydrationToday(householdId);
  const fasting = useFastingToday(householdId);
  const [selected, setSelected] = useState<string>(route.params?.familyMemberId ?? 'all');
  const [beverage, setBeverage] = useState<Beverage>('water');
  const [timing, setTiming] = useState<TimingChoice>('auto');
  const [custom, setCustom] = useState('');

  const drinkers = day.members.filter((m) => !m.noDrinks);
  const member = day.members.find((m) => m.id === selected) ?? null;
  const kid = member ? usesKidCups(member.lifeStage) : false;
  const targetIds = member ? (member.noDrinks ? [] : [member.id]) : drinkers.map((m) => m.id);
  const memberFasting = member ? fasting.memberIds.has(member.id) : fasting.memberIds.size > 0;

  const log = (volumeMl: number) => {
    if (!householdId || targetIds.length === 0 || volumeMl <= 0) return;
    logHydration({
      householdId,
      memberIds: targetIds,
      volumeMl,
      beverage,
      ...(timing !== 'auto' ? { timing: timing as DrinkTiming } : {}),
      windows: member?.windows ?? [],
      mealMinutes: day.mealMinutes,
      nowMinutes: day.nowMinutes,
    });
  };
  const customMl = Number(custom.replace(',', '.'));
  const customValid = Number.isFinite(customMl) && customMl >= 10 && customMl <= 3000;

  const todays = day.logs.filter(
    (l) =>
      logDate(l, day.timezone) === day.today && (member ? l.familyMemberId === member.id : true),
  );
  const names = new Map(day.members.map((m) => [m.id, m.name]));
  const week = member ? lastSevenDays(day.logs, member.id, day.today, day.timezone) : [];
  const weekMax = Math.max(1, member?.targetMl ?? 0, ...week.map((w) => w.ml));
  const next = member ? nextPreMealWindow(member.windows, day.nowMinutes) : day.nextWindow;

  return (
    <Screen testID="hydration.screen">
      <ChipGroup
        label={t('hydration:member.label')}
        single
        options={[
          { value: 'all', label: t('hydration:member.everyone') },
          ...day.members.map((m) => ({ value: m.id, label: m.name })),
        ]}
        selected={[selected]}
        onToggle={setSelected}
        testID="hydration.member"
      />

      {!online ? (
        <InlineMessage tone="info" message={t('hydration:offline')} testID="hydration.offline" />
      ) : null}

      {member?.noDrinks ? (
        <Card variant="filled" testID="hydration.infant">
          <Text>{t('hydration:infant')}</Text>
        </Card>
      ) : member ? (
        <Card testID="hydration.member-card">
          <HydrationRing
            consumedMl={member.consumedMl}
            targetMl={member.targetMl}
            kid={kid}
            fasting={memberFasting}
            label={member.name}
            testID="hydration.ring"
          />
          {kid ? (
            <KidCups
              consumedMl={member.consumedMl}
              targetMl={member.targetMl}
              testID="hydration.cups"
            />
          ) : null}
          {member.targetMl === 0 ? (
            <Text variant="caption" tone="muted" testID="hydration.no-target">
              {t('hydration:noTarget')}
            </Text>
          ) : null}
          {aboveSafeRange(member.consumedMl, member.targetMl) ? (
            <InlineMessage
              tone="info"
              message={t('hydration:aboveRange')}
              testID="hydration.above-range"
            />
          ) : null}
        </Card>
      ) : (
        <Card testID="hydration.family-card">
          <View className="items-center">
            <ProgressRing
              value={(day.score ?? 0) / 100}
              size={140}
              accessibilityLabel={t('hydration:family.a11y', { score: day.score ?? 0 })}
              centerSlot={
                <View className="items-center">
                  <Text variant="title" testID="hydration.family-score">
                    {day.score === null ? '–' : t('hydration:family.percent', { score: day.score })}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {t('hydration:family.label')}
                  </Text>
                </View>
              }
              testID="hydration.family-ring"
            />
          </View>
          <View className="flex-row flex-wrap justify-center gap-3">
            {drinkers.map((m) => (
              <View key={m.id} className="items-center gap-1">
                <HydrationRing
                  consumedMl={m.consumedMl}
                  targetMl={m.targetMl}
                  kid={usesKidCups(m.lifeStage)}
                  size={44}
                  label={m.name}
                  className="items-center"
                  testID={`hydration.mini-${m.id}`}
                />
                <Text variant="caption">{m.name}</Text>
              </View>
            ))}
          </View>
        </Card>
      )}

      {memberFasting ? (
        <Text tone="muted" testID="hydration.fasting-window">
          {t('hydration:fastingWindow')}
        </Text>
      ) : next ? (
        <Text tone="muted" testID="hydration.next-window">
          {t('hydration:nextWindow', {
            meal: next.mealType ? t(`meals:mealType.${next.mealType}`) : t('hydration:aMeal'),
            time: formatTime(next.start) ?? next.start,
          })}
        </Text>
      ) : null}

      {canEdit && targetIds.length > 0 ? (
        <Card variant="outlined" testID="hydration.log">
          <Text variant="heading" accessibilityRole="header">
            {member ? t('hydration:log.title') : t('hydration:log.titleFamily')}
          </Text>
          {kid ? (
            <View className="flex-row flex-wrap gap-2">
              {KID_QUICK_CUPS.map((c) => (
                <Button
                  key={c}
                  label={t('hydration:log.cups', { count: c })}
                  size="sm"
                  onPress={() => log(cupsToMl(c))}
                  testID={`hydration.quick-cup.${c}`}
                />
              ))}
            </View>
          ) : (
            <View className="flex-row flex-wrap gap-2">
              {member ? (
                ADULT_QUICK_SIZES.map((ml) => (
                  <Button
                    key={ml}
                    label={t('hydration:unit.ml', { value: ml })}
                    size="sm"
                    onPress={() => log(ml)}
                    testID={`hydration.quick.${ml}`}
                  />
                ))
              ) : (
                <Button
                  label={t('hydration:log.familyGlass')}
                  onPress={() => log(GLASS_ML)}
                  testID="hydration.family-glass"
                />
              )}
            </View>
          )}
          {!kid ? (
            <View className="flex-row items-end gap-2">
              <Input
                label={t('hydration:log.custom')}
                value={custom}
                onChangeText={setCustom}
                variant="numeric"
                unit={t('hydration:unit.mlShort')}
                className="flex-1"
                testID="hydration.custom"
              />
              <Button
                label={t('hydration:log.add')}
                disabled={!customValid}
                onPress={() => {
                  log(Math.round(customMl));
                  setCustom('');
                }}
                testID="hydration.custom.add"
              />
            </View>
          ) : null}
          <ChipGroup
            label={t('hydration:beverage.label')}
            single
            options={BEVERAGE_OPTIONS.map((b) => ({
              value: b,
              label: t(`hydration:beverage.${b}`),
            }))}
            selected={[beverage]}
            onToggle={setBeverage}
            testID="hydration.beverage"
          />
          <ChipGroup
            label={t('hydration:timing.label')}
            hint={t('hydration:timing.hint')}
            single
            options={TIMING_OPTIONS.map((v) => ({ value: v, label: t(`hydration:timing.${v}`) }))}
            selected={[timing]}
            onToggle={setTiming}
            testID="hydration.timing"
          />
        </Card>
      ) : null}

      <View className="gap-2" testID="hydration.today">
        <Text variant="heading" accessibilityRole="header">
          {t('hydration:today.title')}
        </Text>
        {todays.length === 0 ? (
          <Text tone="muted" testID="hydration.today.empty">
            {t('hydration:today.empty')}
          </Text>
        ) : (
          todays.map((l, i) => {
            const v = formatVolume(l.volumeMl);
            const kidRow = usesKidCups(
              day.members.find((m) => m.id === l.familyMemberId)?.lifeStage,
            );
            return (
              <View
                key={l.id}
                className="flex-row items-center justify-between gap-2 border-b border-line py-2"
                testID={`hydration.today.row-${i}`}
              >
                <View className="flex-1 gap-1">
                  <Text variant="bodyStrong">
                    {kidRow
                      ? t('hydration:log.cups', { count: mlToCups(l.volumeMl) })
                      : t(`hydration:unit.${v.unit}`, { value: v.value })}
                    {' · '}
                    {t(`hydration:beverage.${l.beverage}`)}
                  </Text>
                  <Text variant="caption" tone="muted">
                    {[
                      names.get(l.familyMemberId),
                      instantTime(l.loggedAt, day.timezone),
                      t(`hydration:timing.${l.timing}`),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  {l.queued ? <QueuedBadge testID={`hydration.today.row-${i}.queued`} /> : null}
                </View>
                {canEdit ? (
                  <Button
                    label={t('hydration:today.delete')}
                    size="sm"
                    variant="ghost"
                    accessibilityLabel={t('hydration:today.deleteA11y')}
                    onPress={() => householdId && removeHydrationLog(householdId, l)}
                    testID={`hydration.today.row-${i}.delete`}
                  />
                ) : null}
              </View>
            );
          })
        )}
      </View>

      {member && !member.noDrinks && week.some((w) => w.ml > 0) ? (
        <View className="gap-2" testID="hydration.week">
          <Text variant="heading" accessibilityRole="header">
            {t('hydration:week.title')}
          </Text>
          <View className="h-24 flex-row items-end gap-2">
            {week.map((w) => (
              <View
                key={w.date}
                accessible
                accessibilityLabel={t('hydration:week.a11y', {
                  date: w.date,
                  amount: kid
                    ? t('hydration:log.cups', { count: mlToCups(w.ml) })
                    : t('hydration:unit.ml', { value: w.ml }),
                })}
                className="flex-1 rounded-t-sm bg-water"
                style={{ height: `${Math.max(4, Math.round((w.ml / weekMax) * 100))}%` }}
              />
            ))}
          </View>
        </View>
      ) : null}

      <Card variant="filled" testID="hydration.guidance">
        <Text>{t('hydration:guidance')}</Text>
        <Text variant="caption" tone="muted">
          {t('hydration:adab')}
        </Text>
        {member && Object.keys(member.basis).length > 0 ? (
          <Text variant="caption" tone="muted" testID="hydration.basis">
            {t('hydration:basis')}
          </Text>
        ) : null}
      </Card>

      <Button
        label={t('hydration:symptoms.open')}
        variant="secondary"
        onPress={() =>
          navigation.navigate('DehydrationCheckSheet', member ? { familyMemberId: member.id } : {})
        }
        testID="hydration.symptoms"
      />
    </Screen>
  );
}
