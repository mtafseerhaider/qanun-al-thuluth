import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
  BATCH_COOKING,
  CUISINES,
  HALAL_STRICTNESS,
  HouseholdPreferences,
  KITCHEN_EQUIPMENT,
  SHARED_MEALS,
  SHOPPING_CADENCES,
} from '@shared/domain/intake';

import { ChipGroup } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { RadioCardGroup } from '@/components/ui/radio-card-group';
import { track } from '@/lib/analytics/track';
import type { IntakeStackParamList } from '@/navigation/types';

import { saveHouseholdPreferences } from '../api/intake-api';
import { IntakeStepScaffold } from '../components/intake-step-scaffold';
import { useIntakeFlow } from '../hooks/intake-flow-context';
import { useIntakeHouseholdId } from '../hooks/use-intake-member';
import { useIntakeDraftStore, type PreferencesDraft } from '../store/use-intake-draft-store';
import { numberText, parseInteger, toggle } from '../utils/form-helpers';

type Props = NativeStackScreenProps<IntakeStackParamList, 'IntakeHousehold'>;

export const DEFAULT_PREFERENCES: PreferencesDraft = HouseholdPreferences.parse({});

/**
 * Household preferences (01 §7.1 Additions in `households.preferences`, 24 S2-07): cuisines,
 * cooking time, equipment, batch cooking, shopping cadence, shared meals and halal strictness. The
 * household's name, place and budget were set in onboarding step 3.
 */
export function IntakeHouseholdScreen({ navigation }: Props) {
  const { t } = useTranslation('intake');
  const flow = useIntakeFlow();
  const householdId = useIntakeHouseholdId();
  const stored = useIntakeDraftStore((s) => s.preferences);
  const p: PreferencesDraft = stored ?? DEFAULT_PREFERENCES;
  const set = (patch: Partial<PreferencesDraft>) =>
    useIntakeDraftStore.getState().setPreferences({ ...p, ...patch });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const minutes = p.cooking_minutes;

  const setMinutes = (key: 'weekday' | 'weekend', text: string) => {
    const n = parseInteger(text);
    const max = key === 'weekday' ? 300 : 480;
    const next = {
      weekday: minutes?.weekday ?? 0,
      weekend: minutes?.weekend ?? 0,
      [key]: n === undefined ? 0 : Math.max(0, Math.min(max, n)),
    };
    set({ cooking_minutes: next });
  };

  const onNext = async () => {
    if (!householdId) return;
    setSaving(true);
    setError(null);
    try {
      await saveHouseholdPreferences(householdId, p);
      useIntakeDraftStore.getState().markPreferencesSaved();
      useIntakeDraftStore.getState().setView('members', null);
      track('intake_step_completed', { step: 'household' });
      navigation.push('IntakeMembers');
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <IntakeStepScaffold
      index={1}
      total={3}
      title={t('household.title')}
      subtitle={t('household.helper')}
      onNext={() => void onNext()}
      onBack={flow.onExit}
      saving={saving}
      error={error}
      testID="intake-household.screen"
    >
      <ChipGroup
        label={t('household.cuisines')}
        options={CUISINES.map((c) => ({ value: c, label: t(`household.cuisineNames.${c}`) }))}
        selected={p.cuisines ?? []}
        onToggle={(c) => set({ cuisines: toggle(p.cuisines ?? [], c) })}
        testID="intake-household.cuisines"
      />
      <View className="gap-3">
        <Input
          label={t('household.weekdayMinutes')}
          value={numberText(minutes?.weekday)}
          onChangeText={(x) => setMinutes('weekday', x)}
          variant="numeric"
          unit={t('common.minutes')}
          testID="intake-household.weekday-minutes"
        />
        <Input
          label={t('household.weekendMinutes')}
          value={numberText(minutes?.weekend)}
          onChangeText={(x) => setMinutes('weekend', x)}
          variant="numeric"
          unit={t('common.minutes')}
          testID="intake-household.weekend-minutes"
        />
      </View>
      <ChipGroup
        label={t('household.equipment')}
        options={KITCHEN_EQUIPMENT.map((e) => ({
          value: e,
          label: t(`household.equipmentNames.${e}`),
        }))}
        selected={p.equipment ?? []}
        onToggle={(e) => set({ equipment: toggle(p.equipment ?? [], e) })}
        testID="intake-household.equipment"
      />
      <RadioCardGroup
        label={t('household.batchCooking')}
        options={BATCH_COOKING.map((b) => ({ value: b, title: t(`household.batch.${b}`) }))}
        value={p.batch_cooking ?? 'none'}
        onChange={(batch_cooking) => set({ batch_cooking })}
        testID="intake-household.batch"
      />
      <RadioCardGroup
        label={t('household.shopping')}
        options={SHOPPING_CADENCES.map((c) => ({ value: c, title: t(`household.cadence.${c}`) }))}
        value={p.shopping_cadence ?? null}
        onChange={(shopping_cadence) => set({ shopping_cadence })}
        testID="intake-household.shopping"
      />
      <ChipGroup
        label={t('household.sharedMeals')}
        options={SHARED_MEALS.map((m) => ({ value: m, label: t(`meals.${m}`) }))}
        selected={p.shared_meals ?? []}
        onToggle={(m) => set({ shared_meals: toggle(p.shared_meals ?? [], m) })}
        testID="intake-household.shared-meals"
      />
      <RadioCardGroup
        label={t('household.halal')}
        hint={t('household.halalHint')}
        options={HALAL_STRICTNESS.map((h) => ({
          value: h,
          title: t(`household.halalLevels.${h}.title`),
          description: t(`household.halalLevels.${h}.description`),
        }))}
        value={p.halal_strictness ?? 'ingredient_checked'}
        onChange={(halal_strictness) => set({ halal_strictness })}
        testID="intake-household.halal"
      />
    </IntakeStepScaffold>
  );
}
