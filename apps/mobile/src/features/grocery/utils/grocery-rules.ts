import type { OutboxEntry } from '@/lib/offline/outbox';

/**
 * Pure grocery list rules (02 §7.6.6 to §7.6.8, 14 §10, FR-GRO-02, -03, -06, -11). Offline-first:
 * every item write is an outbox entry, overlaid here on the server rows.
 */

export const GROCERY_ITEM_ADD_KIND = 'grocery.item.add';
export const GROCERY_ITEM_UPDATE_KIND = 'grocery.item.update';
export const GROCERY_ITEM_DELETE_KIND = 'grocery.item.delete';
export const GROCERY_LIST_STATUS_KIND = 'grocery.list.status';
export const PRICE_REPORT_KIND = 'grocery.price.report';

/** Aisle order of `grocery-generate` (sabzi first, 14 §10); unknown aisles sort last. */
export const AISLE_ORDER = [
  'sabzi',
  'fruit',
  'meat',
  'dairy',
  'dry_goods',
  'spices',
  'other',
] as const;
export type KnownAisle = (typeof AISLE_ORDER)[number];

export type ListStatus = 'open' | 'shopping' | 'done';

export interface GroceryListView {
  id: string;
  householdId: string;
  mealPlanId: string | null;
  period: 'weekly' | 'monthly' | 'adhoc';
  startsOn: string;
  endsOn: string;
  estimatedTotalMinor: number;
  currency: string;
  status: ListStatus;
  /** Null when the household's market has no price book (FR-GRO-11): no estimates shown. */
  priceProfileId: string | null;
}

export interface ShoppingItemView {
  id: string;
  groceryListId: string;
  ingredientId: string | null;
  label: string;
  quantity: number;
  unit: string;
  estimatedMinor: number | null;
  actualMinor: number | null;
  isChecked: boolean;
  substitutionForItemId: string | null;
  aisle: string | null;
  isFresh: boolean;
  sortOrder: number;
  updatedAt: string | null;
  queued?: boolean;
}

export interface ItemAddWrite {
  id: string;
  householdId: string;
  listId: string;
  label: string;
  quantity: number;
  unit: string;
  aisle: string;
  isFresh: boolean;
  /** Changes made before the new item reached the server travel with the insert. */
  checked?: boolean;
  actualMinor?: number | null;
}

/**
 * Field changes to one item, merged into a single queued entry per item (check-off, quantity,
 * actual price). `at` is the client time of the latest change and the last-write-wins guard
 * against `updated_at` (FR-GRO-02): a change made elsewhere later is never overwritten.
 */
export interface ItemUpdateWrite {
  itemId: string;
  householdId: string;
  listId: string;
  checked?: boolean;
  quantity?: number;
  actualMinor?: number | null;
  at: string;
}

export interface ItemDeleteWrite {
  itemId: string;
  householdId: string;
  listId: string;
}

export interface ListStatusWrite {
  listId: string;
  householdId: string;
  status: ListStatus;
}

/** A user price report (FR-GRO-06): becomes a `price_observations` row, `source = 'user_report'`. */
export interface PriceReportWrite {
  id: string;
  householdId: string;
  priceProfileId: string;
  ingredientId: string;
  unit: string;
  amountMinor: number;
  observedOn: string;
}

export const OBSERVATION_UNITS = [
  'g',
  'kg',
  'ml',
  'l',
  'piece',
  'dozen',
  'bunch',
  'lot',
  'bottle',
  'pack',
] as const;

/**
 * The observation for an actual price, or null when it cannot be one: no ingredient, no price book,
 * a unit the price book does not use, or a zero price. Price per one unit, rounded.
 */
export function priceReportFor(
  item: Pick<ShoppingItemView, 'ingredientId' | 'unit' | 'quantity'>,
  actualMinor: number,
  list: Pick<GroceryListView, 'priceProfileId' | 'householdId'>,
  ctx: { id: string; today: string },
): PriceReportWrite | null {
  if (!item.ingredientId || !list.priceProfileId) return null;
  if (!(OBSERVATION_UNITS as readonly string[]).includes(item.unit)) return null;
  if (!(actualMinor > 0) || !(item.quantity > 0)) return null;
  const perUnit = Math.round(actualMinor / item.quantity);
  if (perUnit <= 0) return null;
  return {
    id: ctx.id,
    householdId: list.householdId,
    priceProfileId: list.priceProfileId,
    ingredientId: item.ingredientId,
    unit: item.unit,
    amountMinor: perUnit,
    observedOn: ctx.today,
  };
}

/** Overlays queued item writes for one list (02 P10): check-offs, additions, edits, deletions. */
export function applyPendingItems(
  items: readonly ShoppingItemView[],
  entries: readonly OutboxEntry[],
  listId: string,
): ShoppingItemView[] {
  const byId = new Map(items.map((i) => [i.id, { ...i }]));
  for (const e of entries) {
    const p = e.payload as { listId?: string };
    if (p.listId !== listId) continue;
    if (e.kind === GROCERY_ITEM_ADD_KIND) {
      const w = e.payload as ItemAddWrite;
      if (!byId.has(w.id) || byId.get(w.id)?.queued)
        byId.set(w.id, {
          id: w.id,
          groceryListId: w.listId,
          ingredientId: null,
          label: w.label,
          quantity: w.quantity,
          unit: w.unit,
          estimatedMinor: null,
          actualMinor: w.actualMinor ?? null,
          isChecked: w.checked ?? false,
          substitutionForItemId: null,
          aisle: w.aisle,
          isFresh: w.isFresh,
          sortOrder: 9999,
          updatedAt: null,
          queued: true,
        });
    } else if (e.kind === GROCERY_ITEM_UPDATE_KIND) {
      const w = e.payload as ItemUpdateWrite;
      const i = byId.get(w.itemId);
      if (i)
        byId.set(w.itemId, {
          ...i,
          ...(w.checked !== undefined ? { isChecked: w.checked } : {}),
          ...(w.quantity !== undefined ? { quantity: w.quantity } : {}),
          ...(w.actualMinor !== undefined ? { actualMinor: w.actualMinor } : {}),
          queued: true,
        });
    } else if (e.kind === GROCERY_ITEM_DELETE_KIND) {
      byId.delete((e.payload as ItemDeleteWrite).itemId);
    }
  }
  return [...byId.values()];
}

/** The list status with a queued change applied. */
export function pendingListStatus(
  list: GroceryListView,
  entries: readonly OutboxEntry[],
): ListStatus {
  let status = list.status;
  for (const e of entries)
    if (e.kind === GROCERY_LIST_STATUS_KIND && (e.payload as ListStatusWrite).listId === list.id)
      status = (e.payload as ListStatusWrite).status;
  return status;
}

function aisleRank(aisle: string | null): number {
  const i = (AISLE_ORDER as readonly string[]).indexOf(aisle ?? 'other');
  return i === -1 ? AISLE_ORDER.length : i;
}

export interface AisleSection {
  aisle: string;
  items: ShoppingItemView[];
}

/** Items on the list proper: substitution suggestions are shown separately (premium panel). */
export function listItems(items: readonly ShoppingItemView[]): ShoppingItemView[] {
  return items.filter((i) => !i.substitutionForItemId);
}

export function substitutions(
  items: readonly ShoppingItemView[],
): Array<{ substitute: ShoppingItemView; original: ShoppingItemView; savesMinor: number | null }> {
  const byId = new Map(items.map((i) => [i.id, i]));
  return items.flatMap((s) => {
    const original = s.substitutionForItemId ? byId.get(s.substitutionForItemId) : undefined;
    if (!original) return [];
    const saves =
      original.estimatedMinor !== null && s.estimatedMinor !== null
        ? original.estimatedMinor - s.estimatedMinor
        : null;
    return [{ substitute: s, original, savesMinor: saves }];
  });
}

/**
 * Sections by aisle in shop order; inside an aisle fresh items ("buy this week") come first, then
 * by label. `excludeChecked` moves checked items out (shopping mode's "In basket").
 */
export function groupByAisle(
  items: readonly ShoppingItemView[],
  opts: { excludeChecked?: boolean } = {},
): AisleSection[] {
  const visible = listItems(items).filter((i) => !(opts.excludeChecked && i.isChecked));
  const sections = new Map<string, ShoppingItemView[]>();
  for (const i of visible) {
    const key = i.aisle && aisleRank(i.aisle) < AISLE_ORDER.length ? i.aisle : 'other';
    sections.set(key, [...(sections.get(key) ?? []), i]);
  }
  return [...sections.entries()]
    .sort(([a], [b]) => aisleRank(a) - aisleRank(b))
    .map(([aisle, list]) => ({
      aisle,
      items: list.sort(
        (a, b) =>
          Number(b.isFresh) - Number(a.isFresh) ||
          a.sortOrder - b.sortOrder ||
          a.label.localeCompare(b.label),
      ),
    }));
}

export function listTotals(items: readonly ShoppingItemView[]) {
  const proper = listItems(items);
  const estimated = proper.reduce((n, i) => n + (i.estimatedMinor ?? 0), 0);
  const actual = proper.reduce((n, i) => n + (i.actualMinor ?? 0), 0);
  return {
    estimatedMinor: estimated,
    actualMinor: actual,
    hasActuals: proper.some((i) => i.actualMinor !== null),
    checked: proper.filter((i) => i.isChecked).length,
    total: proper.length,
  };
}

/** Quantity for display: whole numbers without decimals, otherwise up to two. */
export function formatQuantity(q: number): string {
  return Number.isInteger(q) ? String(q) : String(Math.round(q * 100) / 100);
}

/**
 * WhatsApp-friendly text (FR-GRO-02): a title, aisle headings, one line per item with a box that
 * is ticked for checked items. No prices: the list is shared with whoever does the shopping.
 */
export function shareText(
  title: string,
  sections: readonly AisleSection[],
  aisleLabel: (aisle: string) => string,
  unitLabel: (unit: string) => string,
): string {
  const lines = [`*${title}*`];
  for (const s of sections) {
    lines.push('', `*${aisleLabel(s.aisle)}*`);
    for (const i of s.items)
      lines.push(
        `${i.isChecked ? '☑' : '☐'} ${i.label} (${formatQuantity(i.quantity)} ${unitLabel(i.unit)})`,
      );
  }
  return lines.join('\n');
}

export { money, parseMajorToMinor } from '@/lib/money/format-money';

export type ItemChange = Pick<ItemUpdateWrite, 'checked' | 'quantity' | 'actualMinor'>;

/**
 * The single queued write that carries a change to an item (offline check-off and edits): folded
 * into the item's queued insert when it has not reached the server yet, otherwise merged with any
 * queued update of the same item. One entry per item keeps the `updated_at` guard meaningful.
 */
export function itemChangeEntry(
  entries: readonly OutboxEntry[],
  item: { id: string; listId: string; householdId: string },
  change: ItemChange,
  at: string,
): { kind: string; dedupeKey: string; payload: ItemAddWrite | ItemUpdateWrite } {
  const add = entries.find(
    (e) => e.kind === GROCERY_ITEM_ADD_KIND && (e.payload as ItemAddWrite).id === item.id,
  );
  if (add) {
    const prev = add.payload as ItemAddWrite;
    return {
      kind: GROCERY_ITEM_ADD_KIND,
      dedupeKey: item.id,
      payload: {
        ...prev,
        ...(change.checked !== undefined ? { checked: change.checked } : {}),
        ...(change.quantity !== undefined ? { quantity: change.quantity } : {}),
        ...(change.actualMinor !== undefined ? { actualMinor: change.actualMinor } : {}),
      },
    };
  }
  const queued = entries.find(
    (e) => e.kind === GROCERY_ITEM_UPDATE_KIND && (e.payload as ItemUpdateWrite).itemId === item.id,
  );
  const prev = (queued?.payload as ItemUpdateWrite | undefined) ?? {};
  return {
    kind: GROCERY_ITEM_UPDATE_KIND,
    dedupeKey: item.id,
    payload: {
      ...prev,
      ...change,
      itemId: item.id,
      listId: item.listId,
      householdId: item.householdId,
      at,
    } as ItemUpdateWrite,
  };
}

/**
 * The plan week a weekly list covers: the 7-day block of the plan that contains `today` (the first
 * week before the plan starts, the last one after it ends), clipped to the plan's end.
 */
export function planWeekFor(
  plan: { startDate: string; endDate: string },
  today: string,
): { startsOn: string; endsOn: string } {
  const day = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const start = day(plan.startDate);
  const end = day(plan.endDate);
  const t = Math.min(Math.max(day(today), start), end);
  const week = Math.floor((t - start) / (7 * 86_400_000));
  const from = start + week * 7 * 86_400_000;
  return { startsOn: iso(from), endsOn: iso(Math.min(end, from + 6 * 86_400_000)) };
}
