import { act, fireEvent, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import {
  compareVersions,
  isBelowMinimum,
  parseMinSupportedVersion,
  storeUrls,
} from '@/lib/app-status/app-version';
import { edgeErrorFrom } from '@/lib/supabase/edge';
import { useAppStatusStore } from '@/stores/use-app-status-store';
import { useFeatureFlagStore } from '@/stores/use-feature-flag-store';
import { renderWithProviders } from '@/test/render';

import { AppStatusGate, resolveAppStatus } from '../app-status-gate';
import { MaintenanceScreen } from '../screens/maintenance-screen';
import { openFirstUrl, UpdateRequiredScreen } from '../screens/update-required-screen';

const SEEDED = { enabled: true, rules: { value: { ios: '1.0.0', android: '1.0.0' } } };

beforeEach(() => {
  useAppStatusStore.setState({ maintenance: false, upgradeRequired: false });
  useFeatureFlagStore.getState().reset();
});

describe('app.min_supported_version', () => {
  it('reads the seeded rules shape and the 19 §4.3 shape', () => {
    expect(parseMinSupportedVersion(SEEDED)).toEqual({ ios: '1.0.0', android: '1.0.0' });
    expect(parseMinSupportedVersion({ enabled: true, rules: { ios: '1.2.0' } })).toEqual({
      ios: '1.2.0',
    });
  });

  it('treats a disabled, missing or malformed flag as no minimum', () => {
    expect(parseMinSupportedVersion(null)).toBeNull();
    expect(parseMinSupportedVersion({ ...SEEDED, enabled: false })).toBeNull();
    expect(
      parseMinSupportedVersion({ enabled: true, rules: { value: { ios: 'latest' } } }),
    ).toEqual({});
  });

  it('compares versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.2')).toBe(1);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.9.9', '1.0.0')).toBe(-1);
  });

  it('blocks only below the platform minimum', () => {
    const min = { ios: '1.2.0', android: '1.0.0' };
    expect(isBelowMinimum('1.1.9', min, 'ios')).toBe(true);
    expect(isBelowMinimum('1.1.9', min, 'android')).toBe(false);
    expect(isBelowMinimum('1.2.0', min, 'ios')).toBe(false);
    expect(isBelowMinimum('1.0.0', null, 'ios')).toBe(false);
  });

  it('builds store links: flag override first, then store app, then website', () => {
    expect(storeUrls('android', 'app.thuluth.mobile', null)).toEqual([
      'market://details?id=app.thuluth.mobile',
      'https://play.google.com/store/apps/details?id=app.thuluth.mobile',
    ]);
    expect(
      storeUrls('ios', 'app.thuluth.mobile', { ios_store_url: 'https://apps.apple.com/app/id1' }),
    ).toEqual([
      'https://apps.apple.com/app/id1',
      'itms-apps://apps.apple.com/',
      'https://apps.apple.com/',
    ]);
  });

  it('falls back to the next store link when one cannot be opened', async () => {
    const open = jest.fn(async (url: string) => {
      if (url.startsWith('market:')) throw new Error('no Play Store');
    });
    await expect(openFirstUrl(['market://x', 'https://y'], open)).resolves.toBe(true);
    expect(open).toHaveBeenLastCalledWith('https://y');
    await expect(openFirstUrl(['market://x'], open)).resolves.toBe(false);
  });
});

describe('resolveAppStatus', () => {
  const base = {
    installedVersion: '1.0.0',
    platform: 'ios' as const,
    minVersion: { ios: '1.0.0', android: '1.0.0' },
    upgradeRequiredByServer: false,
    maintenanceFlag: false,
    maintenanceByServer: false,
  };
  it('runs normally at or above the minimum', () => {
    expect(resolveAppStatus(base)).toBe('ok');
  });
  it('requires an update below the minimum or when a function said UPGRADE_REQUIRED', () => {
    expect(resolveAppStatus({ ...base, minVersion: { ios: '1.1.0' } })).toBe('update_required');
    expect(resolveAppStatus({ ...base, upgradeRequiredByServer: true })).toBe('update_required');
  });
  it('shows maintenance from the flag or a function, update first', () => {
    expect(resolveAppStatus({ ...base, maintenanceFlag: true })).toBe('maintenance');
    expect(resolveAppStatus({ ...base, maintenanceByServer: true })).toBe('maintenance');
    expect(
      resolveAppStatus({ ...base, maintenanceFlag: true, upgradeRequiredByServer: true }),
    ).toBe('update_required');
  });
});

describe('Edge Function errors', () => {
  it('switches to maintenance on FEATURE_DISABLED with reason maintenance only', () => {
    edgeErrorFrom('ai-chat', 503, {
      error: { code: 'FEATURE_DISABLED', message: 'x', details: { flag: 'ai.chat.enabled' } },
    });
    expect(useAppStatusStore.getState().maintenance).toBe(false);
    const error = edgeErrorFrom('ai-chat', 503, {
      error: { code: 'FEATURE_DISABLED', message: 'x', details: { reason: 'maintenance' } },
    });
    expect(error.code).toBe('FEATURE_DISABLED');
    expect(useAppStatusStore.getState().maintenance).toBe(true);
  });

  it('requires an update on UPGRADE_REQUIRED', () => {
    edgeErrorFrom('ai-chat', 426, { error: { code: 'UPGRADE_REQUIRED', message: 'x' } });
    expect(useAppStatusStore.getState().upgradeRequired).toBe(true);
  });
});

describe('AppStatusGate', () => {
  const app = (
    <AppStatusGate>
      <Text testID="app.content">app</Text>
    </AppStatusGate>
  );

  it('renders the app when nothing blocks it (signed out: no flags)', async () => {
    await renderWithProviders(app);
    expect(screen.getByTestId('app.content')).toBeTruthy();
  });

  it('blocks with Update required after UPGRADE_REQUIRED', async () => {
    useAppStatusStore.setState({ upgradeRequired: true });
    await renderWithProviders(app);
    expect(screen.queryByTestId('app.content')).toBeNull();
    expect(screen.getByRole('header', { name: 'Update required' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Update now' })).toBeTruthy();
  });

  it('shows maintenance from the app.maintenance flag', async () => {
    useFeatureFlagStore.getState().setFlags({ 'app.maintenance': true });
    await renderWithProviders(app);
    expect(screen.getByRole('header', { name: "We'll be right back" })).toBeTruthy();
  });

  it('retry leaves maintenance once the server no longer reports it', async () => {
    useAppStatusStore.setState({ maintenance: true });
    await renderWithProviders(app);
    expect(screen.getByTestId('app-status.maintenance.screen')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(screen.getByTestId('app.content')).toBeTruthy();
  });
});

describe('interstitials in Urdu', () => {
  it('localizes Update required and maintenance', async () => {
    await renderWithProviders(<UpdateRequiredScreen storeUrls={[]} />, { locale: 'ur' });
    expect(screen.getByRole('header', { name: 'اپ ڈیٹ ضروری ہے' })).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'ابھی اپ ڈیٹ کریں' }));
    });
    expect(
      screen.getByText('اسٹور نہیں کھل سکا۔ براہ کرم ایپ اسٹور یا گوگل پلے سے ثُلُث اپ ڈیٹ کریں۔'),
    ).toBeTruthy();
    screen.unmount();

    await renderWithProviders(<MaintenanceScreen onRetry={jest.fn()} />, { locale: 'ur' });
    expect(screen.getByRole('header', { name: 'ہم جلد واپس آئیں گے' })).toBeTruthy();
  });
});
