import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { Button } from '@/components/ui/button';
import { ChipGroup } from '@/components/ui/chip';
import { InlineMessage } from '@/components/ui/inline-message';
import { Input } from '@/components/ui/input';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useFamilyMembers } from '@/features/family';
import { useHouseholdClock } from '@/features/meals';
import type { RootScreenProps } from '@/navigation/types';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';
import { usePreferencesStore } from '@/stores/use-preferences-store';

import { logMeasurement, useGrowthDashboard } from '../hooks/use-growth';
import {
  ageMonthsBetween,
  defaultPosition,
  headCircumferenceAsked,
  plausibilityWarning,
  validateMeasurement,
  type MeasurementForm,
} from '../utils/growth-rules';

/**
 * X9 Add Measurement (02 §5.9, §7.9; FR-GRW-01). Date (today by default, not in the future or
 * before birth), height or length, weight, and head circumference under 2 years. A big change from
 * the last measurement asks "Double-check?" but never blocks. The row is queued in the outbox, so
 * it saves offline; `growth-compute` runs when the device is back online.
 */
export function AddGrowthMeasurementScreen({
  route,
  navigation,
}: RootScreenProps<'AddGrowthMeasurementModal'>) {
  const { familyMemberId } = route.params;
  const { t } = useTranslation('growth');
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const units = usePreferencesStore((s) => s.units);
  const clock = useHouseholdClock(householdId);
  const members = useFamilyMembers(householdId);
  const member = (members.data ?? []).find((m) => m.id === familyMemberId) ?? null;
  const dashboard = useGrowthDashboard(householdId, familyMemberId);
  const dob = member?.date_of_birth ?? null;
  const ageMonths = dob ? ageMonthsBetween(dob, clock.today) : 0;
  const [form, setForm] = useState<MeasurementForm>({
    measuredOn: clock.today,
    height: '',
    weight: '',
    head: '',
  });
  const [position, setPosition] = useState<'recumbent' | 'standing'>(defaultPosition(ageMonths));
  const [touched, setTouched] = useState(false);
  const result = validateMeasurement(form, { today: clock.today, dateOfBirth: dob, units });
  const errorFor = (k: keyof MeasurementForm) =>
    touched && result.errors[k] ? t(`add.errors.${result.errors[k]}`) : undefined;
  const errorProps = (k: keyof MeasurementForm): { errorText?: string } => {
    const text = errorFor(k);
    return text ? { errorText: text } : {};
  };
  const set = (patch: Partial<MeasurementForm>) => setForm((f) => ({ ...f, ...patch }));
  const lengthUnit = units === 'imperial' ? t('units.in') : t('units.cm');
  const weightUnit = units === 'imperial' ? t('units.lb') : t('units.kg');

  const doSave = () => {
    if (!householdId || !member || !result.values) return;
    const v = result.values;
    const sameDay = dashboard.rows.find((r) => r.measuredOn === v.measuredOn);
    logMeasurement(
      {
        householdId,
        familyMemberId,
        measuredOn: v.measuredOn,
        heightCm: v.heightCm,
        weightKg: v.weightKg,
        headCm: headCircumferenceAsked(ageMonths) ? v.headCm : null,
        position: v.heightCm !== null ? position : null,
        ...(sameDay ? { existingId: sameDay.id } : {}),
      },
      member.life_stage,
    );
    navigation.goBack();
  };

  const save = () => {
    setTouched(true);
    if (!result.values) return;
    const previous =
      [...dashboard.rows].reverse().find((r) => r.measuredOn < form.measuredOn) ?? null;
    const warning = plausibilityWarning(previous, result.values);
    if (!warning) return doSave();
    Alert.alert(t('add.checkTitle'), t(`add.check.${warning}`), [
      { text: t('add.checkEdit'), style: 'cancel' },
      { text: t('add.checkSave'), onPress: doSave },
    ]);
  };

  return (
    <Screen testID="growth-add.screen">
      <Text variant="title" accessibilityRole="header">
        {t('add.title', { name: member?.name ?? '' })}
      </Text>
      {!dob && member ? (
        <InlineMessage tone="info" message={t('needDob', { name: member.name })} />
      ) : null}
      <Input
        label={t('add.date')}
        helperText={t('add.dateHint')}
        value={form.measuredOn}
        onChangeText={(measuredOn) => set({ measuredOn })}
        autoCapitalize="none"
        {...errorProps('measuredOn')}
        testID="growth-add.date"
      />
      <Input
        label={ageMonths < 24 ? t('add.length') : t('add.height')}
        {...(ageMonths < 24 ? { helperText: t('add.lengthHint') } : {})}
        value={form.height}
        onChangeText={(height) => set({ height })}
        variant="numeric"
        unit={lengthUnit}
        {...errorProps('height')}
        testID="growth-add.height"
      />
      {form.height.trim() ? (
        <ChipGroup
          label={t('add.position')}
          single
          options={(['recumbent', 'standing'] as const).map((p) => ({
            value: p,
            label: t(`add.positions.${p}`),
          }))}
          selected={[position]}
          onToggle={setPosition}
          testID="growth-add.position"
        />
      ) : null}
      <Input
        label={t('add.weight')}
        value={form.weight}
        onChangeText={(weight) => set({ weight })}
        variant="numeric"
        unit={weightUnit}
        {...errorProps('weight')}
        testID="growth-add.weight"
      />
      {headCircumferenceAsked(ageMonths) ? (
        <Input
          label={t('add.head')}
          helperText={t('add.headHint')}
          value={form.head}
          onChangeText={(head) => set({ head })}
          variant="numeric"
          unit={lengthUnit}
          {...errorProps('head')}
          testID="growth-add.head"
        />
      ) : null}
      <Text variant="caption" tone="muted">
        {t('add.offlineNote')}
      </Text>
      <Button
        label={t('add.save')}
        onPress={save}
        disabled={!member || !dob}
        fullWidth
        testID="growth-add.save"
      />
    </Screen>
  );
}
