import * as Crypto from 'expo-crypto';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Share, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ChipGroup } from '@/components/ui/chip';
import { InlineMessage } from '@/components/ui/inline-message';
import { Input } from '@/components/ui/input';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import {
  addBudgetEntry,
  spendByCategory,
  useBudgetCategories,
  useBudgetProfile,
} from '@/features/budget';
import { QueuedBadge, useHouseholdClock, useHouseholdPremium } from '@/features/meals';
import { track } from '@/lib/analytics/track';
import type { PlanScreenProps } from '@/navigation/types';
import { selectCanEdit, useActiveHouseholdStore } from '@/stores/use-active-household-store';

import {
  addManualItem,
  changeItem,
  changeListStatus,
  removeItem,
  reportPrice,
  useGroceryList,
} from '../hooks/use-grocery';
import {
  AISLE_ORDER,
  formatQuantity,
  groupByAisle,
  listItems,
  listTotals,
  money,
  parseMajorToMinor,
  priceReportFor,
  shareText,
  substitutions,
  type ShoppingItemView,
} from '../utils/grocery-rules';

const MANUAL_UNITS = ['piece', 'kg', 'g', 'l', 'dozen', 'pack'] as const;

/**
 * P7 Grocery list detail and P8 shopping mode (02 §7.6.7 to §7.6.8, 24 S4-05, FR-GRO-02 to -06):
 * items grouped by aisle, check-off and edits through the outbox (offline), manual items, share
 * as text, actual prices (reported as `price_observations`), substitutions for premium and a calm
 * upsell for free. Finishing a trip records the spend in the budget.
 */
export function GroceryListDetailScreen({ route }: PlanScreenProps<'GroceryListDetail'>) {
  const { t, i18n } = useTranslation(['grocery', 'errors']);
  const listId = route.params.groceryListId;
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const canEdit = useActiveHouseholdStore(selectCanEdit);
  const { data, isLoading, isError, pending } = useGroceryList(householdId, listId);
  const premium = useHouseholdPremium(householdId).data === true;
  const clock = useHouseholdClock(householdId);
  const budget = useBudgetProfile(householdId);
  const categories = useBudgetCategories();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [typedTotal, setTypedTotal] = useState('');
  const [showSubs, setShowSubs] = useState(false);

  if (!data) {
    return (
      <Screen testID="grocery-detail.screen">
        {isError ? (
          <InlineMessage tone="danger" message={t('errors:codes.UNKNOWN')} />
        ) : isLoading ? (
          <Text tone="muted">{t('grocery:loading')}</Text>
        ) : (
          <Text tone="muted" testID="grocery-detail.missing">
            {t('grocery:detail.missing')}
          </Text>
        )}
      </Screen>
    );
  }

  const { list, items } = data;
  const shopping = list.status === 'shopping';
  const done = list.status === 'done';
  const editable = canEdit && !done;
  const totals = listTotals(items);
  const sections = groupByAisle(items, { excludeChecked: shopping });
  const basket = shopping ? listItems(items).filter((i) => i.isChecked) : [];
  const subs = substitutions(items);
  const fmt = (minor: number) => money(minor, list.currency, i18n.language);
  const aisleLabel = (a: string) => t(`grocery:aisle.${a}`, { defaultValue: a });
  const unitLabel = (u: string) => t(`grocery:unit.${u}`, { defaultValue: u });
  const ref = { id: '', listId, householdId: list.householdId };

  const toggle = (item: ShoppingItemView, checked: boolean) => {
    changeItem({ ...ref, id: item.id }, { checked });
    track('grocery_item_checked', { source: shopping ? 'shopping' : 'detail' });
  };

  const share = async () => {
    const text = shareText(
      t('grocery:share.title', { from: list.startsOn, to: list.endsOn }),
      groupByAisle(items),
      aisleLabel,
      unitLabel,
    );
    try {
      await Share.share({ message: text });
      track('grocery_list_shared', { items: totals.total });
    } catch {
      // The share sheet was dismissed or is unavailable; nothing to do.
    }
  };

  const finish = () => {
    const proper = listItems(items);
    // Actual prices become user price reports for the household's price book (FR-GRO-06).
    let reports = 0;
    for (const item of proper) {
      if (item.actualMinor === null) continue;
      const report = priceReportFor(item, item.actualMinor, list, {
        id: Crypto.randomUUID(),
        today: clock.today,
      });
      if (report) {
        reportPrice(report);
        reports += 1;
      }
    }
    if (reports > 0) track('price_reported', { count: reports });
    // The trip's spend goes to the budget, by category (FR-GRO-08).
    const profile = budget.data;
    if (profile && profile.currency === list.currency) {
      const spend = spendByCategory(proper, parseMajorToMinor(typedTotal));
      for (const [code, amountMinor] of Object.entries(spend)) {
        const category = (categories.data ?? []).find((c) => c.code === code);
        if (!category || amountMinor <= 0) continue;
        addBudgetEntry(
          {
            householdId: list.householdId,
            budgetProfileId: profile.id,
            amountMinor,
            currency: profile.currency,
            categoryId: category.id,
            spentOn: clock.today,
            groceryListId: list.id,
            note: null,
          },
          'grocery',
          code,
        );
      }
    }
    changeListStatus({ listId, householdId: list.householdId, status: 'done' });
    track('shopping_finished', {
      items: totals.total,
      checked: totals.checked,
      has_actuals: totals.hasActuals,
    });
    setFinishing(false);
  };

  const renderItem = (item: ShoppingItemView, i: string) => (
    <View key={item.id} className="gap-1" testID={`grocery-detail.item.${i}`}>
      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          <Checkbox
            label={item.label}
            description={`${formatQuantity(item.quantity)} ${unitLabel(item.unit)}`}
            checked={item.isChecked}
            onChange={(c) => toggle(item, c)}
            disabled={!editable}
            testID={`grocery-detail.item.${i}.check`}
          />
        </View>
        {item.queued ? <QueuedBadge testID={`grocery-detail.item.${i}.queued`} /> : null}
        {item.actualMinor !== null ? (
          <Text variant="bodyStrong">{fmt(item.actualMinor)}</Text>
        ) : list.priceProfileId && item.estimatedMinor !== null ? (
          <Text tone="muted">≈ {fmt(item.estimatedMinor)}</Text>
        ) : null}
        {editable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('grocery:item.editA11y', { label: item.label })}
            hitSlop={8}
            onPress={() => setEditing(editing === item.id ? null : item.id)}
            testID={`grocery-detail.item.${i}.edit`}
          >
            <Text tone="primary">{t('grocery:item.edit')}</Text>
          </Pressable>
        ) : null}
      </View>
      {editing === item.id ? (
        <ItemEditor
          item={item}
          currency={list.currency}
          onSave={(change) => {
            if (Object.keys(change).length > 0) changeItem({ ...ref, id: item.id }, change);
            setEditing(null);
          }}
          onDelete={() => {
            removeItem({ ...ref, id: item.id });
            setEditing(null);
          }}
          testID={`grocery-detail.item.${i}.editor`}
        />
      ) : null}
    </View>
  );

  return (
    <Screen testID="grocery-detail.screen">
      <Card testID="grocery-detail.summary">
        <Text variant="heading">
          {t('grocery:lists.dates', { from: list.startsOn, to: list.endsOn })}
        </Text>
        <Text tone="muted" testID={`grocery-detail.status.${list.status}`}>
          {t(`grocery:status.${list.status}`)} ·{' '}
          {t('grocery:detail.progress', { checked: totals.checked, total: totals.total })}
        </Text>
        {list.priceProfileId ? (
          <Text testID="grocery-detail.estimate">
            {t('grocery:detail.estimate', { amount: fmt(totals.estimatedMinor) })}
          </Text>
        ) : (
          <Text variant="caption" tone="muted" testID="grocery-detail.no-prices">
            {t('grocery:detail.noPrices')}
          </Text>
        )}
        {totals.hasActuals ? (
          <Text testID="grocery-detail.actual">
            {t('grocery:detail.actual', { amount: fmt(totals.actualMinor) })}
          </Text>
        ) : null}
        {pending ? (
          <Text variant="caption" tone="muted" testID="grocery-detail.pending">
            {t('grocery:detail.pending')}
          </Text>
        ) : null}
        <View className="flex-row flex-wrap gap-2">
          <Button
            label={t('grocery:detail.share')}
            variant="secondary"
            size="sm"
            onPress={() => void share()}
            testID="grocery-detail.share"
          />
          {editable && !shopping ? (
            <Button
              label={t('grocery:detail.startShopping')}
              size="sm"
              onPress={() =>
                changeListStatus({ listId, householdId: list.householdId, status: 'shopping' })
              }
              testID="grocery-detail.start-shopping"
            />
          ) : null}
          {editable && shopping ? (
            <Button
              label={t('grocery:detail.finish')}
              size="sm"
              onPress={() => setFinishing(true)}
              testID="grocery-detail.finish"
            />
          ) : null}
        </View>
      </Card>

      {finishing ? (
        <Card variant="outlined" testID="grocery-detail.finish-card">
          <Text variant="bodyStrong">{t('grocery:finish.title')}</Text>
          {totals.hasActuals ? (
            <Text tone="muted">
              {t('grocery:finish.fromActuals', { amount: fmt(totals.actualMinor) })}
            </Text>
          ) : (
            <Input
              label={t('grocery:finish.total')}
              helperText={t('grocery:finish.totalHint')}
              value={typedTotal}
              onChangeText={setTypedTotal}
              variant="numeric"
              unit={list.currency}
              testID="grocery-detail.finish.total"
            />
          )}
          {!budget.data ? (
            <Text variant="caption" tone="muted">
              {t('grocery:finish.noBudget')}
            </Text>
          ) : null}
          <View className="flex-row gap-2">
            <Button
              label={t('grocery:finish.confirm')}
              size="sm"
              onPress={finish}
              testID="grocery-detail.finish.confirm"
            />
            <Button
              label={t('grocery:finish.cancel')}
              size="sm"
              variant="ghost"
              onPress={() => setFinishing(false)}
            />
          </View>
        </Card>
      ) : null}

      {sections.map((s) => (
        <Card key={s.aisle} testID={`grocery-detail.aisle.${s.aisle}`}>
          <Text variant="overline" tone="muted" accessibilityRole="header">
            {aisleLabel(s.aisle)}
          </Text>
          {s.items.map((item, i) => renderItem(item, `${s.aisle}-${i}`))}
        </Card>
      ))}

      {basket.length > 0 ? (
        <Card variant="filled" testID="grocery-detail.basket">
          <Text variant="overline" tone="muted" accessibilityRole="header">
            {t('grocery:detail.basket', { count: basket.length })}
          </Text>
          {basket.map((item, i) => renderItem(item, `basket-${i}`))}
        </Card>
      ) : null}

      {editable ? (
        adding ? (
          <ManualItemForm
            onCancel={() => setAdding(false)}
            onAdd={(v) => {
              addManualItem({ ...v, householdId: list.householdId, listId });
              setAdding(false);
            }}
          />
        ) : (
          <Button
            label={t('grocery:manual.open')}
            variant="secondary"
            onPress={() => setAdding(true)}
            testID="grocery-detail.add"
          />
        )
      ) : null}

      {premium ? (
        subs.length > 0 ? (
          <Card testID="grocery-detail.substitutions">
            <Text variant="heading">{t('grocery:subs.title')}</Text>
            {showSubs ? (
              subs.map((s, i) => (
                <View key={s.substitute.id} testID={`grocery-detail.sub-${i}`}>
                  <Text>
                    {t('grocery:subs.row', {
                      from: s.original.label,
                      to: s.substitute.label,
                    })}
                  </Text>
                  {s.savesMinor !== null && s.savesMinor > 0 ? (
                    <Text variant="caption" tone="success">
                      {t('grocery:subs.saves', { amount: fmt(s.savesMinor) })}
                    </Text>
                  ) : null}
                </View>
              ))
            ) : (
              <Button
                label={t('grocery:subs.show', { count: subs.length })}
                variant="secondary"
                size="sm"
                onPress={() => {
                  setShowSubs(true);
                  track('grocery_substitution_viewed', { premium: true });
                }}
                testID="grocery-detail.substitutions.show"
              />
            )}
          </Card>
        ) : null
      ) : (
        <Card variant="filled" testID="grocery-detail.upsell">
          <Text variant="bodyStrong">{t('grocery:subs.upsellTitle')}</Text>
          <Text tone="muted">{t('grocery:subs.upsellBody')}</Text>
        </Card>
      )}
    </Screen>
  );
}

function ItemEditor({
  item,
  currency,
  onSave,
  onDelete,
  testID,
}: {
  item: ShoppingItemView;
  currency: string;
  onSave: (change: { quantity?: number; actualMinor?: number | null }) => void;
  onDelete: () => void;
  testID: string;
}) {
  const { t } = useTranslation('grocery');
  const [quantity, setQuantity] = useState(formatQuantity(item.quantity));
  const [actual, setActual] = useState(
    item.actualMinor === null ? '' : String(item.actualMinor / 100),
  );
  const q = Number(quantity.replace(',', '.'));
  const qValid = Number.isFinite(q) && q > 0 && q < 100_000;
  const actualMinor = actual.trim() === '' ? null : parseMajorToMinor(actual);
  const aValid = actual.trim() === '' || (actualMinor !== null && actualMinor > 0);
  return (
    <View className="gap-2 rounded-md bg-surface-sunken p-3" testID={testID}>
      <Input
        label={t('item.quantity')}
        value={quantity}
        onChangeText={setQuantity}
        variant="numeric"
        unit={t(`unit.${item.unit}`, { defaultValue: item.unit })}
        testID={`${testID}.quantity`}
      />
      <Input
        label={t('item.actual')}
        helperText={t('item.actualHint')}
        value={actual}
        onChangeText={setActual}
        variant="numeric"
        unit={currency}
        testID={`${testID}.actual`}
      />
      <View className="flex-row gap-2">
        <Button
          label={t('item.save')}
          size="sm"
          disabled={!qValid || !aValid}
          onPress={() =>
            onSave({
              ...(q !== item.quantity ? { quantity: q } : {}),
              ...(actualMinor !== item.actualMinor ? { actualMinor } : {}),
            })
          }
          testID={`${testID}.save`}
        />
        <Button
          label={t('item.delete')}
          size="sm"
          variant="ghost"
          onPress={onDelete}
          testID={`${testID}.delete`}
        />
      </View>
    </View>
  );
}

function ManualItemForm({
  onAdd,
  onCancel,
}: {
  onAdd: (v: {
    label: string;
    quantity: number;
    unit: string;
    aisle: string;
    isFresh: boolean;
  }) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation('grocery');
  const [label, setLabel] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState<string>('piece');
  const [aisle, setAisle] = useState<string>('other');
  const q = Number(quantity.replace(',', '.'));
  const valid = label.trim().length > 0 && label.trim().length <= 80 && Number.isFinite(q) && q > 0;
  return (
    <Card testID="grocery-detail.manual">
      <Input
        label={t('manual.label')}
        value={label}
        onChangeText={setLabel}
        maxLength={80}
        testID="grocery-detail.manual.label"
      />
      <Input
        label={t('manual.quantity')}
        value={quantity}
        onChangeText={setQuantity}
        variant="numeric"
        testID="grocery-detail.manual.quantity"
      />
      <ChipGroup
        label={t('manual.unit')}
        single
        options={MANUAL_UNITS.map((u) => ({ value: u, label: t(`unit.${u}`) }))}
        selected={[unit]}
        onToggle={setUnit}
        testID="grocery-detail.manual.unit"
      />
      <ChipGroup
        label={t('manual.aisle')}
        single
        options={AISLE_ORDER.map((a) => ({ value: a, label: t(`aisle.${a}`) }))}
        selected={[aisle]}
        onToggle={setAisle}
        testID="grocery-detail.manual.aisle"
      />
      <View className="flex-row gap-2">
        <Button
          label={t('manual.add')}
          size="sm"
          disabled={!valid}
          onPress={() =>
            onAdd({
              label: label.trim(),
              quantity: q,
              unit,
              aisle,
              isFresh: aisle === 'sabzi' || aisle === 'fruit' || aisle === 'meat',
            })
          }
          testID="grocery-detail.manual.add"
        />
        <Button label={t('manual.cancel')} size="sm" variant="ghost" onPress={onCancel} />
      </View>
    </Card>
  );
}
