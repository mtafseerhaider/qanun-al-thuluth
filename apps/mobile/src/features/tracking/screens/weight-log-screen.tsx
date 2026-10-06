import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipGroup } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useFamilyMembers } from '@/features/family';
import { QueuedBadge, useHouseholdClock } from '@/features/meals';
import type { MoreScreenProps } from '@/navigation/types';
import { selectCanEdit, useActiveHouseholdStore } from '@/stores/use-active-household-store';
import { usePreferencesStore } from '@/stores/use-preferences-store';

import { logWeight, useWeights } from '../hooks/use-tracking';
import {
  canLogWeight,
  parseWaistCm,
  parseWeightKg,
  toDisplayWeight,
  weightChange,
} from '../utils/tracking-rules';

/**
 * M4 Weight log (02 §7.12.4, 24 S4-16, FR-TRK-06): adults only. Members under 18 never get a
 * scale log: the screen explains that children's growth is followed on growth charts instead.
 * Entries are queued through the outbox (one per member and day) and BMI is computed server-side.
 */
export function WeightLogScreen({ route }: MoreScreenProps<'WeightLog'>) {
  const { t } = useTranslation('tracking');
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const canEdit = useActiveHouseholdStore(selectCanEdit);
  const units = usePreferencesStore((s) => s.units);
  const clock = useHouseholdClock(householdId);
  const members = useFamilyMembers(householdId);
  const all = useMemo(
    () =>
      (members.data ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        dateOfBirth: m.date_of_birth,
        lifeStage: m.life_stage,
      })),
    [members.data],
  );
  const adults = all.filter((m) => canLogWeight(m, clock.today));
  const requested = route.params?.familyMemberId
    ? all.find((m) => m.id === route.params?.familyMemberId)
    : undefined;
  const [selected, setSelected] = useState<string | null>(null);
  const memberId = selected ?? requested?.id ?? adults[0]?.id ?? null;
  const member = all.find((m) => m.id === memberId) ?? null;
  const allowed = member ? canLogWeight(member, clock.today) : false;
  const weights = useWeights(householdId, allowed ? memberId : null);
  const [weight, setWeight] = useState('');
  const [waist, setWaist] = useState('');

  const kg = parseWeightKg(weight, units);
  const waistCm = parseWaistCm(waist);
  const valid = kg !== null && waistCm !== 'invalid';
  const todayEntry = weights.data.find((w) => w.measuredOn === clock.today);
  const change = weightChange(weights.data, clock.today);
  const unit = units === 'imperial' ? t('weight.lb') : t('weight.kg');

  const save = () => {
    if (!householdId || !member || kg === null || waistCm === 'invalid') return;
    logWeight({
      householdId,
      familyMemberId: member.id,
      measuredOn: clock.today,
      weightKg: kg,
      waistCm,
      ...(todayEntry ? { existingId: todayEntry.id } : {}),
    });
    setWeight('');
    setWaist('');
  };

  return (
    <Screen testID="weight.screen">
      {adults.length > 0 ? (
        <ChipGroup
          label={t('weight.member')}
          single
          options={adults.map((m) => ({ value: m.id, label: m.name }))}
          selected={memberId && allowed ? [memberId] : []}
          onToggle={setSelected}
          testID="weight.member"
        />
      ) : null}

      {member && !allowed ? (
        <Card variant="filled" testID="weight.minor">
          <Text variant="bodyStrong">{t('weight.minorTitle', { name: member.name })}</Text>
          <Text tone="muted">{t('weight.minorBody')}</Text>
        </Card>
      ) : null}
      {!member && !members.isLoading ? (
        <Card variant="filled" testID="weight.no-adults">
          <Text tone="muted">{t('weight.noAdults')}</Text>
        </Card>
      ) : null}

      {member && allowed ? (
        <>
          {canEdit ? (
            <Card testID="weight.form">
              <Text variant="heading">
                {todayEntry ? t('weight.updateToday') : t('weight.addToday')}
              </Text>
              <Input
                label={t('weight.weight')}
                value={weight}
                onChangeText={setWeight}
                variant="numeric"
                unit={unit}
                {...(weight && kg === null ? { errorText: t('weight.weightError') } : {})}
                testID="weight.input"
              />
              <Input
                label={t('weight.waist')}
                helperText={t('weight.waistHint')}
                value={waist}
                onChangeText={setWaist}
                variant="numeric"
                unit={t('weight.cm')}
                {...(waistCm === 'invalid' ? { errorText: t('weight.waistError') } : {})}
                testID="weight.waist"
              />
              <Button
                label={t('weight.save')}
                onPress={save}
                disabled={!valid}
                testID="weight.save"
              />
            </Card>
          ) : null}
          {change !== null ? (
            <Text tone="muted" testID="weight.change">
              {t('weight.change', {
                value: `${change > 0 ? '+' : ''}${toDisplayWeight(change, units)} ${unit}`,
              })}
            </Text>
          ) : null}
          <Card testID="weight.history">
            <Text variant="heading">{t('weight.history')}</Text>
            {weights.data.length === 0 ? (
              <Text tone="muted" testID="weight.empty">
                {t('weight.empty')}
              </Text>
            ) : (
              weights.data.slice(0, 30).map((w, i) => (
                <View
                  key={w.id}
                  className="flex-row items-center justify-between gap-2"
                  testID={`weight.row-${i}`}
                >
                  <Text>{w.measuredOn}</Text>
                  {w.queued ? <QueuedBadge testID={`weight.row-${i}.queued`} /> : null}
                  <Text variant="bodyStrong">
                    {toDisplayWeight(w.weightKg, units)} {unit}
                    {w.waistCm !== null ? ` · ${w.waistCm} ${t('weight.cm')}` : ''}
                  </Text>
                </View>
              ))
            )}
          </Card>
          <Text variant="caption" tone="muted">
            {t('weight.note')}
          </Text>
        </>
      ) : null}
    </Screen>
  );
}
