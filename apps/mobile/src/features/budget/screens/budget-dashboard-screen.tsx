import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipGroup } from '@/components/ui/chip';
import { InlineMessage } from '@/components/ui/inline-message';
import { Input } from '@/components/ui/input';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { money, parseMajorToMinor } from '@/lib/money/format-money';
import { localized, QueuedBadge } from '@/features/meals';
import { track } from '@/lib/analytics/track';
import type { MoreScreenProps } from '@/navigation/types';
import { selectCanEdit, useActiveHouseholdStore } from '@/stores/use-active-household-store';

import { BudgetBar } from '../components/budget-bar';
import { addBudgetEntry, removeBudgetEntry, useBudgetSummary } from '../hooks/use-budget';
import { monthDiff, monthOf, shiftMonth } from '../utils/budget-rules';

const MIN_OFFSET = -24;

/**
 * M9 Budget dashboard (02 §7.12.9, 24 S4-07, FR-GRO-07 to -09): month to date against the budget,
 * linear forecast, cost per person per day, categories and the spend entries. Entries are queued
 * through the outbox, so spend can be added offline.
 */
export function BudgetDashboardScreen({ navigation, route }: MoreScreenProps<'BudgetDashboard'>) {
  const { t, i18n } = useTranslation('budget');
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const canEdit = useActiveHouseholdStore(selectCanEdit);
  const [month, setMonth] = useState<string | null>(route.params?.month ?? null);
  const data = useBudgetSummary(householdId, month ?? undefined);
  const current = monthOf(data.today);
  const offset = monthDiff(current, data.month);
  const { summary, profile } = data;
  const currency = profile?.currency ?? data.entries[0]?.currency ?? 'PKR';
  const fmt = (minor: number) => money(minor, currency, i18n.language);

  useEffect(() => {
    track('budget_viewed', { month_offset: Math.max(MIN_OFFSET, Math.min(1, offset)) });
  }, [offset]);

  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const amountMinor = parseMajorToMinor(amount);
  const category = data.categories.find((c) => c.id === categoryId) ?? null;
  const canAdd =
    canEdit && Boolean(profile) && amountMinor !== null && amountMinor > 0 && Boolean(category);
  const spentOn = data.month === current ? data.today : `${data.month}-01`;

  const add = () => {
    if (!householdId || !profile || !category || !amountMinor) return;
    addBudgetEntry(
      {
        householdId,
        budgetProfileId: profile.id,
        amountMinor,
        currency: profile.currency,
        categoryId: category.id,
        spentOn,
        groceryListId: null,
        note: note.trim() || null,
      },
      'manual',
      category.code,
    );
    setAmount('');
    setNote('');
  };

  const categoryName = (id: string, code: string) => {
    const c = data.categories.find((x) => x.id === id);
    return c ? localized(c.nameI18n, i18n.language, code) : t('category.other');
  };

  return (
    <Screen testID="budget.screen">
      <View className="flex-row items-center justify-between">
        <Button
          label={t('month.prev')}
          variant="ghost"
          size="sm"
          disabled={offset <= MIN_OFFSET}
          onPress={() => setMonth(shiftMonth(data.month, -1))}
          testID="budget.month.prev"
        />
        <Text variant="heading" testID="budget.month">
          {formatMonth(data.month, i18n.language)}
        </Text>
        <Button
          label={t('month.next')}
          variant="ghost"
          size="sm"
          disabled={offset >= 0}
          onPress={() => setMonth(shiftMonth(data.month, 1))}
          testID="budget.month.next"
        />
      </View>

      {data.isError ? (
        <InlineMessage tone="danger" message={t('error')} testID="budget.error" />
      ) : null}

      {!profile && !data.isLoading ? (
        <Card testID="budget.empty">
          <Text variant="bodyStrong">{t('empty.title')}</Text>
          <Text tone="muted">{t('empty.body')}</Text>
          {canEdit ? (
            <Button
              label={t('empty.cta')}
              onPress={() => navigation.navigate('BudgetSettings')}
              testID="budget.empty.cta"
            />
          ) : null}
        </Card>
      ) : null}

      {profile ? (
        <Card testID="budget.summary">
          <Text variant="overline" tone="muted">
            {t('summary.title')}
          </Text>
          <Text variant="title" testID="budget.spent">
            {fmt(summary.spentMinor)}
          </Text>
          <Text tone="muted">{t('summary.of', { budget: fmt(summary.budgetMinor) })}</Text>
          <BudgetBar
            spentMinor={summary.spentMinor}
            budgetMinor={summary.budgetMinor}
            forecastMinor={summary.forecastMinor}
            accessibilityLabel={t('summary.a11y', {
              spent: fmt(summary.spentMinor),
              budget: fmt(summary.budgetMinor),
            })}
            testID="budget.bar"
          />
          <Text tone={summary.tone} testID={`budget.status.${summary.status}`}>
            {t(`status.${summary.status}`, { forecast: fmt(summary.forecastMinor) })}
          </Text>
          <View className="flex-row flex-wrap gap-4">
            <Stat
              label={t('summary.forecast')}
              value={fmt(summary.forecastMinor)}
              testID="budget.forecast"
            />
            <Stat
              label={t('summary.left')}
              value={fmt(Math.max(0, summary.budgetMinor - summary.spentMinor))}
              testID="budget.left"
            />
            <Stat
              label={t('summary.daysLeft')}
              value={String(summary.daysLeft)}
              testID="budget.days-left"
            />
            <Stat
              label={t('summary.perPersonDay')}
              value={
                summary.costPerPersonPerDayMinor === null
                  ? t('summary.none')
                  : fmt(summary.costPerPersonPerDayMinor)
              }
              testID="budget.per-person"
            />
          </View>
          {canEdit ? (
            <Button
              label={t('settings.open')}
              variant="link"
              onPress={() => navigation.navigate('BudgetSettings')}
              testID="budget.settings"
            />
          ) : null}
        </Card>
      ) : null}

      {summary.byCategory.length > 0 ? (
        <Card testID="budget.categories">
          <Text variant="heading">{t('categories.title')}</Text>
          {summary.byCategory.map((c) => (
            <View key={c.categoryId} className="gap-1" testID={`budget.category.${c.code}`}>
              <View className="flex-row justify-between">
                <Text>{categoryName(c.categoryId, c.code)}</Text>
                <Text tone="muted">
                  {c.allocatedMinor !== null
                    ? t('categories.ofAllocated', {
                        spent: fmt(c.spentMinor),
                        allocated: fmt(c.allocatedMinor),
                      })
                    : fmt(c.spentMinor)}
                </Text>
              </View>
              {c.allocatedMinor !== null ? (
                <BudgetBar
                  spentMinor={c.spentMinor}
                  budgetMinor={c.allocatedMinor}
                  accessibilityLabel={t('summary.a11y', {
                    spent: fmt(c.spentMinor),
                    budget: fmt(c.allocatedMinor),
                  })}
                />
              ) : null}
            </View>
          ))}
        </Card>
      ) : null}

      {profile && canEdit && offset <= 0 ? (
        <Card testID="budget.add">
          <Text variant="heading">{t('add.title')}</Text>
          <Input
            label={t('add.amount')}
            value={amount}
            onChangeText={setAmount}
            variant="numeric"
            unit={profile.currency}
            testID="budget.add.amount"
          />
          <ChipGroup
            label={t('add.category')}
            single
            options={data.categories.map((c) => ({
              value: c.id,
              label: localized(c.nameI18n, i18n.language, c.code),
            }))}
            selected={categoryId ? [categoryId] : []}
            onToggle={setCategoryId}
            testID="budget.add.category"
          />
          <Input
            label={t('add.note')}
            value={note}
            onChangeText={setNote}
            maxLength={280}
            testID="budget.add.note"
          />
          <Button label={t('add.save')} onPress={add} disabled={!canAdd} testID="budget.add.save" />
        </Card>
      ) : null}

      <Card testID="budget.entries">
        <Text variant="heading">{t('entries.title')}</Text>
        {data.entries.length === 0 ? (
          <Text tone="muted" testID="budget.entries.empty">
            {t('entries.empty')}
          </Text>
        ) : (
          data.entries.map((e, i) => (
            <View
              key={e.id}
              className="flex-row items-center justify-between gap-2"
              testID={`budget.entry-${i}`}
            >
              <View className="flex-1">
                <Text>{categoryName(e.categoryId, 'other')}</Text>
                <Text variant="caption" tone="muted">
                  {e.note ? `${e.spentOn} · ${e.note}` : e.spentOn}
                  {e.groceryListId ? ` · ${t('entries.fromGrocery')}` : ''}
                </Text>
              </View>
              {e.queued ? <QueuedBadge testID={`budget.entry-${i}.queued`} /> : null}
              <Text variant="bodyStrong">{fmt(e.amountMinor)}</Text>
              {canEdit && householdId ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('entries.deleteA11y', {
                    category: categoryName(e.categoryId, 'other'),
                    amount: fmt(e.amountMinor),
                    date: e.spentOn,
                  })}
                  hitSlop={8}
                  className="min-h-touch min-w-11 items-center justify-center"
                  onPress={() => removeBudgetEntry(householdId, e)}
                  testID={`budget.entry-${i}.delete`}
                >
                  <Text tone="danger">×</Text>
                </Pressable>
              ) : null}
            </View>
          ))
        )}
      </Card>
      <Text variant="caption" tone="muted">
        {t('footer')}
      </Text>
    </Screen>
  );
}

function formatMonth(month: string, locale: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  try {
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(locale === 'ur' ? 'ur-PK' : locale, {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return month;
  }
}

function Stat({ label, value, testID }: { label: string; value: string; testID: string }) {
  return (
    <View className="min-w-[40%] gap-0.5" testID={testID}>
      <Text variant="caption" tone="muted">
        {label}
      </Text>
      <Text variant="bodyStrong">{value}</Text>
    </View>
  );
}
