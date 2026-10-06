import { z } from 'zod';

import { RedFlagScreening } from '../domain/intake.ts';
import { LIFE_STAGES } from '../enums.ts';
import { Escalation, Locale, Uuid } from './common.ts';

/** `POST /functions/v1/ai-intake-assess` (06-api-specification §4.2). */
export const AiIntakeAssessRequest = z.object({
  household_id: Uuid,
  family_member_ids: z.array(Uuid).min(1).max(20).optional(), // default: all active members
  reason: z.enum(['onboarding', 'profile_changed', 'periodic']).default('onboarding'),
  locale: Locale.optional(),
  /** Screening answers keyed by family_member_id (01 §7.6). Inputs only: just the flags are stored. */
  red_flag_screening: z.record(Uuid, RedFlagScreening).optional(),
});
export type AiIntakeAssessRequest = z.infer<typeof AiIntakeAssessRequest>;

/** `kcal_per_day` is the goal-adjusted target; the breakdown fields are optional (adults only). */
export const EnergyTargets = z.object({
  kcal_per_day: z.number(),
  method: z.string(),
  bmr_kcal: z.number().optional(),
  tdee_kcal: z.number().optional(),
  goal_adjustment_kcal: z.number().optional(),
  pal: z.number().optional(),
});
export const MacroTargets = z.object({
  protein_g: z.number(),
  carbs_g: z.number(),
  fat_g: z.number(),
  fiber_g: z.number(),
});

export const MemberAssessment = z
  .object({
    assessment_id: Uuid,
    family_member_id: Uuid,
    life_stage: z.enum(LIFE_STAGES),
    summary: z.string(),
    energy_targets: EnergyTargets.nullable(), // null for under-18
    macro_targets: MacroTargets.nullable(),
    hydration_target_ml: z.number().int(),
    child_guidance: z.array(z.string()).optional(), // present for under-18
    risk_flags: z.array(z.string()),
    escalation: Escalation.nullable(),
    recommendation_ids: z.array(Uuid),
  })
  .refine(
    (a) =>
      !['infant', 'toddler', 'child', 'teen'].includes(a.life_stage) ||
      (a.energy_targets === null && a.macro_targets === null),
    { message: 'Members under 18 never get calorie or macro targets', path: ['energy_targets'] },
  );
export type MemberAssessment = z.infer<typeof MemberAssessment>;

export const AiIntakeAssessResponse = z.object({
  household_id: Uuid,
  assessments: z.array(MemberAssessment),
  disclaimer_key: z.literal('disclaimer.not_medical_advice'),
});
export type AiIntakeAssessResponse = z.infer<typeof AiIntakeAssessResponse>;
