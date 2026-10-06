import {
  HouseholdInviteRequest,
  INVITE_TTL_DAYS,
  inviteShareUrl,
} from '@thuluth/shared/contracts/household-invite.ts';
import type { HouseholdInviteResponse } from '@thuluth/shared/contracts/household-invite.ts';

import { requireUser } from '../_shared/auth.ts';
import type { ClaimsVerifier } from '../_shared/auth.ts';
import { maskEmail, randomToken, sha256Hex } from '../_shared/crypto.ts';
import { HttpError } from '../_shared/errors.ts';
import { jsonHandler } from '../_shared/http.ts';
import type { InviteEmailSender } from '../_shared/integrations/email.ts';
import type { Invitation, InviteStore } from './store.ts';

/** App users per household in the MVP (06 §4.11). */
export const MAX_APP_USERS_PER_HOUSEHOLD = 10;
/** Daily create/resend quota (06 §2.7). */
export const DAILY_INVITES = { free: 20, premium: 50 } as const;
/** Burst limit per user across every action, accept included (06 §2.7; S7-03). */
export const INVITE_BURST_PER_MINUTE = 5;

export interface InviteDeps {
  verify: ClaimsVerifier;
  store: InviteStore;
  sendEmail: InviteEmailSender;
  now?: () => Date;
}

export function createInviteHandler(deps: InviteDeps) {
  const now = deps.now ?? (() => new Date());

  const expiry = () => new Date(now().getTime() + INVITE_TTL_DAYS * 86_400_000).toISOString();

  async function enforceDailyQuota(userId: string) {
    const since = new Date(now().getTime() - 86_400_000);
    const [used, premium] = await Promise.all([
      deps.store.invitesCreatedSince(userId, since),
      deps.store.hasPremium(userId),
    ]);
    const limit = premium ? DAILY_INVITES.premium : DAILY_INVITES.free;
    if (used >= limit)
      throw new HttpError('QUOTA_EXCEEDED', 'You have sent the maximum invites for today.', {
        limit,
      });
  }

  /** Owners may invite caregivers and viewers; caregivers may invite viewers only. */
  async function requireInviter(householdId: string, userId: string, role: 'caregiver' | 'viewer') {
    const mine = await deps.store.membership(householdId, userId);
    if (mine === 'owner') return;
    if (mine === 'caregiver' && role === 'viewer') return;
    throw new HttpError('FORBIDDEN', 'Only the household owner can send this invite.');
  }

  async function sendInvite(
    invite: Invitation,
    token: string,
    inviterId: string,
    message?: string,
  ) {
    const [household, inviter] = await Promise.all([
      deps.store.household(invite.household_id),
      deps.store.userProfile(inviterId),
    ]);
    const shareUrl = inviteShareUrl(token);
    try {
      await deps.sendEmail({
        to: invite.email,
        locale: inviter?.locale === 'ur' ? 'ur' : 'en',
        inviterName: inviter?.display_name || 'A family member',
        householdName: household?.name ?? '',
        role: invite.role === 'viewer' ? 'viewer' : 'caregiver',
        shareUrl,
        ...(message ? { message } : {}),
      });
    } catch (err) {
      // The share link still works (WhatsApp fallback), so a failed email does not fail the invite.
      console.error(
        JSON.stringify({ level: 'error', msg: 'invite email failed', error: String(err) }),
      );
    }
    return shareUrl;
  }

  return jsonHandler(
    HouseholdInviteRequest,
    async ({ req, input }): Promise<HouseholdInviteResponse> => {
      const user = await requireUser(req, deps.verify);
      const burst = await deps.store.consumeRateLimit(
        `household-invite:${user.userId}:min`,
        INVITE_BURST_PER_MINUTE,
        60,
      );
      if (!burst.allowed) {
        throw new HttpError('RATE_LIMITED', 'Please wait a minute and try again.', {
          reset_at: burst.reset_at,
        });
      }

      switch (input.action) {
        case 'create': {
          await requireInviter(input.household_id, user.userId, input.role);
          if ((await deps.store.memberEmails(input.household_id)).includes(input.email)) {
            throw new HttpError('ALREADY_MEMBER', 'This person is already in the household.');
          }
          if ((await deps.store.memberCount(input.household_id)) >= MAX_APP_USERS_PER_HOUSEHOLD) {
            throw new HttpError(
              'LIMIT_REACHED',
              'This household has the maximum number of app users.',
              {
                resource: 'household_members',
                limit: MAX_APP_USERS_PER_HOUSEHOLD,
              },
            );
          }
          await enforceDailyQuota(user.userId);

          const token = randomToken();
          const tokenHash = await sha256Hex(token);
          // One open invite per address: a repeated create rotates the token instead of duplicating.
          const existing = await deps.store.pendingInvite(input.household_id, input.email);
          const invite = existing
            ? await deps.store.rotateInvite(existing.id, tokenHash, expiry())
            : await deps.store.insertInvite({
                household_id: input.household_id,
                email: input.email,
                role: input.role,
                invited_by: user.userId,
                expires_at: expiry(),
                token_hash: tokenHash,
              });
          const shareUrl = await sendInvite(invite, token, user.userId, input.message);
          await deps.store.audit({
            actor: user.userId,
            householdId: invite.household_id,
            action: 'insert',
            entity: 'household_invitations',
            entityId: invite.id,
            diff: { role: invite.role },
          });
          return {
            action: 'create',
            invitation_id: invite.id,
            expires_at: invite.expires_at,
            share_url: shareUrl,
          };
        }

        case 'resend': {
          const invite = await deps.store.inviteById(input.invitation_id);
          if (!invite || invite.accepted_at || invite.revoked_at)
            throw new HttpError('INVITE_INVALID', 'This invite is no longer open.');
          await requireInviter(
            invite.household_id,
            user.userId,
            invite.role === 'viewer' ? 'viewer' : 'caregiver',
          );
          await enforceDailyQuota(user.userId);
          const token = randomToken();
          const rotated = await deps.store.rotateInvite(
            invite.id,
            await sha256Hex(token),
            expiry(),
          );
          await sendInvite(rotated, token, user.userId);
          return { action: 'resend', invitation_id: rotated.id, expires_at: rotated.expires_at };
        }

        case 'revoke': {
          const invite = await deps.store.inviteById(input.invitation_id);
          if (!invite) throw new HttpError('NOT_FOUND', 'Invite not found.');
          const mine = await deps.store.membership(invite.household_id, user.userId);
          if (mine !== 'owner' && invite.invited_by !== user.userId) {
            throw new HttpError(
              'FORBIDDEN',
              'Only the owner or the person who sent it can cancel this invite.',
            );
          }
          if (!invite.revoked_at && !invite.accepted_at) {
            await deps.store.revokeInvite(invite.id);
            await deps.store.audit({
              actor: user.userId,
              householdId: invite.household_id,
              action: 'update',
              entity: 'household_invitations',
              entityId: invite.id,
              diff: { revoked: true },
            });
          }
          return { action: 'revoke', invitation_id: invite.id, revoked: true };
        }

        case 'accept': {
          const invite = await deps.store.inviteByTokenHash(await sha256Hex(input.token));
          if (!invite || invite.revoked_at)
            throw new HttpError('INVITE_INVALID', 'This invite link is not valid.');
          const existingRole = await deps.store.membership(invite.household_id, user.userId);
          if (existingRole) {
            throw new HttpError('ALREADY_MEMBER', 'You are already in this household.', {
              household_id: invite.household_id,
              role: existingRole,
            });
          }
          if (invite.accepted_at)
            throw new HttpError('INVITE_INVALID', 'This invite has already been used.');
          if (new Date(invite.expires_at).getTime() <= now().getTime()) {
            throw new HttpError('INVITE_EXPIRED', 'This invite has expired. Invites last 7 days.');
          }
          if (!user.email || user.email.toLowerCase() !== invite.email.toLowerCase()) {
            throw new HttpError(
              'INVITE_EMAIL_MISMATCH',
              'Sign in with the email this invite was sent to.',
              {
                invited_email: maskEmail(invite.email),
              },
            );
          }
          await deps.store.acceptInvite(invite, user.userId);
          await deps.store.audit({
            actor: user.userId,
            householdId: invite.household_id,
            action: 'insert',
            entity: 'household_members',
            entityId: invite.id,
            diff: { role: invite.role, via: 'invitation' },
          });
          return { action: 'accept', household_id: invite.household_id, role: invite.role };
        }
      }
    },
  );
}
