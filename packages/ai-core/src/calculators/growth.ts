/**
 * Child growth maths (15-family-health-modules §2.3 to §2.8, FR-GRW-02): WHO LMS z-scores,
 * percentiles, reference selection, the WHO length/height adjustment and the growth alert rules.
 * Pure, no I/O: `growth-compute` loads `growth_reference_lms` rows and the member's history, this
 * module does the arithmetic. 15 §2.5 sketches the same functions under packages/shared; they live
 * next to the other calculators here because the Edge Functions already depend on ai-core.
 *
 * No energy, kcal or weight targets are produced for children, ever (00 §10.3).
 */

export type GrowthReferenceKey = 'who_2006' | 'who_2007' | 'cdc_2000';
/** `growth_reference_lms.indicator`: weight, length/height, BMI, head circumference for age. */
export type GrowthIndicatorKey = 'wfa' | 'lhfa' | 'bmifa' | 'hcfa';

export interface Lms {
  l: number;
  m: number;
  s: number;
}

export interface LmsRow extends Lms {
  ageMonths: number;
  /** Set for WHO 2006 daily rows (exact table key); null for monthly tables. */
  ageDays?: number | null;
}

/** Days per month used by WHO (15 §2.3). */
export const DAYS_PER_MONTH = 30.4375;
/** Last day of the WHO 2006 standards used here (60 months, 1826 days). */
export const WHO_2006_MAX_AGE_DAYS = 1826;
/** WHO 2007 weight-for-age stops at 10 years. */
export const WHO_2007_WFA_MAX_MONTHS = 120;
/** WHO 2007 stops at 19 years. */
export const WHO_2007_MAX_MONTHS = 228;
/** CDC 2000 covers 24 to 240 months; under 24 months CDC itself recommends the WHO standards. */
export const CDC_2000_MIN_MONTHS = 24;
export const CDC_2000_MAX_MONTHS = 240;
/** Major WHO percentile lines (3rd, 15th, 50th, 85th, 97th) as z (15 §2.7). */
export const MAJOR_LINES_Z = [-1.88, -1.04, 0, 1.04, 1.88] as const;
/** z of the 3rd and 97th percentiles. */
export const Z_P3 = -1.88;
export const Z_P97 = 1.88;

const round = (x: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
};

/** Whole days from date of birth to the measurement date (both `YYYY-MM-DD`, UTC calendar). */
export function ageInDays(dateOfBirth: string, measuredOn: string): number {
  const a = Date.parse(`${dateOfBirth}T00:00:00Z`);
  const b = Date.parse(`${measuredOn}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) throw new RangeError('invalid date');
  return Math.round((b - a) / 86_400_000);
}

export const ageMonthsFromDays = (days: number): number => days / DAYS_PER_MONTH;

/**
 * Raw LMS z-score; with `restricted` (weight-based indicators: wfa, bmifa) WHO's linear tail
 * beyond |z| = 3 is applied (15 §2.4). Not rounded.
 */
export function lmsZ(x: number, { l, m, s }: Lms, restricted: boolean): number {
  if (!(x > 0) || !(m > 0) || !(s > 0)) throw new RangeError('LMS inputs must be positive');
  const z = Math.abs(l) < 1e-7 ? Math.log(x / m) / s : ((x / m) ** l - 1) / (l * s);
  if (!restricted || Math.abs(z) <= 3) return z;
  const sd = (k: number) => lmsValueAt(k, { l, m, s });
  if (z > 3) {
    const sd3 = sd(3);
    return 3 + (x - sd3) / (sd3 - sd(2));
  }
  const sd3 = sd(-3);
  return -3 + (x - sd3) / (sd(-2) - sd3);
}

/** The measurement at z-score `z` (inverse LMS; used for chart curves and tests). */
export function lmsValueAt(z: number, { l, m, s }: Lms): number {
  return Math.abs(l) < 1e-7 ? m * Math.exp(s * z) : m * (1 + l * s * z) ** (1 / l);
}

/** Standard normal CDF (Abramowitz and Stegun 7.1.26 erf, |error| < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Percentile 0..100 with two decimals. */
export const zToPercentile = (z: number): number => round(normalCdf(z) * 100, 2);

/**
 * LMS at an age. Daily rows (WHO 2006) are matched on `ageDays` when given; otherwise the rows are
 * interpolated linearly on `ageMonths` (15 §2.3). An age up to one month before the first row
 * uses the first row (WHO 2007 starts at 61 months; WHO 2006 here ends at 60). Returns null when
 * the age is outside the table.
 */
export function lmsAt(
  rows: readonly LmsRow[],
  age: { ageDays: number; ageMonths: number },
): Lms | null {
  if (!rows.length) return null;
  const daily = rows.filter((r) => r.ageDays != null);
  if (daily.length) {
    const exact = daily.find((r) => r.ageDays === age.ageDays);
    if (exact) return { l: exact.l, m: exact.m, s: exact.s };
  }
  const sorted = [...rows].sort((a, b) => a.ageMonths - b.ageMonths);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return null;
  const a = age.ageMonths;
  if (a < first.ageMonths) return first.ageMonths - a <= 1 ? pick(first) : null;
  if (a > last.ageMonths) return null;
  let lo = first;
  let hi = last;
  for (const r of sorted) {
    if (r.ageMonths <= a) lo = r;
    if (r.ageMonths >= a) {
      hi = r;
      break;
    }
  }
  if (hi.ageMonths === lo.ageMonths) return pick(lo);
  const f = (a - lo.ageMonths) / (hi.ageMonths - lo.ageMonths);
  return { l: lo.l + f * (hi.l - lo.l), m: lo.m + f * (hi.m - lo.m), s: lo.s + f * (hi.s - lo.s) };
}

const pick = (r: Lms): Lms => ({ l: r.l, m: r.m, s: r.s });

/**
 * WHO convention: under 731 days length is recumbent, from 731 days height is standing. A standing
 * height under 2 years gets +0.7 cm; a recumbent length from 2 years gets -0.7 cm.
 */
export function adjustedHeightCm(
  heightCm: number,
  ageDays: number,
  position?: 'recumbent' | 'standing' | null,
): number {
  if (ageDays < 731 && position === 'standing') return heightCm + 0.7;
  if (ageDays >= 731 && position === 'recumbent') return heightCm - 0.7;
  return heightCm;
}

/** BMI with one decimal (kg / m²). */
export const childBmi = (weightKg: number, heightCm: number): number =>
  round(weightKg / (heightCm / 100) ** 2, 1);

/**
 * Reference for an age (15 §2.3, 06 §4.8): WHO 2006 to 60 months, WHO 2007 to 228 months, CDC 2000
 * (24 to 240 months) only when the household opted in. Null when no reference covers the age.
 */
export function selectGrowthReference(
  ageDays: number,
  opts: { preferCdc?: boolean } = {},
): GrowthReferenceKey | null {
  if (ageDays < 0) return null;
  const months = ageMonthsFromDays(ageDays);
  if (opts.preferCdc && months >= CDC_2000_MIN_MONTHS && months <= CDC_2000_MAX_MONTHS)
    return 'cdc_2000';
  if (ageDays <= WHO_2006_MAX_AGE_DAYS) return 'who_2006';
  if (months <= WHO_2007_MAX_MONTHS) return 'who_2007';
  return null;
}

/** Indicators a reference provides at an age (15 §2.3). */
export function indicatorsFor(
  reference: GrowthReferenceKey,
  ageMonths: number,
): GrowthIndicatorKey[] {
  if (reference === 'who_2006') return ['wfa', 'lhfa', 'bmifa', 'hcfa'];
  if (reference === 'who_2007')
    return ageMonths <= WHO_2007_WFA_MAX_MONTHS ? ['wfa', 'lhfa', 'bmifa'] : ['lhfa', 'bmifa'];
  return ['wfa', 'lhfa', 'bmifa'];
}

/** Weight-based indicators use WHO's restricted tails. */
export const isRestrictedIndicator = (i: GrowthIndicatorKey): boolean =>
  i === 'wfa' || i === 'bmifa';

/**
 * WHO implausibility flags (15 §2.8): HFA z < -6 or > 6; WFA z < -6 or > 5; BMI z < -5 or > 5;
 * head circumference uses the HFA bounds.
 */
export function isImplausibleZ(indicator: GrowthIndicatorKey, z: number): boolean {
  if (indicator === 'wfa') return z < -6 || z > 5;
  if (indicator === 'bmifa') return z < -5 || z > 5;
  return z < -6 || z > 6;
}

/** Major percentile lines strictly between two z-scores (positive = crossed downward). */
export function linesCrossedDownward(fromZ: number, toZ: number): number {
  if (toZ >= fromZ) return 0;
  return MAJOR_LINES_Z.filter((line) => fromZ >= line && toZ < line).length;
}

// ---- alert rules (15 §2.8, 06 §4.8) ---------------------------------------------------------------

export interface GrowthPoint {
  measuredOn: string;
  ageDays: number;
  weightKg: number | null;
  heightCm: number | null;
  z: Partial<Record<GrowthIndicatorKey, number | null>>;
  /** Points flagged implausible are left out of trend and crossing rules. */
  implausible?: boolean;
}

export type GrowthRuleCode =
  | 'weight_for_age_below_p3'
  | 'crossed_two_major_percentiles'
  | 'rapid_weight_loss'
  | 'bmi_for_age_above_p97'
  | 'height_for_age_below_p3'
  /** Rules without a contract alert code yet; recorded as flags only (see growth-compute). */
  | 'severe_thinness'
  | 'head_circumference_out_of_range'
  | 'implausible_measurement';

export interface GrowthRuleHit {
  code: GrowthRuleCode;
  severity: 'info' | 'watch' | 'see_clinician';
  /** Red flag: pauses growth plans until a clinician is seen (15 §2.8). */
  stopsPlanning: boolean;
  escalation: 'faltering_growth' | 'rapid_child_weight_loss' | null;
  evidence: Record<string, number | string>;
}

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * Evaluates the alert rules for `current` against earlier `history` (any order, the current point
 * excluded). Thresholds are PENDING CLINICAL REVIEW (S6-03):
 * - WFA z < -1.88 (below 3rd): see_clinician, red flag.
 * - WFA or BMI-for-age crossing two or more major lines downward against any measurement in the
 *   previous 12 months: see_clinician, red flag.
 * - Weight down more than 5 percent within 90 days, or any weight decrease under 24 months across
 *   two measurements 30 or more days apart: see_clinician, red flag.
 * - BMI-for-age z < -3 (severe thinness): see_clinician, red flag.
 * - HFA z < -1.88: watch (z < -3: see_clinician); never stops planning.
 * - BMI-for-age z > 1.88 (above 97th): info only. Family-habit tips, never restriction or a
 *   weight-loss goal (14 gate G3); never stops planning.
 * - Head circumference |z| > 2 (under 5): see_clinician, no stop.
 */
export function evaluateGrowthRules(
  current: GrowthPoint,
  history: readonly GrowthPoint[],
): GrowthRuleHit[] {
  const hits: GrowthRuleHit[] = [];
  if (current.implausible) {
    return [
      {
        code: 'implausible_measurement',
        severity: 'info',
        stopsPlanning: false,
        escalation: null,
        evidence: {},
      },
    ];
  }
  const z = current.z;
  const past = history
    .filter((p) => !p.implausible && p.measuredOn < current.measuredOn)
    .sort((a, b) => (a.measuredOn < b.measuredOn ? -1 : 1));

  if (z.wfa != null && z.wfa < Z_P3) {
    hits.push({
      code: 'weight_for_age_below_p3',
      severity: 'see_clinician',
      stopsPlanning: true,
      escalation: 'faltering_growth',
      evidence: { wfa_z: round(z.wfa, 2) },
    });
  }

  // Two-line downward crossing within 12 months (WFA or BMI-for-age).
  let crossing: { indicator: string; lines: number; since: string } | null = null;
  for (const p of past) {
    const days = daysBetween(p.measuredOn, current.measuredOn);
    if (days > 366 || days <= 0) continue;
    for (const ind of ['wfa', 'bmifa'] as const) {
      const a = p.z[ind];
      const b = z[ind];
      if (a == null || b == null) continue;
      const lines = linesCrossedDownward(a, b);
      if (lines >= 2 && (!crossing || lines > crossing.lines))
        crossing = { indicator: ind, lines, since: p.measuredOn };
    }
  }
  if (crossing) {
    hits.push({
      code: 'crossed_two_major_percentiles',
      severity: 'see_clinician',
      stopsPlanning: true,
      escalation: 'faltering_growth',
      evidence: crossing,
    });
  }

  // Rapid weight loss.
  if (current.weightKg != null) {
    let loss: Record<string, number | string> | null = null;
    for (const p of past) {
      if (p.weightKg == null || p.weightKg <= 0) continue;
      const days = daysBetween(p.measuredOn, current.measuredOn);
      if (days <= 0) continue;
      const pct = ((p.weightKg - current.weightKg) / p.weightKg) * 100;
      const infantDrop = current.ageDays < 731 && days >= 30 && current.weightKg < p.weightKg;
      if ((days <= 90 && pct > 5) || infantDrop) {
        loss = { since: p.measuredOn, days, percent: round(pct, 1) };
      }
    }
    if (loss) {
      hits.push({
        code: 'rapid_weight_loss',
        severity: 'see_clinician',
        stopsPlanning: true,
        escalation: 'rapid_child_weight_loss',
        evidence: loss,
      });
    }
  }

  if (z.bmifa != null && z.bmifa < -3) {
    hits.push({
      code: 'severe_thinness',
      severity: 'see_clinician',
      stopsPlanning: true,
      escalation: 'faltering_growth',
      evidence: { bmifa_z: round(z.bmifa, 2) },
    });
  }

  if (z.lhfa != null && z.lhfa < Z_P3) {
    hits.push({
      code: 'height_for_age_below_p3',
      severity: z.lhfa < -3 ? 'see_clinician' : 'watch',
      stopsPlanning: false,
      escalation: z.lhfa < -3 ? 'faltering_growth' : null,
      evidence: { lhfa_z: round(z.lhfa, 2) },
    });
  }

  if (z.bmifa != null && z.bmifa > Z_P97) {
    hits.push({
      code: 'bmi_for_age_above_p97',
      severity: 'info',
      stopsPlanning: false,
      escalation: null,
      evidence: { bmifa_z: round(z.bmifa, 2) },
    });
  }

  if (z.hcfa != null && Math.abs(z.hcfa) > 2) {
    hits.push({
      code: 'head_circumference_out_of_range',
      severity: 'see_clinician',
      stopsPlanning: false,
      escalation: null,
      evidence: { hcfa_z: round(z.hcfa, 2) },
    });
  }
  return hits;
}

/** Trend over the last three plausible points of an indicator (0.3 z band = stable). */
export function growthDirection(zs: readonly number[]): 'stable' | 'rising' | 'falling' {
  const last = zs.slice(-3);
  const start = last[0];
  const end = last[last.length - 1];
  if (last.length < 2 || start === undefined || end === undefined) return 'stable';
  const delta = end - start;
  if (delta > 0.3) return 'rising';
  if (delta < -0.3) return 'falling';
  return 'stable';
}
