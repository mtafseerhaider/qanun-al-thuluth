import { growthDirection } from '../calculators/growth.ts';

/**
 * `get_growth_status` view (12 §8.10, 15 §2.9). Reads what `growth-compute` already stored in
 * `growth_tracking` (z-scores, percentiles, flags); the LMS maths stays in that module. The view
 * carries percentiles, alert codes and (premium) a trend, and never a weight, height, kcal or any
 * target: a child's growth is discussed as growth-first rhythm, never restriction (00 §10.3).
 */

export interface GrowthRow {
  measured_on: string;
  reference: string;
  age_months: number | null;
  height_for_age_percentile: number | null;
  weight_for_age_percentile: number | null;
  bmi_for_age_percentile: number | null;
  head_circumference_for_age_percentile: number | null;
  weight_for_age_z: number | null;
  height_for_age_z: number | null;
  flags: readonly string[];
  /** Null until growth-compute has run; such rows are skipped. */
  computed_at: string | null;
}

export interface GrowthStatusView {
  measurements: number;
  latest: {
    measuredOn: string;
    reference: string;
    percentiles: {
      heightForAge: number | null;
      weightForAge: number | null;
      bmiForAge: number | null;
      headCircumferenceForAge: number | null;
    };
  } | null;
  alerts: string[];
  /** Any alert that should go to a paediatrician (15 §2.8). */
  seeClinician: boolean;
  trend: {
    direction: 'stable' | 'rising' | 'falling';
    series: Array<{ measuredOn: string; weightForAge: number | null; heightForAge: number | null }>;
  } | null;
  /** Instruction for the model; the data has no target numbers to repeat. */
  instruction: string;
}

const round1 = (n: number | null) => (n === null ? null : Math.round(Number(n) * 10) / 10);

/** Codes as stored ('red_flag.wfa_below_p3') or bare ('weight_for_age_below_p3'). */
export function growthAlertCode(flag: string): string {
  return flag.replace(/^red_flag\./, '');
}

const CLINICIAN =
  /below_p3|crossed_two|two_lines|rapid_weight_loss|faltering|severe|stunting|implausible/;

const zs = (rows: readonly GrowthRow[], k: 'weight_for_age_z' | 'height_for_age_z') =>
  rows
    .map((r) => r[k])
    .filter((v): v is number => v !== null)
    .map(Number);

export function growthStatusView(
  rows: readonly GrowthRow[],
  opts: { includeTrend: boolean; premium: boolean },
): GrowthStatusView {
  const computed = rows
    .filter((r) => r.computed_at !== null)
    .sort((a, b) => a.measured_on.localeCompare(b.measured_on));
  const last = computed.at(-1);
  const alerts = [...new Set((last?.flags ?? []).map(growthAlertCode))];
  const series = computed.slice(-12).map((r) => ({
    measuredOn: r.measured_on,
    weightForAge: round1(r.weight_for_age_percentile),
    heightForAge: round1(r.height_for_age_percentile),
  }));
  const seeClinician = alerts.some((a) => CLINICIAN.test(a));
  return {
    measurements: computed.length,
    latest: last
      ? {
          measuredOn: last.measured_on,
          reference: last.reference,
          percentiles: {
            heightForAge: round1(last.height_for_age_percentile),
            weightForAge: round1(last.weight_for_age_percentile),
            bmiForAge: round1(last.bmi_for_age_percentile),
            headCircumferenceForAge: round1(last.head_circumference_for_age_percentile),
          },
        }
      : null,
    alerts,
    seeClinician,
    trend:
      opts.includeTrend && opts.premium && series.length >= 2
        ? {
            // The trend rule lives with the LMS maths (calculators/growth.ts): weight-for-age
            // z-scores, or height-for-age when weight-for-age is not defined (over 10 years).
            direction: growthDirection(
              zs(computed, 'weight_for_age_z').length >= 2
                ? zs(computed, 'weight_for_age_z')
                : zs(computed, 'height_for_age_z'),
            ),
            series,
          }
        : null,
    instruction: !last
      ? 'No growth measurement yet. Suggest logging height and weight in the Growth screen; do not estimate.'
      : seeClinician
        ? 'An alert is present: say kindly that this is worth discussing with their paediatrician, call escalate_to_clinician (category faltering_growth) if growth is faltering, and never suggest a diet, smaller portions, a calorie or weight target for a child.'
        : 'Describe the percentiles gently as where the child sits compared with other children; any steady line is healthy. Never give a weight, calorie or portion target for a child; talk about regular family meals, variety and the Division of Responsibility.',
  };
}
