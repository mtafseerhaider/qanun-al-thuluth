import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { NavigationContainer } from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { I18nProvider } from '@/app/providers/i18n-provider';
import { track } from '@/lib/analytics/track';
import { i18n } from '@/lib/i18n/i18n';
import { qk } from '@/lib/query/query-keys';
import { navigationRef } from '@/navigation/navigation-ref';
import type { RootStackParamList } from '@/navigation/types';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';
import { usePreferencesStore } from '@/stores/use-preferences-store';
import { useSessionStore } from '@/stores/use-session-store';
import { renderWithProviders } from '@/test/render';

import { SensoryCalmToggle } from '../components/sensory-calm-toggle';
import { useSensoryCalmSuggestion } from '../hooks/use-sensory-calm-suggestion';
import { SensoryCalmSuggestionSheet } from '../screens/sensory-calm-suggestion-sheet';
import { sensoryCalmSuggestion, setSensoryCalmByUser } from '../utils/sensory-calm';

jest.mock('@/lib/analytics/track', () => ({ track: jest.fn(() => true) }));

const trackMock = track as jest.Mock;
const HOUSEHOLD = 'h1';
const autismMember = { id: 'm1', name: 'Zayd', special_modules: ['autism'] };
const otherMember = { id: 'm2', name: 'Amina', special_modules: ['picky_eater'] };

beforeEach(() => {
  trackMock.mockClear();
  usePreferencesStore.setState({ sensoryCalm: false, sensoryCalmSuggested: false });
});

describe('sensoryCalmSuggestion (02 §7.10)', () => {
  const fresh = { sensoryCalm: false, sensoryCalmSuggested: false };

  it('shows once a member has the autism module', () => {
    expect(sensoryCalmSuggestion([otherMember, autismMember], fresh)).toBe('show');
  });

  it('does nothing without an autism member or before members load', () => {
    expect(sensoryCalmSuggestion([otherMember, { special_modules: null }], fresh)).toBe('none');
    expect(sensoryCalmSuggestion(undefined, fresh)).toBe('none');
  });

  it('never shows twice', () => {
    expect(
      sensoryCalmSuggestion([autismMember], { sensoryCalm: false, sensoryCalmSuggested: true }),
    ).toBe('none');
  });

  it('is spent silently when Sensory-calm is already on', () => {
    expect(
      sensoryCalmSuggestion([autismMember], { sensoryCalm: true, sensoryCalmSuggested: false }),
    ).toBe('skip');
  });
});

describe('sensory_calm_toggled', () => {
  it('is tracked with enabled when the user changes the setting, not when it stays the same', () => {
    setSensoryCalmByUser(true);
    expect(usePreferencesStore.getState().sensoryCalm).toBe(true);
    setSensoryCalmByUser(true);
    setSensoryCalmByUser(false);
    expect(usePreferencesStore.getState().sensoryCalm).toBe(false);
    expect(trackMock.mock.calls).toEqual([
      ['sensory_calm_toggled', { enabled: true }],
      ['sensory_calm_toggled', { enabled: false }],
    ]);
  });

  it('is tracked from the settings switch', async () => {
    await i18n.changeLanguage('en');
    await render(
      <I18nProvider>
        <SensoryCalmToggle />
      </I18nProvider>,
    );
    await act(async () => {
      fireEvent(screen.getByTestId('settings.sensory-calm'), 'valueChange', true);
    });
    expect(trackMock).toHaveBeenCalledWith('sensory_calm_toggled', { enabled: true });
  });
});

const Stack = createNativeStackNavigator<RootStackParamList>();

function Home() {
  return <RNText testID="home">Home</RNText>;
}

function Harness() {
  useSensoryCalmSuggestion(true);
  return (
    <Stack.Navigator screenOptions={{ animation: 'none' }}>
      <Stack.Screen name="Boot" component={Home} />
      <Stack.Screen name="SensoryCalmSuggestionSheet" component={SensoryCalmSuggestionSheet} />
    </Stack.Navigator>
  );
}

async function renderApp(members: unknown[], locale: 'en' | 'ur' = 'en') {
  await i18n.changeLanguage(locale);
  useSessionStore.setState({ status: 'signed_in' });
  useActiveHouseholdStore.setState({ activeHouseholdId: HOUSEHOLD });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  client.setQueryData(qk.household(HOUSEHOLD).familyMembers(), members);
  const view = await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <I18nProvider>
        <QueryClientProvider client={client}>
          <NavigationContainer ref={navigationRef}>
            <Harness />
          </NavigationContainer>
        </QueryClientProvider>
      </I18nProvider>
    </SafeAreaProvider>,
  );
  // The hook presents the sheet on the next tick.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return view;
}

describe('one-time Sensory-calm suggestion sheet', () => {
  it('opens when a member has autism, remembers it, and turns Sensory-calm on', async () => {
    const view = await renderApp([autismMember]);
    expect(await screen.findByTestId('sensory-calm-suggestion.screen')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Try Sensory-calm mode?' })).toBeTruthy();
    expect(usePreferencesStore.getState().sensoryCalmSuggested).toBe(true);

    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Turn on Sensory-calm' }));
    });
    expect(usePreferencesStore.getState().sensoryCalm).toBe(true);
    expect(trackMock).toHaveBeenCalledWith('sensory_calm_toggled', { enabled: true });
    expect(navigationRef.getCurrentRoute()?.name).toBe('Boot');
    await view.unmount();
  });

  it('closes on "Not now" without changing the setting, and does not come back', async () => {
    const first = await renderApp([autismMember]);
    await screen.findByTestId('sensory-calm-suggestion.screen');
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
    });
    expect(usePreferencesStore.getState().sensoryCalm).toBe(false);
    expect(trackMock).not.toHaveBeenCalled();
    expect(navigationRef.getCurrentRoute()?.name).toBe('Boot');
    await first.unmount();

    const second = await renderApp([autismMember]);
    expect(screen.queryByTestId('sensory-calm-suggestion.screen')).toBeNull();
    await second.unmount();
  });

  it('does not open without an autism member', async () => {
    const view = await renderApp([otherMember]);
    expect(screen.queryByTestId('sensory-calm-suggestion.screen')).toBeNull();
    expect(usePreferencesStore.getState().sensoryCalmSuggested).toBe(false);
    await view.unmount();
  });

  it('is spent without opening when Sensory-calm is already on', async () => {
    usePreferencesStore.setState({ sensoryCalm: true });
    const view = await renderApp([autismMember]);
    await waitFor(() => expect(usePreferencesStore.getState().sensoryCalmSuggested).toBe(true));
    expect(screen.queryByTestId('sensory-calm-suggestion.screen')).toBeNull();
    await view.unmount();
  });
});

describe('Sensory-calm suggestion sheet copy', () => {
  const nav = { canGoBack: () => true, goBack: jest.fn() };

  it.each([
    ['en', 'Try Sensory-calm mode?', 'Turn on Sensory-calm', 'Not now'],
    ['ur', 'پُرسکون حسی موڈ آزمائیں؟', 'پُرسکون حسی موڈ آن کریں', 'ابھی نہیں'],
  ] as const)('has %s copy with a header and two plain choices', async (locale, title, on, off) => {
    await renderWithProviders(
      <SensoryCalmSuggestionSheet navigation={nav as never} route={{} as never} />,
      { locale },
    );
    expect(screen.getByRole('header', { name: title })).toBeTruthy();
    expect(screen.getByRole('button', { name: on })).toBeTruthy();
    expect(screen.getByRole('button', { name: off })).toBeTruthy();
    await screen.unmount();
    await i18n.changeLanguage('en');
  });
});
