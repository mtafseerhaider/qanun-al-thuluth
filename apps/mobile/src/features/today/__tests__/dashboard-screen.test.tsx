import { onlineManager, QueryClient } from '@tanstack/react-query';
import { fireEvent, screen } from '@testing-library/react-native';

import { deviceIsoDate } from '@/lib/dates/local-date';
import { useOutboxStore } from '@/lib/offline/outbox';
import { qk } from '@/lib/query/query-keys';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';
import { renderWithProviders } from '@/test/render';

import { DashboardScreen } from '../screens/dashboard-screen';

jest.mock('expo-crypto', () => ({
  randomUUID: () => (jest.requireActual('crypto') as { randomUUID: () => string }).randomUUID(),
}));

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn() }),
}));

const TODAY = deviceIsoDate(new Date());
const PLAN = {
  id: 'plan-1',
  householdId: 'h1',
  kind: 'standard',
  status: 'active',
  title: null,
  startDate: TODAY,
  endDate: TODAY,
  weekCount: 1,
  rationale: null,
  version: 1,
  parentPlanId: null,
  failureReason: null,
  progress: null,
  weeklyThemes: [],
  createdAt: '2026-10-06T00:00:00Z',
};
const serving = (id: string, memberId: string, kcal: number) => ({
  id,
  dailyMealId: 'dm-1',
  familyMemberId: memberId,
  status: 'planned',
  acceptance: null,
  adaptation: 'none',
  adaptedMeal: null,
  portion: {
    householdMeasure: 'One katori',
    householdMeasureI18n: {},
    grams: 150,
    kcal,
    lifeStage: 'child',
  },
  loggedAt: null,
  updatedAt: '2026-10-06T00:00:00Z',
});
const MEAL = {
  id: 'dm-1',
  mealPlanId: 'plan-1',
  householdId: 'h1',
  planDate: TODAY,
  mealType: 'dinner',
  slot: 1,
  scheduledTime: '23:59:00',
  notes: null,
  swappedFromMealId: null,
  meal: {
    id: 'meal-1',
    title: 'Chicken karahi',
    titleI18n: {},
    mealType: 'dinner',
    plateSplit: null,
    components: [],
  },
  servings: [serving('s-1', 'm-adult', 520), serving('s-2', 'm-child', 310)],
};

function seededClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  const h = qk.household('h1');
  client.setQueryData(h.activePlan(), PLAN);
  client.setQueryData(h.mealPlans(), [PLAN]);
  client.setQueryData(h.dailyMealsRange('plan-1', TODAY, TODAY), [MEAL]);
  client.setQueryData(h.familyMembers(), [
    { id: 'm-adult', name: 'Ayesha', life_stage: 'adult', special_modules: [] },
    { id: 'm-child', name: 'Ibrahim', life_stage: 'child', special_modules: [] },
  ]);
  return client;
}

beforeEach(() => {
  useOutboxStore.getState().reset();
  useActiveHouseholdStore.getState().setActiveHousehold('h1', 'owner');
  onlineManager.setOnline(false);
});
afterEach(() => onlineManager.setOnline(true));

describe('Today dashboard (24 S3-11)', () => {
  it('renders the next meal from the persisted cache while offline', async () => {
    await renderWithProviders(<DashboardScreen />, { queryClient: seededClient() });
    expect(screen.getByTestId('today.offline')).toBeTruthy();
    expect(screen.getByTestId('today.next-meal.card')).toBeTruthy();
    expect(screen.getByText('Chicken karahi')).toBeTruthy();
    expect(screen.queryByText(/kcal|310|520/)).toBeNull();
  });

  it('"Everyone ate" queues the logs offline and shows them as saved', async () => {
    await renderWithProviders(<DashboardScreen />, { queryClient: seededClient() });
    await fireEvent.press(screen.getByTestId('today.next-meal.card.everyone-ate'));
    const { entries } = useOutboxStore.getState();
    expect(entries.map((e) => e.dedupeKey).sort()).toEqual(['s-1', 's-2']);
    // Fully logged: it leaves "Next meal" and shows in the list as saved, waiting to sync.
    expect(await screen.findByTestId('today.meal-0.queued')).toBeTruthy();
    expect(screen.getByTestId('today.all-done')).toBeTruthy();
    expect(screen.getByTestId('today.pending-sync')).toBeTruthy();
    expect(screen.getByTestId('today.undo.undo')).toBeTruthy();
  });

  it('opens Meal Detail and the swap sheet', async () => {
    await renderWithProviders(<DashboardScreen />, { queryClient: seededClient() });
    await fireEvent.press(screen.getByTestId('today.next-meal.card.open'));
    expect(mockNavigate).toHaveBeenCalledWith('MealDetail', { dailyMealId: 'dm-1' });
    await fireEvent.press(screen.getByTestId('today.next-meal.card.swap'));
    expect(mockNavigate).toHaveBeenCalledWith('SwapMealSheet', { dailyMealId: 'dm-1' });
  });
});
