import * as Crypto from 'expo-crypto';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { RamadanGenerateAccepted } from '@shared/contracts';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipGroup } from '@/components/ui/chip';
import { InlineMessage } from '@/components/ui/inline-message';
import { RadioCardGroup } from '@/components/ui/radio-card-group';
import { Screen } from '@/components/ui/screen';
import { StepProgress } from '@/components/ui/step-progress';
import { Text } from '@/components/ui/text';
import { useHousehold } from '@/features/household';
import { UpsellCard, usePremium } from '@/features/subscription';
import { useIsOnline } from '@/hooks/use-is-online';
import { track } from '@/lib/analytics/track';
import { addDays } from '@/lib/dates/local-date';
import { isAppError } from '@/lib/supabase/app-error';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { RootScreenProps } from '@/navigation/types';
import { selectCanEdit, useActiveHouseholdStore } from '@/stores/use-active-household-store';
import { usePreferencesStore } from '@/stores/use-preferences-store';

import { ParticipationCard } from '../components/participation-card';
import {
  useGenerateRamadanPlan,
  useParticipationRules,
  useUpcomingRamadan,
} from '../hooks/use-ramadan';
import {
  buildParticipants,
  countFasting,
  formatPlanDate,
  ramadanEndDate,
  SUHOOR_STRATEGIES,
  validateChoice,
  validateDates,
  type ParticipationChoice,
  type SuhoorStrategy,
} from '../utils/ramadan-rules';

type Step = 'dates' | 'members' | 'review';
const STEPS: readonly Step[] = ['dates', 'members', 'review'];
/** A local moon sighting moves the start by a day or two at most. */
const MAX_SHIFT_DAYS = 2;

/**
 * Ramadan setup (02 §7.12.6, 24 S5-11): confirm the start date (moon sighting can move it) and
 * length, choose each member's participation under the child and safety rules, pick a suhoor
 * timing and generate. Generation is premium (17 §4); free users see the upsell and the tips stay
 * free in the planner.
 */
export function RamadanSetupScreen({ navigation }: RootScreenProps<'RamadanSetup'>) {
  const { t, i18n } = useTranslation(['ramadan', 'errors']);
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const canEdit = useActiveHouseholdStore(selectCanEdit);
  const household = useHousehold(householdId);
  const tradition = usePreferencesStore((s) => s.traditionPreference);
  const { premium, loading: premiumLoading } = usePremium(householdId);
  const online = useIsOnline();
  const upcoming = useUpcomingRamadan(householdId);
  const { rules } = useParticipationRules(householdId);
  const generate = useGenerateRamadanPlan(householdId);
  const idempotencyKey = useRef(Crypto.randomUUID());

  const [step, setStep] = useState<Step>('dates');
  const [shift, setShift] = useState(0);
  const [days, setDays] = useState<29 | 30>(upcoming.computedDays);
  const [choices, setChoices] = useState<Record<string, ParticipationChoice>>({});
  const [suhoor, setSuhoor] = useState<SuhoorStrategy>('just_before_fajr');
  const [showErrors, setShowErrors] = useState(false);
  const [accepted, setAccepted] = useState<RamadanGenerateAccepted | null>(null);

  useEffect(() => {
    track('ramadan_setup_started', {});
  }, []);

  const startDate = upcoming.computedStart ? addDays(upcoming.computedStart, shift) : null;
  const endDate = startDate ? ramadanEndDate(startDate, days) : null;
  const datesError =
    startDate && endDate
      ? validateDates({ hijriYear: upcoming.hijriYear, startDate, endDate }, upcoming.today)
      : 'year';
  const h = household.data;
  const hasLocation = Boolean(h?.city && h.city.length >= 2 && h.country_code?.length === 2);
  const choiceFor = (memberId: string) =>
    choices[memberId] ?? rules.find((r) => r.memberId === memberId)?.defaultChoice;
  const membersValid =
    rules.length > 0 &&
    rules.every((r) => {
      const c = choiceFor(r.memberId);
      return r.fixed || (c ? validateChoice(r, c) === null : false);
    });
  const participants = useMemo(() => {
    try {
      return buildParticipants(rules, choices);
    } catch {
      return null;
    }
  }, [rules, choices]);
  const counts = participants ? countFasting(participants) : { fasting: 0, practice: 0 };

  const next = () => {
    if (step === 'dates') {
      if (datesError || !hasLocation) {
        setShowErrors(true);
        return;
      }
      setShowErrors(false);
      setStep('members');
    } else if (step === 'members') {
      if (!membersValid) {
        setShowErrors(true);
        return;
      }
      setShowErrors(false);
      setStep('review');
    }
  };
  const back = () => {
    if (step === 'members') setStep('dates');
    else if (step === 'review') setStep('members');
    else navigation.goBack();
  };

  const submit = () => {
    if (!householdId || !startDate || !endDate || !participants || !h?.city || !h.country_code)
      return;
    generate.mutate(
      {
        key: idempotencyKey.current,
        body: {
          household_id: householdId,
          hijri_year: upcoming.hijriYear,
          start_date: startDate,
          end_date: endDate,
          location: { city: h.city, country_code: h.country_code.toUpperCase() },
          calculation: {
            ...(tradition === 'shia' ? { method: 0, iftar_at: 'maghrib' as const } : {}),
            suhoor_buffer_min: 10,
          },
          participants,
          suhoor_time_strategy: suhoor,
        },
      },
      {
        onSuccess: (res) => {
          if (res.member_escalations.length > 0) setAccepted(res);
          else openProgress(res);
        },
        onError: (e) => {
          if (isAppError(e) && e.code === 'PREMIUM_REQUIRED')
            navigation.navigate('PaywallModal', { trigger: 'ramadan_plan' });
        },
      },
    );
  };
  const openProgress = (res: RamadanGenerateAccepted) =>
    navigation.replace('PlanGenerationProgress', {
      mealPlanId: res.meal_plan_id,
      pollAfterMs: res.poll_after_ms,
    });

  const stepNo = STEPS.indexOf(step) + 1;

  if (accepted)
    return (
      <Screen testID="ramadan-setup.escalations">
        <Text variant="title" accessibilityRole="header">
          {t('setup.escalationsTitle')}
        </Text>
        {accepted.member_escalations.map((e, i) => (
          <InlineMessage key={i} tone="warning" message={e.message} />
        ))}
        <Button
          label={t('setup.continue')}
          onPress={() => openProgress(accepted)}
          testID="ramadan-setup.escalations.continue"
        />
      </Screen>
    );

  return (
    <Screen testID="ramadan-setup.screen">
      <StepProgress
        current={stepNo}
        total={STEPS.length}
        label={t('setup.step', { current: stepNo, total: STEPS.length })}
      />
      {!canEdit ? <InlineMessage tone="info" message={t('setup.viewer')} /> : null}

      {step === 'dates' ? (
        <View className="gap-4" testID="ramadan-setup.dates">
          <Text variant="title" accessibilityRole="header">
            {t('setup.datesTitle', { year: upcoming.hijriYear })}
          </Text>
          <Text tone="muted">{t('setup.datesBody')}</Text>
          {startDate ? (
            <Card variant="filled">
              <Text variant="caption" tone="muted">
                {t('setup.startsOn')}
              </Text>
              <Text variant="bodyStrong" testID="ramadan-setup.start-date">
                {formatPlanDate(startDate, i18n.language)}
              </Text>
              <View className="flex-row flex-wrap gap-2">
                <Button
                  label={t('setup.dayEarlier')}
                  size="sm"
                  variant="secondary"
                  disabled={shift <= -MAX_SHIFT_DAYS}
                  onPress={() => setShift((s) => s - 1)}
                  testID="ramadan-setup.earlier"
                />
                <Button
                  label={t('setup.dayLater')}
                  size="sm"
                  variant="secondary"
                  disabled={shift >= MAX_SHIFT_DAYS}
                  onPress={() => setShift((s) => s + 1)}
                  testID="ramadan-setup.later"
                />
              </View>
            </Card>
          ) : null}
          <ChipGroup<'29' | '30'>
            label={t('setup.lengthLabel')}
            hint={t('setup.lengthHint')}
            single
            options={[
              { value: '29', label: t('setup.days', { count: 29 }) },
              { value: '30', label: t('setup.days', { count: 30 }) },
            ]}
            selected={[String(days) as '29' | '30']}
            onToggle={(v) => setDays(v === '29' ? 29 : 30)}
            testID="ramadan-setup.length"
          />
          {endDate ? (
            <Text tone="muted">
              {t('setup.endsOn', { date: formatPlanDate(endDate, i18n.language) })}
            </Text>
          ) : null}
          {hasLocation && h ? (
            <Text tone="muted" testID="ramadan-setup.city">
              {t('setup.city', { city: h.city })}
            </Text>
          ) : (
            <InlineMessage
              tone="warning"
              message={t('setup.noCity')}
              testID="ramadan-setup.no-city"
            />
          )}
          {showErrors && datesError ? (
            <InlineMessage tone="danger" message={t(`setup.datesError.${datesError}`)} />
          ) : null}
        </View>
      ) : null}

      {step === 'members' ? (
        <View className="gap-4" testID="ramadan-setup.members">
          <Text variant="title" accessibilityRole="header">
            {t('setup.membersTitle')}
          </Text>
          <Text tone="muted">{t('setup.membersBody')}</Text>
          {rules.map((rule) => {
            const value = choiceFor(rule.memberId) ?? rule.defaultChoice;
            return (
              <ParticipationCard
                key={rule.memberId}
                rule={rule}
                value={value}
                onChange={(c) => setChoices((prev) => ({ ...prev, [rule.memberId]: c }))}
                showErrors={showErrors}
              />
            );
          })}
        </View>
      ) : null}

      {step === 'review' ? (
        <View className="gap-4" testID="ramadan-setup.review">
          <Text variant="title" accessibilityRole="header">
            {t('setup.reviewTitle')}
          </Text>
          <Card variant="filled">
            {startDate && endDate ? (
              <Text>
                {t('setup.reviewDates', {
                  start: formatPlanDate(startDate, i18n.language),
                  end: formatPlanDate(endDate, i18n.language),
                })}
              </Text>
            ) : null}
            <Text testID="ramadan-setup.review-counts">
              {t('setup.reviewCounts', { fasting: counts.fasting, practice: counts.practice })}
            </Text>
          </Card>
          <RadioCardGroup<SuhoorStrategy>
            label={t('setup.suhoorLabel')}
            options={SUHOOR_STRATEGIES.map((s) => ({
              value: s,
              title: t(`suhoor.${s}.title`),
              description: t(`suhoor.${s}.body`),
            }))}
            value={suhoor}
            onChange={setSuhoor}
            testID="ramadan-setup.suhoor"
          />
          <Text variant="caption" tone="muted">
            {t('setup.disclaimer')}
          </Text>
          {!premiumLoading && !premium ? (
            <UpsellCard
              trigger="ramadan_plan"
              title={t('upsell.title')}
              body={t('upsell.body')}
              intent={submit}
              testID="ramadan-setup.upsell"
            />
          ) : (
            <Button
              label={t('setup.create')}
              onPress={submit}
              loading={generate.isPending}
              disabled={!online || !canEdit || !participants?.length || generate.isPending}
              testID="ramadan-setup.create"
            />
          )}
          {!online ? <InlineMessage tone="info" message={t('setup.offline')} /> : null}
          {generate.isError &&
          !(isAppError(generate.error) && generate.error.code === 'PREMIUM_REQUIRED') ? (
            <InlineMessage
              tone="danger"
              message={t(`errors:${errorKeyFor(generate.error)}`)}
              testID="ramadan-setup.error"
            />
          ) : null}
        </View>
      ) : null}

      <View className="flex-row gap-2">
        <Button
          label={step === 'dates' ? t('setup.cancel') : t('setup.back')}
          variant="ghost"
          onPress={back}
          testID="ramadan-setup.back"
        />
        {step !== 'review' ? (
          <Button
            label={t('setup.next')}
            onPress={next}
            className="flex-1"
            testID="ramadan-setup.next"
          />
        ) : null}
      </View>
    </Screen>
  );
}
