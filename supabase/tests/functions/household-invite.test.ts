import { assert, assertEquals, assertMatch } from 'jsr:@std/assert@1';
import type { HouseholdRole } from '@thuluth/shared';

import { sha256Hex } from '../../functions/_shared/crypto.ts';
import type { InviteEmail } from '../../functions/_shared/integrations/email.ts';
import {
  createInviteHandler,
  INVITE_BURST_PER_MINUTE,
  MAX_APP_USERS_PER_HOUSEHOLD,
} from '../../functions/household-invite/handler.ts';
import type { Invitation, InviteStore } from '../../functions/household-invite/store.ts';

const HH = '00000000-0000-4000-b000-000000000001';
const OWNER = '00000000-0000-4000-a000-000000000001';
const CAREGIVER = '00000000-0000-4000-a000-000000000002';
const UZMA = '00000000-0000-4000-a000-000000000003';
const NOW = new Date('2026-10-06T08:00:00Z');

const users: Record<string, { email: string; jwt: string }> = {
  [OWNER]: { email: 'tafseer@example.com', jwt: 'owner' },
  [CAREGIVER]: { email: 'nani@example.com', jwt: 'caregiver' },
  [UZMA]: { email: 'uzma@example.com', jwt: 'uzma' },
};

function memoryStore() {
  const members = new Map<string, HouseholdRole>([
    [`${HH}:${OWNER}`, 'owner'],
    [`${HH}:${CAREGIVER}`, 'caregiver'],
  ]);
  const invites: (Invitation & { token_hash: string; accepted_by?: string })[] = [];
  const audits: string[] = [];
  let extraMembers = 0;
  const rateCounts = new Map<string, number>();
  const store: InviteStore = {
    membership: async (h, u) => members.get(`${h}:${u}`) ?? null,
    household: async (h) => (h === HH ? { id: HH, name: 'Lahore Family' } : null),
    memberEmails: async (h) =>
      [...members.keys()].filter((k) => k.startsWith(h)).map((k) => users[k.split(':')[1]!]!.email),
    memberCount: async (h) =>
      [...members.keys()].filter((k) => k.startsWith(h)).length + extraMembers,
    invitesCreatedSince: async () => 0,
    hasPremium: async () => false,
    consumeRateLimit: async (key, limit) => {
      const count = (rateCounts.get(key) ?? 0) + 1;
      rateCounts.set(key, count);
      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        reset_at: NOW.toISOString(),
      };
    },
    userProfile: async () => ({ display_name: 'Tafseer', locale: 'en' }),
    pendingInvite: async (h, e) =>
      invites.find(
        (i) => i.household_id === h && i.email === e && !i.accepted_at && !i.revoked_at,
      ) ?? null,
    inviteById: async (id) => invites.find((i) => i.id === id) ?? null,
    inviteByTokenHash: async (t) => invites.find((i) => i.token_hash === t) ?? null,
    insertInvite: async (row) => {
      const invite = { ...row, id: crypto.randomUUID(), accepted_at: null, revoked_at: null };
      invites.push(invite);
      return invite;
    },
    rotateInvite: async (id, tokenHash, expiresAt) => {
      const i = invites.find((x) => x.id === id)!;
      Object.assign(i, { token_hash: tokenHash, expires_at: expiresAt });
      return i;
    },
    revokeInvite: async (id) => {
      invites.find((x) => x.id === id)!.revoked_at = NOW.toISOString();
    },
    acceptInvite: async (invite, userId) => {
      members.set(`${invite.household_id}:${userId}`, invite.role);
      Object.assign(
        invites.find((x) => x.id === invite.id)!,
        { accepted_at: NOW.toISOString(), accepted_by: userId },
      );
    },
    audit: async (e) => {
      audits.push(`${e.action}:${e.entity}`);
    },
  };
  return {
    store,
    invites,
    members,
    audits,
    rateCounts,
    addMembers: (n: number) => (extraMembers += n),
  };
}

function setup(now = () => NOW) {
  const mem = memoryStore();
  const emails: InviteEmail[] = [];
  const handler = createInviteHandler({
    verify: async (jwt) => {
      const entry = Object.entries(users).find(([, u]) => u.jwt === jwt);
      return entry ? { sub: entry[0], email: entry[1].email } : null;
    },
    store: mem.store,
    sendEmail: async (e) => {
      emails.push(e);
      return { sent: true };
    },
    now,
  });
  const call = async (jwt: string, body: unknown) => {
    const res = await handler(
      new Request('http://localhost/household-invite', {
        method: 'POST',
        headers: { authorization: `Bearer ${jwt}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    return { status: res.status, json: await res.json() };
  };
  return { ...mem, emails, call };
}

const tokenOf = (shareUrl: string) => shareUrl.split('/invite/')[1]!;

Deno.test('owner invites, invitee accepts with the matching email', async () => {
  const t = setup();
  const created = await t.call('owner', {
    action: 'create',
    household_id: HH,
    email: 'Uzma@Example.com',
    role: 'caregiver',
  });
  assertEquals(created.status, 200);
  assertMatch(created.json.share_url, /^https:\/\/thuluth\.app\/invite\/[A-Za-z0-9_-]{43}$/);
  assertEquals(t.emails[0]?.to, 'uzma@example.com');
  // Only the hash is stored.
  const token = tokenOf(created.json.share_url);
  assertEquals(t.invites[0]?.token_hash, await sha256Hex(token));
  assert(!JSON.stringify(t.invites).includes(token));

  const accepted = await t.call('uzma', { action: 'accept', token });
  assertEquals(accepted.json, { action: 'accept', household_id: HH, role: 'caregiver' });
  assertEquals(t.members.get(`${HH}:${UZMA}`), 'caregiver');
  assertEquals(t.audits, ['insert:household_invitations', 'insert:household_members']);
});

Deno.test('caregivers may invite viewers only', async () => {
  const t = setup();
  const asCaregiver = await t.call('caregiver', {
    action: 'create',
    household_id: HH,
    email: 'a@b.co',
    role: 'caregiver',
  });
  assertEquals(asCaregiver.json.error.code, 'FORBIDDEN');
  const viewer = await t.call('caregiver', {
    action: 'create',
    household_id: HH,
    email: 'a@b.co',
    role: 'viewer',
  });
  assertEquals(viewer.status, 200);
  const outsider = await t.call('uzma', {
    action: 'create',
    household_id: HH,
    email: 'a@b.co',
    role: 'viewer',
  });
  assertEquals(outsider.json.error.code, 'FORBIDDEN');
});

Deno.test('a repeated create rotates the open invite instead of duplicating it', async () => {
  const t = setup();
  const first = await t.call('owner', {
    action: 'create',
    household_id: HH,
    email: 'uzma@example.com',
    role: 'viewer',
  });
  const second = await t.call('owner', {
    action: 'create',
    household_id: HH,
    email: 'uzma@example.com',
    role: 'viewer',
  });
  assertEquals(first.json.invitation_id, second.json.invitation_id);
  assertEquals(t.invites.length, 1);
  // The first link no longer works.
  const old = await t.call('uzma', { action: 'accept', token: tokenOf(first.json.share_url) });
  assertEquals(old.json.error.code, 'INVITE_INVALID');
});

Deno.test('rejects inviting an existing member and enforces the app-user cap', async () => {
  const t = setup();
  const dup = await t.call('owner', {
    action: 'create',
    household_id: HH,
    email: 'nani@example.com',
    role: 'viewer',
  });
  assertEquals(dup.json.error.code, 'ALREADY_MEMBER');
  t.addMembers(MAX_APP_USERS_PER_HOUSEHOLD);
  const full = await t.call('owner', {
    action: 'create',
    household_id: HH,
    email: 'x@y.co',
    role: 'viewer',
  });
  assertEquals(full.status, 409);
  assertEquals(full.json.error.code, 'LIMIT_REACHED');
});

Deno.test('accept fails on email mismatch with a masked address', async () => {
  const t = setup();
  const created = await t.call('owner', {
    action: 'create',
    household_id: HH,
    email: 'someone@gmail.com',
    role: 'viewer',
  });
  const res = await t.call('uzma', { action: 'accept', token: tokenOf(created.json.share_url) });
  assertEquals(res.status, 403);
  assertEquals(res.json.error.code, 'INVITE_EMAIL_MISMATCH');
  assertEquals(res.json.error.details.invited_email, 's***@gmail.com');
});

Deno.test('accept fails after seven days', async () => {
  let now = NOW;
  const t = setup(() => now);
  const created = await t.call('owner', {
    action: 'create',
    household_id: HH,
    email: 'uzma@example.com',
    role: 'viewer',
  });
  now = new Date(NOW.getTime() + 7 * 86_400_000 + 1000);
  const res = await t.call('uzma', { action: 'accept', token: tokenOf(created.json.share_url) });
  assertEquals(res.status, 410);
  assertEquals(res.json.error.code, 'INVITE_EXPIRED');
});

Deno.test('revoked invites cannot be accepted; only owner or inviter can revoke', async () => {
  const t = setup();
  const created = await t.call('owner', {
    action: 'create',
    household_id: HH,
    email: 'uzma@example.com',
    role: 'viewer',
  });
  const id = created.json.invitation_id;
  const byOutsider = await t.call('uzma', { action: 'revoke', invitation_id: id });
  assertEquals(byOutsider.json.error.code, 'FORBIDDEN');
  const revoked = await t.call('owner', { action: 'revoke', invitation_id: id });
  assertEquals(revoked.json.revoked, true);
  const res = await t.call('uzma', { action: 'accept', token: tokenOf(created.json.share_url) });
  assertEquals(res.json.error.code, 'INVITE_INVALID');
});

Deno.test('resend issues a new link and keeps the invite id', async () => {
  const t = setup();
  const created = await t.call('owner', {
    action: 'create',
    household_id: HH,
    email: 'uzma@example.com',
    role: 'viewer',
  });
  const resent = await t.call('owner', {
    action: 'resend',
    invitation_id: created.json.invitation_id,
  });
  assertEquals(resent.json.invitation_id, created.json.invitation_id);
  assertEquals(t.emails.length, 2);
  assert(t.emails[0]!.shareUrl !== t.emails[1]!.shareUrl);
});

Deno.test('accepting again as a member reports ALREADY_MEMBER with the household', async () => {
  const t = setup();
  const created = await t.call('owner', {
    action: 'create',
    household_id: HH,
    email: 'uzma@example.com',
    role: 'viewer',
  });
  const token = tokenOf(created.json.share_url);
  await t.call('uzma', { action: 'accept', token });
  const again = await t.call('uzma', { action: 'accept', token });
  assertEquals(again.json.error.code, 'ALREADY_MEMBER');
  assertEquals(again.json.error.details.household_id, HH);
});

Deno.test('S7-03: every action, accept included, has a per-user burst limit', async () => {
  const t = setup();
  for (let i = 0; i < INVITE_BURST_PER_MINUTE; i++) {
    const r = await t.call('uzma', { action: 'accept', token: 'x'.repeat(43) });
    assertEquals(r.json.error.code, 'INVITE_INVALID');
  }
  const limited = await t.call('uzma', { action: 'accept', token: 'x'.repeat(43) });
  assertEquals(limited.status, 429);
  assertEquals(limited.json.error.code, 'RATE_LIMITED');
  assertEquals(t.rateCounts.get(`household-invite:${UZMA}:min`), INVITE_BURST_PER_MINUTE + 1);
});
