import { screen } from '@testing-library/react-native';

import { useSessionStore } from '@/stores/use-session-store';
import { renderWithProviders } from '@/test/render';

import { branchForStatus, RootNavigator } from '../root-navigator';

describe('RootNavigator', () => {
  it.each([
    ['initializing', 'Boot'],
    ['signed_out', 'Auth'],
    ['needs_age_gate', 'Onboarding'],
    ['needs_onboarding', 'Onboarding'],
    ['signed_in', 'Main'],
  ] as const)('routes %s to %s', (status, branch) => {
    expect(branchForStatus(status)).toBe(branch);
  });

  it('shows the five tabs with their labels when signed in', async () => {
    useSessionStore.setState({ status: 'signed_in' });
    await renderWithProviders(<RootNavigator />, { withNavigation: true });
    for (const id of ['tab.today', 'tab.plan', 'tab.chat', 'tab.family', 'tab.more']) {
      expect(await screen.findByTestId(id)).toBeTruthy();
    }
    expect(screen.getByText('Ask')).toBeTruthy();
  });

  it('shows the welcome screen when signed out', async () => {
    useSessionStore.setState({ status: 'signed_out' });
    await renderWithProviders(<RootNavigator />, { withNavigation: true });
    expect(await screen.findByTestId('auth-welcome.screen')).toBeTruthy();
  });
});
