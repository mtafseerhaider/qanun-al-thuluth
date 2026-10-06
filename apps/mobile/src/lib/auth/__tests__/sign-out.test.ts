import { useSessionStore } from '@/stores/use-session-store';

import { purgeLocalUserData, type PurgeDeps } from '../sign-out';

function makeDeps(overrides: Partial<PurgeDeps> = {}) {
  const calls: string[] = [];
  const step = (name: string) => async (): Promise<void> => {
    calls.push(name);
  };
  const clearMutations = jest.fn(() => calls.push('mutations'));
  const deps: PurgeDeps = {
    queryClient: {
      cancelQueries: jest.fn(async () => void calls.push('cancel')),
      clear: jest.fn(() => void calls.push('queries')),
      getMutationCache: jest.fn(() => ({ clear: clearMutations })) as never,
    },
    clearEncryptedCaches: step('mmkv'),
    clearAnalyticsQueue: () => void calls.push('analytics'),
    resetStores: () => void calls.push('stores'),
    clearSentryUser: () => void calls.push('sentry'),
    signOutOfProviders: step('google'),
    removeStoredSession: step('session'),
    clearPendingInvite: step('invite'),
    ...overrides,
  };
  return { deps, calls };
}

describe('purgeLocalUserData', () => {
  it('clears every user-scoped store in order', async () => {
    const { deps, calls } = makeDeps();
    await purgeLocalUserData({}, deps);
    expect(calls).toEqual([
      'cancel',
      'mutations',
      'queries',
      'mmkv',
      'analytics',
      'stores',
      'sentry',
      'google',
      'session',
      'invite',
    ]);
  });

  it('keeps going when one step fails', async () => {
    const { deps, calls } = makeDeps({
      clearEncryptedCaches: async () => {
        throw new Error('mmkv locked');
      },
    });
    await purgeLocalUserData({}, deps);
    expect(calls).toContain('session');
    expect(calls).toContain('invite');
  });

  it('can keep a parked invite so the invitee can switch accounts', async () => {
    useSessionStore.setState({ pendingInviteToken: 'tok' });
    const { deps, calls } = makeDeps({
      resetStores: () => useSessionStore.getState().reset(),
    });
    await purgeLocalUserData({ keepPendingInvite: true }, deps);
    expect(calls).not.toContain('invite');
    expect(useSessionStore.getState().pendingInviteToken).toBe('tok');
  });
});
