import { useEffect, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { restoreParkedInviteToken } from '@/lib/auth/pending-invite';
import { isUserInitiatedSignOut, signOut } from '@/lib/auth/sign-out';
import { queryClient } from '@/lib/query/query-client';
import { qk } from '@/lib/query/query-keys';
import { supabase } from '@/lib/supabase/client';
import { useSessionStore } from '@/stores/use-session-store';

import { applySession } from '../auth/session-sync';

/**
 * Drives the session store from Supabase auth events (11 §8, 24 S1-06). supabase-js restores the
 * session from secure storage and emits INITIAL_SESSION; handlers are deferred with setTimeout so no
 * Supabase call runs inside the auth callback (supabase-js deadlock guidance). Without a configured
 * backend the dev-guest path keeps working via `restore()`.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    void restoreParkedInviteToken();
    const client = supabase;
    if (!client) {
      if (useSessionStore.getState().status === 'initializing')
        useSessionStore.getState().restore();
      return undefined;
    }

    const { data } = client.auth.onAuthStateChange((event, session) => {
      setTimeout(() => {
        switch (event) {
          case 'INITIAL_SESSION':
            void applySession(session, 'restore');
            break;
          case 'SIGNED_IN': {
            const s = useSessionStore.getState();
            // SIGNED_IN also fires on refocus and token refresh in some versions; ignore repeats.
            if (session && s.userId === session.user.id && s.status !== 'signed_out') break;
            void applySession(session, 'signed_in');
            break;
          }
          case 'USER_UPDATED':
            void queryClient.invalidateQueries({ queryKey: qk.profile() });
            break;
          case 'SIGNED_OUT':
            if (!isUserInitiatedSignOut() && useSessionStore.getState().userId)
              void signOut({ forced: true, keepPendingInvite: true });
            else if (useSessionStore.getState().status === 'initializing')
              useSessionStore.getState().restore();
            break;
          default:
            break;
        }
      }, 0);
    });

    // Refresh tokens only while foregrounded (supabase-js React Native guidance).
    if (AppState.currentState === 'active') void client.auth.startAutoRefresh();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void client.auth.startAutoRefresh();
      else void client.auth.stopAutoRefresh();
    });

    return () => {
      data.subscription.unsubscribe();
      sub.remove();
    };
  }, []);

  return children;
}
