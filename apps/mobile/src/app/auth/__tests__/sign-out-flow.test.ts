import { useOnboardingStore } from '@/features/onboarding';
import { signOut } from '@/lib/auth/sign-out';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';
import { useSessionStore } from '@/stores/use-session-store';

describe('signOut', () => {
  it('resets user stores and lands signed out (no backend configured)', async () => {
    useSessionStore.setState({ status: 'signed_in', userId: 'u1', email: 'a@b.co' });
    useActiveHouseholdStore.getState().setActiveHousehold('hh-1', 'owner');
    useOnboardingStore.getState().begin('u1');
    await signOut();
    expect(useSessionStore.getState()).toMatchObject({
      status: 'signed_out',
      userId: null,
      email: null,
    });
    expect(useActiveHouseholdStore.getState().activeHouseholdId).toBeNull();
    expect(useOnboardingStore.getState().userId).toBeNull();
  });
});
