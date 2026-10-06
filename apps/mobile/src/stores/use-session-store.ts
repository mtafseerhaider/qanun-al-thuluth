import { appStorage } from '@/lib/storage/mmkv';

import { createStore, resetters } from './create-store';

/**
 * Auth status for routing (09 §5.1). Tokens never live here; supabase-js owns the session.
 * Sprint 0 placeholder: real sign-in arrives in Sprint 1. `enterDevGuest` lets developers reach the
 * Main tabs in development builds; the flag is remembered in MMKV so an RTL reload keeps you there.
 */
export type SessionStatus =
  'initializing' | 'signed_out' | 'needs_age_gate' | 'needs_onboarding' | 'signed_in';

export interface SessionState {
  status: SessionStatus;
  userId: string | null;
  email: string | null;
  providers: Array<'email' | 'google' | 'apple'>;
  lastAuthenticatedAt: number | null;
  locked: boolean;
  pendingInviteToken: string | null;
  isDevGuest: boolean;
}

export interface SessionActions {
  setInitializing(): void;
  setSignedIn(p: {
    userId: string;
    email: string | null;
    providers: SessionState['providers'];
    lastAuthenticatedAt: number;
    profile: { ageAttested: boolean; onboarded: boolean };
  }): void;
  setSignedOut(): void;
  markOnboarded(): void;
  setLocked(locked: boolean): void;
  setPendingInviteToken(token: string | null): void;
  /** Development only: restores the dev-guest session if one was entered before a reload. */
  restore(): void;
  enterDevGuest(): void;
  reset(): void;
}

const DEV_GUEST_KEY = 'session.dev-guest';

export const initialSession: SessionState = {
  status: 'initializing',
  userId: null,
  email: null,
  providers: [],
  lastAuthenticatedAt: null,
  locked: false,
  pendingInviteToken: null,
  isDevGuest: false,
};

export const useSessionStore = createStore<SessionState & SessionActions>('session', (set) => ({
  ...initialSession,
  setInitializing: () => set({ status: 'initializing' }),
  setSignedIn: ({ userId, email, providers, lastAuthenticatedAt, profile }) =>
    set({
      userId,
      email,
      providers,
      lastAuthenticatedAt,
      isDevGuest: false,
      status: !profile.ageAttested
        ? 'needs_age_gate'
        : !profile.onboarded
          ? 'needs_onboarding'
          : 'signed_in',
    }),
  setSignedOut: () => {
    appStorage.remove(DEV_GUEST_KEY);
    set({ ...initialSession, status: 'signed_out' });
  },
  markOnboarded: () => set({ status: 'signed_in' }),
  setLocked: (locked) => set({ locked }),
  setPendingInviteToken: (pendingInviteToken) => set({ pendingInviteToken }),
  restore: () => {
    const devGuest = __DEV__ && appStorage.getString(DEV_GUEST_KEY) === '1';
    set(devGuest ? { status: 'signed_in', isDevGuest: true } : { status: 'signed_out' });
  },
  enterDevGuest: () => {
    if (!__DEV__) return;
    appStorage.set(DEV_GUEST_KEY, '1');
    set({ status: 'signed_in', isDevGuest: true });
  },
  reset: () => {
    appStorage.remove(DEV_GUEST_KEY);
    set({ ...initialSession, status: 'signed_out' });
  },
}));

resetters.add(() => useSessionStore.getState().reset());

export const selectIsSignedIn = (s: SessionState) => s.status === 'signed_in';
