import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { InvitableRole } from '@shared/contracts';

import { track } from '@/lib/analytics/track';
import { qk } from '@/lib/query/query-keys';
import { isSupabaseConfigured } from '@/lib/env';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';
import { useSessionStore } from '@/stores/use-session-store';

import {
  changeHouseholdRole,
  fetchHousehold,
  fetchHouseholdPeople,
  fetchMyHouseholds,
  fetchPendingInvitations,
  removeHouseholdPerson,
} from '../api/households-api';
import { acceptInvite, createInvite, resendInvite, revokeInvite } from '../api/invite-api';

/** Memberships with role (09 §3 `qk.households()`); reconciles the active household on success. */
export function useMyHouseholds() {
  const userId = useSessionStore((s) => s.userId);
  return useQuery({
    queryKey: qk.households(),
    queryFn: async () => {
      const rows = await fetchMyHouseholds(userId as string);
      useActiveHouseholdStore.getState().reconcile(rows);
      return rows;
    },
    enabled: Boolean(userId) && isSupabaseConfigured,
  });
}

export function useHousehold(householdId: string | null) {
  return useQuery({
    queryKey: qk.household(householdId ?? 'none').detail(),
    queryFn: () => fetchHousehold(householdId as string),
    enabled: Boolean(householdId) && isSupabaseConfigured,
  });
}

export function useHouseholdPeople(householdId: string | null) {
  return useQuery({
    queryKey: qk.household(householdId ?? 'none').members(),
    queryFn: () => fetchHouseholdPeople(householdId as string),
    enabled: Boolean(householdId) && isSupabaseConfigured,
  });
}

export function usePendingInvitations(householdId: string | null, enabled = true) {
  return useQuery({
    queryKey: qk.household(householdId ?? 'none').invitations(),
    queryFn: () => fetchPendingInvitations(householdId as string),
    enabled: enabled && Boolean(householdId) && isSupabaseConfigured,
  });
}

export function useCreateInvite(householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['household-invite', 'create'],
    mutationFn: (v: { email: string; role: InvitableRole; idempotencyKey: string }) =>
      createInvite({ householdId, email: v.email, role: v.role }, v.idempotencyKey),
    onSuccess: (_res, v) => {
      track('invite_sent', { role: v.role });
      void qc.invalidateQueries({ queryKey: qk.household(householdId).invitations() });
    },
  });
}

export function useResendInvite(householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['household-invite', 'resend'],
    mutationFn: (invitationId: string) => resendInvite(invitationId),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: qk.household(householdId).invitations() }),
  });
}

export function useRevokeInvite(householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['household-invite', 'revoke'],
    mutationFn: (invitationId: string) => revokeInvite(invitationId),
    onSuccess: () => {
      track('invite_revoked', {});
      void qc.invalidateQueries({ queryKey: qk.household(householdId).invitations() });
    },
  });
}

/** Accepts an invitation, then makes the joined household active (11 §12.3). */
export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['household-invite', 'accept'],
    mutationFn: (token: string) => acceptInvite(token),
    onSuccess: (res) => {
      track('invite_accepted', { role: res.role });
      useActiveHouseholdStore.getState().setActiveHousehold(res.household_id, res.role);
      void qc.invalidateQueries({ queryKey: qk.households() });
    },
  });
}

/** Owner removes someone's access, or the current user leaves (FR-HH-05). */
export function useRemoveHouseholdPerson(householdId: string) {
  const qc = useQueryClient();
  const userId = useSessionStore((s) => s.userId);
  return useMutation({
    mutationKey: ['household-members', 'remove'],
    mutationFn: (person: { id: string; user_id: string }) => removeHouseholdPerson(person.id),
    onSuccess: (_r, person) => {
      const self = person.user_id === userId;
      track('household_member_removed', { self });
      if (self) {
        // Leaving: drop that household's cached data and pick another active household.
        qc.removeQueries({ queryKey: qk.household(householdId).all() });
        useActiveHouseholdStore.getState().reset();
      }
      void qc.invalidateQueries({ queryKey: qk.households() });
      void qc.invalidateQueries({ queryKey: qk.household(householdId).members() });
    },
  });
}

export function useChangeHouseholdRole(householdId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['household-members', 'role'],
    mutationFn: (v: { id: string; role: 'caregiver' | 'viewer' }) =>
      changeHouseholdRole(v.id, v.role),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.household(householdId).members() }),
  });
}
