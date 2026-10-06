import 'react-native-gesture-handler';

import { NavigationContainer } from '@react-navigation/native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { registerNavigationContainer, Sentry } from '@/lib/sentry/init';
import { linking } from '@/navigation/linking';
import { navigationRef } from '@/navigation/navigation-ref';
import { RootNavigator } from '@/navigation/root-navigator';
import { trackScreenChange } from '@/navigation/screen-tracking';
import { useNavigationTheme } from '@/theme/use-theme-colors';

import { bootstrap } from './bootstrap';
import { RootErrorBoundary } from './error-boundary';
import { I18nProvider } from './providers/i18n-provider';
import { QueryProvider } from './providers/query-provider';
import { ThemeProvider } from './providers/theme-provider';
import { SplashGate } from './splash-gate';

bootstrap();

function Navigation() {
  const theme = useNavigationTheme();
  return (
    <NavigationContainer
      ref={navigationRef}
      linking={linking}
      theme={theme}
      onReady={() => {
        registerNavigationContainer(navigationRef);
        trackScreenChange(navigationRef);
      }}
      onStateChange={() => trackScreenChange(navigationRef)}
    >
      <RootNavigator />
    </NavigationContainer>
  );
}

/** Provider order per 07 §9.1; auth, sheets, toast and app-lock providers arrive in later sprints. */
function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <RootErrorBoundary>
          <I18nProvider>
            <ThemeProvider>
              <QueryProvider>
                <SplashGate>
                  <Navigation />
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
