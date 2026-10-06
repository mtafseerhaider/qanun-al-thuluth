/** Safety thresholds from 00-foundations §10. */

/** Anyone younger than this is a child: never restricted, no calorie targets, no weight-loss goals. */
export const CHILD_AGE_YEARS = 18;

/** No fasting plans below this age; gentle practice fasts only from here to puberty. */
export const FASTING_MIN_AGE_YEARS = 7;

export const RED_FLAG_CODES = [
  'eating_disorder_signals',
  'rapid_child_weight_loss',
  'faltering_growth',
  'dehydration_signs',
  'pregnancy_complication',
  'severe_allergy_reaction',
  'insulin_or_sulfonylurea_fasting',
] as const;
export type RedFlagCode = (typeof RED_FLAG_CODES)[number];
