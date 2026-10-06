import { onlineManager, QueryClient } from '@tanstack/react-query';
import { fireEvent, screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';

import { clearOutboxHandlers, flushOutbox, useOutboxStore } from '@/lib/offline/outbox';
import { qk } from '@/lib/query/query-keys';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';
import { renderWithProviders } from '@/test/render';

import { insertManualItem, updateItem } from '../api/grocery-api';
import {
  addManualItem,
  changeItem,
  registerGroceryOutboxHandlers,
  removeItem,
} from '../hooks/use-grocery';
import { GroceryListDetailScreen } from '../screens/grocery-list-detail-screen';
import {
  applyPendingItems,
  GROCERY_ITEM_ADD_KIND,
  GROCERY_ITEM_UPDATE_KIND,
  groupByAisle,
  planWeekFor,
  priceReportFor,
  shareText,
  substitutions,
  type GroceryListView,
  type ShoppingItemView,
} from '../utils/grocery-rules';

// The upsell card opens the paywall through the navigator (Sprint 5).
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => (jest.requireActual('crypto') as { randomUUID: () => string }).randomUUID(),
}));

jest.mock('../api/grocery-api', () => ({
  updateItem: jest.fn(async () => undefined),
  insertManualItem: jest.fn(async () => undefined),
  deleteItem: jest.fn(async () => undefined),
  setListStatus: jest.fn(async () => undefined),
  insertPriceReport: jest.fn(async () => undefined),
  fetchGroceryList: jest.fn(async () => null),
  fetchGroceryLists: jest.fn(async () => []),
  requestGroceryList: jest.fn(),
}));

const updateMock = updateItem as jest.MockedFunction<typeof updateItem>;
const insertMock = insertManualItem as jest.MockedFunction<typeof insertManualItem>;

const LIST: GroceryListView = {
  id: 'list-1',
  householdId: 'h1',
  mealPlanId: 'plan-1',
  period: 'weekly',
  startsOn: '2026-10-05',
  endsOn: '2026-10-11',
  estimatedTotalMinor: 450000,
  currency: 'PKR',
  status: 'open',
  priceProfileId: 'pp-1',
};

const item = (over: Partial<ShoppingItemView>): ShoppingItemView => ({
  id: 'i-1',
  groceryListId: 'list-1',
  ingredientId: 'ing-1',
  label: 'Tomatoes',
  quantity: 2,
  unit: 'kg',
  estimatedMinor: 40000,
  actualMinor: null,
  isChecked: false,
  substitutionForItemId: null,
  aisle: 'sabzi',
  isFresh: true,
  sortOrder: 1,
  updatedAt: '2026-10-05T08:00:00Z',
  ...over,
});

const ITEMS = [
  item({}),
  item({ id: 'i-2', label: 'Atta', aisle: 'dry_goods', unit: 'kg', quantity: 5, isFresh: false }),
  item({ id: 'i-3', label: 'Chicken', aisle: 'meat', estimatedMinor: 150000 }),
  item({
    id: 'i-4',
    label: 'Daal masoor',
    aisle: 'dry_goods',
    substitutionForItemId: 'i-3',
    estimatedMinor: 60000,
  }),
];

const ref = { id: 'i-1', listId: 'list-1', householdId: 'h1' };

beforeEach(() => {
  useOutboxStore.getState().reset();
  clearOutboxHandlers();
  updateMock.mockClear();
  insertMock.mockClear();
});

describe('grocery list rules (24 S4-05)', () => {
  it('groups by aisle in shop order, keeps substitutes off the list and fresh first', () => {
    const sections = groupByAisle(ITEMS);
    expect(sections.map((s) => s.aisle)).toEqual(['sabzi', 'meat', 'dry_goods']);
    expect(sections[2]?.items.map((i) => i.id)).toEqual(['i-2']);
    expect(substitutions(ITEMS)).toEqual([
      expect.objectContaining({
        savesMinor: 90000,
        original: expect.objectContaining({ id: 'i-3' }),
      }),
    ]);
  });

  it('shares a WhatsApp-friendly list with ticks and no prices', () => {
    const text = shareText(
      'Shopping',
      groupByAisle([
        ...ITEMS.slice(0, 2),
        item({
          id: 'i-5',
          label: 'Milk',
          aisle: 'dairy',
          isChecked: true,
          unit: 'l',
          quantity: 1.5,
        }),
      ]),
      (a) => a.toUpperCase(),
      (u) => u,
    );
    expect(text).toContain('*SABZI*');
    expect(text).toContain('☐ Tomatoes (2 kg)');
    expect(text).toContain('☑ Milk (1.5 l)');
    expect(text).not.toMatch(/PKR|400/);
  });

  it('turns an actual price into a per-unit user report only when it can be one', () => {
    expect(priceReportFor(item({}), 50000, LIST, { id: 'r1', today: '2026-10-06' })).toEqual({
      id: 'r1',
      householdId: 'h1',
      priceProfileId: 'pp-1',
      ingredientId: 'ing-1',
      unit: 'kg',
      amountMinor: 25000,
      observedOn: '2026-10-06',
    });
    expect(
      priceReportFor(item({ ingredientId: null }), 50000, LIST, { id: 'r', today: 'x' }),
    ).toBeNull();
    expect(
      priceReportFor(item({}), 50000, { ...LIST, priceProfileId: null }, { id: 'r', today: 'x' }),
    ).toBeNull();
  });

  it('picks the plan week that contains today, clipped to the plan', () => {
    const plan = { startDate: '2026-10-01', endDate: '2026-10-28' };
    expect(planWeekFor(plan, '2026-10-09')).toEqual({
      startsOn: '2026-10-08',
      endsOn: '2026-10-14',
    });
    expect(planWeekFor(plan, '2026-09-20')).toEqual({
      startsOn: '2026-10-01',
      endsOn: '2026-10-07',
    });
    expect(planWeekFor({ startDate: '2026-10-01', endDate: '2026-10-03' }, '2026-10-02')).toEqual({
      startsOn: '2026-10-01',
      endsOn: '2026-10-03',
    });
  });
});

describe('offline check-off and sync (FR-GRO-02)', () => {
  it('merges repeated changes to one item into one queued update with the latest time', async () => {
    changeItem(ref, { checked: true }, new Date('2026-10-06T10:00:00Z'));
    changeItem(ref, { actualMinor: 52000 }, new Date('2026-10-06T10:05:00Z'));
    const { entries } = useOutboxStore.getState();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe(GROCERY_ITEM_UPDATE_KIND);
    expect(entries[0]?.payload).toMatchObject({
      itemId: 'i-1',
      checked: true,
      actualMinor: 52000,
      at: '2026-10-06T10:05:00.000Z',
    });
    const overlaid = applyPendingItems(ITEMS, entries, 'list-1');
    expect(overlaid.find((i) => i.id === 'i-1')).toMatchObject({
      isChecked: true,
      actualMinor: 52000,
      queued: true,
    });

    registerGroceryOutboxHandlers(new QueryClient());
    expect((await flushOutbox()).sent).toBe(1);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 'i-1', checked: true, at: '2026-10-06T10:05:00.000Z' }),
    );
    expect(useOutboxStore.getState().entries).toHaveLength(0);
  });

  it('folds a check-off of a manual item into its queued insert, and removing it sends nothing', async () => {
    const id = addManualItem({
      householdId: 'h1',
      listId: 'list-1',
      label: 'Lemons',
      quantity: 6,
      unit: 'piece',
      aisle: 'fruit',
      isFresh: true,
    });
    changeItem({ ...ref, id }, { checked: true });
    let { entries } = useOutboxStore.getState();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe(GROCERY_ITEM_ADD_KIND);
    expect(entries[0]?.payload).toMatchObject({ id, checked: true });

    registerGroceryOutboxHandlers(new QueryClient());
    await flushOutbox();
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ id, checked: true }));

    const other = addManualItem({
      householdId: 'h1',
      listId: 'list-1',
      label: 'Mint',
      quantity: 1,
      unit: 'bunch',
      aisle: 'sabzi',
      isFresh: true,
    });
    removeItem({ ...ref, id: other });
    ({ entries } = useOutboxStore.getState());
    expect(entries).toHaveLength(0);
  });

  it('checks an item off on the list screen while offline and shows it as saved', async () => {
    onlineManager.setOnline(false);
    useActiveHouseholdStore.getState().setActiveHousehold('h1', 'owner');
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    client.setQueryData(qk.household('h1').groceryList('list-1'), { list: LIST, items: ITEMS });
    client.setQueryData(qk.household('h1').premium(), false);
    await renderWithProviders(
      <GroceryListDetailScreen
        {...({
          route: { params: { groceryListId: 'list-1' } },
          navigation: {},
        } as unknown as ComponentProps<typeof GroceryListDetailScreen>)}
      />,
      { queryClient: client },
    );
    expect(screen.getByTestId('grocery-detail.aisle.sabzi')).toBeTruthy();
    expect(screen.getByTestId('grocery-detail.upsell')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('grocery-detail.item.sabzi-0.check'));
    expect(await screen.findByTestId('grocery-detail.item.sabzi-0.queued')).toBeTruthy();
    expect(screen.getByTestId('grocery-detail.pending')).toBeTruthy();
    expect(useOutboxStore.getState().entries[0]?.payload).toMatchObject({
      itemId: 'i-1',
      checked: true,
    });
    onlineManager.setOnline(true);
  });
});
