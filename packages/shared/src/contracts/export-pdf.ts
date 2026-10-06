import { z } from 'zod';

import { AsyncAccepted, ExportKind, IsoDate, IsoInstant, Locale, Uuid } from './common.ts';

/**
 * `POST /functions/v1/export-pdf` (06-api-specification §4.10, 18-exports-and-analytics Part A).
 * Premium. Kinds outside `exports.kinds` return `EXPORT_KIND_UNSUPPORTED`.
 */

/** Kinds enabled in Sprint 6 (S6-08); the rest stay behind the `exports.kinds` flag. */
export const ExportPdfMvpKind = ExportKind.extract(['meal_plan', 'grocery_list', 'growth_report']);
export type ExportPdfMvpKind = z.infer<typeof ExportPdfMvpKind>;
export const EXPORT_PDF_MVP_KINDS = ExportPdfMvpKind.options;

/** Signed URL lifetime: 24 h (FR-EXP-04, S6-08). */
export const EXPORT_SIGNED_URL_TTL_SECONDS = 24 * 60 * 60;
/** Storage object lifetime (`exports.expires_at`, 18 §6). */
export const EXPORT_OBJECT_TTL_DAYS = 7;

export const ExportPaper = z.enum(['A4', 'Letter']);
export type ExportPaper = z.infer<typeof ExportPaper>;

export const ExportPdfParams = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('meal_plan'),
    meal_plan_id: Uuid,
    week_index: z.number().int().min(0).max(3).optional(),
    include_recipes: z.boolean().default(true),
    include_sources: z.boolean().default(true),
  }),
  z.object({
    kind: z.literal('grocery_list'),
    grocery_list_id: Uuid,
    group_by: z.enum(['aisle', 'category']).default('aisle'),
  }),
  z.object({
    kind: z.literal('nutrition_report'),
    family_member_id: Uuid,
    from: IsoDate,
    to: IsoDate,
  }),
  z.object({
    kind: z.literal('growth_report'),
    family_member_id: Uuid,
    include_notes_for_clinician: z.boolean().default(true), // 18 §4.4
  }),
  z.object({ kind: z.literal('ramadan_pack'), ramadan_plan_id: Uuid }),
  z.object({ kind: z.literal('family_summary') }),
]);
export type ExportPdfParams = z.infer<typeof ExportPdfParams>;

export const ExportPdfRequest = z
  .object({
    household_id: Uuid,
    locale: Locale, // `ur` renders RTL
    paper: ExportPaper.default('A4'),
    params: ExportPdfParams,
  })
  .refine((r) => r.params.kind !== 'nutrition_report' || r.params.from <= r.params.to, {
    message: 'from must be on or before to',
    path: ['params', 'to'],
  });
export type ExportPdfRequest = z.infer<typeof ExportPdfRequest>;

/** `exports.status` (06 §9 addition). */
export const ExportStatus = z.enum(['processing', 'ready', 'failed', 'expired']);
export type ExportStatus = z.infer<typeof ExportStatus>;

export const ExportPdfReady = z.object({
  status: z.literal('ready'),
  export_id: Uuid,
  url: z.string().url(), // signed, private bucket `exports`
  expires_at: IsoInstant, // signed URL expiry, issued_at + 24 h
  pages: z.number().int().positive(),
});
export type ExportPdfReady = z.infer<typeof ExportPdfReady>;

export const ExportPdfAccepted = AsyncAccepted.extend({
  export_id: Uuid,
  export_status: z.literal('processing'),
});
export type ExportPdfAccepted = z.infer<typeof ExportPdfAccepted>;

export const ExportPdfResponse = z.union([ExportPdfReady, ExportPdfAccepted]);
export type ExportPdfResponse = z.infer<typeof ExportPdfResponse>;
