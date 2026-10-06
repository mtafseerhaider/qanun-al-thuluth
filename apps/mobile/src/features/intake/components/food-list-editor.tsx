import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { DISLIKE_REASONS } from '@shared/domain/intake';
import { FOOD_SUGGESTIONS } from '@shared/intake/catalog';
import type { FoodDislikeDraft, FoodPreferenceDraft } from '@shared/intake/questions';

import { Card } from '@/components/ui/card';
import { Chip, ChipGroup } from '@/components/ui/chip';
import { Text } from '@/components/ui/text';

import { newRowId } from '../utils/form-helpers';
import { AddTextRow } from './text-list-editor';

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Labels are stored in English for suggestions so the same food matches across locales. */
function suggestionOptions(t: (k: string) => string) {
  return FOOD_SUGGESTIONS.map((f) => ({ value: f.label, label: t(`foods.${f.key}`) }));
}

/**
 * Likes or safe foods (`food_preferences`, 02 §7.3.7 and §7.3.12). Tapping a liked chip cycles its
 * strength like → love → favourite → removed. Anything added here is removed from `exclude`
 * (an item cannot be both liked and disliked).
 */
export function PreferenceListEditor({
  label,
  items,
  onChange,
  isSafeFood = false,
  testID,
}: {
  label: string;
  items: FoodPreferenceDraft[];
  onChange: (items: FoodPreferenceDraft[]) => void;
  isSafeFood?: boolean;
  testID: string;
}) {
  const { t } = useTranslation('intake');
  const strengthLabel = (n: number | undefined) => t(`food.strength.${n ?? 2}`);
  const toggle = (foodLabel: string) => {
    const found = items.find((x) => same(x.label, foodLabel));
    if (!found)
      return onChange([
        ...items,
        {
          id: newRowId(),
          label: foodLabel,
          strength: isSafeFood ? 3 : 1,
          is_safe_food: isSafeFood,
        },
      ]);
    if (isSafeFood || (found.strength ?? 1) >= 3) return onChange(items.filter((x) => x !== found));
    return onChange(
      items.map((x) => (x === found ? { ...x, strength: (x.strength ?? 1) + 1 } : x)),
    );
  };
  const custom = items.filter((x) => !FOOD_SUGGESTIONS.some((f) => same(f.label, x.label)));
  return (
    <View className="gap-3" testID={testID}>
      <ChipGroup
        label={label}
        {...(!isSafeFood ? { hint: t('food.strengthHint') } : {})}
        options={suggestionOptions(t).map((o) => {
          const it = items.find((x) => same(x.label, o.value));
          return {
            ...o,
            label: it && !isSafeFood ? `${o.label} · ${strengthLabel(it.strength)}` : o.label,
          };
        })}
        selected={items.map((x) => x.label)}
        onToggle={toggle}
        testID={`${testID}.suggestions`}
      />
      {custom.length > 0 ? (
        <View className="flex-row flex-wrap gap-2">
          {custom.map((x) => (
            <Chip
              key={x.id}
              label={isSafeFood ? x.label : `${x.label} · ${strengthLabel(x.strength)}`}
              selected
              onPress={() => toggle(x.label)}
              accessibilityHint={t('common.tapToChange')}
              testID={`${testID}.custom.${x.label}`}
            />
          ))}
        </View>
      ) : null}
      <AddTextRow
        label={t('food.addOther')}
        onAdd={(text) => {
          if (items.some((x) => same(x.label, text))) return;
          onChange([
            ...items,
            { id: newRowId(), label: text, strength: isSafeFood ? 3 : 2, is_safe_food: isSafeFood },
          ]);
        }}
        testID={`${testID}.other`}
      />
    </View>
  );
}

/** Dislikes (`food_dislikes`) with a reason per item (02 §7.3.7). */
export function DislikeListEditor({
  label,
  hint,
  items,
  onChange,
  testID,
}: {
  label: string;
  hint?: string;
  items: FoodDislikeDraft[];
  onChange: (items: FoodDislikeDraft[]) => void;
  testID: string;
}) {
  const { t } = useTranslation('intake');
  const toggle = (foodLabel: string) => {
    const found = items.find((x) => same(x.label, foodLabel));
    onChange(
      found
        ? items.filter((x) => x !== found)
        : [...items, { id: newRowId(), label: foodLabel, reason: 'taste' }],
    );
  };
  return (
    <View className="gap-3" testID={testID}>
      <ChipGroup
        label={label}
        {...(hint ? { hint } : {})}
        options={suggestionOptions(t)}
        selected={items.map((x) => x.label)}
        onToggle={toggle}
        tone="avoid"
        testID={`${testID}.suggestions`}
      />
      {items.map((x, i) => (
        <Card key={x.id} variant="filled" padding="sm" testID={`${testID}.item-${i}`}>
          <Text variant="bodyStrong">
            {FOOD_SUGGESTIONS.find((f) => same(f.label, x.label))
              ? t(`foods.${FOOD_SUGGESTIONS.find((f) => same(f.label, x.label))?.key}`)
              : x.label}
          </Text>
          <ChipGroup
            label={t('food.reason')}
            single
            options={DISLIKE_REASONS.map((r) => ({ value: r, label: t(`food.reasons.${r}`) }))}
            selected={[x.reason ?? 'taste']}
            onToggle={(reason) =>
              onChange(items.map((y) => (y.id === x.id ? { ...y, reason } : y)))
            }
            testID={`${testID}.item-${i}.reason`}
          />
        </Card>
      ))}
      <AddTextRow
        label={t('food.addOther')}
        onAdd={(text) => {
          if (items.some((x) => same(x.label, text))) return;
          onChange([...items, { id: newRowId(), label: text, reason: 'taste' }]);
        }}
        testID={`${testID}.other`}
      />
    </View>
  );
}

/** Removes from `list` anything whose label appears in `other` (liked vs disliked are exclusive). */
export function withoutLabels<T extends { label: string }>(
  list: readonly T[],
  other: readonly { label: string }[],
): T[] {
  return list.filter((x) => !other.some((o) => same(o.label, x.label)));
}
