import { z } from 'zod';

/** `consents.kind` (00 §6). `child_data` is scoped to a household (05). */
export const CONSENT_KINDS = [
  'terms',
  'privacy',
  'health_data',
  'child_data',
  'ai_processing',
  'marketing',
] as const;
export type ConsentKind = (typeof CONSENT_KINDS)[number];

/** Consents required before onboarding can continue (FR-AUTH-05); marketing is optional. */
export const REQUIRED_CONSENTS: readonly ConsentKind[] = [
  'terms',
  'privacy',
  'health_data',
  'ai_processing',
];

/** Current document versions; bump when the legal text changes so users re-consent. */
export const CONSENT_VERSIONS: Record<ConsentKind, string> = {
  terms: '2026-10-01',
  privacy: '2026-10-01',
  health_data: '2026-10-01',
  child_data: '2026-10-01',
  ai_processing: '2026-10-01',
  marketing: '2026-10-01',
};

export const ConsentGrant = z
  .object({
    kind: z.enum(CONSENT_KINDS),
    version: z.string().min(1),
    household_id: z.string().uuid().nullable().optional(),
  })
  .refine((c) => c.kind !== 'child_data' || !!c.household_id, {
    message: 'child_data consent needs a household',
    path: ['household_id'],
  });
export type ConsentGrant = z.infer<typeof ConsentGrant>;
