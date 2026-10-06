import * as Crypto from 'expo-crypto';
import type { z } from 'zod';

import {
  HouseholdInviteRequest,
  HouseholdInviteResponse,
  type InvitableRole,
} from '@shared/contracts';

import { invokeEdge } from '@/lib/supabase/edge';

/** `household-invite` (06 §4.11). `create` and `resend` require an Idempotency-Key (06 §2.4). */
type Action = HouseholdInviteResponse['action'];
type ResponseFor<A extends Action> = Extract<HouseholdInviteResponse, { action: A }>;

async function call<A extends Action>(
  body: HouseholdInviteRequest & { action: A },
  idempotencyKey?: string,
): Promise<ResponseFor<A>> {
  const request = HouseholdInviteRequest.parse(body);
  const schema = HouseholdInviteResponse as unknown as z.ZodType<
    ResponseFor<A>,
    z.ZodTypeDef,
    unknown
  >;
  return invokeEdge('household-invite', request, schema, {
    ...(idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {}),
  });
}

export function newIdempotencyKey(): string {
  return Crypto.randomUUID();
}

export function createInvite(
  input: { householdId: string; email: string; role: InvitableRole; message?: string },
  idempotencyKey: string = newIdempotencyKey(),
) {
  return call(
    {
      action: 'create',
      household_id: input.householdId,
      email: input.email,
      role: input.role,
      ...(input.message ? { message: input.message } : {}),
    },
    idempotencyKey,
  );
}

export function resendInvite(invitationId: string) {
  return call({ action: 'resend', invitation_id: invitationId }, newIdempotencyKey());
}

export function revokeInvite(invitationId: string) {
  return call({ action: 'revoke', invitation_id: invitationId });
}

export function acceptInvite(token: string) {
  return call({ action: 'accept', token });
}
