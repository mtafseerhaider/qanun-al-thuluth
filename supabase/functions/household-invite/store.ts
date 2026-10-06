import type { SupabaseClient } from '@supabase/supabase-js';
import type { HouseholdRole } from '@thuluth/shared';

import { fromPostgrestError } from '../_shared/errors.ts';
import type { PgErrorLike } from '../_shared/errors.ts';

export interface Invitation {
  id: string;
  household_id: string;
  email: string;
  role: HouseholdRole;
  invited_by: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

/** Data access for `household-invite`, so the handler can be tested without a database. */
export interface InviteStore {
  membership(householdId: string, userId: string): Promise<HouseholdRole | null>;
  household(householdId: string): Promise<{ id: string; name: string } | null>;
  memberEmails(householdId: string): Promise<string[]>;
  memberCount(householdId: string): Promise<number>;
  invitesCreatedSince(userId: string, since: Date): Promise<number>;
  hasPremium(userId: string): Promise<boolean>;
  userProfile(userId: string): Promise<{ display_name: string; locale: string } | null>;
  pendingInvite(householdId: string, email: string): Promise<Invitation | null>;
  inviteById(id: string): Promise<Invitation | null>;
  inviteByTokenHash(tokenHash: string): Promise<Invitation | null>;
  insertInvite(
    row: Omit<Invitation, 'id' | 'accepted_at' | 'revoked_at'> & { token_hash: string },
  ): Promise<Invitation>;
  rotateInvite(id: string, tokenHash: string, expiresAt: string): Promise<Invitation>;
  revokeInvite(id: string): Promise<void>;
  acceptInvite(invite: Invitation, userId: string): Promise<void>;
  audit(entry: {
    actor: string;
    householdId: string;
    action: string;
    entity: string;
    entityId: string;
    diff: Record<string, unknown>;
  }): Promise<void>;
}

const INVITE_COLUMNS =
  'id, household_id, email, role, invited_by, expires_at, accepted_at, revoked_at';

function check<T>(result: { data: T; error: PgErrorLike | null }): T {
  if (result.error) throw fromPostgrestError(result.error);
  return result.data;
}

/** Service-role implementation. Every write sets `household_id` explicitly (06 §2.2). */
export function supabaseInviteStore(admin: SupabaseClient): InviteStore {
  return {
    async membership(householdId, userId) {
      const data = check(
        await admin
          .from('household_members')
          .select('role')
          .eq('household_id', householdId)
          .eq('user_id', userId)
          .is('deleted_at', null)
          .maybeSingle(),
      );
      return (data?.role as HouseholdRole | undefined) ?? null;
    },
    async household(householdId) {
      return check(
        await admin
          .from('households')
          .select('id, name')
          .eq('id', householdId)
          .is('deleted_at', null)
          .maybeSingle(),
      );
    },
    async memberEmails(householdId) {
      const data = check(
        await admin
          .from('household_members')
          .select('user:users(email)')
          .eq('household_id', householdId)
          .is('deleted_at', null),
      ) as unknown as { user: { email: string | null } | null }[];
      return data.map((r) => r.user?.email?.toLowerCase() ?? '').filter(Boolean);
    },
    async memberCount(householdId) {
      const { count, error } = await admin
        .from('household_members')
        .select('id', { count: 'exact', head: true })
        .eq('household_id', householdId)
        .is('deleted_at', null);
      if (error) throw fromPostgrestError(error);
      return count ?? 0;
    },
    async invitesCreatedSince(userId, since) {
      const { count, error } = await admin
        .from('household_invitations')
        .select('id', { count: 'exact', head: true })
        .eq('invited_by', userId)
        .gte('updated_at', since.toISOString());
      if (error) throw fromPostgrestError(error);
      return count ?? 0;
    },
    async hasPremium(userId) {
      return check(await admin.rpc('has_premium', { p_user_id: userId })) === true;
    },
    async userProfile(userId) {
      return check(
        await admin.from('users').select('display_name, locale').eq('id', userId).maybeSingle(),
      );
    },
    async pendingInvite(householdId, email) {
      return check(
        await admin
          .from('household_invitations')
          .select(INVITE_COLUMNS)
          .eq('household_id', householdId)
          .eq('email', email)
          .is('accepted_at', null)
          .is('revoked_at', null)
          .maybeSingle(),
      ) as Invitation | null;
    },
    async inviteById(id) {
      return check(
        await admin.from('household_invitations').select(INVITE_COLUMNS).eq('id', id).maybeSingle(),
      ) as Invitation | null;
    },
    async inviteByTokenHash(tokenHash) {
      return check(
        await admin
          .from('household_invitations')
          .select(INVITE_COLUMNS)
          .eq('token_hash', tokenHash)
          .maybeSingle(),
      ) as Invitation | null;
    },
    async insertInvite(row) {
      return check(
        await admin.from('household_invitations').insert(row).select(INVITE_COLUMNS).single(),
      ) as Invitation;
    },
    async rotateInvite(id, tokenHash, expiresAt) {
      return check(
        await admin
          .from('household_invitations')
          .update({ token_hash: tokenHash, expires_at: expiresAt })
          .eq('id', id)
          .select(INVITE_COLUMNS)
          .single(),
      ) as Invitation;
    },
    async revokeInvite(id) {
      check(
        await admin
          .from('household_invitations')
          .update({ revoked_at: new Date().toISOString() })
          .eq('id', id),
      );
    },
    async acceptInvite(invite, userId) {
      // Atomic: locks the invitation, re-checks it is open, inserts the membership, marks it accepted.
      check(
        await admin.rpc('accept_household_invitation', {
          p_invitation_id: invite.id,
          p_user_id: userId,
        }),
      );
    },
    async audit(e) {
      check(
        await admin.from('audit_log').insert({
          actor_user_id: e.actor,
          household_id: e.householdId,
          action: e.action,
          entity: e.entity,
          entity_id: e.entityId,
          diff: e.diff,
        }),
      );
    },
  };
}
