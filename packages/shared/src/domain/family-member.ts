import { z } from 'zod';

import { ACTIVITY_LEVELS, BLOOD_GROUPS, SEXES_AT_BIRTH, SPECIAL_MODULES } from '../enums.ts';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');

/**
 * Insert/update shape for `family_members` (onboarding step 4, FR-HH-02). `life_stage` is not
 * accepted from clients: a trigger derives it from `date_of_birth` (mirror: `lifeStageFor`).
 */
export const FamilyMemberInput = z.object({
  name: z.string().trim().min(1).max(60),
  date_of_birth: isoDate.refine(
    (d) => d <= new Date().toISOString().slice(0, 10),
    'Date of birth is in the future',
  ),
  sex_at_birth: z.enum(SEXES_AT_BIRTH).default('unspecified'),
  height_cm: z.number().min(30).max(260).nullable().optional(),
  weight_kg: z.number().min(1).max(400).nullable().optional(),
  blood_group: z.enum(BLOOD_GROUPS).default('unknown'),
  activity_level: z.enum(ACTIVITY_LEVELS).default('moderate'),
  special_modules: z.array(z.enum(SPECIAL_MODULES)).default([]),
  linked_user_id: z.string().uuid().nullable().optional(),
});
export type FamilyMemberInput = z.infer<typeof FamilyMemberInput>;
