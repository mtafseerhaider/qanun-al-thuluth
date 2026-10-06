import { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';

import { deviceIsoDate } from '@/lib/dates/local-date';
import { useOutboxStore } from '@/lib/offline/outbox';
import { qk } from '@/lib/query/query-keys';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';
import { renderWithProviders } from '@/test/render';

import { DivisionOfResponsibilityScreen } from '../screens/division-of-responsibility-screen';
import { PickyEaterHubScreen } from '../screens/picky-eater-hub-screen';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => (jest.requireActual('crypto') as { randomUUID: () => string }).randomUUID(),
}));

const CHILD = '44444444-4444-4444-8444-444444444444';
const NO_TARGETS = /kcal|calorie|target weight|goal weight|diet/i;

function setup() {
  useActiveHouseholdStore.getState().setActiveHousehold('h1', 'owner');
  useOutboxStore.getState().reset();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  client.setQueryData(qk.household('h1').familyMembers(), [
    {
      id: CHILD,
      name: 'Zainab',
      date_of_birth: deviceIsoDate(new Date(Date.now() - 4 * 365 * 86_400_000)),
      life_stage: 'child',
      special_modules: ['picky_eater'],
      linked_user_id: null,
    },
  ]);
  return client;
}

describe('picky eater hub (S6-05)', () => {
  it('shows the log button and guide links, with no kcal or weight targets', async () => {
    const client = setup();
    const navigate = jest.fn();
    await renderWithProviders(
      <PickyEaterHubScreen
        {...({
          route: { params: { familyMemberId: CHILD } },
          navigation: { navigate, goBack: jest.fn() },
        } as unknown as ComponentProps<typeof PickyEaterHubScreen>)}
      />,
      { queryClient: client },
    );
    expect(screen.getByTestId('picky.hub')).toBeTruthy();
    expect(screen.queryByText(NO_TARGETS)).toBeNull();
    await fireEvent.press(screen.getByTestId('picky.log'));
    expect(navigate).toHaveBeenCalledWith(
      'LogExposureSheet',
      expect.objectContaining({ familyMemberId: CHILD }),
    );
  });

  it('shows the division of responsibility guide in Urdu', async () => {
    const client = setup();
    await renderWithProviders(<DivisionOfResponsibilityScreen />, {
      queryClient: client,
      locale: 'ur',
    });
    expect(screen.queryByText(NO_TARGETS)).toBeNull();
    expect(screen.getByText('ذمہ داری کی تقسیم')).toBeTruthy();
  });
});
