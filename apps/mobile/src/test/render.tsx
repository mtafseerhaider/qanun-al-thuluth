import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { I18nProvider } from '@/app/providers/i18n-provider';
import { i18n } from '@/lib/i18n/i18n';
import { usePreferencesStore } from '@/stores/use-preferences-store';

export interface RenderWithProvidersOptions extends Omit<RenderOptions, 'wrapper'> {
  locale?: 'en' | 'ur';
  theme?: 'light' | 'dark';
  queryClient?: QueryClient;
  withNavigation?: boolean;
}

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

/** Wraps I18n, a fresh QueryClient (retry: false), safe area and optionally navigation (08 §13.2). */
export async function renderWithProviders(ui: ReactElement, opts: RenderWithProvidersOptions = {}) {
  const { locale = 'en', theme = 'light', queryClient, withNavigation = false, ...rest } = opts;
  await i18n.changeLanguage(locale);
  usePreferencesStore.setState({ theme, locale });
  const client =
    queryClient ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false, gcTime: Infinity },
        mutations: { retry: false, gcTime: Infinity },
      },
    });

  function Wrapper({ children }: { children: ReactNode }) {
    const content = withNavigation ? (
      <NavigationContainer>{children}</NavigationContainer>
    ) : (
      children
    );
    return (
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        <I18nProvider>
          <QueryClientProvider client={client}>{content}</QueryClientProvider>
        </I18nProvider>
      </SafeAreaProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...rest });
}
