import { fireEvent, screen } from '@testing-library/react-native';

import { AppError } from '@/lib/supabase/app-error';
import { renderWithProviders } from '@/test/render';

import { SwapMealSheet } from '../screens/swap-meal-sheet';

jest.mock('expo-crypto', () => ({
  randomUUID: () => (jest.requireActual('crypto') as { randomUUID: () => string }).randomUUID(),
}));

const mockGoBack = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ goBack: mockGoBack, navigate: jest.fn() }),
  useRoute: () => ({ params: { dailyMealId: 'dm-1' } }),
}));

let mockFlag = true;
jest.mock('@/hooks/use-feature-flag', () => ({ useFeatureFlag: () => mockFlag }));

let mockPremium: boolean | undefined = false;
const mockPreview = {
  mutate: jest.fn(),
  isPending: false,
  isError: false,
  error: null,
  data: undefined as unknown,
};
const mockApply = { mutate: jest.fn(), isPending: false };
const mockSwap = { mutate: jest.fn(), isError: false, error: null };

jest.mock('../hooks/use-meals', () => ({
  useDailyMeal: () => ({
    data: {
      id: 'dm-1',
      mealPlanId: 'plan-1',
      planDate: '2026-10-06',
      mealType: 'lunch',
      meal: { id: 'meal-1', title: 'Masoor daal', titleI18n: {} },
      servings: [],
    },
  }),
  useMealAlternatives: () => ({
    isLoading: false,
    data: [
      {
        id: 'alt-1',
        reason: 'budget',
        notes: null,
        meal: { id: 'meal-2', title: 'Chana daal', titleI18n: {} },
      },
    ],
  }),
  useHouseholdPremium: () => ({ data: mockPremium }),
  useSwapMeal: () => mockSwap,
  useAiSwap: () => ({ preview: mockPreview, apply: mockApply }),
}));

beforeEach(() => {
  mockFlag = true;
  mockPremium = false;
  jest.clearAllMocks();
});

describe('SwapMealSheet gating (24 S3-13)', () => {
  it('free users see catalog swaps and the upsell, never the AI button', async () => {
    await renderWithProviders(<SwapMealSheet />);
    expect(screen.getByTestId('swap-meal.alternative-0')).toBeTruthy();
    expect(screen.getByTestId('swap-meal.upsell')).toBeTruthy();
    expect(screen.queryByTestId('swap-meal.ask-ai')).toBeNull();
  });

  it('catalog swap is free and calls the swap RPC', async () => {
    await renderWithProviders(<SwapMealSheet />);
    await fireEvent.press(screen.getByTestId('swap-meal.alternative-0'));
    expect(mockSwap.mutate).toHaveBeenCalledWith(
      { dailyMealId: 'dm-1', alternativeMealId: 'meal-2', reason: 'budget' },
      expect.anything(),
    );
  });

  it('premium users can ask AI; the flag switches it off', async () => {
    mockPremium = true;
    const view = await renderWithProviders(<SwapMealSheet />);
    expect(screen.getByTestId('swap-meal.ask-ai')).toBeTruthy();
    await view.unmount();
    mockFlag = false;
    await renderWithProviders(<SwapMealSheet />);
    expect(screen.getByTestId('swap-meal.ai-disabled')).toBeTruthy();
  });

  it('PREMIUM_REQUIRED from ai-adjust-plan switches to the upsell', async () => {
    mockPremium = true;
    mockPreview.mutate.mockImplementation((_v, opts: { onError: (e: unknown) => void }) =>
      opts.onError(new AppError('PREMIUM_REQUIRED', 'upgrade')),
    );
    await renderWithProviders(<SwapMealSheet />);
    await fireEvent.press(screen.getByTestId('swap-meal.ask-ai'));
    expect(await screen.findByTestId('swap-meal.upsell')).toBeTruthy();
    expect(screen.queryByTestId('swap-meal.ask-ai')).toBeNull();
  });
});
