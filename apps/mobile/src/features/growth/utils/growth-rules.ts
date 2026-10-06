import {
  GROWTH_CDC_MAX_AGE_MONTHS,
  GROWTH_MAX_AGE_MONTHS,
  GROWTH_WFA_MAX_AGE_MONTHS,
  type GrowthAlertCode,
  type GrowthReference,
} from '@shared/contracts';
import { inToCm, lbToKg } from '@shared/utils/units';

import { addDays } from '@/lib/dates/local-date';

/**
 * Growth tracking rules for the app (15 §2, 02 §5.9 and §7.9, FR-GRW-01 to -05). Pure, so they are
 * unit-tested. The server (`growth-compute`) is the source of truth for z-scores, percentiles and
 * alerts; the app only draws reference bands from cached LMS rows, validates input and phrases
 * results. Children never see kcal, weight targets or labels like "underweight" (02 §1.1, P3).
 */

export type Indicator = 'wfa' | 'hfa' | 'bmi' | 'hc';
export const INDICATORS: readonly Indicator[] = ['wfa', 'hfa', 'bmi', 'hc'];
export type LmsIndicator = 'wfa' | 'lhfa' | 'bmifa' | 'hcfa';
export const LMS_INDICATOR: Record<Indicator, LmsIndicator> = {
  wfa: 'wfa',
  hfa: 'lhfa',
  bmi: 'bmifa',
  hc: 'hcfa',
};

export const DAYS_PER_MONTH = 30.4375;

/** Fractional age in months between two ISO dates (15 §2.3: `age_days / 30.4375`). */
export function ageMonthsBetween(dateOfBirth: string, onDate: string): number {
  const days = (Date.parse(`${onDate}T00:00:00Z`) - Date.parse(`${dateOfBirth}T00:00:00Z`)) / 864e5;
  return Math.max(0, days / DAYS_PER_MONTH);
}

/** WHO 2006 to 60 months, WHO 2007 to 228 months; CDC 2000 to 240 months only when chosen. */
export function referenceForAge(ageMonths: number, useCdc = false): GrowthReference | null {
  if (useCdc) return ageMonths <= GROWTH_CDC_MAX_AGE_MONTHS ? 'cdc_2000' : null;
  if (ageMonths <= 60) return 'who_2006';
  if (ageMonths <= GROWTH_MAX_AGE_MONTHS) return 'who_2007';
  return null;
}

/** Indicators the chart offers at an age (15 §2.3, 02 §7.9 region 3). */
export function indicatorsForAge(
  ageMonths: number,
  reference: GrowthReference | null,
): Indicator[] {
  if (!reference) return [];
  const out: Indicator[] = [];
  if (reference === 'cdc_2000' || ageMonths <= GROWTH_WFA_MAX_AGE_MONTHS) out.push('wfa');
  out.push('hfa');
  if (ageMonths >= 24) out.push('bmi');
  if (reference === 'who_2006' && ageMonths < 60) out.push('hc');
  return out;
}

/** Head circumference is asked under 24 months (02 §5.9, FR-GRW-01). */
export const headCircumferenceAsked = (ageMonths: number): boolean => ageMonths < 24;
/** Lying length under 2 years, standing height after (15 §2.2). */
export const defaultPosition = (ageMonths: number): 'recumbent' | 'standing' =>
  ageMonths < 24 ? 'recumbent' : 'standing';

/** Measurement reminder cadence (FR-GRW-05): monthly under 2, quarterly 2 to 5, twice yearly after. */
export function measurementIntervalMonths(ageMonths: number): number {
  if (ageMonths < 24) return 1;
  if (ageMonths < 60) return 3;
  return 6;
}

export function nextMeasurementDue(lastMeasuredOn: string, ageMonths: number): string {
  return addDays(lastMeasuredOn, Math.round(measurementIntervalMonths(ageMonths) * DAYS_PER_MONTH));
}

/* ------------------------------------------------------------------------------------------------
 * Input validation (02 §7.9 X9). Ranges follow the `growth-compute` contract so a queued row never
 * fails validation on the server: height 30 to 220 cm, weight 1 to 200 kg, head 25 to 60 cm.
 * ---------------------------------------------------------------------------------------------- */

export interface MeasurementForm {
  measuredOn: string;
  height: string;
  weight: string;
  head: string;
}

export interface MeasurementValues {
  measuredOn: string;
  heightCm: number | null;
  weightKg: number | null;
  headCm: number | null;
}

export type MeasurementError =
  | 'date_future'
  | 'date_before_birth'
  | 'date_invalid'
  | 'height_range'
  | 'weight_range'
  | 'head_range'
  | 'need_one';

function parseNumber(text: string): number | null | 'invalid' {
  if (!text.trim()) return null;
  const n = Number(text.replace(',', '.').trim());
  return Number.isFinite(n) && n > 0 ? n : 'invalid';
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function validateMeasurement(
  form: MeasurementForm,
  ctx: { today: string; dateOfBirth: string | null; units: 'metric' | 'imperial' },
): {
  values: MeasurementValues | null;
  errors: Partial<Record<keyof MeasurementForm, MeasurementError>>;
} {
  const errors: Partial<Record<keyof MeasurementForm, MeasurementError>> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.measuredOn) || Number.isNaN(Date.parse(form.measuredOn)))
    errors.measuredOn = 'date_invalid';
  else if (form.measuredOn > ctx.today) errors.measuredOn = 'date_future';
  else if (ctx.dateOfBirth && form.measuredOn < ctx.dateOfBirth)
    errors.measuredOn = 'date_before_birth';

  const imperial = ctx.units === 'imperial';
  const h = parseNumber(form.height);
  const w = parseNumber(form.weight);
  const hc = parseNumber(form.head);
  const heightCm = typeof h === 'number' ? round1(imperial ? inToCm(h) : h) : h;
  const weightKg = typeof w === 'number' ? round2(imperial ? lbToKg(w) : w) : w;
  const headCm = typeof hc === 'number' ? round1(imperial ? inToCm(hc) : hc) : hc;
  if (heightCm === 'invalid' || (typeof heightCm === 'number' && (heightCm < 30 || heightCm > 220)))
    errors.height = 'height_range';
  if (weightKg === 'invalid' || (typeof weightKg === 'number' && (weightKg < 1 || weightKg > 200)))
    errors.weight = 'weight_range';
  if (headCm === 'invalid' || (typeof headCm === 'number' && (headCm < 25 || headCm > 60)))
    errors.head = 'head_range';
  if (heightCm === null && weightKg === null && !errors.height && !errors.weight)
    errors.height = 'need_one';
  if (Object.keys(errors).length > 0) return { values: null, errors };
  return {
    values: {
      measuredOn: form.measuredOn,
      heightCm: heightCm as number | null,
      weightKg: weightKg as number | null,
      headCm: headCm as number | null,
    },
    errors,
  };
}

/**
 * Plausibility against the previous measurement (02 §7.9 X9): a height drop of more than 1 cm, or a
 * weight change over 10 percent within 30 days, asks "Double-check?" before saving. Never blocks.
 */
export function plausibilityWarning(
  previous: { measuredOn: string; heightCm: number | null; weightKg: number | null } | null,
  next: MeasurementValues,
): 'height_decrease' | 'weight_jump' | null {
  if (!previous || previous.measuredOn >= next.measuredOn) return null;
  if (previous.heightCm !== null && next.heightCm !== null && previous.heightCm - next.heightCm > 1)
    return 'height_decrease';
  const days = (Date.parse(next.measuredOn) - Date.parse(previous.measuredOn)) / 864e5;
  if (
    days <= 30 &&
    previous.weightKg !== null &&
    next.weightKg !== null &&
    Math.abs(next.weightKg - previous.weightKg) / previous.weightKg > 0.1
  )
    return 'weight_jump';
  return null;
}

/* ------------------------------------------------------------------------------------------------
 * Reference bands from LMS rows (15 §2.4, 02 §7.9 region 4). Value at z: M (1 + L S z)^(1/L).
 * ---------------------------------------------------------------------------------------------- */

export interface LmsRow {
  ageMonths: number;
  l: number;
  m: number;
  s: number;
}

export function valueAtZ({ l, m, s }: Omit<LmsRow, 'ageMonths'>, z: number): number {
  if (Math.abs(l) < 1e-7) return m * Math.exp(s * z);
  const base = 1 + l * s * z;
  return base <= 0 ? Number.NaN : m * Math.pow(base, 1 / l);
}

/** WHO bands 3rd, 15th, 50th, 85th, 97th; CDC bands 5th, 25th, 50th, 75th, 95th. */
export const WHO_BANDS = [
  { percentile: 3, z: -1.881 },
  { percentile: 15, z: -1.036 },
  { percentile: 50, z: 0 },
  { percentile: 85, z: 1.036 },
  { percentile: 97, z: 1.881 },
] as const;
export const CDC_BANDS = [
  { percentile: 5, z: -1.645 },
  { percentile: 25, z: -0.674 },
  { percentile: 50, z: 0 },
  { percentile: 75, z: 0.674 },
  { percentile: 95, z: 1.645 },
] as const;

export interface BandCurve {
  percentile: number;
  points: Array<[ageMonths: number, value: number]>;
}

/** One curve per band over [fromMonths, toMonths], sampled from the LMS rows in that window. */
export function buildBandCurves(
  rows: readonly LmsRow[],
  reference: GrowthReference,
  fromMonths: number,
  toMonths: number,
): BandCurve[] {
  const bands = reference === 'cdc_2000' ? CDC_BANDS : WHO_BANDS;
  const window = [...rows]
    .filter((r) => r.ageMonths >= fromMonths && r.ageMonths <= toMonths)
    .sort((a, b) => a.ageMonths - b.ageMonths);
  // Keep the curves light: at most ~60 points per band.
  const step = Math.max(1, Math.ceil(window.length / 60));
  const sampled = window.filter((_, i) => i % step === 0 || i === window.length - 1);
  return bands.map((b) => ({
    percentile: b.percentile,
    points: sampled
      .map((r) => [r.ageMonths, valueAtZ(r, b.z)] as [number, number])
      .filter(([, v]) => Number.isFinite(v)),
  }));
}

/** Chart window: from 3 months before the first point (or birth) to 3 months after the latest. */
export function chartWindow(ages: readonly number[], currentAge: number): [number, number] {
  const lo = Math.max(0, Math.floor(Math.min(currentAge, ...ages) - 3));
  const hi = Math.ceil(Math.max(currentAge, ...ages) + 3);
  return [lo, Math.max(hi, lo + 6)];
}

/* ------------------------------------------------------------------------------------------------
 * Rows from `growth_dashboard` (05 §21.2) and alert codes.
 * ---------------------------------------------------------------------------------------------- */

export interface GrowthRow {
  id: string;
  measuredOn: string;
  ageMonths: number | null;
  heightCm: number | null;
  weightKg: number | null;
  headCm: number | null;
  bmi: number | null;
  reference: GrowthReference;
  percentile: Record<Indicator, number | null>;
  flags: GrowthAlertCode[];
  computed: boolean;
  /** Saved on this device, waiting for the outbox. */
  queued?: boolean;
}

export interface GrowthDashboardView {
  member: { id: string; name: string; sex: string | null; ageMonths: number | null };
  premium: boolean;
  rows: GrowthRow[];
  openFlags: GrowthAlertCode[];
}

const ALERT_CODES: readonly GrowthAlertCode[] = [
  'weight_for_age_below_p3',
  'crossed_two_major_percentiles',
  'rapid_weight_loss',
  'bmi_for_age_above_p97',
  'height_for_age_below_p3',
  'severe_thinness',
  'head_circumference_out_of_range',
  'implausible_measurement',
];
/** Older flag spellings in `growth_tracking.flags` (05 §12.7 comment) mapped to contract codes. */
const FLAG_ALIASES: Record<string, GrowthAlertCode> = {
  wfa_below_p3: 'weight_for_age_below_p3',
  crossed_two_major_lines: 'crossed_two_major_percentiles',
  growth_faltering_two_lines: 'crossed_two_major_percentiles',
  child_rapid_weight_loss: 'rapid_weight_loss',
  hfa_below_p3: 'height_for_age_below_p3',
  stunting_severe: 'height_for_age_below_p3',
};

export function normalizeFlag(raw: unknown): GrowthAlertCode | null {
  if (typeof raw !== 'string') return null;
  const code = raw.replace(/^red_flag\./, '');
  if ((ALERT_CODES as readonly string[]).includes(code)) return code as GrowthAlertCode;
  return FLAG_ALIASES[code] ?? null;
}

/** Red flags that pause growth plans (15 §2.8, contract `stops_planning`). */
export const PLAN_PAUSING: ReadonlySet<GrowthAlertCode> = new Set([
  'weight_for_age_below_p3',
  'crossed_two_major_percentiles',
  'rapid_weight_loss',
  'severe_thinness',
]);
/** The only non-safety alert: premium (FR-GRW-04). Everything else shows on every tier (P1). */
export const PREMIUM_ONLY_ALERTS: ReadonlySet<GrowthAlertCode> = new Set(['bmi_for_age_above_p97']);

export function visibleAlerts(
  flags: readonly GrowthAlertCode[],
  premium: boolean,
): GrowthAlertCode[] {
  const unique = [...new Set(flags)];
  return premium ? unique : unique.filter((f) => !PREMIUM_ONLY_ALERTS.has(f));
}

export type GrowthStatus = 'none' | 'pending' | 'steady' | 'remeasure' | 'watch' | 'red_flag';

/** Plain-language status for the status card (02 §7.9 Copy). */
export function growthStatus(
  rows: readonly GrowthRow[],
  flags: readonly GrowthAlertCode[],
): GrowthStatus {
  if (rows.length === 0) return 'none';
  if (flags.some((f) => PLAN_PAUSING.has(f))) return 'red_flag';
  const latest = rows[rows.length - 1];
  if (latest && !latest.computed) return 'pending';
  if (flags.includes('implausible_measurement')) return 'remeasure';
  if (flags.length > 0) return 'watch';
  return 'steady';
}

export const planPaused = (flags: readonly GrowthAlertCode[]): boolean =>
  flags.some((f) => PLAN_PAUSING.has(f));

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const REFS: readonly GrowthReference[] = ['who_2006', 'who_2007', 'cdc_2000'];

export function toGrowthRow(raw: Record<string, unknown>): GrowthRow {
  const reference = REFS.includes(raw.reference as GrowthReference)
    ? (raw.reference as GrowthReference)
    : 'who_2006';
  const flags = Array.isArray(raw.flags)
    ? raw.flags.map(normalizeFlag).filter((f): f is GrowthAlertCode => f !== null)
    : [];
  return {
    id: String(raw.id),
    measuredOn: String(raw.measured_on),
    ageMonths:
      num(raw.age_months) ??
      (num(raw.age_days) !== null ? (num(raw.age_days) as number) / DAYS_PER_MONTH : null),
    heightCm: num(raw.height_cm),
    weightKg: num(raw.weight_kg),
    headCm: num(raw.head_circumference_cm),
    bmi: num(raw.bmi),
    reference,
    percentile: {
      wfa: num(raw.weight_for_age_percentile),
      hfa: num(raw.height_for_age_percentile),
      bmi: num(raw.bmi_for_age_percentile),
      hc: num(raw.head_circumference_for_age_percentile),
    },
    flags,
    computed: raw.computed_at !== null && raw.computed_at !== undefined,
  };
}

export function parseDashboard(json: unknown): GrowthDashboardView | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as Record<string, unknown>;
  const member = (j.member ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(j.measurements)
    ? (j.measurements as Record<string, unknown>[]).map(toGrowthRow)
    : [];
  rows.sort((a, b) => a.measuredOn.localeCompare(b.measuredOn));
  const openFlags = Array.isArray(j.openFlags)
    ? j.openFlags.map(normalizeFlag).filter((f): f is GrowthAlertCode => f !== null)
    : [];
  return {
    member: {
      id: String(member.id ?? ''),
      name: typeof member.name === 'string' ? member.name : '',
      sex: typeof member.sex === 'string' ? member.sex : null,
      ageMonths: num(member.ageMonths),
    },
    premium: j.premium === true,
    rows,
    openFlags: [...new Set(openFlags)],
  };
}

/** The value plotted for an indicator; null when missing. */
export function indicatorValue(row: GrowthRow, indicator: Indicator): number | null {
  switch (indicator) {
    case 'wfa':
      return row.weightKg;
    case 'hfa':
      return row.heightCm;
    case 'bmi':
      return row.bmi;
    case 'hc':
      return row.headCm;
  }
}

export interface SeriesPoint {
  measuredOn: string;
  ageMonths: number;
  value: number;
  percentile: number | null;
}

/** The child's points for one indicator; implausible rows stay out of charts until re-measured. */
export function seriesFor(
  rows: readonly GrowthRow[],
  indicator: Indicator,
  dateOfBirth: string | null,
): SeriesPoint[] {
  return rows.flatMap((r) => {
    if (r.flags.includes('implausible_measurement')) return [];
    const value = indicatorValue(r, indicator);
    const age = r.ageMonths ?? (dateOfBirth ? ageMonthsBetween(dateOfBirth, r.measuredOn) : null);
    if (value === null || age === null) return [];
    return [
      { measuredOn: r.measuredOn, ageMonths: age, value, percentile: r.percentile[indicator] },
    ];
  });
}

/** "around the 40th percentile": rounded to a whole number, never shown as a label (P3). */
export function roundPercentile(p: number): number {
  if (p < 1) return 1;
  if (p > 99) return 99;
  return Math.round(p);
}

export function ordinalEn(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** Trend between the last two computed percentiles of an indicator (for the chart summary). */
export function trendFor(points: readonly SeriesPoint[]): 'steady' | 'rising' | 'falling' | null {
  const withP = points.filter((p) => p.percentile !== null);
  if (withP.length < 2) return null;
  const a = withP[withP.length - 2]?.percentile as number;
  const b = withP[withP.length - 1]?.percentile as number;
  if (Math.abs(b - a) < 10) return 'steady';
  return b > a ? 'rising' : 'falling';
}
