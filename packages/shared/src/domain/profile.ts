import { z } from 'zod';

import { SOURCE_TRADITIONS } from '../enums.ts';

/** Editable columns of `users` (06 §3.1: select/update own row). */
export const ProfileUpdate = z
  .object({
    display_name: z.string().trim().max(80),
    locale: z.enum(['en', 'ur']),
    country_code: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
    timezone: z.string().min(1),
    tradition_preference: z.enum(SOURCE_TRADITIONS),
    units: z.enum(['metric', 'imperial']),
  })
  .partial();
export type ProfileUpdate = z.infer<typeof ProfileUpdate>;
