import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ChipGroup } from '@/components/ui/chip';
import { InlineMessage } from '@/components/ui/inline-message';
import { Screen } from '@/components/ui/screen';
import { Text } from '@/components/ui/text';
import { useFamilyMembers } from '@/features/family';
import { memberAge } from '@/features/meal-log';
import { QueuedBadge, useHouseholdClock } from '@/features/meals';
import { UpsellCard, usePremium } from '@/features/subscription';
import { track } from '@/lib/analytics/track';
import { errorKeyFor } from '@/lib/supabase/error-mapping';
import type { FamilyScreenProps } from '@/navigation/types';
import { selectCanEdit, useActiveHouseholdStore } from '@/stores/use-active-household-store';
import { usePreferencesStore } from '@/stores/use-preferences-store';

import { GrowthAlertCard } from '../components/growth-alert-card';
import { GrowthChart } from '../components/growth-chart';
import { useGrowthDashboard, useLmsRows } from '../hooks/use-growth';
import {
  ageMonthsBetween,
  buildBandCurves,
  chartWindow,
  growthStatus,
  indicatorsForAge,
  indicatorValue,
  nextMeasurementDue,
  ordinalEn,
  referenceForAge,
  roundPercentile,
  seriesFor,
  trendFor,
  visibleAlerts,
  type GrowthRow,
  type Indicator,
} from '../utils/growth-rules';
import { formatMeasurement, unitKey } from '../utils/growth-format';

/**
 * G1 Growth Tracking (02 §7.9, 15 §2, 24 S6-04, FR-GRW-01, -03, -05). Free: log measurements, the
 * latest values with a percentile phrase, and every safety alert (P1). Premium: percentile charts
 * with WHO bands, history and the BMI-for-age info alert. Viewers do not see percentiles (02 §4.3).
 * Children never see kcal, weight targets or body labels (02 §1.1).
 */
export function GrowthDashboardScreen({ route, navigation }: FamilyScreenProps<'GrowthDashboard'>) {
  const { t, i18n } = useTranslation(['growth', 'errors']);
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const role = useActiveHouseholdStore((s) => s.activeRole);
  const canEdit = useActiveHouseholdStore(selectCanEdit);
  const units = usePreferencesStore((s) => s.units);
  const clock = useHouseholdClock(householdId);
  const members = useFamilyMembers(householdId);
  const children = useMemo(
    () => (members.data ?? []).filter((m) => memberAge(m, clock.today).minor),
    [members.data, clock.today],
  );
  const [selected, setSelected] = useState<string>(route.params.familyMemberId);
  const member = (members.data ?? []).find((m) => m.id === selected) ?? null;
  const { premium: premiumTier } = usePremium(householdId);
  const dashboard = useGrowthDashboard(householdId, role === 'viewer' ? null : selected);
  const premium = dashboard.data?.premium ?? premiumTier;
  const rows = dashboard.rows;
  const latest: GrowthRow | null = rows[rows.length - 1] ?? null;
  const flags = visibleAlerts(
    [...(dashboard.data?.openFlags ?? []), ...(latest?.flags ?? [])],
    premium,
  );
  const status = growthStatus(rows, flags);
  const dob = member?.date_of_birth ?? null;
  const ageMonths = dob ? ageMonthsBetween(dob, clock.today) : null;
  const reference = ageMonths !== null ? referenceForAge(ageMonths) : null;
  const indicators = ageMonths !== null ? indicatorsForAge(ageMonths, reference) : [];
  const [indicator, setIndicator] = useState<Indicator>(route.params.indicator ?? 'wfa');
  const active: Indicator = indicators.includes(indicator) ? indicator : (indicators[0] ?? 'hfa');
  const points = seriesFor(rows, active, dob);
  const lms = useLmsRows(
    reference,
    active,
    member?.sex_at_birth ?? null,
    premium && points.length > 0,
  );
  const window = chartWindow(
    points.map((p) => p.ageMonths),
    ageMonths ?? 0,
  );
  const bands =
    reference && lms.data ? buildBandCurves(lms.data, reference, window[0], window[1]) : [];
  const [asTable, setAsTable] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const name = member?.name ?? '';
  const isUr = i18n.language === 'ur';
  const withUnit = (v: number, ind: Indicator) => {
    const u = unitKey(ind, units);
    return u
      ? `${formatMeasurement(v, ind, units)} ${t(`growth:units.${u}`)}`
      : formatMeasurement(v, ind, units);
  };

  const percentilePhrase = (p: number | null) =>
    p === null
      ? null
      : t('growth:percentile', {
          value: isUr ? String(roundPercentile(p)) : ordinalEn(roundPercentile(p)),
        });
  const ageLabel = (months: number) =>
    months < 24
      ? t('growth:ageMonthsShort', { count: months })
      : t('growth:ageYearsShort', { count: Math.floor(months / 12) });

  useEffect(() => {
    if (flags.length === 0) return;
    track('growth_alert_shown', {
      red_flag: status === 'red_flag',
      count: Math.min(10, flags.length),
    });
    // Once per member and flag set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, flags.join(',')]);
  useEffect(() => {
    if (premium && points.length > 0 && reference)
      track('growth_chart_viewed', { indicator: active });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [premium, active, reference]);

  if (role === 'viewer')
    return (
      <Screen testID="growth.screen">
        <InlineMessage tone="info" message={t('growth:viewerNotice')} testID="growth.viewer" />
      </Screen>
    );

  const openAdd = () =>
    navigation.navigate('AddGrowthMeasurementModal', { familyMemberId: selected });
  const summary = t('growth:chartSummary', {
    indicator: t(`growth:indicators.${active}`),
    count: points.length,
    latest:
      percentilePhrase(points[points.length - 1]?.percentile ?? null) ?? t('growth:notComputed'),
    trend: t(`growth:trend.${trendFor(points) ?? 'unknown'}`),
  });

  return (
    <Screen
      testID="growth.screen"
      refreshing={dashboard.isRefetching}
      onRefresh={() => void dashboard.refetch()}
    >
      {children.length > 1 ? (
        <ChipGroup
          label={t('growth:child')}
          single
          options={children.map((m) => ({ value: m.id, label: m.name }))}
          selected={[selected]}
          onToggle={setSelected}
          testID="growth.member"
        />
      ) : null}
      <View className="gap-1">
        <Text variant="title" accessibilityRole="header">
          {t('growth:title', { name })}
        </Text>
        {ageMonths !== null ? (
          <Text tone="muted" testID="growth.age">
            {ageMonths < 24
              ? t('growth:ageMonths', { count: Math.floor(ageMonths) })
              : t('growth:ageYearsMonths', {
                  years: Math.floor(ageMonths / 12),
                  months: Math.floor(ageMonths % 12),
                })}
          </Text>
        ) : (
          <InlineMessage
            tone="info"
            message={t('growth:needDob', { name })}
            testID="growth.no-dob"
          />
        )}
      </View>

      {dashboard.isError ? (
        <InlineMessage tone="danger" message={t(`errors:${errorKeyFor(dashboard.error)}`)} />
      ) : null}

      <GrowthAlertCard
        name={name}
        alerts={flags}
        acknowledged={acknowledged}
        onAcknowledge={() => {
          setAcknowledged(true);
          track('red_flag_acknowledged', {});
        }}
        onExport={
          premium
            ? () =>
                navigation.navigate('CreateExportSheet', {
                  kind: 'growth_report',
                  familyMemberId: selected,
                })
            : undefined
        }
        onShowChart={() => setAsTable(true)}
      />

      <Card testID="growth.status">
        <Text variant="heading" testID={`growth.status.${status}`}>
          {t(`growth:status.${status}`, { name })}
        </Text>
        {latest ? (
          <Text tone="muted" testID="growth.last-measured">
            {t('growth:lastMeasured', { date: latest.measuredOn })}
          </Text>
        ) : null}
        {latest && ageMonths !== null ? (
          <Text tone="muted" testID="growth.next-due">
            {t('growth:nextDue', { date: nextMeasurementDue(latest.measuredOn, ageMonths) })}
          </Text>
        ) : null}
        {canEdit && dob ? (
          <Button label={t('growth:addButton')} onPress={openAdd} testID="growth.add" />
        ) : null}
      </Card>

      {latest ? (
        <Card variant="outlined" testID="growth.latest">
          <Text variant="overline" tone="muted">
            {t('growth:latestTitle')}
          </Text>
          {(['hfa', 'wfa', 'hc'] as const).map((ind) => {
            const v = indicatorValue(latest, ind);
            if (v === null) return null;
            return (
              <View key={ind} className="gap-0.5" testID={`growth.latest.${ind}`}>
                <Text variant="bodyStrong">
                  {t('growth:valueLine', {
                    measure: t(`growth:measures.${ind}`),
                    value: withUnit(v, ind),
                  })}
                </Text>
                {percentilePhrase(latest.percentile[ind]) ? (
                  <Text tone="muted">{percentilePhrase(latest.percentile[ind])}</Text>
                ) : null}
              </View>
            );
          })}
          {latest.queued ? <QueuedBadge testID="growth.latest.queued" /> : null}
          {latest.queued ? (
            <Text variant="caption" tone="muted">
              {t('growth:offline')}
            </Text>
          ) : null}
        </Card>
      ) : !dashboard.isLoading ? (
        <Card variant="filled" testID="growth.empty">
          <Text tone="muted">{t('growth:empty', { name })}</Text>
        </Card>
      ) : null}

      {!premium && rows.length > 0 ? (
        <UpsellCard
          trigger="growth_chart"
          title={t('growth:upsell.title')}
          body={t('growth:upsell.body')}
          testID="growth.upsell"
        />
      ) : null}

      {premium && indicators.length > 0 && rows.length > 0 ? (
        <View className="gap-3" testID="growth.charts">
          <ChipGroup
            label={t('growth:indicator')}
            single
            options={indicators.map((i) => ({ value: i, label: t(`growth:indicators.${i}`) }))}
            selected={[active]}
            onToggle={setIndicator}
            testID="growth.indicator"
          />
          {!asTable && points.length > 0 ? (
            <GrowthChart
              bands={bands}
              points={points}
              window={window}
              accessibilityLabel={summary}
              ageLabel={ageLabel}
              testID="growth.chart"
            />
          ) : null}
          {points.length === 0 ? <Text tone="muted">{t('growth:noPoints')}</Text> : null}
          <Button
            label={asTable ? t('growth:viewChart') : t('growth:viewTable')}
            size="sm"
            variant="ghost"
            className="self-start"
            onPress={() => setAsTable((v) => !v)}
            testID="growth.table-toggle"
          />
          {asTable ? (
            <View accessibilityLabel={summary} className="gap-1" testID="growth.table">
              {points.map((p) => (
                <View key={p.measuredOn} className="flex-row justify-between gap-2">
                  <Text>{p.measuredOn}</Text>
                  <Text variant="bodyStrong">{withUnit(p.value, active)}</Text>
                  <Text tone="muted">
                    {percentilePhrase(p.percentile) ?? t('growth:notComputed')}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
          <Text variant="caption" tone="muted">
            {t('growth:bandsNote')}
          </Text>
        </View>
      ) : null}

      {premium && rows.length > 1 ? (
        <Card testID="growth.history">
          <Text variant="heading" accessibilityRole="header">
            {t('growth:history')}
          </Text>
          {[...rows].reverse().map((r, i) => (
            <View key={r.id} className="gap-0.5" testID={`growth.history.${i}`}>
              <Text variant="bodyStrong">{r.measuredOn}</Text>
              <Text tone="muted">
                {[
                  r.heightCm !== null
                    ? `${t('growth:measures.hfa')} ${withUnit(r.heightCm, 'hfa')}`
                    : null,
                  r.weightKg !== null
                    ? `${t('growth:measures.wfa')} ${withUnit(r.weightKg, 'wfa')}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
              {r.flags.includes('implausible_measurement') ? (
                <Text variant="caption" tone="muted">
                  {t('growth:excluded')}
                </Text>
              ) : null}
              {r.queued ? <QueuedBadge testID={`growth.history.${i}.queued`} /> : null}
            </View>
          ))}
        </Card>
      ) : null}

      <Button
        label={t('growth:howToMeasure')}
        variant="link"
        className="self-start"
        onPress={() =>
          navigation.navigate('MoreTab', {
            screen: 'HelpArticle',
            params: { slug: 'measure-child-at-home' },
          })
        }
        testID="growth.how-to-measure"
      />
      <Text variant="caption" tone="muted">
        {t('growth:disclaimer')}
      </Text>
    </Screen>
  );
}
