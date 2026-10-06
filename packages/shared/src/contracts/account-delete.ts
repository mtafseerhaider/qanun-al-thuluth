import { z } from 'zod';

import { IsoInstant } from './common.ts';

/**
 * `POST /functions/v1/account-delete` (06-api-specification §4.13, 16-security-architecture §7.5,
 * FR-SET-05). OTP confirmation is a step-up re-auth (11 §15): the client verifies a fresh email
 * OTP (or Apple/Google) with Supabase Auth and the function checks the JWT `amr` is at most
 * 5 minutes old, so no code travels in this body. Deletion runs after a cancellable grace period.
 */

/** Grace period before hard delete; the user can cancel at any point inside it (FR-SET-05). */
export const ACCOUNT_DELETION_GRACE_DAYS = 30;
/** Maximum age of the sign-in that confirms the request (11 §15.1). */
export const ACCOUNT_DELETION_REAUTH_MAX_AGE_SEC = 300;

export const AccountDeleteReason = z.enum([
  'privacy',
  'not_useful',
  'too_expensive',
  'other',
  'under_age', // age gate declined (11 §13.1): no data exists, deleted immediately
]);
export type AccountDeleteReason = z.infer<typeof AccountDeleteReason>;

export const AccountDeleteRequest = z
  .discriminatedUnion('action', [
    z.object({
      action: z.literal('request'),
      confirm: z.literal('DELETE'),
      reason: AccountDeleteReason.optional(),
      immediate: z.boolean().default(false),
      /** Fresh Apple `authorizationCode` so the token can be revoked (11 §15.2). */
      apple_authorization_code: z.string().min(1).max(2048).optional(),
    }),
    z.object({ action: z.literal('cancel') }), // valid only while inside the grace period
  ])
  .refine((r) => r.action !== 'request' || !r.immediate || r.reason === 'under_age', {
    message: 'Only an age-gate decline skips the grace period',
    path: ['immediate'],
  });
export type AccountDeleteRequest = z.infer<typeof AccountDeleteRequest>;

export const AccountDeleteResponse = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('request'),
    scheduled_for: IsoInstant, // now + 30 days (now for an immediate under-age delete)
    active_subscription_warning: z.boolean(), // deep-link to store subscription management
  }),
  z.object({ action: z.literal('cancel'), cancelled: z.literal(true) }),
]);
export type AccountDeleteResponse = z.infer<typeof AccountDeleteResponse>;

/** `POST /functions/v1/account-delete/execute` (internal, hourly cron). */
export const AccountDeleteExecuteResponse = z.object({
  deleted_users: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
});
export type AccountDeleteExecuteResponse = z.infer<typeof AccountDeleteExecuteResponse>;

/** When a deletion requested at `requestedAt` becomes due. */
export function deletionScheduledFor(requestedAt: Date, immediate = false): Date {
  if (immediate) return new Date(requestedAt.getTime());
  return new Date(requestedAt.getTime() + ACCOUNT_DELETION_GRACE_DAYS * 24 * 60 * 60 * 1000);
}

/** True while a scheduled deletion can still be cancelled. */
export function isWithinDeletionGrace(scheduledFor: Date, now: Date = new Date()): boolean {
  return now.getTime() < scheduledFor.getTime();
}
