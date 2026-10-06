import { z } from 'zod';

import { AsyncAccepted, Uuid } from './common.ts';

/**
 * `POST /functions/v1/account-export` (06-api-specification §4.12, 16-security-architecture §7.4).
 * Free on every tier (FR-EXP-06). Requires a recent sign-in (fresh OTP or Apple/Google re-auth).
 * Produces an `exports` row with `kind = 'account_data'` and a zip in the `exports` bucket.
 */

/** Emailed download link lifetime: 24 h (16 §7.4, 11 §15.2). */
export const ACCOUNT_EXPORT_LINK_TTL_HOURS = 24;

export const AccountExportRequest = z.object({
  include_pdfs: z.boolean().default(true), // adds meal plan and growth PDFs
  // default: all households the user belongs to (only data they can read)
  household_ids: z.array(Uuid).min(1).max(20).optional(),
});
export type AccountExportRequest = z.infer<typeof AccountExportRequest>;

export const AccountExportAccepted = AsyncAccepted.extend({
  export_id: Uuid,
  export_status: z.literal('processing'),
});
export type AccountExportAccepted = z.infer<typeof AccountExportAccepted>;
