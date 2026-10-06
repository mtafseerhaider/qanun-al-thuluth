import type { Session } from '@supabase/supabase-js';

import { useOnboardingStore } from '@/features/onboarding';
import type { Profile } from '@/lib/auth/profile';
import { queryClient } from '@/lib/query/query-client';
import { qk } from '@/lib/query/query-keys';
import { branchForStatus } from '@/navigation/root-navigator';
import { initialSession, useSessionStore } from '@/stores/use-session-store';

import { applySession } from '../session-sync';

const USER_ID = '00000000-0000-4000-8000-000000000001';

const session = (provider = 'email') =>
  ({
    access_token: 'a',
    refresh_token: 'r',
    user: {
      id: USER_ID,
      email: 'amina@example.com',
      app_metadata: { provider, providers: [provider] },
      last_sign_in_at: '2026-10-06T08:00:00Z',
    },
  }) as unknown as Session;

const profile = (patch: Partial<Profile> = {}): Profile => ({
  id: USER_ID,
  display_name: 'Amina',
  email: 'amina@example.com',
  locale: 'en',
  country_code: 'PK',
  timezone: 'Asia/Karachi',
  tradition_preference: 'shared',
  units: 'metric',
  onboarding_completed_at: null,
  age_attested_at: null,
  ...patch,
});

beforeEach(() => {
  queryClient.clear();
  useSessionStore.setState({ ...initialSession });
  useOnboardingStore.getState().reset();
});

describe('applySession routing', () => {
  it('sends a new user to onboarding and starts their onboarding progress', async () => {
    await applySession(session(), 'signed_in', { fetchProfile: async () => profile() });
    const s = useSessionStore.getState();
    expect(s.status).toBe('needs_age_gate');
    expect(branchForStatus(s.status)).toBe('Onboarding');
    expect(s).toMatchObject({ userId: USER_ID, email: 'amina@example.com', providers: ['email'] });
    expect(useOnboardingStore.getState().userId).toBe(USER_ID);
  });

  it('routes an attested user without onboarding_completed_at to onboarding', async () => {
    await applySession(session(), 'restore', {
      fetchProfile: async () => profile({ age_attested_at: '2026-10-06T08:00:00Z' }),
    });
    expect(useSessionStore.getState().status).toBe('needs_onboarding');
  });

  it('routes a user with onboarding_completed_at to Main', async () => {
    await applySession(session('google'), 'signed_in', {
      fetchProfile: async () =>
        profile({
          age_attested_at: '2026-10-01T08:00:00Z',
          onboarding_completed_at: '2026-10-01T08:10:00Z',
        }),
    });
    const s = useSessionStore.getState();
    expect(s.status).toBe('signed_in');
    expect(branchForStatus(s.status)).toBe('Main');
    expect(s.providers).toEqual(['google']);
    expect(queryClient.getQueryData(qk.profile())).toMatchObject({ id: USER_ID });
  });

  it('falls back to the cached profile of the same user when offline', async () => {
    queryClient.setQueryData(
      qk.profile(),
      profile({ onboarding_completed_at: '2026-10-01T08:10:00Z' }),
    );
    await applySession(session(), 'restore', {
      fetchProfile: async () => {
        throw new Error('Network request failed');
      },
    });
    expect(useSessionStore.getState().status).toBe('signed_in');
  });

  it('ignores a cached profile that belongs to someone else', async () => {
    queryClient.setQueryData(
      qk.profile(),
      profile({ id: 'someone-else', onboarding_completed_at: '2026-10-01T08:10:00Z' }),
    );
    await applySession(session(), 'restore', {
      fetchProfile: async () => {
        throw new Error('Network request failed');
      },
    });
    expect(branchForStatus(useSessionStore.getState().status)).toBe('Onboarding');
  });

  it('signs out when there is no session', async () => {
    await applySession(null, 'restore');
    expect(useSessionStore.getState().status).toBe('signed_out');
  });
});
