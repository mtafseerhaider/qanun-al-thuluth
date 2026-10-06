import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipGroup } from '@/components/ui/chip';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import {
  IngredientPicker,
  useLoseSafeFood,
  useModuleMember,
  useSafeFoods,
  useSaveSafeFood,
  type IngredientLite,
  type SafeFoodView,
} from '@/features/exposures';
import type { FamilyScreenProps } from '@/navigation/types';
import { errorKeyFor } from '@/lib/supabase/error-mapping';

const STRENGTHS = ['1', '2', '3'] as const;

/**
 * Safe foods (02 §7.10.3, FR-AUT-01; free). Foods the child reliably eats, with how sure the parent
 * is. "No longer safe" never deletes silently: it asks first and keeps the food as a dislike, because
 * losing a safe food is worth noticing.
 */
export function SafeFoodsScreen({ route }: FamilyScreenProps<'SafeFoods'>) {
  const { familyMemberId } = route.params;
  const { t } = useTranslation('autism');
  const m = useModuleMember(familyMemberId);
  const safe = useSafeFoods(m.householdId, familyMemberId);
  const save = useSaveSafeFood(m.householdId, familyMemberId);
  const lose = useLoseSafeFood(m.householdId, familyMemberId);
  const [food, setFood] = useState<IngredientLite | null>(null);
  const [strength, setStrength] = useState<(typeof STRENGTHS)[number]>('2');

  const add = () => {
    if (!food) return;
    save.mutate(
      { label: food.label, ingredientId: food.id, strength: Number(strength), source: 'manual' },
      { onSuccess: () => setFood(null) },
    );
  };
  const confirmLose = (s: SafeFoodView) =>
    Alert.alert(t('safe.loseTitle', { food: s.label }), t('safe.loseBody', { name: m.name }), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('safe.loseConfirm'), style: 'destructive', onPress: () => lose.mutate(s) },
    ]);

  const error = save.error ?? lose.error ?? safe.error;
  return (
    <Screen testID="safe-foods.screen">
      <Text variant="title" accessibilityRole="header">
        {t('safe.title', { name: m.name })}
      </Text>
      <Text tone="muted">{t('safe.intro')}</Text>
      {error ? <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(error)}`)} /> : null}
      {m.canEdit ? (
        <Card variant="outlined" testID="safe-foods.add">
          <IngredientPicker
            label={t('safe.addLabel')}
            selected={food}
            onSelect={setFood}
            testID="safe-foods.picker"
          />
          <ChipGroup
            label={t('safe.strength')}
            single
            options={STRENGTHS.map((s) => ({ value: s, label: t(`safe.strengths.${s}`) }))}
            selected={[strength]}
            onToggle={setStrength}
            testID="safe-foods.strength"
          />
          <Button
            label={t('safe.add')}
            onPress={add}
            disabled={!food}
            loading={save.isPending}
            testID="safe-foods.save"
          />
        </Card>
      ) : null}
      {(safe.data ?? []).length === 0 && !safe.isLoading ? (
        <Text tone="muted" testID="safe-foods.empty">
          {t('safe.empty', { name: m.name })}
        </Text>
      ) : null}
      {(safe.data ?? []).map((s) => (
        <Card key={s.id} variant="filled" testID="safe-foods.item">
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <View className="flex-1">
              <Text variant="bodyStrong">{s.label}</Text>
              <Text variant="caption" tone="muted">
                {t(`safe.strengths.${String(s.strength)}`, { defaultValue: '' })}
              </Text>
            </View>
            {m.canEdit ? (
              <Button
                label={t('safe.lose')}
                size="sm"
                variant="ghost"
                onPress={() => confirmLose(s)}
                testID="safe-foods.lose"
              />
            ) : null}
          </View>
        </Card>
      ))}
    </Screen>
  );
}
