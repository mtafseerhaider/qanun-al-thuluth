import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { ProgressRing } from '@/components/ui/progress-ring';
import { Text } from '@/components/ui/text';
import { BudgetBar, useBudgetSummary } from '@/features/budget';
import { useFastingTimes, useFastingToday } from '@/features/fasting';
import { formatVolume, useHydrationToday } from '@/features/hydration';
import { useInbox } from '@/features/notifications';
import { track } from '@/lib/analytics/track';
import { formatTime } from '@/lib/dates/local-date';
import { money } from '@/lib/money/format-money';

/**
 * Today's Sprint 4 cards (02 §7.5.1, FR-DASH-03): the family hydration ring with the next pre-meal
 * window, who is fasting today with iftar time, and the month's budget. Each opens its tracker.
 */
export function TodayHydrationCard({
  householdId,
  onOpen,
}: {
  householdId: string | null;
  onOpen: () => void;
}) {
  const { t } = useTranslation(['today', 'hydration', 'meals']);
  const day = useHydrationToday(householdId);
  const fasting = useFastingToday(householdId);
  const drinkers = day.members.filter((m) => !m.noDrinks && m.targetMl > 0);
  if (drinkers.length === 0) return null;
  const consumed = drinkers.reduce((n, m) => n + Math.min(m.consumedMl, m.targetMl), 0);
  const target = drinkers.reduce((n, m) => n + m.targetMl, 0);
  const allFasting = drinkers.every((m) => fasting.memberIds.has(m.id));
  const next = day.nextWindow;
  const vol = (ml: number) => {
    const v = formatVolume(ml);
    return t(`hydration:unit.${v.unit}`, { value: v.value });
  };
  return (
    <Card
      onPress={() => {
        track('dashboard_section_tapped', { section: 'hydration' });
        onOpen();
      }}
      accessibilityLabel={t('today:hydration.a11y', { percent: day.score ?? 0 })}
      testID="today.hydration"
    >
      <View className="flex-row items-center gap-4">
        <ProgressRing
          value={(day.score ?? 0) / 100}
          size={72}
          strokeWidth={8}
          tone="water"
          dimmed={allFasting}
          accessibilityLabel={t('today:hydration.a11y', { percent: day.score ?? 0 })}
          centerSlot={
            <Text variant="bodyStrong" testID="today.hydration.score">
              {`${day.score ?? 0}%`}
            </Text>
          }
          testID="today.hydration.ring"
        />
        <View className="flex-1 gap-1">
          <Text variant="bodyStrong">{t('today:hydration.title')}</Text>
          <Text tone="muted">
            {t('today:hydration.amount', {
              consumed: vol(consumed),
              target: vol(target),
            })}
          </Text>
          {allFasting ? (
            <Text variant="caption" tone="muted" testID="today.hydration.fasting">
              {t('hydration:fastingWindow')}
            </Text>
          ) : next ? (
            <Text variant="caption" tone="muted" testID="today.hydration.next">
              {t('hydration:nextWindow', {
                meal: next.mealType ? t(`meals:mealType.${next.mealType}`) : t('hydration:aMeal'),
                time: formatTime(next.start) ?? next.start,
              })}
            </Text>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

export function TodayFastingLine({
  householdId,
  today,
  onOpen,
}: {
  householdId: string | null;
  today: string;
  onOpen: () => void;
}) {
  const { t } = useTranslation('today');
  const fasting = useFastingToday(householdId);
  const times = useFastingTimes(householdId, today);
  if (fasting.memberIds.size === 0) return null;
  return (
    <Card
      variant="filled"
      onPress={() => {
        track('dashboard_section_tapped', { section: 'fasting' });
        onOpen();
      }}
      accessibilityLabel={t('fasting.title', { count: fasting.memberIds.size })}
      testID="today.fasting"
    >
      <Text variant="bodyStrong">{t('fasting.title', { count: fasting.memberIds.size })}</Text>
      {times ? (
        <Text tone="muted" testID="today.fasting.iftar">
          {t('fasting.iftar', { time: times.iftar })}
        </Text>
      ) : null}
    </Card>
  );
}

export function TodayBudgetLine({
  householdId,
  onOpen,
}: {
  householdId: string | null;
  onOpen: () => void;
}) {
  const { t, i18n } = useTranslation('today');
  const b = useBudgetSummary(householdId);
  if (!b.profile) return null;
  const fmt = (minor: number) => money(minor, b.profile?.currency ?? 'PKR', i18n.language);
  const label = t('budget.line', {
    spent: fmt(b.summary.spentMinor),
    budget: fmt(b.summary.budgetMinor),
  });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        track('dashboard_section_tapped', { section: 'budget' });
        onOpen();
      }}
      className="min-h-touch justify-center gap-1"
      testID="today.budget"
    >
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <BudgetBar
        spentMinor={b.summary.spentMinor}
        budgetMinor={b.summary.budgetMinor}
        accessibilityLabel={label}
      />
    </Pressable>
  );
}

/** Bell with the unread count, opening the notifications center (02 §7.13.1). */
export function NotificationBell({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation('today');
  const inbox = useInbox();
  const label = inbox.unread > 0 ? t('bell.unread', { count: inbox.unread }) : t('bell.label');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={() => {
        track('dashboard_section_tapped', { section: 'notifications' });
        onOpen();
      }}
      className="min-h-control flex-row items-center gap-1 px-2"
      testID="today.bell"
    >
      <Text variant="heading">🔔</Text>
      {inbox.unread > 0 ? (
        <View className="rounded-full bg-primary px-1.5" testID="today.bell.count">
          <Text variant="caption" tone="inverse">
            {inbox.unread > 9 ? '9+' : String(inbox.unread)}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
