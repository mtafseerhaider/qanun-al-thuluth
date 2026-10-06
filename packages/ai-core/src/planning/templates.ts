import type { CandidateSetWithPool } from './candidates.ts';
import type { Catalog, PlanMealType } from './types.ts';

/**
 * Free-tier curated weekly templates (S3-05, FR-PLAN-02, 14 §17, §19). Eight Pakistani family weeks
 * across budget tiers 1 to 3, referencing global meals by `meals.code` (seed
 * supabase/seed/catalog/092_meals.sql). A template is a starting grid: `template_personalize`
 * keeps every template meal that passes the engine's hard constraints for the household and asks
 * the `plan.adjust` route to choose among engine candidates for the rest.
 *
 * CONTENT REVIEW REQUIRED: the grids are drafts by the AI lane for dietitian and PO review (variety,
 * protein rhythm, cost tier, regional fit) before free users see them.
 */

export type TemplateDay = Partial<
  Record<Extract<PlanMealType, 'breakfast' | 'lunch' | 'snack' | 'dinner'>, string>
>;

export interface WeeklyTemplate {
  key: string;
  title: string;
  countryCode: 'PK';
  budgetTier: 1 | 2 | 3;
  /** Index 0 = Monday .. 6 = Sunday. */
  days: readonly [
    TemplateDay,
    TemplateDay,
    TemplateDay,
    TemplateDay,
    TemplateDay,
    TemplateDay,
    TemplateDay,
  ];
}

type Row = readonly [string, string, string, string];
const week = (rows: readonly [Row, Row, Row, Row, Row, Row, Row]): WeeklyTemplate['days'] =>
  rows.map(([breakfast, lunch, snack, dinner]) => ({
    breakfast,
    lunch,
    snack,
    dinner,
  })) as unknown as WeeklyTemplate['days'];

/**
 * Rows are Monday..Sunday as [breakfast, lunch, snack, dinner]. Rhythm follows 14 §8.5 where the
 * tier allows: chicken early in the week, daal mid-week, fish once a week from tier 2, red meat at
 * most three dinners, no deep-fried mains, legumes at least three times.
 */
export const PLAN_TEMPLATES: readonly WeeklyTemplate[] = [
  {
    key: 'pk_t1_daal_sabzi',
    title: 'Daal and sabzi week',
    countryCode: 'PK',
    budgetTier: 1,
    days: week([
      ['B001', 'L002', 'S001', 'D018'],
      ['B003', 'L012', 'S003', 'D001'],
      ['B005', 'L025', 'S004', 'D012'],
      ['B019', 'L019', 'S010', 'D027'],
      ['B007', 'L005', 'S015', 'D005'],
      ['B009', 'L009', 'S008', 'D015'],
      ['B021', 'L032', 'S014', 'D022'],
    ]),
  },
  {
    key: 'pk_t1_thrifty_eggs',
    title: 'Thrifty week with eggs and lentils',
    countryCode: 'PK',
    budgetTier: 1,
    days: week([
      ['B002', 'L013', 'S006', 'D002'],
      ['B004', 'L017', 'S001', 'D039'],
      ['B013', 'L026', 'S003', 'D033'],
      ['B006', 'L006', 'S013', 'D050'],
      ['B016', 'L030', 'S012', 'D012'],
      ['B010', 'L010', 'S009', 'D015'],
      ['B022', 'L031', 'S007', 'D001'],
    ]),
  },
  {
    key: 'pk_t1_seasonal_greens',
    title: 'Seasonal greens week',
    countryCode: 'PK',
    budgetTier: 1,
    days: week([
      ['B014', 'L021', 'S001', 'D012'],
      ['B017', 'L018', 'S004', 'D018'],
      ['B003', 'L033', 'S015', 'D005'],
      ['B008', 'L022', 'S010', 'D022'],
      ['B020', 'L014', 'S003', 'D039'],
      ['B011', 'L008', 'S013', 'D033'],
      ['B001', 'L035', 'S016', 'D015'],
    ]),
  },
  {
    key: 'pk_t2_lahore_family',
    title: 'Lahore family week',
    countryCode: 'PK',
    budgetTier: 2,
    days: week([
      ['B001', 'L002', 'S001', 'D006'],
      ['B003', 'L001', 'S003', 'D001'],
      ['B004', 'L012', 'S004', 'D010'],
      ['B002', 'L019', 'S010', 'D013'],
      ['B019', 'L005', 'S015', 'D021'],
      ['B009', 'L016', 'S008', 'D047'],
      ['B021', 'L007', 'S014', 'D007'],
    ]),
  },
  {
    key: 'pk_t2_weeknight_classics',
    title: 'Weeknight classics',
    countryCode: 'PK',
    budgetTier: 2,
    days: week([
      ['B012', 'L025', 'S006', 'D034'],
      ['B005', 'L017', 'S001', 'D027'],
      ['B013', 'L003', 'S003', 'D043'],
      ['B006', 'L020', 'S013', 'D025'],
      ['B007', 'L030', 'S009', 'D012'],
      ['B010', 'L029', 'S012', 'D011'],
      ['B022', 'L006', 'S004', 'D029'],
    ]),
  },
  {
    key: 'pk_t2_lunchbox',
    title: 'Lunchbox-friendly week',
    countryCode: 'PK',
    budgetTier: 2,
    days: week([
      ['B015', 'L027', 'S001', 'D017'],
      ['B004', 'L032', 'S015', 'D018'],
      ['B008', 'L028', 'S010', 'D049'],
      ['B014', 'L021', 'S003', 'D037'],
      ['B017', 'L013', 'S007', 'D005'],
      ['B011', 'L024', 'S006', 'D038'],
      ['B021', 'L034', 'S013', 'D028'],
    ]),
  },
  {
    key: 'pk_t3_weekend_dawat',
    title: 'Comfortable week with a weekend dawat',
    countryCode: 'PK',
    budgetTier: 3,
    days: week([
      ['B015', 'L029', 'S002', 'D042'],
      ['B004', 'L002', 'S005', 'D009'],
      ['B001', 'L003', 'S010', 'D020'],
      ['B012', 'L034', 'S013', 'D036'],
      ['B008', 'L005', 'S019', 'D021'],
      ['B016', 'L001', 'S017', 'D047'],
      ['B021', 'L007', 'S014', 'D014'],
    ]),
  },
  {
    key: 'pk_t3_fish_and_grills',
    title: 'Fish and grills week',
    countryCode: 'PK',
    budgetTier: 3,
    days: week([
      ['B002', 'L027', 'S005', 'D028'],
      ['B006', 'L018', 'S001', 'D044'],
      ['B013', 'L028', 'S002', 'D003'],
      ['B020', 'L023', 'S019', 'D030'],
      ['B019', 'L030', 'S004', 'D040'],
      ['B009', 'L011', 'S017', 'D031'],
      ['B018', 'L024', 'S013', 'D046'],
    ]),
  },
];

/** Monday-based index from a JS weekday (0 = Sunday). */
export const mondayIndex = (weekday: number): number => (weekday + 6) % 7;

/**
 * Budget tier from the active budget profile: PKR per person per month. Thresholds are a product
 * placeholder (PO to confirm against 14 §16 price data); non-PKR budgets use the middle tier.
 */
export function budgetTierFor(
  monthlyAmountMinor: number | null,
  currency: string | null,
  people: number,
): 1 | 2 | 3 | null {
  if (monthlyAmountMinor === null) return null;
  if (currency !== 'PKR') return 2;
  const perPersonPkr = monthlyAmountMinor / 100 / Math.max(1, people);
  if (perPersonPkr < 10_000) return 1;
  if (perPersonPkr < 20_000) return 2;
  return 3;
}

/** Templates for a tier (falls back to the nearest tier), rotated by `rotation` (e.g. plan count). */
export function chooseTemplate(
  budgetTier: 1 | 2 | 3 | null,
  rotation: number,
  templates: readonly WeeklyTemplate[] = PLAN_TEMPLATES,
): WeeklyTemplate | null {
  if (!templates.length) return null;
  const tier = budgetTier ?? 2;
  for (const t of [tier, 2, 1, 3]) {
    const pool = templates.filter((x) => x.budgetTier === t);
    if (pool.length) return pool[Math.abs(rotation) % pool.length] ?? null;
  }
  return null;
}

/**
 * Template slots that survive the household's hard constraints (the meal is in the slot's feasible
 * pool). Everything else is a swap slot for the light personalisation step.
 */
export function templateChoices(
  template: WeeklyTemplate,
  sets: readonly CandidateSetWithPool[],
  catalog: Catalog,
): { fixed: Map<string, string>; swapSlots: string[] } {
  const byCode = new Map<string, string>();
  for (const m of catalog.meals.values()) if (m.code) byCode.set(m.code, m.id);
  const fixed = new Map<string, string>();
  const swapSlots: string[] = [];
  for (const set of sets) {
    const day = template.days[mondayIndex(set.slot.weekday)];
    const code = day?.[set.slot.mealType as keyof TemplateDay];
    const mealId = code ? byCode.get(code) : undefined;
    if (mealId && set.pool.includes(mealId)) fixed.set(set.slot.ref, mealId);
    else swapSlots.push(set.slot.ref);
  }
  return { fixed, swapSlots };
}
