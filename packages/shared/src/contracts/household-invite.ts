import { z } from 'zod';

import { HouseholdRole, IsoInstant, Uuid } from './common.ts';

/** `household-invite` (06 §4.11). Caregivers may invite viewers only; coach invites wait for Phase 2 (00 §11). */
export const InvitableRole = z.enum(['caregiver', 'viewer']);
export type InvitableRole = z.infer<typeof InvitableRole>;

export const HouseholdInviteRequest = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    household_id: Uuid,
    email: z.string().trim().toLowerCase().pipe(z.string().email()),
    role: InvitableRole,
    message: z.string().max(280).optional(),
  }),
  z.object({ action: z.literal('resend'), invitation_id: Uuid }),
  z.object({ action: z.literal('revoke'), invitation_id: Uuid }),
  z.object({ action: z.literal('accept'), token: z.string().min(32).max(128) }),
]);
export type HouseholdInviteRequest = z.infer<typeof HouseholdInviteRequest>;

export const HouseholdInviteResponse = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    invitation_id: Uuid,
    expires_at: IsoInstant,
    share_url: z.string().url(),
  }),
  z.object({ action: z.literal('resend'), invitation_id: Uuid, expires_at: IsoInstant }),
  z.object({ action: z.literal('revoke'), invitation_id: Uuid, revoked: z.literal(true) }),
  z.object({ action: z.literal('accept'), household_id: Uuid, role: HouseholdRole }),
]);
export type HouseholdInviteResponse = z.infer<typeof HouseholdInviteResponse>;

/** Invitation lifetime and the share link format (06 §4.11). */
export const INVITE_TTL_DAYS = 7;
export const inviteShareUrl = (token: string): string => `https://thuluth.app/invite/${token}`;
