import { z } from 'zod';

import { AsyncAccepted, Escalation, IsoDate, Uuid } from './common.ts';

/** `POST /functions/v1/ramadan-generate` (06-api-specification §4.9). Premium only. */
export const RamadanParticipant = z
  .object({
    family_member_id: Uuid,
    intention: z.enum(['fasting', 'practice_fast', 'not_fasting', 'exempt']),
    practice_fast: z
      .object({
        days_per_week: z.number().int().min(1).max(7),
        until: z.enum(['dhuhr', 'asr', 'maghrib']),
      })
      .optional(), // only for 7 to puberty
    exemption_reason: z
      .enum(['travel', 'illness', 'pregnancy', 'breastfeeding', 'menstruation', 'age', 'other'])
      .optional(),
  })
  .refine((p) => p.intention !== 'practice_fast' || p.practice_fast !== undefined, {
    message: 'practice_fast details are required for a practice fast',
    path: ['practice_fast'],
  })
  .refine((p) => p.intention !== 'exempt' || p.exemption_reason !== undefined, {
    message: 'An exemption needs a reason',
    path: ['exemption_reason'],
  });
export type RamadanParticipant = z.infer<typeof RamadanParticipant>;

export const RamadanGenerateRequest = z.object({
  household_id: Uuid,
  hijri_year: z.number().int().min(1447).max(1500),
  start_date: IsoDate.optional(), // user can correct for local moon sighting
  end_date: IsoDate.optional(),
  location: z.object({ city: z.string().min(2), country_code: z.string().length(2) }),
  calculation: z
    .object({
      method: z.number().int().min(0).max(23).optional(), // Aladhan method id
      asr_school: z.enum(['standard', 'hanafi']).optional(),
      iftar_at: z.enum(['sunset', 'maghrib']).optional(),
      suhoor_buffer_min: z.number().int().min(0).max(30).default(10),
    })
    .default({}),
  participants: z.array(RamadanParticipant).min(1),
  suhoor_time_strategy: z
    .enum(['just_before_fajr', 'after_tahajjud', 'before_sleep'])
    .default('just_before_fajr'),
  budget_profile_id: Uuid.optional(),
});
export type RamadanGenerateRequest = z.infer<typeof RamadanGenerateRequest>;

export const RamadanGenerateAccepted = AsyncAccepted.extend({
  ramadan_plan_id: Uuid,
  meal_plan_id: Uuid,
  plan_status: z.literal('generating'),
  dates: z.object({ start_date: IsoDate, end_date: IsoDate }),
  prayer_times_source: z.enum(['aladhan', 'cache', 'computed_fallback']),
  member_escalations: z.array(Escalation),
});
export type RamadanGenerateAccepted = z.infer<typeof RamadanGenerateAccepted>;
