import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { BootScreen } from '@/features/auth';
import { AcceptInviteScreen, InviteCaregiverScreen } from '@/features/household';
import { useSessionStore, type SessionStatus } from '@/stores/use-session-store';

import { AuthStack } from './auth-stack';
import { MainTabs } from './main-tabs';
import { OnboardingStack } from './onboarding-stack';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export type RootBranch = 'Boot' | 'Auth' | 'Onboarding' | 'Main';

/**
 * State-driven root routing (02 §3.1, 11 §8): exactly one branch is mounted for each session status.
 * The status comes from the Supabase session plus `users.onboarding_completed_at` (AuthProvider).
 */
export function branchForStatus(status: SessionStatus): RootBranch {
  switch (status) {
    case 'initializing':
      return 'Boot';
    case 'signed_out':
      return 'Auth';
    case 'needs_age_gate':
    case 'needs_onboarding':
      return 'Onboarding';
    case 'signed_in':
      return 'Main';
  }
}

/** A parked invite opens AcceptInvite once a signed-in branch is mounted (11 §12.3). */
export function shouldOpenAcceptInvite(
  status: SessionStatus,
  token: string | null,
  currentRoute: string | undefined,
): boolean {
  if (!token || currentRoute === 'AcceptInvite') return false;
  return branchForStatus(status) === 'Onboarding' || branchForStatus(status) === 'Main';
}

export function RootNavigator() {
  const { t } = useTranslation('navigation');
  const status = useSessionStore((s) => s.status);
  const branch = branchForStatus(status);
  const signedIn = branch === 'Onboarding' || branch === 'Main';

  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
      {branch === 'Boot' ? <Stack.Screen name="Boot" component={BootScreen} /> : null}
      {branch === 'Auth' ? <Stack.Screen name="Auth" component={AuthStack} /> : null}
      {branch === 'Onboarding' ? (
        <Stack.Screen name="Onboarding" component={OnboardingStack} />
      ) : null}
      {branch === 'Main' ? <Stack.Screen name="Main" component={MainTabs} /> : null}
      {signedIn ? (
        <Stack.Group screenOptions={{ presentation: 'modal', headerShown: true }}>
          <Stack.Screen
            name="AcceptInvite"
            component={AcceptInviteScreen}
            options={{ title: t('screens.acceptInvite') }}
          />
          {branch === 'Main' ? (
            <Stack.Screen
              name="InviteCaregiverModal"
              component={InviteCaregiverScreen}
              options={{ title: t('screens.inviteCaregiver') }}
            />
          ) : null}
        </Stack.Group>
      ) : null}
    </Stack.Navigator>
  );
}
