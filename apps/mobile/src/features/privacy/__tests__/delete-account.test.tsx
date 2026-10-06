import { QueryClient } from '@tanstack/react-query';
import { screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';

import { qk } from '@/lib/query/query-keys';
import { renderWithProviders } from '@/test/render';

import { DeleteAccountScreen } from '../screens/delete-account-screen';

jest.mock('expo-crypto', () => ({
  randomUUID: () => (jest.requireActual('crypto') as { randomUUID: () => string }).randomUUID(),
}));

const props = {
  route: { params: undefined },
  navigation: { goBack: jest.fn(), navigate: jest.fn() },
} as unknown as ComponentProps<typeof DeleteAccountScreen>;

const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });

describe('delete account (S6-11)', () => {
  it('explains the 30-day grace period and asks for an email code first', async () => {
    const qc = client();
    qc.setQueryData(qk.account(), {
      deletionScheduledFor: null,
      deletionRequestedAt: null,
      analyticsOptOut: false,
    });
    await renderWithProviders(<DeleteAccountScreen {...props} />, { queryClient: qc });
    expect(screen.getByText(/deleted after 30 days/)).toBeTruthy();
    expect(screen.getByTestId('delete-account.reauth')).toBeTruthy();
    expect(screen.queryByTestId('deletion-countdown')).toBeNull();
  });

  it('shows the countdown and a cancel button while deletion is pending', async () => {
    const qc = client();
    qc.setQueryData(qk.account(), {
      deletionScheduledFor: new Date(Date.now() + 10 * 86_400_000 - 60_000).toISOString(),
      deletionRequestedAt: new Date().toISOString(),
      analyticsOptOut: false,
    });
    await renderWithProviders(<DeleteAccountScreen {...props} />, { queryClient: qc });
    expect(screen.getByTestId('deletion-countdown')).toBeTruthy();
    expect(screen.getByText(/deleted in 10 days/)).toBeTruthy();
    expect(screen.getByTestId('deletion-countdown.cancel')).toBeTruthy();
    expect(screen.queryByTestId('delete-account.reauth')).toBeNull();
  });
});
