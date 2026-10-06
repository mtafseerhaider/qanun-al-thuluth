import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { BootScreen } from '@/features/auth';
import { useSessionStore, type SessionStatus } from '@/stores/use-session-store';

import { AuthStack } from './auth-stack';
import { MainTabs } from './main-tabs';
import { OnboardingStack } from './onboarding-stack';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export type RootBranch = 'Boot' | 'Auth' | 'Onboarding' | 'Main';

/** State-driven root routing (02 §3.1): exactly one branch is mounted for each session status. */
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

export function RootNavigator() {
  const status = useSessionStore((s) => s.status);
  const branch = branchForStatus(status);

  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
      {branch === 'Boot' ? <Stack.Screen name="Boot" component={BootScreen} /> : null}
      {branch === 'Auth' ? <Stack.Screen name="Auth" component={AuthStack} /> : null}
      {branch === 'Onboarding' ? (
        <Stack.Screen name="Onboarding" component={OnboardingStack} />
      ) : null}
      {branch === 'Main' ? <Stack.Screen name="Main" component={MainTabs} /> : null}
    </Stack.Navigator>
  );
}
