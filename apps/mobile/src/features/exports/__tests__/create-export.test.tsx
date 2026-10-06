import { fireEvent, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';

import { useActiveHouseholdStore } from '@/stores/use-active-household-store';
import { renderWithProviders } from '@/test/render';

import { CreateExportSheet } from '../screens/create-export-sheet';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => (jest.requireActual('crypto') as { randomUUID: () => string }).randomUUID(),
}));
jest.mock('@/features/subscription', () => ({
  ...jest.requireActual('@/features/subscription'),
  usePremium: () => ({ premium: true, loading: false }),
}));
jest.mock('../api/exports-api', () => ({
  ...jest.requireActual('../api/exports-api'),
  requestExport: jest.fn(async () => {
    const { AppError: MockAppError } = jest.requireActual<{
      AppError: new (code: string, message: string, opts: object) => Error;
    }>('@/lib/supabase/app-error');
    throw new MockAppError('FEATURE_DISABLED', 'off', {
      details: { reason: 'renderer_not_configured' },
    });
  }),
}));

const PLAN = '66666666-6666-4666-8666-666666666666';

describe('create export (S6-09)', () => {
  it('shows a friendly "not available yet" state when the renderer is off', async () => {
    useActiveHouseholdStore.getState().setActiveHousehold('h1', 'owner');
    await renderWithProviders(
      <CreateExportSheet
        {...({
          route: { params: { kind: 'meal_plan', mealPlanId: PLAN } },
          navigation: { goBack: jest.fn(), navigate: jest.fn() },
        } as unknown as ComponentProps<typeof CreateExportSheet>)}
      />,
    );
    expect(screen.getByText('A4')).toBeTruthy();
    expect(screen.getByText('Letter')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('export-create.submit'));
    expect(await screen.findByTestId('export-create.not-available')).toBeTruthy();
    expect(screen.queryByTestId('export-create.error')).toBeNull();
  });
});
