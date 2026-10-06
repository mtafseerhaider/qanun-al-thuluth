import { useOutboxStore } from '@/lib/offline/outbox';

import { addBudgetEntry, removeBudgetEntry } from '../hooks/use-budget';
import {
  applyPendingEntries,
  budgetTone,
  monthDiff,
  shiftMonth,
  spendByCategory,
  splitIsValid,
  summarizeBudget,
  type BudgetCategoryView,
  type BudgetEntryView,
} from '../utils/budget-rules';

jest.mock('expo-crypto', () => ({
  randomUUID: () => (jest.requireActual('crypto') as { randomUUID: () => string }).randomUUID(),
}));

const CATS: BudgetCategoryView[] = [
  { id: 'c-staples', code: 'staples', nameI18n: {}, sortOrder: 10 },
  { id: 'c-veg', code: 'produce_veg', nameI18n: {}, sortOrder: 50 },
];
const entry = (over: Partial<BudgetEntryView>): BudgetEntryView => ({
  id: 'e',
  amountMinor: 100000,
  currency: 'PKR',
  categoryId: 'c-staples',
  spentOn: '2026-10-03',
  groceryListId: null,
  note: null,
  ...over,
});

beforeEach(() => useOutboxStore.getState().reset());

describe('budget dashboard maths (24 S4-07)', () => {
  it('sums month to date, forecasts linearly and gives cost per person per day', () => {
    const s = summarizeBudget({
      month: '2026-10',
      today: '2026-10-10',
      budgetMinor: 6_000_000,
      categorySplit: { staples: 0.5, produce_veg: 0.5 },
      categories: CATS,
      entries: [
        entry({ id: 'a', amountMinor: 1_500_000 }),
        entry({ id: 'b', amountMinor: 500_000, categoryId: 'c-veg' }),
        entry({ id: 'old', amountMinor: 900_000, spentOn: '2026-09-30' }),
      ],
      members: 4,
    });
    expect(s.spentMinor).toBe(2_000_000);
    expect(s.daysElapsed).toBe(10);
    expect(s.daysLeft).toBe(21);
    expect(s.forecastMinor).toBe(6_200_000);
    expect(s.status).toBe('forecast_over');
    expect(s.costPerPersonPerDayMinor).toBe(50_000);
    expect(s.byCategory).toEqual([
      {
        categoryId: 'c-staples',
        code: 'staples',
        spentMinor: 1_500_000,
        allocatedMinor: 3_000_000,
      },
      { categoryId: 'c-veg', code: 'produce_veg', spentMinor: 500_000, allocatedMinor: 3_000_000 },
    ]);
  });

  it('uses the 85 and 100 percent tones', () => {
    expect(budgetTone(80, 100)).toBe('success');
    expect(budgetTone(85, 100)).toBe('warning');
    expect(budgetTone(101, 100)).toBe('danger');
  });

  it('moves between months', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(monthDiff('2026-10', '2026-08')).toBe(-2);
    expect(splitIsValid({ staples: 0.6, dairy: 0.39 })).toBe(true);
    expect(splitIsValid({ staples: 0.6 })).toBe(false);
  });

  it('turns a shopping trip into spend by category', () => {
    expect(
      spendByCategory(
        [
          { aisle: 'sabzi', actualMinor: 40000 },
          { aisle: 'meat', actualMinor: 150000 },
          { aisle: 'dry_goods', actualMinor: null },
        ],
        null,
      ),
    ).toEqual({ produce_veg: 40000, protein_animal: 150000 });
    expect(spendByCategory([{ aisle: 'sabzi', actualMinor: null }], 250000)).toEqual({
      staples: 250000,
    });
  });

  it('shows queued spending offline and drops a queued entry that is removed', () => {
    const id = addBudgetEntry({
      householdId: 'h1',
      budgetProfileId: 'bp-1',
      amountMinor: 120000,
      currency: 'PKR',
      categoryId: 'c-veg',
      spentOn: '2026-10-06',
      groceryListId: null,
      note: 'Sabzi mandi',
    });
    const view = applyPendingEntries([entry({ id: 'a' })], useOutboxStore.getState().entries);
    expect(view.map((e) => [e.id, e.queued ?? false])).toEqual([
      [id, true],
      ['a', false],
    ]);
    removeBudgetEntry('h1', view[0] as BudgetEntryView);
    expect(useOutboxStore.getState().entries).toHaveLength(0);
  });
});
