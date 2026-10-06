import { z } from 'zod';

import { Escalation, IsoDate, Uuid } from './common.ts';

/**
 * `POST /functions/v1/growth-compute` (06-api-specification §4.8, 15-family-health-modules §2).
 * Children only: the output is z-scores, percentiles and alerts. It never carries kcal, weight
 * targets or weight-loss goals (00-foundations §10.3), so the response object is strict.
 */
export const GrowthReference = z.enum(['who_2006', 'who_2007', 'cdc_2000']);
export type GrowthReference = z.infer<typeof GrowthReference>;

/** WHO 2007 has no weight-for-age beyond 10 years (06 §4.8). */
export const GROWTH_WFA_MAX_AGE_MONTHS = 120;
/** Over 19 years the function returns `GROWTH_REFERENCE_OUT_OF_RANGE` (use `weight_tracking`). */
export const GROWTH_MAX_AGE_MONTHS = 228;
/** CDC 2000 runs to 20 years; only used when the household opts in. */
export const GROWTH_CDC_MAX_AGE_MONTHS = 240;
/** Major WHO percentile lines used for crossing alerts: 3rd, 15th, 50th, 85th, 97th (15 §2.7). */
export const GROWTH_MAJOR_LINES_Z = [-1.88, -1.04, 0, 1.04, 1.88] as const;

/** Additive (15 §2.1): recumbent length vs standing height, for the 0.7 cm WHO adjustment. */
export const MeasurementPosition = z.enum(['recumbent', 'standing']);

export const GrowthMeasurementInput = z.object({
  household_id: Uuid,
  family_member_id: Uuid,
  measured_on: IsoDate,
  height_cm: z.number().min(30).max(220),
  weight_kg: z.number().min(1).max(200),
  head_circumference_cm: z.number().min(25).max(60).optional(),
  measurement_position: MeasurementPosition.optional(),
});
export type GrowthMeasurementInput = z.infer<typeof GrowthMeasurementInput>;

export const GrowthComputeRequest = z.union([
  z.object({ growth_tracking_id: Uuid }), // row already inserted (offline path)
  GrowthMeasurementInput,
]);
export type GrowthComputeRequest = z.infer<typeof GrowthComputeRequest>;

export const GrowthAlertCode = z.enum([
  'weight_for_age_below_p3',
  'crossed_two_major_percentiles',
  'rapid_weight_loss',
  'bmi_for_age_above_p97',
  'height_for_age_below_p3',
]);
export type GrowthAlertCode = z.infer<typeof GrowthAlertCode>;

export const GrowthAlertSeverity = z.enum(['info', 'watch', 'see_clinician']);

export const GrowthAlert = z
  .object({
    code: GrowthAlertCode,
    severity: GrowthAlertSeverity,
    message: z.string(),
    escalation: Escalation.nullable(),
    /** Additive (15 §2.8): a red flag that pauses growth plans until a clinician is seen. */
    stops_planning: z.boolean().default(false),
  })
  .refine((a) => !a.stops_planning || a.escalation !== null, {
    message: 'An alert that pauses planning must carry an escalation',
    path: ['escalation'],
  })
  .refine((a) => a.code !== 'bmi_for_age_above_p97' || !a.stops_planning, {
    // Never restriction or a weight-loss goal for a child: family-habit tips only (14 gate G3).
    message: 'A high BMI-for-age alert never pauses or restricts a child plan',
    path: ['stops_planning'],
  });
export type GrowthAlert = z.infer<typeof GrowthAlert>;

const ZScore = z.number().min(-10).max(10);
const Percentile = z.number().min(0).max(100);

const IndicatorZ = z.object({
  height_for_age: ZScore.nullable(),
  weight_for_age: ZScore.nullable(),
  bmi_for_age: ZScore.nullable(),
  /** Additive (05 §12.7): under 60 months only. */
  head_circumference_for_age: ZScore.nullable().default(null),
});
const IndicatorPercentile = z.object({
  height_for_age: Percentile.nullable(),
  weight_for_age: Percentile.nullable(),
  bmi_for_age: Percentile.nullable(),
  head_circumference_for_age: Percentile.nullable().default(null),
});

export const GrowthTrend = z.object({
  series: z.array(
    z.object({
      measured_on: IsoDate,
      weight_for_age_percentile: Percentile.nullable(),
      height_for_age_percentile: Percentile.nullable(),
    }),
  ),
  direction: z.enum(['stable', 'rising', 'falling']),
});

const INDICATORS = [
  'height_for_age',
  'weight_for_age',
  'bmi_for_age',
  'head_circumference_for_age',
] as const;

export const GrowthComputeResponse = z
  .object({
    growth_tracking_id: Uuid,
    reference: GrowthReference,
    age_months: z.number().min(0).max(GROWTH_CDC_MAX_AGE_MONTHS),
    bmi: z.number().positive(),
    z: IndicatorZ,
    percentile: IndicatorPercentile,
    alerts: z.array(GrowthAlert), // safety alerts on every tier
    /** Additive: true when any alert paused growth plans (red-flag plan pause, 15 §2.8). */
    plan_paused: z.boolean().default(false),
    trend: GrowthTrend.nullable(), // premium only, else null
  })
  .strict() // no kcal, targets or goals can ride along on a child's growth result
  .superRefine((r, ctx) => {
    for (const k of INDICATORS) {
      if ((r.z[k] === null) !== (r.percentile[k] === null))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'z-score and percentile must both be present or both be null',
          path: ['percentile', k],
        });
    }
    if (
      r.reference !== 'cdc_2000' &&
      r.age_months > GROWTH_WFA_MAX_AGE_MONTHS &&
      r.z.weight_for_age !== null
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'WHO weight-for-age is not computed above 120 months',
        path: ['z', 'weight_for_age'],
      });
    if (r.reference !== 'cdc_2000' && r.age_months > GROWTH_MAX_AGE_MONTHS)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'WHO references stop at 228 months',
        path: ['age_months'],
      });
    if (r.plan_paused !== r.alerts.some((a) => a.stops_planning))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'plan_paused must match whether any alert stops planning',
        path: ['plan_paused'],
      });
  });
export type GrowthComputeResponse = z.infer<typeof GrowthComputeResponse>;
