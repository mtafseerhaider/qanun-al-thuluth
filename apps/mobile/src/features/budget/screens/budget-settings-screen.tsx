import { minorDigits, toMinor } from '@shared';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { InlineMessage } from '@/components/ui/inline-message';
import { Input } from '@/components/ui/input';
import { RadioCardGroup } from '@/components/ui/radio-card-group';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useHousehold } from '@/features/household';
import { localized } from '@/features/meals';
import { useIsOnline } from '@/hooks/use-is-online';
import type { MoreScreenProps } from '@/navigation/types';
import { selectCanEdit, useActiveHouseholdStore } from '@/stores/use-active-household-store';

import { useBudgetCategories, useBudgetProfile, useSaveBudgetSettings } from '../hooks/use-budget';
import { splitIsValid, type Strictness } from '../utils/budget-rules';

const STRICTNESS: readonly Strictness[] = ['flexible', 'target', 'hard_cap'];

/**
 * Budget settings (02 §7.12.9, 24 S4-07): monthly amount, strictness and an optional split by
 * category in percent. Saved online; the split must add up to 100.
 */
export function BudgetSettingsScreen({ navigation }: MoreScreenProps<'BudgetSettings'>) {
  const { t, i18n } = useTranslation('budget');
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const canEdit = useActiveHouseholdStore(selectCanEdit);
  const online = useIsOnline();
  const household = useHousehold(householdId);
  const profile = useBudgetProfile(householdId);
  const categories = useBudgetCategories();
  const save = useSaveBudgetSettings(householdId);
  const currency = profile.data?.currency ?? household.data?.currency ?? 'PKR';

  const [amount, setAmount] = useState('');
  const [strictness, setStrictness] = useState<Strictness>('target');
  const [split, setSplit] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded || profile.isLoading) return;
    const p = profile.data;
    if (p) {
      setAmount(String(p.monthlyAmountMinor / 10 ** minorDigits(p.currency)));
      setStrictness(p.strictness);
      setSplit(
        Object.fromEntries(
          Object.entries(p.categorySplit).map(([k, v]) => [k, String(Math.round(v * 100))]),
        ),
      );
    }
    setLoaded(true);
  }, [loaded, profile.isLoading, profile.data]);

  const major = Number(amount.replace(/[,\s]/g, ''));
  const amountValid = Number.isFinite(major) && major > 0;
  const shares = Object.fromEntries(
    Object.entries(split)
      .filter(([, v]) => v.trim() !== '')
      .map(([k, v]) => [k, Number(v) / 100]),
  );
  const splitTotal = Math.round(Object.values(shares).reduce((n, v) => n + v, 0) * 100);
  const splitValid = splitIsValid(shares);

  const submit = () => {
    if (!amountValid || !splitValid) return;
    save.mutate(
      {
        monthly_amount_minor: toMinor(major, currency),
        currency,
        strictness,
        categorySplit: shares,
      },
      { onSuccess: () => navigation.goBack() },
    );
  };

  return (
    <Screen testID="budget-settings.screen">
      {!canEdit ? <InlineMessage tone="info" message={t('settings.readOnly')} /> : null}
      <Card>
        <Input
          label={t('settings.amount')}
          value={amount}
          onChangeText={setAmount}
          variant="numeric"
          unit={currency}
          editable={canEdit}
          {...(amount && !amountValid ? { errorText: t('settings.amountError') } : {})}
          testID="budget-settings.amount"
        />
        <RadioCardGroup
          label={t('settings.strictness')}
          options={STRICTNESS.map((s) => ({
            value: s,
            title: t(`strictness.${s}.title`),
            description: t(`strictness.${s}.body`),
          }))}
          value={strictness}
          onChange={setStrictness}
          testID="budget-settings.strictness"
        />
      </Card>
      <Card testID="budget-settings.split">
        <Text variant="heading">{t('settings.split')}</Text>
        <Text tone="muted">{t('settings.splitHint')}</Text>
        {(categories.data ?? []).map((c) => (
          <View key={c.id}>
            <Input
              label={localized(c.nameI18n, i18n.language, c.code)}
              value={split[c.code] ?? ''}
              onChangeText={(v) => setSplit((s) => ({ ...s, [c.code]: v }))}
              variant="numeric"
              unit="%"
              editable={canEdit}
              testID={`budget-settings.split.${c.code}`}
            />
          </View>
        ))}
        <Text tone={splitValid ? 'muted' : 'danger'} testID="budget-settings.split-total">
          {t('settings.splitTotal', { total: splitTotal })}
        </Text>
      </Card>
      {save.isError ? <InlineMessage tone="danger" message={t('settings.saveError')} /> : null}
      {!online ? <InlineMessage tone="info" message={t('settings.offline')} /> : null}
      {canEdit ? (
        <Button
          label={t('settings.save')}
          onPress={submit}
          loading={save.isPending}
          disabled={!amountValid || !splitValid || !online}
          fullWidth
          testID="budget-settings.save"
        />
      ) : null}
    </Screen>
  );
}
