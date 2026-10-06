import { GrowthAlertCode } from '@shared/contracts';

import en from '@locales/en/growth.json';
import ur from '@locales/ur/growth.json';

import {
  growthStatus,
  indicatorsForAge,
  normalizeFlag,
  planPaused,
  plausibilityWarning,
  referenceForAge,
  seriesFor,
  toGrowthRow,
  trendFor,
  validateMeasurement,
  visibleAlerts,
  type GrowthRow,
} from '../utils/growth-rules';

const TODAY = '2026-10-06';
const ctx = { today: TODAY, dateOfBirth: '2022-01-15', units: 'metric' as const };
const form = (
  over: Partial<{ measuredOn: string; height: string; weight: string; head: string }>,
) => ({
  measuredOn: TODAY,
  height: '',
  weight: '',
  head: '',
  ...over,
});

const row = (measuredOn: string, extra: Record<string, unknown> = {}): GrowthRow =>
  toGrowthRow({
    id: measuredOn,
    measured_on: measuredOn,
    age_months: 40,
    height_cm: 98,
    weight_kg: 15,
    computed_at: '2026-10-06T00:00:00Z',
    weight_for_age_percentile: 40,
    ...extra,
  });

describe('validateMeasurement', () => {
  it('accepts metric values and converts imperial ones', () => {
    expect(validateMeasurement(form({ height: '98.4', weight: '15,2' }), ctx).values).toEqual({
      measuredOn: TODAY,
      heightCm: 98.4,
      weightKg: 15.2,
      headCm: null,
    });
    const imp = validateMeasurement(form({ height: '39', weight: '33' }), {
      ...ctx,
      units: 'imperial',
    });
    expect(imp.values?.heightCm).toBe(99.1);
    expect(imp.values?.weightKg).toBe(14.97);
  });

  it('rejects bad dates, out-of-range values and an empty form', () => {
    expect(
      validateMeasurement(form({ measuredOn: 'nope', weight: '15' }), ctx).errors.measuredOn,
    ).toBe('date_invalid');
    expect(
      validateMeasurement(form({ measuredOn: '2026-10-07', weight: '15' }), ctx).errors.measuredOn,
    ).toBe('date_future');
    expect(
      validateMeasurement(form({ measuredOn: '2021-01-01', weight: '15' }), ctx).errors.measuredOn,
    ).toBe('date_before_birth');
    expect(validateMeasurement(form({ height: '250' }), ctx).errors.height).toBe('height_range');
    expect(validateMeasurement(form({ weight: '0.5' }), ctx).errors.weight).toBe('weight_range');
    expect(validateMeasurement(form({ weight: '12', head: '70' }), ctx).errors.head).toBe(
      'head_range',
    );
    const empty = validateMeasurement(form({}), ctx);
    expect(empty.values).toBeNull();
    expect(empty.errors.height).toBe('need_one');
  });
});

describe('plausibilityWarning', () => {
  const next = { measuredOn: TODAY, heightCm: 96, weightKg: 15, headCm: null };
  it('flags a height drop over 1 cm and a fast weight jump, never older rows', () => {
    expect(
      plausibilityWarning({ measuredOn: '2026-09-01', heightCm: 98, weightKg: 15 }, next),
    ).toBe('height_decrease');
    expect(
      plausibilityWarning(
        { measuredOn: '2026-09-20', heightCm: 96, weightKg: 13 },
        { ...next, weightKg: 15 },
      ),
    ).toBe('weight_jump');
    expect(
      plausibilityWarning({ measuredOn: '2026-06-01', heightCm: 96, weightKg: 13 }, next),
    ).toBeNull();
    expect(plausibilityWarning(null, next)).toBeNull();
  });
});

describe('references and indicators', () => {
  it('uses WHO 2006 to 60 months then WHO 2007, and CDC only when chosen', () => {
    expect(referenceForAge(12)).toBe('who_2006');
    expect(referenceForAge(60)).toBe('who_2006');
    expect(referenceForAge(61)).toBe('who_2007');
    expect(referenceForAge(300)).toBeNull();
    expect(referenceForAge(100, true)).toBe('cdc_2000');
  });
  it('offers head circumference under 5 and BMI from 2 years', () => {
    expect(indicatorsForAge(12, 'who_2006')).toEqual(['wfa', 'hfa', 'hc']);
    expect(indicatorsForAge(30, 'who_2006')).toEqual(['wfa', 'hfa', 'bmi', 'hc']);
    expect(indicatorsForAge(150, 'who_2007')).toEqual(['hfa', 'bmi']);
    expect(indicatorsForAge(30, null)).toEqual([]);
  });
});

describe('alerts and status', () => {
  it('normalizes prefixed and legacy flag spellings and drops unknown ones', () => {
    expect(normalizeFlag('red_flag.rapid_weight_loss')).toBe('rapid_weight_loss');
    expect(normalizeFlag('wfa_below_p3')).toBe('weight_for_age_below_p3');
    expect(normalizeFlag('something_else')).toBeNull();
    expect(normalizeFlag(3)).toBeNull();
  });

  it('shows every safety alert on every tier; only the BMI-above alert is premium', () => {
    expect(visibleAlerts(['bmi_for_age_above_p97', 'severe_thinness'], false)).toEqual([
      'severe_thinness',
    ]);
    expect(visibleAlerts(['bmi_for_age_above_p97', 'bmi_for_age_above_p97'], true)).toEqual([
      'bmi_for_age_above_p97',
    ]);
  });

  it('pauses plans on red flags only', () => {
    expect(planPaused(['weight_for_age_below_p3'])).toBe(true);
    expect(planPaused(['head_circumference_out_of_range'])).toBe(false);
  });

  it('derives the status card state', () => {
    expect(growthStatus([], [])).toBe('none');
    expect(growthStatus([row('2026-10-01')], [])).toBe('steady');
    expect(growthStatus([row('2026-10-01', { computed_at: null })], [])).toBe('pending');
    expect(growthStatus([row('2026-10-01')], ['implausible_measurement'])).toBe('remeasure');
    expect(growthStatus([row('2026-10-01')], ['height_for_age_below_p3'])).toBe('watch');
    expect(growthStatus([row('2026-10-01')], ['rapid_weight_loss'])).toBe('red_flag');
  });

  it('has calm copy for every contract alert code in both languages', () => {
    for (const code of GrowthAlertCode.options) {
      expect(en.alert.codes[code]).toBeTruthy();
      expect(ur.alert.codes[code]).toBeTruthy();
    }
  });
});

describe('series', () => {
  it('keeps implausible rows off the chart and reads the trend', () => {
    const rows = [
      row('2026-06-01', { weight_for_age_percentile: 30 }),
      row('2026-08-01', { flags: ['implausible_measurement'], weight_kg: 40 }),
      row('2026-10-01', { weight_for_age_percentile: 55 }),
    ];
    const points = seriesFor(rows, 'wfa', null);
    expect(points.map((p) => p.measuredOn)).toEqual(['2026-06-01', '2026-10-01']);
    expect(trendFor(points)).toBe('rising');
    expect(trendFor(points.slice(0, 1))).toBeNull();
  });
});
