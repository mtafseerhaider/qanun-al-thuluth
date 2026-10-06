import { z } from 'zod';

import { FAST_KINDS } from '../enums.ts';

/**
 * Client write shapes for the Sprint 4 trackers (05-database-schema.md). These rows are written
 * through PostgREST (offline via the outbox), so `id` is client-generated and doubles as the
 * idempotency key. `household_id` and `family_member_id` are added by the caller.
 */

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const IsoInstant = z.string().datetime({ offset: true });

export const BEVERAGES = ['water', 'milk', 'laban', 'juice', 'tea', 'other'] as const;
export const DRINK_TIMINGS = ['pre_meal', 'with_meal', 'post_meal', 'other'] as const;
/** Quick sizes in ml (FR-HYD-03); the kid cup view uses the smaller ones. */
export const QUICK_SIZES_ML = [100, 150, 250, 330, 500] as const;

export const HydrationLogInput = z.object({
  id: z.string().uuid(),
  logged_at: IsoInstant,
  volume_ml: z.number().int().min(10).max(3000),
  beverage: z.enum(BEVERAGES).default('water'),
  timing: z.enum(DRINK_TIMINGS).default('other'),
});
export type HydrationLogInput = z.infer<typeof HydrationLogInput>;

export const EXEMPTION_REASONS = [
  'illness',
  'travel',
  'menstruation',
  'pregnancy',
  'breastfeeding',
  'age',
  'medical_advice',
  'postpartum',
  'chronic_condition',
  'other',
] as const;

export const FastingLogInput = z
  .object({
    id: z.string().uuid(),
    fast_date: IsoDate,
    kind: z.enum(FAST_KINDS),
    started_at: IsoInstant.nullable().optional(),
    ended_at: IsoInstant.nullable().optional(),
    completed: z.boolean().default(false),
    exemption_reason: z.enum(EXEMPTION_REASONS).nullable().optional(),
    is_practice_fast: z.boolean().default(false),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((f) => !(f.completed && f.exemption_reason), {
    message: 'A completed fast has no exemption',
    path: ['exemption_reason'],
  })
  .refine((f) => !f.started_at || !f.ended_at || f.ended_at > f.started_at, {
    message: 'ended_at must be after started_at',
    path: ['ended_at'],
  });
export type FastingLogInput = z.infer<typeof FastingLogInput>;

export const BudgetEntryInput = z.object({
  id: z.string().uuid(),
  budget_profile_id: z.string().uuid(),
  amount_minor: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  category_id: z.string().uuid(),
  spent_on: IsoDate,
  grocery_list_id: z.string().uuid().nullable().optional(),
  note: z.string().trim().max(280).nullable().optional(),
});
export type BudgetEntryInput = z.infer<typeof BudgetEntryInput>;

/** Adults only: weight logs are never offered for members under 18 (00 §10). */
export const WeightLogInput = z.object({
  id: z.string().uuid(),
  measured_on: IsoDate,
  weight_kg: z.number().min(20).max(400),
  waist_cm: z.number().min(30).max(250).nullable().optional(),
});
export type WeightLogInput = z.infer<typeof WeightLogInput>;

const Score5 = z.number().int().min(1).max(5);
export const NutritionJournalInput = z.object({
  id: z.string().uuid(),
  journal_date: IsoDate,
  mood: Score5.nullable().optional(),
  energy: Score5.nullable().optional(),
  digestion: Score5.nullable().optional(),
  thuluth_adherence: z.number().int().min(0).max(3).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
});
export type NutritionJournalInput = z.infer<typeof NutritionJournalInput>;
