import { z } from 'zod';

import { CurrencyCode, IsoDate, Uuid } from './common.ts';

/** `POST /functions/v1/grocery-generate` (06-api-specification §4.7). */
export const GroceryGenerateRequest = z
  .object({
    household_id: Uuid,
    meal_plan_id: Uuid,
    period: z.enum(['weekly', 'monthly']).default('weekly'),
    starts_on: IsoDate,
    ends_on: IsoDate,
    budget_profile_id: Uuid.optional(),
    price_profile_id: Uuid.optional(), // default: household region/city profile
    optimize: z.boolean().default(true), // premium only
    pantry_exclusions: z.array(z.string()).max(100).default([]), // labels the family already has
    replace_list_id: Uuid.optional(), // regenerate into an existing open list
  })
  .refine((r) => r.starts_on <= r.ends_on, {
    message: 'starts_on must be on or before ends_on',
    path: ['ends_on'],
  });
export type GroceryGenerateRequest = z.infer<typeof GroceryGenerateRequest>;

export const BudgetStatus = z.enum(['no_budget', 'under', 'near', 'over']);

export const GrocerySubstitution = z.object({
  item_id: Uuid,
  substitute_item_id: Uuid,
  label: z.string(),
  saves_minor: z.number().int(),
  reason: z.enum(['budget', 'season', 'availability']),
});

export const GroceryGenerateResponse = z.object({
  grocery_list_id: Uuid,
  currency: CurrencyCode,
  estimated_total_minor: z.number().int(),
  items_count: z.number().int(),
  fresh_items_count: z.number().int(),
  budget: z.object({
    target_minor: z.number().int().nullable(),
    status: BudgetStatus,
    by_category: z.array(
      z.object({
        category_code: z.string(),
        estimated_minor: z.number().int(),
        target_minor: z.number().int().nullable(),
      }),
    ),
  }),
  substitutions: z.array(GrocerySubstitution),
  price_coverage: z.number().min(0).max(1), // share of items with a known price
});
export type GroceryGenerateResponse = z.infer<typeof GroceryGenerateResponse>;
