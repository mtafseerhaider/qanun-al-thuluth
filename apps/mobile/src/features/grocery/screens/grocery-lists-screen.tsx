import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useHouseholdClock, useHouseholdPremium } from '@/features/meals';
import { useActivePlan } from '@/features/plan';
import { useIsOnline } from '@/hooks/use-is-online';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { PlanScreenProps } from '@/navigation/types';
import { selectCanEdit, useActiveHouseholdStore } from '@/stores/use-active-household-store';

import { useGenerateGroceryList, useGroceryLists } from '../hooks/use-grocery';
import { money, planWeekFor, type GroceryListView } from '../utils/grocery-rules';

/**
 * P6 Grocery lists (02 §7.6.6, 24 S4-05, FR-GRO-01): lists of the household and "Make this week's
 * list" from the active plan through `grocery-generate`. An open list for the same week is
 * regenerated in place instead of duplicated. Generating needs a connection; lists open offline.
 */
export function GroceryListsScreen({ navigation }: PlanScreenProps<'GroceryLists'>) {
  const { t, i18n } = useTranslation(['grocery', 'errors']);
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const canEdit = useActiveHouseholdStore(selectCanEdit);
  const online = useIsOnline();
  const lists = useGroceryLists(householdId);
  const plan = useActivePlan(householdId);
  const premium = useHouseholdPremium(householdId).data === true;
  const clock = useHouseholdClock(householdId);
  const generate = useGenerateGroceryList(householdId);

  const active = plan.data ?? null;
  const week = active ? planWeekFor(active, clock.today) : null;
  const all = lists.data ?? [];
  const sameWeek = week
    ? all.find(
        (l) => l.mealPlanId === active?.id && l.startsOn === week.startsOn && l.status !== 'done',
      )
    : undefined;

  const make = () => {
    if (!active || !week) return;
    generate.mutate(
      {
        mealPlanId: active.id,
        startsOn: week.startsOn,
        endsOn: week.endsOn,
        premium,
        source: 'lists',
        ...(sameWeek ? { replaceListId: sameWeek.id } : {}),
      },
      {
        onSuccess: (r) =>
          navigation.navigate('GroceryListDetail', { groceryListId: r.grocery_list_id }),
      },
    );
  };

  return (
    <Screen
      testID="grocery-lists.screen"
      refreshing={lists.isRefetching}
      onRefresh={() => void lists.refetch()}
    >
      {canEdit ? (
        <Card testID="grocery-lists.generate">
          <Text variant="heading">{t('grocery:lists.generateTitle')}</Text>
          {active && week ? (
            <>
              <Text tone="muted">
                {t('grocery:lists.generateBody', { from: week.startsOn, to: week.endsOn })}
              </Text>
              {sameWeek ? (
                <Text variant="caption" tone="muted">
                  {t('grocery:lists.replaceNote')}
                </Text>
              ) : null}
              <Button
                label={sameWeek ? t('grocery:lists.regenerate') : t('grocery:lists.generate')}
                onPress={make}
                loading={generate.isPending}
                disabled={!online}
                testID="grocery-lists.generate.button"
              />
              {!online ? (
                <Text variant="caption" tone="muted" testID="grocery-lists.offline">
                  {t('grocery:lists.offline')}
                </Text>
              ) : null}
            </>
          ) : (
            <Text tone="muted" testID="grocery-lists.no-plan">
              {t('grocery:lists.noPlan')}
            </Text>
          )}
        </Card>
      ) : null}
      {generate.isError ? (
        <InlineMessage
          tone="danger"
          message={t(`errors:${errorKeyFor(generate.error)}`)}
          testID="grocery-lists.error"
        />
      ) : null}
      {lists.isError && !lists.data ? (
        <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(lists.error)}`)} />
      ) : null}
      {!lists.isLoading && all.length === 0 && !lists.isError ? (
        <Card variant="filled" testID="grocery-lists.empty">
          <Text tone="muted">{t('grocery:lists.empty')}</Text>
        </Card>
      ) : null}
      {all.map((l, i) => (
        <ListRow
          key={l.id}
          list={l}
          locale={i18n.language}
          onPress={() => navigation.navigate('GroceryListDetail', { groceryListId: l.id })}
          testID={`grocery-lists.row-${i}`}
        />
      ))}
    </Screen>
  );
}

function ListRow({
  list,
  locale,
  onPress,
  testID,
}: {
  list: GroceryListView;
  locale: string;
  onPress: () => void;
  testID: string;
}) {
  const { t } = useTranslation('grocery');
  return (
    <Card
      variant="outlined"
      onPress={onPress}
      accessibilityLabel={t('lists.openA11y', { from: list.startsOn, to: list.endsOn })}
      testID={testID}
    >
      <Text variant="bodyStrong">{t('lists.dates', { from: list.startsOn, to: list.endsOn })}</Text>
      <Text variant="caption" tone="muted">
        {t(`status.${list.status}`)}
        {list.priceProfileId && list.estimatedTotalMinor > 0
          ? ` · ${t('lists.estimate', { amount: money(list.estimatedTotalMinor, list.currency, locale) })}`
          : ''}
      </Text>
    </Card>
  );
}
