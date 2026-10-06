import type { QueryClient } from '@tanstack/react-query';

import { analytics } from '@/lib/analytics/track';
import { queryClient } from '@/lib/query/query-client';
import { setSentryUser } from '@/lib/sentry/init';
import { getSensitiveStorage } from '@/lib/storage/sensitive-key';
import { AUTH_STORAGE_KEY, supabase } from '@/lib/supabase/client';
import { secureSessionStorage } from '@/lib/supabase/secure-session-storage';
import { resetAllStores } from '@/stores/reset-all-stores';
import { useSessionStore } from '@/stores/use-session-store';

import { unregisterDevice } from './device-registration';
import { signOutOfGoogle } from './google';
import { clearParkedInviteToken } from './pending-invite';

/** Everything purgeLocalUserData touches, injectable for tests (11 §11.2). */
export interface PurgeDeps {
  queryClient: Pick<QueryClient, 'cancelQueries' | 'clear' | 'getMutationCache'>;
  clearEncryptedCaches: () => Promise<void>;
  clearAnalyticsQueue: () => void;
  resetStores: () => void;
  clearSentryUser: () => void;
  signOutOfProviders: () => Promise<void>;
  removeStoredSession: () => Promise<void>;
  clearPendingInvite: () => Promise<void>;
}

export const defaultPurgeDeps: PurgeDeps = {
  queryClient,
  clearEncryptedCaches: async () => {
    const s = await getSensitiveStorage();
    s.queryCache.clearAll();
    s.drafts.clearAll();
  },
  clearAnalyticsQueue: () => analytics.clear(),
  resetStores: resetAllStores,
  clearSentryUser: () => setSentryUser(null),
  signOutOfProviders: signOutOfGoogle,
  removeStoredSession: () => secureSessionStorage.removeItem(AUTH_STORAGE_KEY),
  clearPendingInvite: clearParkedInviteToken,
};

const settle = async (fn: () => unknown) => {
  try {
    await fn();
  } catch {
    // Each purge step is independent: one failure must not leave the rest of the data behind.
  }
};

/**
 * Local purge shared by every sign-out path: React Query memory and persisted cache, encrypted MMKV
 * instances, the analytics queue, user stores, Sentry user, provider sessions and the stored session.
 * Device preferences (theme, locale) and the install marker are kept.
 */
export async function purgeLocalUserData(
  opts: { keepPendingInvite?: boolean } = {},
  deps: PurgeDeps = defaultPurgeDeps,
): Promise<void> {
  const invite = useSessionStore.getState().pendingInviteToken;
  await settle(() => deps.queryClient.cancelQueries());
  await settle(() => deps.queryClient.getMutationCache().clear());
  await settle(() => deps.queryClient.clear());
  await settle(deps.clearEncryptedCaches);
  await settle(deps.clearAnalyticsQueue);
  await settle(deps.resetStores);
  await settle(deps.clearSentryUser);
  await settle(deps.signOutOfProviders);
  await settle(deps.removeStoredSession);
  if (opts.keepPendingInvite && invite) useSessionStore.getState().setPendingInviteToken(invite);
  else await settle(deps.clearPendingInvite);
}

let userInitiated = false;

/** True while signOut() is running, so AuthProvider can tell a forced SIGNED_OUT from ours. */
export function isUserInitiatedSignOut(): boolean {
  return userInitiated;
}

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<void>((resolve) => setTimeout(resolve, ms))]);

/**
 * Sign-out sequence (11 §11.1, §11.3). User-initiated: flush analytics while the JWT is still valid,
 * delete this device's `devices` row, revoke the session locally, then purge. Forced (refresh token
 * revoked, account deleted): skip server calls and purge.
 */
export async function signOut(
  opts: { forced?: boolean; keepPendingInvite?: boolean } = {},
): Promise<void> {
  userInitiated = true;
  try {
    if (!opts.forced && supabase) {
      await settle(() => withTimeout(analytics.flush(), 2000));
      await settle(() => unregisterDevice());
      await settle(() => supabase?.auth.signOut({ scope: 'local' }));
    }
    await purgeLocalUserData({ keepPendingInvite: opts.keepPendingInvite ?? false });
  } finally {
    userInitiated = false;
    useSessionStore.getState().setSignedOut();
  }
}
