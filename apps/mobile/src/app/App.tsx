import 'react-native-gesture-handler';

import { NavigationContainer } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { flushPendingNotification } from '@/features/notifications';
import { useSensoryCalmSuggestion } from '@/features/settings';
import { markStartup } from '@/lib/perf/startup';
import { registerNavigationContainer, Sentry } from '@/lib/sentry/init';
import { linking } from '@/navigation/linking';
import { navigationRef } from '@/navigation/navigation-ref';
import { RootNavigator, shouldOpenAcceptInvite } from '@/navigation/root-navigator';
import { trackScreenChange } from '@/navigation/screen-tracking';
import { useSessionStore } from '@/stores/use-session-store';
import { useNavigationTheme } from '@/theme/use-theme-colors';

import { bootstrap } from './bootstrap';
import { RootErrorBoundary } from './error-boundary';
import { AuthProvider } from './providers/auth-provider';
import { I18nProvider } from './providers/i18n-provider';
import { QueryProvider } from './providers/query-provider';
import { ThemeProvider } from './providers/theme-provider';
import { SplashGate } from './splash-gate';

bootstrap();

/** Opens AcceptInvite once a parked invite token meets a signed-in branch (11 §12.3). */
function usePendingInviteNavigation(ready: boolean) {
  const status = useSessionStore((s) => s.status);
  const token = useSessionStore((s) => s.pendingInviteToken);
  useEffect(() => {
    if (!ready || !navigationRef.isReady()) return;
    if (!shouldOpenAcceptInvite(status, token, navigationRef.getCurrentRoute()?.name)) return;
    // Let the newly mounted branch settle before pushing the modal.
    const id = setTimeout(() => {
      if (token && navigationRef.isReady()) navigationRef.navigate('AcceptInvite', { token });
    }, 0);
    return () => clearTimeout(id);
  }, [ready, status, token]);
}

/** Opens a notification tapped before the signed-in app was mounted (cold start, 02 §3.4). */
function usePendingNotificationNavigation(ready: boolean) {
  const status = useSessionStore((s) => s.status);
  useEffect(() => {
    if (!ready || status !== 'signed_in') return;
    const id = setTimeout(() => flushPendingNotification(), 0);
    return () => clearTimeout(id);
  }, [ready, status]);
}

function Navigation() {
  const theme = useNavigationTheme();
  const [ready, setReady] = useState(false);
  usePendingInviteNavigation(ready);
  usePendingNotificationNavigation(ready);
  useSensoryCalmSuggestion(ready);
  return (
    <NavigationContainer
      ref={navigationRef}
      linking={linking}
      theme={theme}
      onReady={() => {
        markStartup('nav_ready');
        registerNavigationContainer(navigationRef);
        trackScreenChange(navigationRef);
        setReady(true);
      }}
      onStateChange={() => trackScreenChange(navigationRef)}
    >
      <RootNavigator />
    </NavigationContainer>
  );
}

/** Provider order per 07 §9.1; sheets, toast and app-lock providers arrive in later sprints. */
function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <RootErrorBoundary>
          <I18nProvider>
            <ThemeProvider>
              <QueryProvider>
                <SplashGate>
                  <AuthProvider>
                    <Navigation />
                  </AuthProvider>
                </SplashGate>
              </QueryProvider>
            </ThemeProvider>
          </I18nProvider>
        </RootErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(App);
