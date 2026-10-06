import type { SessionState } from '@/stores/use-session-store';

/** Profile fields that decide the root branch (02 §3.1, 11 §8). */
export interface RoutingProfile {
  onboarding_completed_at: string | null;
  /** 18+ attestation (11 §13); captured on the consents step. */
  age_attested_at: string | null;
}

export function routingFlags(profile: RoutingProfile | null): {
  ageAttested: boolean;
  onboarded: boolean;
} {
  return {
    // Accounts that finished onboarding before the column existed (0017) count as attested; the
    // age gate itself lives in the consents step, which is inside the Onboarding branch.
    ageAttested: Boolean(profile?.age_attested_at) || Boolean(profile?.onboarding_completed_at),
    onboarded: Boolean(profile?.onboarding_completed_at),
  };
}

interface UserLike {
  app_metadata?: { provider?: unknown; providers?: unknown } | null;
  last_sign_in_at?: string | null;
}

export function providersFromUser(user: UserLike | null | undefined): SessionState['providers'] {
  const raw = user?.app_metadata?.providers ?? user?.app_metadata?.provider ?? [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter(
    (p): p is 'email' | 'google' | 'apple' => p === 'email' || p === 'google' || p === 'apple',
  );
}

export function lastAuthenticatedAt(user: UserLike | null | undefined, now = Date.now()): number {
  const parsed = user?.last_sign_in_at ? Date.parse(user.last_sign_in_at) : NaN;
  return Number.isFinite(parsed) ? parsed : now;
}
