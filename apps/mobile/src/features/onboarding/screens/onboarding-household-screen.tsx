import { useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { getCalendars, getLocales } from 'expo-localization';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { LimitReachedNotice } from '@/components/layout/limit-reached-notice';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RadioCardGroup } from '@/components/ui/radio-card-group';
import { Text } from '@/components/ui/text';
import { createHousehold, saveBudget, updateHousehold } from '@/features/household';
import { useProfile } from '@/hooks/use-profile';
import { track } from '@/lib/analytics/track';
import { updateProfile } from '@/lib/auth/profile';
import { qk } from '@/lib/query/query-keys';
import { isAppError } from '@/lib/supabase/app-error';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';
import { useSessionStore } from '@/stores/use-session-store';

import { OnboardingScaffold } from '../components/onboarding-scaffold';
import { useOnboardingFlow } from '../hooks/use-onboarding-flow';
import { useOnboardingStore, type HouseholdDraft } from '../store/use-onboarding-store';
import {
  CITY_SUGGESTIONS,
  COUNTRIES,
  CURRENCY_FOR_COUNTRY,
  DEFAULT_TIMEZONE_FOR_COUNTRY,
  householdDefaults,
  isCountryCode,
  parseBudget,
  validateHouseholdDraft,
  type HouseholdErrorKey,
  type HouseholdField,
} from '../utils/household-defaults';

function initialDraft(displayName: string, fallbackName: string): HouseholdDraft {
  const d = householdDefaults({
    regionCode: getLocales()[0]?.regionCode ?? null,
    timeZone: getCalendars()[0]?.timeZone ?? null,
  });
  return {
    id: Crypto.randomUUID(),
    name: displayName ? '' : fallbackName,
    city: '',
    budgetMajor: '',
    ...d,
  };
}

/**
 * Step 3 Create household (02 §7.3.1, 24 S1-10): name, country, city, currency, time zone, and an
 * optional monthly budget written to `budget_profiles` in minor units. The draft is persisted so a
 * killed app resumes with the data intact (FR-ONB-01).
 */
export function OnboardingHouseholdScreen() {
  const { t } = useTranslation(['onboarding', 'errors']);
  const flow = useOnboardingFlow('household');
  const qc = useQueryClient();
  const profile = useProfile();
  const displayName = profile.data?.display_name ?? '';
  const storedDraft = useOnboardingStore((s) => s.householdDraft);
  const setDraft = useOnboardingStore((s) => s.setHouseholdDraft);
  const [draft, setLocal] = useState<HouseholdDraft>(
    () => storedDraft ?? initialDraft(displayName, t('onboarding:household.defaultNameFallback')),
  );
  const [errors, setErrors] = useState<Partial<Record<HouseholdField, HouseholdErrorKey>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);

  const prefilled = useRef(draft.name !== '');
  useEffect(() => {
    if (prefilled.current || !displayName) return;
    prefilled.current = true;
    setLocal((d) => ({ ...d, name: t('onboarding:household.defaultName', { name: displayName }) }));
  }, [displayName, t]);

  const update = (patch: Partial<HouseholdDraft>) => {
    setLocal((d) => {
      const next = { ...d, ...patch };
      setDraft(next);
      return next;
    });
    const touched = new Set(Object.keys(patch).map((k) => (k === 'budgetMajor' ? 'budget' : k)));
    setErrors(
      (e) => Object.fromEntries(Object.entries(e).filter(([k]) => !touched.has(k))) as typeof e,
    );
  };

  const onContinue = async () => {
    const found = validateHouseholdDraft(draft);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    const userId = useSessionStore.getState().userId;
    if (!userId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const input = {
        name: draft.name.trim(),
        country_code: draft.country_code,
        city: draft.city.trim() || null,
        timezone: draft.timezone.trim(),
        currency: draft.currency,
      };
      const store = useOnboardingStore.getState();
      if (store.createdHouseholdId === draft.id) await updateHousehold(draft.id, input);
      else {
        await createHousehold(draft.id, userId, input);
        store.setCreatedHouseholdId(draft.id);
      }
      const budget = parseBudget(draft.budgetMajor, draft.currency);
      if (typeof budget === 'number')
        await saveBudget(draft.id, {
          monthly_amount_minor: budget,
          currency: draft.currency,
          strictness: 'target',
        });
      await updateProfile(userId, {
        country_code: draft.country_code,
        timezone: draft.timezone.trim(),
      }).catch(() => undefined);
      useActiveHouseholdStore.getState().setActiveHousehold(draft.id, 'owner');
      void qc.invalidateQueries({ queryKey: qk.households() });
      track('household_created', { has_budget: typeof budget === 'number' });
      flow.goNext();
    } catch (e) {
      setSaveError(e);
    } finally {
      setSaving(false);
    }
  };

  const err = (f: HouseholdField) =>
    errors[f] ? { errorText: t(`onboarding:household.errors.${errors[f]}`) } : {};
  const limit =
    isAppError(saveError) && saveError.code === 'LIMIT_REACHED'
      ? String(saveError.details.resource ?? 'households')
      : null;
  const cities = isCountryCode(draft.country_code)
    ? (CITY_SUGGESTIONS[draft.country_code] ?? [])
    : [];
  const currencies = Array.from(new Set(Object.values(CURRENCY_FOR_COUNTRY)));

  return (
    <OnboardingScaffold
      step={flow.stepNumber}
      total={flow.totalSteps}
      title={t('onboarding:household.title')}
      subtitle={t('onboarding:household.body')}
      primaryLabel={t('onboarding:common.continue')}
      onPrimary={() => void onContinue()}
      primaryLoading={saving}
      onBack={flow.goBack}
      error={saveError && !limit ? t(`errors:${errorKeyFor(saveError)}`) : null}
      testID="onboarding-household.screen"
    >
      {limit ? <LimitReachedNotice resource={limit} /> : null}
      <Input
        label={t('onboarding:household.name')}
        helperText={t('onboarding:household.nameHelper')}
        {...err('name')}
        value={draft.name}
        onChangeText={(name) => update({ name })}
        maxLength={40}
        required
        testID="onboarding-household.name"
      />
      <RadioCardGroup
        label={t('onboarding:household.country')}
        options={COUNTRIES.map((c) => ({ value: c, title: t(`onboarding:countries.${c}`) }))}
        value={isCountryCode(draft.country_code) ? draft.country_code : null}
        onChange={(c) =>
          update({
            country_code: c,
            currency: CURRENCY_FOR_COUNTRY[c],
            timezone: DEFAULT_TIMEZONE_FOR_COUNTRY[c],
            city: '',
          })
        }
        inline
        testID="onboarding-household.country"
      />
      <View className="gap-2">
        <Input
          label={t('onboarding:household.city')}
          helperText={t('onboarding:household.cityHelper')}
          {...err('city')}
          value={draft.city}
          onChangeText={(city) => update({ city })}
          maxLength={60}
          autoCapitalize="words"
          testID="onboarding-household.city"
        />
        {cities.length > 0 ? (
          <View className="flex-row flex-wrap gap-2">
            {cities.map((c) => (
              <Button
                key={c}
                label={t(`onboarding:cities.${c}`)}
                size="sm"
                variant={draft.city === c ? 'primary' : 'secondary'}
                selected={draft.city === c}
                accessibilityRole="radio"
                onPress={() => update({ city: c })}
                testID={`onboarding-household.city-${c}`}
              />
            ))}
          </View>
        ) : null}
      </View>
      <RadioCardGroup
        label={t('onboarding:household.currency')}
        options={currencies.map((c) => ({ value: c, title: c }))}
        value={draft.currency}
        onChange={(currency) => update({ currency })}
        inline
        testID="onboarding-household.currency"
      />
      <Input
        label={t('onboarding:household.timezone')}
        helperText={t('onboarding:household.timezoneHelper')}
        {...err('timezone')}
        value={draft.timezone}
        onChangeText={(timezone) => update({ timezone })}
        autoCapitalize="none"
        autoCorrect={false}
        testID="onboarding-household.timezone"
      />
      <View className="gap-1">
        <Text variant="heading">{t('onboarding:household.budgetTitle')}</Text>
        <Input
          label={t('onboarding:household.budget')}
          helperText={t('onboarding:household.budgetHelper')}
          {...err('budget')}
          value={draft.budgetMajor}
          onChangeText={(budgetMajor) => update({ budgetMajor })}
          variant="numeric"
          unit={draft.currency}
          testID="onboarding-household.budget"
        />
      </View>
    </OnboardingScaffold>
  );
}
