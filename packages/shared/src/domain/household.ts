import { z } from 'zod';

/** Insert/update shape for `households` (onboarding step 3, FR-HH-01). */
export const HouseholdInput = z.object({
  name: z.string().trim().min(1).max(80),
  country_code: z.string().regex(/^[A-Z]{2}$/),
  region: z.string().max(10).nullable().optional(),
  city: z.string().trim().max(80).nullable().optional(),
  timezone: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export type HouseholdInput = z.infer<typeof HouseholdInput>;

/** Optional monthly budget (`budget_profiles`, FR-GRO-07). Amount in minor units. */
export const BudgetInput = z.object({
  monthly_amount_minor: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  strictness: z.enum(['flexible', 'target', 'hard_cap']).default('target'),
});
export type BudgetInput = z.infer<typeof BudgetInput>;
