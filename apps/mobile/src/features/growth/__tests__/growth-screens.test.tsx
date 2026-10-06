import { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';

import { deviceIsoDate } from '@/lib/dates/local-date';
import { useOutboxStore } from '@/lib/offline/outbox';
import { qk } from '@/lib/query/query-keys';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';
import { renderWithProviders } from '@/test/render';

import { GROWTH_MEASUREMENT_KIND } from '../hooks/use-growth';
import { AddGrowthMeasurementScreen } from '../screens/add-growth-measurement-screen';

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
      date_of_birth: deviceIsoDate(new Date(Date.now() - 400 * 86_400_000)),
      life_stage: 'toddler',
      special_modules: [],
      linked_user_id: null,
    },
  ]);
  return client;
}

describe('add growth measurement (S6-04)', () => {
  it('asks for head circumference under 2, shows no kcal or weight targets, and queues offline', async () => {
    const client = setup();
    const goBack = jest.fn();
    await renderWithProviders(
      <AddGrowthMeasurementScreen
        {...({
          route: { params: { familyMemberId: CHILD } },
          navigation: { goBack, navigate: jest.fn() },
        } as unknown as ComponentProps<typeof AddGrowthMeasurementScreen>)}
      />,
      { queryClient: client },
    );
    expect(screen.getByTestId('growth-add.head')).toBeTruthy();
    expect(screen.queryByText(NO_TARGETS)).toBeNull();
    await fireEvent.changeText(screen.getByTestId('growth-add.weight'), '10.2');
    await fireEvent.press(screen.getByTestId('growth-add.save'));
    const entries = useOutboxStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe(GROWTH_MEASUREMENT_KIND);
    expect(goBack).toHaveBeenCalled();
  });

  it('blocks saving an empty form with a calm message', async () => {
    const client = setup();
    await renderWithProviders(
      <AddGrowthMeasurementScreen
        {...({
          route: { params: { familyMemberId: CHILD } },
          navigation: { goBack: jest.fn(), navigate: jest.fn() },
        } as unknown as ComponentProps<typeof AddGrowthMeasurementScreen>)}
      />,
      { queryClient: client },
    );
    await fireEvent.press(screen.getByTestId('growth-add.save'));
    expect(useOutboxStore.getState().entries).toHaveLength(0);
  });
});
