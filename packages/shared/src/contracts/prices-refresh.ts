import { z } from 'zod';

import { IsoDate } from './common.ts';

/** 06 §4.16. */
export const PricesRefreshRequest = z.object({
  region_ids: z.array(z.string().uuid()).max(100).optional(),
  since: IsoDate.optional(),
});
export const PricesRefreshResponse = z.object({
  profiles_updated: z.number().int(),
  ingredients_repriced: z.number().int(),
  outliers_rejected: z.number().int(),
  /** Additive: pending reports accepted by agreement, and profiles whose data is stale (14 §16.3). */
  pending_accepted: z.number().int(),
  stale_profiles: z.array(z.string()),
});
export type PricesRefreshResponse = z.infer<typeof PricesRefreshResponse>;
