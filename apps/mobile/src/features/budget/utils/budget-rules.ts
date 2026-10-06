import type { OutboxEntry } from '@/lib/offline/outbox';

/**
 * Budget dashboard maths (02 §7.12.9, 14 §11.4, FR-GRO-07 to -09). Pure: the dashboard numbers
 * are sums over `budget_entries`, so they can be checked against SQL aggregates in tests.
 */

export const BUDGET_ENTRY_KIND = 'budget.entry';
export const BUDGET_ENTRY_DELETE_KIND = 'budget.entry.delete';

export type Strictness = 'flexible' | 'target' | 'hard_cap';

export interface BudgetProfileView {
  id: string;
  monthlyAmountMinor: number;
  currency: string;
  strictness: Strictness;
  /** category code to share, values sum to about 1 (05 §11.1). */
  categorySplit: Record<string, number>;
}

export interface BudgetCategoryView {
  id: string;
  code: string;
  nameI18n: unknown;
  sortOrder: number;
}

export interface BudgetEntryView {
  id: string;
  amountMinor: number;
  currency: string;
  categoryId: string;
  spentOn: string;
  groceryListId: string | null;
  note: string | null;
  queued?: boolean;
}

/** Outbox payload; `id` is the row id and the idempotency key. */
export interface BudgetEntryWrite {
  id: string;
  householdId: string;
  budgetProfileId: string;
  amountMinor: number;
  currency: string;
  categoryId: string;
  spentOn: string;
  groceryListId: string | null;
  note: string | null;
}

export interface BudgetEntryDeleteWrite {
  id: string;
  householdId: string;
}

/** `YYYY-MM` of an ISO date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthBounds(month: string): { from: string; to: string } {
  return { from: `${month}-01`, to: `${month}-${String(daysInMonth(month)).padStart(2, '0')}` };
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Months from `a` to `b` (b - a). */
export function monthDiff(a: string, b: string): number {
  const [ya, ma] = a.split('-').map(Number) as [number, number];
  const [yb, mb] = b.split('-').map(Number) as [number, number];
  return (yb - ya) * 12 + (mb - ma);
}

export type BudgetTone = 'success' | 'warning' | 'danger';

/** 08 §5.11: below 85 percent success, 85 to 100 warning, over 100 danger. */
export function budgetTone(spentMinor: number, budgetMinor: number): BudgetTone {
  if (budgetMinor <= 0) return 'success';
  const r = spentMinor / budgetMinor;
  if (r > 1) return 'danger';
  if (r >= 0.85) return 'warning';
  return 'success';
}

export interface BudgetSummary {
  spentMinor: number;
  budgetMinor: number;
  /** Days elapsed in the month, including today (all days for a past month). */
  daysElapsed: number;
  daysLeft: number;
  /** Linear projection to the month end (FR-GRO-09). */
  forecastMinor: number;
  status: 'on_track' | 'near' | 'over' | 'forecast_over';
  tone: BudgetTone;
  /** Spend per family member per elapsed day; null without members or spend days. */
  costPerPersonPerDayMinor: number | null;
  byCategory: Array<{
    categoryId: string;
    code: string;
    spentMinor: number;
    allocatedMinor: number | null;
  }>;
}

export function summarizeBudget(input: {
  month: string;
  today: string;
  budgetMinor: number;
  categorySplit: Record<string, number>;
  categories: readonly BudgetCategoryView[];
  entries: readonly BudgetEntryView[];
  members: number;
}): BudgetSummary {
  const { month, today, budgetMinor } = input;
  const total = daysInMonth(month);
  const thisMonth = monthOf(today);
  const daysElapsed =
    month < thisMonth ? total : month > thisMonth ? 0 : Math.min(total, Number(today.slice(8, 10)));
  const inMonth = input.entries.filter((e) => monthOf(e.spentOn) === month);
  const spent = inMonth.reduce((n, e) => n + e.amountMinor, 0);
  const forecast = daysElapsed > 0 ? Math.round((spent / daysElapsed) * total) : spent;
  const tone = budgetTone(spent, budgetMinor);
  const status: BudgetSummary['status'] =
    budgetMinor > 0 && spent > budgetMinor
      ? 'over'
      : tone === 'warning'
        ? 'near'
        : budgetMinor > 0 && forecast > budgetMinor
          ? 'forecast_over'
          : 'on_track';
  const byId = new Map(input.categories.map((c) => [c.id, c]));
  const spentByCategory = new Map<string, number>();
  for (const e of inMonth)
    spentByCategory.set(e.categoryId, (spentByCategory.get(e.categoryId) ?? 0) + e.amountMinor);
  const byCategory = [...input.categories]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => {
      const share = input.categorySplit[c.code];
      return {
        categoryId: c.id,
        code: c.code,
        spentMinor: spentByCategory.get(c.id) ?? 0,
        allocatedMinor:
          typeof share === 'number' && budgetMinor > 0 ? Math.round(share * budgetMinor) : null,
      };
    })
    .filter((c) => c.spentMinor > 0 || c.allocatedMinor !== null);
  // Entries in categories unknown to this client still count in the total.
  for (const [id, minor] of spentByCategory)
    if (!byId.has(id))
      byCategory.push({ categoryId: id, code: 'other', spentMinor: minor, allocatedMinor: null });
  return {
    spentMinor: spent,
    budgetMinor,
    daysElapsed,
    daysLeft: Math.max(0, total - daysElapsed),
    forecastMinor: forecast,
    status,
    tone,
    costPerPersonPerDayMinor:
      input.members > 0 && daysElapsed > 0 ? Math.round(spent / input.members / daysElapsed) : null,
    byCategory,
  };
}

/** Aisle of a shopping item to the budget category it is spent from (14 §11.4). */
export const AISLE_TO_CATEGORY: Record<string, string> = {
  sabzi: 'produce_veg',
  fruit: 'produce_fruit',
  meat: 'protein_animal',
  dairy: 'dairy',
  dry_goods: 'staples',
  spices: 'spices',
  other: 'staples',
};

/**
 * Spend from a finished shopping trip: one amount per budget category from the actual prices, or
 * the typed total in staples when no actual prices were entered.
 */
export function spendByCategory(
  items: ReadonlyArray<{ aisle: string | null; actualMinor: number | null }>,
  typedTotalMinor: number | null,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) {
    if (!i.actualMinor) continue;
    const code = AISLE_TO_CATEGORY[i.aisle ?? 'other'] ?? 'staples';
    out[code] = (out[code] ?? 0) + i.actualMinor;
  }
  if (Object.keys(out).length === 0 && typedTotalMinor && typedTotalMinor > 0)
    out.staples = typedTotalMinor;
  return out;
}

export function applyPendingEntries(
  entries: readonly BudgetEntryView[],
  outbox: readonly OutboxEntry[],
): BudgetEntryView[] {
  const deleted = new Set<string>();
  const added: BudgetEntryView[] = [];
  for (const e of outbox) {
    if (e.kind === BUDGET_ENTRY_DELETE_KIND) deleted.add((e.payload as BudgetEntryDeleteWrite).id);
    if (e.kind === BUDGET_ENTRY_KIND) {
      const w = e.payload as BudgetEntryWrite;
      added.push({
        id: w.id,
        amountMinor: w.amountMinor,
        currency: w.currency,
        categoryId: w.categoryId,
        spentOn: w.spentOn,
        groceryListId: w.groceryListId,
        note: w.note,
        queued: true,
      });
    }
  }
  const known = new Set(entries.map((e) => e.id));
  return [...entries, ...added.filter((a) => !known.has(a.id))]
    .filter((e) => !deleted.has(e.id))
    .sort((a, b) => b.spentOn.localeCompare(a.spentOn));
}

/** Shares must sum to 1 within 0.02 (05 §11.1, validated server-side too). */
export function splitIsValid(split: Record<string, number>): boolean {
  const values = Object.values(split);
  if (values.length === 0) return true;
  if (values.some((v) => !(v >= 0) || v > 1)) return false;
  return Math.abs(values.reduce((n, v) => n + v, 0) - 1) <= 0.02;
}
