import type { Session } from '@supabase/supabase-js';

import { SUPPORTED_LOCALES } from '@shared';

import { fetchMyHouseholds } from '@/features/household';
import { useOnboardingStore } from '@/features/onboarding';
import { setAnalyticsContext, track } from '@/lib/analytics/track';
import { registerDevice } from '@/lib/auth/device-registration';
import { fetchProfile, type Profile } from '@/lib/auth/profile';
import { lastAuthenticatedAt, providersFromUser, routingFlags } from '@/lib/auth/session-status';
import { changeLocale } from '@/lib/i18n/i18n';
import { queryClient } from '@/lib/query/query-client';
import { qk } from '@/lib/query/query-keys';
import { setSentryUser } from '@/lib/sentry/init';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';
import { usePreferencesStore, type AppLocale } from '@/stores/use-preferences-store';
import { useSessionStore } from '@/stores/use-session-store';

export type SignInMethod = 'restore' | 'signed_in';

/**
 * Turns a Supabase session into routing state (11 §8) and runs post-auth wiring (11 §9). Offline or
 * a lagging `users` row falls back to the persisted `qk.profile()` cache for the same user.
 */
export async function applySession(
  session: Session | null,
  method: SignInMethod,
  deps: { fetchProfile: typeof fetchProfile } = { fetchProfile },
): Promise<void> {
  const store = useSessionStore.getState();
  if (!session) {
    if (__DEV__ && store.isDevGuest) return;
    store.restore();
    return;
  }

  const user = session.user;
  let profile: Profile | null = null;
  try {
    profile = await deps.fetchProfile(user.id);
    queryClient.setQueryData(qk.profile(), profile);
  } catch {
    // Offline or a lagging `users` row: fall back to the cached profile for the same user. With
    // neither, the user lands in onboarding, which is resumable and re-checks the server flag.
    const cached = queryClient.getQueryData<Profile>(qk.profile());
    profile = cached && cached.id === user.id ? cached : null;
  }

  const flags = routingFlags(profile);
  store.setSignedIn({
    userId: user.id,
    email: user.email ?? null,
    providers: providersFromUser(user),
    lastAuthenticatedAt: lastAuthenticatedAt(user),
    profile: flags,
  });
  if (!flags.onboarded) useOnboardingStore.getState().begin(user.id);

  const signedInWith = providersFromUser({
    app_metadata: { provider: user.app_metadata.provider },
  })[0];
  postAuthWiring(user.id, profile, method === 'restore' ? 'restore' : (signedInWith ?? 'email'));
}

/** Non-blocking steps (11 §9 steps 2, 3, 6, 7, 10); failures never block routing. */
function postAuthWiring(
  userId: string,
  profile: Profile | null,
  method: 'restore' | 'email' | 'google' | 'apple',
): void {
  setSentryUser(userId);
  if (profile) {
    usePreferencesStore.getState().hydrateFromProfile(profile);
    const locale = profile.locale as AppLocale;
    const prefs = usePreferencesStore.getState();
    if (
      method !== 'restore' &&
      locale !== prefs.locale &&
      (SUPPORTED_LOCALES as readonly string[]).includes(locale)
    )
      void changeLocale(locale);
  }
  void registerDevice(userId);
  void fetchMyHouseholds(userId)
    .then((rows) => {
      queryClient.setQueryData(qk.households(), rows);
      useActiveHouseholdStore.getState().reconcile(rows);
      setAnalyticsContext({ householdId: useActiveHouseholdStore.getState().activeHouseholdId });
    })
    .catch(() => undefined);
  track('auth_signed_in', { method });
}
