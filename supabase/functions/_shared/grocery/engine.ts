/**
 * Deterministic grocery math (14 §10 to §13): plan servings → raw ingredient grams → purchase
 * units → price estimate → budget status → premium budget optimiser. No I/O here; the stores load
 * the rows and the handlers write the results. Used by `grocery-generate` and by `ai-adjust-plan`
 * (`budget_delta_minor`).
 */

export type LifeStage = 'infant' | 'toddler' | 'child' | 'teen' | 'adult' | 'older_adult';

export const BUDGET_CATEGORY_CODES = [
  'staples',
  'protein_animal',
  'protein_plant',
  'dairy',
  'produce_veg',
  'produce_fruit',
  'oils_fats',
  'spices',
  'beverages',
  'snacks',
] as const;
export type BudgetCategoryCode = (typeof BUDGET_CATEGORY_CODES)[number];

/** Default Pakistan category split for a family of four (14 §11.1). */
export const DEFAULT_CATEGORY_SPLIT: Record<BudgetCategoryCode, number> = {
  staples: 0.14,
  protein_animal: 0.33,
  protein_plant: 0.06,
  dairy: 0.18,
  produce_veg: 0.12,
  produce_fruit: 0.08,
  oils_fats: 0.04,
  spices: 0.02,
  beverages: 0.01,
  snacks: 0.02,
};

export interface PurchaseUnit {
  unit: string;
  grams: number;
}

export interface GroceryIngredient {
  id: string;
  name: string;
  name_i18n: Record<string, string>;
  category: string;
  budget_category: string;
  default_unit: string;
  grams_per_unit: number | null;
  shelf_life_days: number | null;
  purchase_units: PurchaseUnit[];
  aisle: string | null;
  halal_status: 'halal' | 'haram' | 'mashbooh' | 'depends_on_source';
  allergen_codes: string[];
  /** Per 100 g; null when unknown. */
  nutrients: {
    protein_g: number | null;
    iron_mg: number | null;
    calcium_mg: number | null;
    fiber_g: number | null;
  };
}

export type MealComponent =
  | {
      kind: 'recipe';
      /** `servings_share`: recipe servings per adult serving of the meal (default 1). */
      share: number;
      servings: number;
      ingredients: Array<{ ingredient_id: string; grams: number; optional: boolean }>;
    }
  | { kind: 'ingredient'; ingredient_ids: string[]; grams_per_adult: number };

export interface MealRecipe {
  meal_id: string;
  /** Cooked grams of the adult `standard` portion, the scale reference for other portions. */
  adult_portion_grams: number | null;
  components: MealComponent[];
}

/** One member's serving of one planned slot (leftover slots are excluded by the store). */
export interface PlannedServing {
  plan_date: string;
  daily_meal_id: string;
  /** `daily_meal_servings.adapted_meal_id ?? daily_meals.meal_id`. */
  meal_id: string;
  /** `daily_meals.meal_id`: whose adult portion scales `portion_grams`. */
  base_meal_id: string;
  batch_multiplier: number;
  life_stage: LifeStage;
  portion_grams: number | null;
  /** `daily_meals.meal_type`; used by Ramadan lists (iftar dates). */
  meal_type?: string;
}

/**
 * Share of an adult serving by life stage, used when the serving has no portion row. Children's
 * shares follow the 092 seed's reference portions (child 1/2, toddler 1/3 of the adult serving).
 */
export const LIFE_STAGE_FACTOR: Record<LifeStage, number> = {
  infant: 0,
  toddler: 1 / 3,
  child: 0.5,
  teen: 1,
  adult: 1,
  older_adult: 0.9,
};

/** Default raw grams for an ingredient side without a recipe (1 fist of vegetables, 14 §6.2). */
export const SIDE_GRAMS_PER_ADULT = 80;

/** Never put on a shopping list. */
const NOT_SHOPPED = new Set(['water']);

/** Raw grams per adult serving of a meal, by ingredient (optional recipe ingredients skipped). */
export function gramsPerAdultServing(meal: MealRecipe): Map<string, number> {
  const out = new Map<string, number>();
  const add = (id: string, g: number) => out.set(id, (out.get(id) ?? 0) + g);
  for (const c of meal.components) {
    if (c.kind === 'recipe') {
      const servings = c.servings > 0 ? c.servings : 1;
      for (const ri of c.ingredients) {
        if (ri.optional) continue;
        add(ri.ingredient_id, (ri.grams / servings) * (c.share > 0 ? c.share : 1));
      }
    } else if (c.ingredient_ids.length) {
      const each = c.grams_per_adult / c.ingredient_ids.length;
      for (const id of c.ingredient_ids) add(id, each);
    }
  }
  return out;
}

/** Share of an adult serving one member's serving represents. */
export function servingFactor(s: PlannedServing, meals: Map<string, MealRecipe>): number {
  const ref =
    meals.get(s.base_meal_id)?.adult_portion_grams ?? meals.get(s.meal_id)?.adult_portion_grams;
  if (s.portion_grams && ref && ref > 0) return s.portion_grams / ref;
  return LIFE_STAGE_FACTOR[s.life_stage] ?? 1;
}

/** 14 §10.1: Σ over servings of raw grams × serving factor × batch multiplier. */
export function aggregateNeed(
  servings: readonly PlannedServing[],
  meals: Map<string, MealRecipe>,
): { need: Map<string, number>; missingMeals: string[] } {
  const need = new Map<string, number>();
  const missing = new Set<string>();
  const perMeal = new Map<string, Map<string, number>>();
  for (const s of servings) {
    const meal = meals.get(s.meal_id);
    if (!meal) {
      missing.add(s.meal_id);
      continue;
    }
    let grams = perMeal.get(meal.meal_id);
    if (!grams) {
      grams = gramsPerAdultServing(meal);
      perMeal.set(meal.meal_id, grams);
    }
    const factor = servingFactor(s, meals) * (s.batch_multiplier > 0 ? s.batch_multiplier : 1);
    if (factor <= 0) continue;
    for (const [id, g] of grams) need.set(id, (need.get(id) ?? 0) + g * factor);
  }
  return { need, missingMeals: [...missing] };
}

export function derivedAisle(i: Pick<GroceryIngredient, 'aisle' | 'category'>): string {
  if (i.aisle) return i.aisle;
  switch (i.category) {
    case 'vegetable':
      return 'sabzi';
    case 'fruit':
      return 'fruit';
    case 'meat':
    case 'poultry':
    case 'fish':
    case 'egg':
      return 'meat';
    case 'dairy':
      return 'dairy';
    case 'spice_herb':
    case 'condiment':
      return 'spices';
    default:
      return 'dry_goods';
  }
}

/** 14 §10.4: shelf life of 10 days or less, or a fresh aisle. */
export function isFresh(
  i: Pick<GroceryIngredient, 'aisle' | 'category' | 'shelf_life_days'>,
): boolean {
  if (i.shelf_life_days !== null && i.shelf_life_days <= 10) return true;
  return ['sabzi', 'fruit', 'meat', 'dairy'].includes(derivedAisle(i));
}

const isProduce = (i: Pick<GroceryIngredient, 'category'>) =>
  i.category === 'vegetable' || i.category === 'fruit';

/** +5 percent trim for produce, nothing for dry goods (14 §10.1). */
export function applyWaste(need: Map<string, number>, ingredients: Map<string, GroceryIngredient>) {
  const out = new Map<string, number>();
  for (const [id, g] of need) {
    const ing = ingredients.get(id);
    out.set(id, ing && isProduce(ing) ? g * 1.05 : g);
  }
  return out;
}

export interface PantryRow {
  ingredient_id: string | null;
  grams: number;
  expires_on: string | null;
}

/** 14 §10.3: pantry stock reduces need; expired stock does not count; under 1 g is dropped. */
export function deductPantry(
  need: Map<string, number>,
  pantry: readonly PantryRow[],
  today: string,
) {
  const out = new Map(need);
  for (const p of pantry) {
    if (!p.ingredient_id) continue;
    if (p.expires_on && p.expires_on < today) continue;
    const n = out.get(p.ingredient_id);
    if (n === undefined) continue;
    out.set(p.ingredient_id, Math.max(0, n - p.grams));
  }
  for (const [k, v] of out) if (v < 1) out.delete(k);
  return out;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * "I already have this" labels (request `pantry_exclusions`): an ingredient is excluded when a
 * label equals its name, a translated name, or the name before the bracket ("Onion" for
 * "Onion (pyaz)").
 */
export function matchesExclusion(i: GroceryIngredient, labels: ReadonlySet<string>): boolean {
  if (!labels.size) return false;
  const names = [i.name, ...Object.values(i.name_i18n ?? {})].map(norm);
  for (const n of [...names]) {
    const head = n.split('(')[0]?.trim();
    if (head) names.push(head);
    const inner = /\(([^)]+)\)/.exec(n)?.[1]?.trim();
    if (inner) names.push(inner);
  }
  return names.some((n) => labels.has(n));
}

/** Purchase unit options: catalog `purchase_units`, else the default unit, else kg. */
export function purchaseUnitsFor(i: GroceryIngredient): PurchaseUnit[] {
  const listed = (i.purchase_units ?? []).filter((u) => u && u.grams > 0);
  if (listed.length) return listed;
  const g = i.grams_per_unit && i.grams_per_unit > 0 ? Number(i.grams_per_unit) : null;
  switch (i.default_unit) {
    case 'dozen':
    case 'piece':
    case 'bunch':
    case 'lot':
      if (g) return [{ unit: i.default_unit, grams: g }];
      break;
    case 'l':
    case 'ml':
      return [{ unit: 'L', grams: g && i.default_unit === 'l' ? g : 1000 }];
  }
  return [{ unit: 'kg', grams: 1000 }];
}

/** Rounding step per unit (14 §10.2): kg and L by 0.25 under 2, else 0.5; dozen by half. */
export function roundingStep(unit: string, packs: number): number {
  if (unit === 'kg' || unit === 'L') return packs < 2 ? 0.25 : 0.5;
  if (unit === 'dozen') return 0.5;
  return 1;
}

export interface ChosenUnit {
  unit: string;
  unit_grams: number;
  quantity: number;
}

/**
 * Picks the unit minimising (waste grams × price per gram) + (packs × 0.01) (14 §10.2). Without a
 * price, waste grams alone decide.
 */
export function choosePurchaseUnit(
  grams: number,
  units: readonly PurchaseUnit[],
  pricePerKgMinor: number | null,
): ChosenUnit {
  let best: (ChosenUnit & { cost: number }) | null = null;
  const perGram = pricePerKgMinor ? pricePerKgMinor / 1000 : 1;
  for (const u of units) {
    const raw = grams / u.grams;
    const step = roundingStep(u.unit, raw);
    const quantity = Math.max(step, Math.ceil(raw / step - 1e-9) * step);
    const waste = quantity * u.grams - grams;
    const cost = waste * perGram + quantity * 0.01;
    if (!best || cost < best.cost) best = { unit: u.unit, unit_grams: u.grams, quantity, cost };
  }
  const chosen = best ?? {
    unit: 'kg',
    unit_grams: 1000,
    quantity: Math.max(0.25, Math.ceil(grams / 250) / 4),
    cost: 0,
  };
  return {
    unit: chosen.unit,
    unit_grams: chosen.unit_grams,
    quantity: Number(chosen.quantity.toFixed(2)),
  };
}

export interface ListItem {
  key: string;
  ingredient_id: string;
  label: string;
  need_grams: number;
  quantity: number;
  unit: string;
  unit_grams: number;
  /** Null when the price book has no price for this ingredient. */
  estimated_minor: number | null;
  price_per_kg_minor: number | null;
  is_fresh: boolean;
  aisle: string;
  category_code: string;
  /** Set on a substitute: the key of the item it replaces. */
  substitution_for: string | null;
  /** Set on a replaced item: it stays on the list (hidden in the UI) for transparency and undo. */
  replaced: boolean;
}

export function buildItems(
  need: Map<string, number>,
  ingredients: Map<string, GroceryIngredient>,
  prices: Map<string, number>,
  locale: 'en' | 'ur' = 'en',
): ListItem[] {
  const items: ListItem[] = [];
  for (const [id, grams] of need) {
    const ing = ingredients.get(id);
    if (!ing || grams <= 0 || NOT_SHOPPED.has(norm(ing.name))) continue;
    items.push(itemFor(ing, grams, prices.get(id) ?? null, locale));
  }
  return sortItems(items);
}

export function itemFor(
  ing: GroceryIngredient,
  grams: number,
  pricePerKg: number | null,
  locale: 'en' | 'ur' = 'en',
): ListItem {
  const unit = choosePurchaseUnit(grams, purchaseUnitsFor(ing), pricePerKg);
  return {
    key: ing.id,
    ingredient_id: ing.id,
    label: (locale === 'ur' ? ing.name_i18n?.ur : null) ?? ing.name,
    need_grams: Math.round(grams),
    quantity: unit.quantity,
    unit: unit.unit,
    unit_grams: unit.unit_grams,
    estimated_minor:
      pricePerKg === null
        ? null
        : Math.round((unit.quantity * unit.unit_grams * pricePerKg) / 1000),
    price_per_kg_minor: pricePerKg,
    is_fresh: isFresh(ing),
    aisle: derivedAisle(ing),
    category_code: ing.budget_category,
    substitution_for: null,
    replaced: false,
  };
}

const AISLE_ORDER = ['sabzi', 'fruit', 'meat', 'dairy', 'dry_goods', 'spices', 'other'];

export function sortItems(items: ListItem[]): ListItem[] {
  return items.sort(
    (a, b) =>
      AISLE_ORDER.indexOf(a.aisle) - AISLE_ORDER.indexOf(b.aisle) || a.label.localeCompare(b.label),
  );
}

/** Items counted in totals: replaced originals are not bought. */
export const activeItems = (items: readonly ListItem[]) => items.filter((i) => !i.replaced);

export function totalMinor(items: readonly ListItem[]): number {
  return activeItems(items).reduce((s, i) => s + (i.estimated_minor ?? 0), 0);
}

export function priceCoverage(items: readonly ListItem[]): number {
  const active = activeItems(items);
  if (!active.length) return 1;
  return Number(
    (active.filter((i) => i.estimated_minor !== null).length / active.length).toFixed(3),
  );
}

// ---- budget ---------------------------------------------------------------------------------------

export interface BudgetProfile {
  id: string;
  monthly_amount_minor: number;
  currency: string;
  strictness: 'flexible' | 'target' | 'hard_cap';
  category_split: Record<string, number>;
}

export const AVG_DAYS_PER_MONTH = 30.44;

/** The envelope for a list covering `days` days (monthly lists use the whole month). */
export function periodTarget(
  budget: BudgetProfile,
  days: number,
  period: 'weekly' | 'monthly',
): number {
  if (period === 'monthly' && days >= 28) return budget.monthly_amount_minor;
  return Math.round((budget.monthly_amount_minor * days) / AVG_DAYS_PER_MONTH);
}

export function categorySplit(budget: BudgetProfile): Record<string, number> {
  const split = budget.category_split ?? {};
  const sum = Object.values(split).reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);
  return sum > 0.5 ? split : DEFAULT_CATEGORY_SPLIT;
}

/** Status thresholds: near from 90 percent of the target; over above it. */
export function budgetStatus(
  total: number,
  target: number | null,
): 'no_budget' | 'under' | 'near' | 'over' {
  if (target === null) return 'no_budget';
  if (total > target) return 'over';
  if (total >= target * 0.9) return 'near';
  return 'under';
}

export function byCategory(
  items: readonly ListItem[],
  target: number | null,
  budget: BudgetProfile | null,
) {
  const sums = new Map<string, number>();
  for (const i of activeItems(items)) {
    sums.set(i.category_code, (sums.get(i.category_code) ?? 0) + (i.estimated_minor ?? 0));
  }
  const split = budget ? categorySplit(budget) : null;
  return [...sums.entries()]
    .sort(
      (a, b) =>
        (BUDGET_CATEGORY_CODES as readonly string[]).indexOf(a[0]) -
        (BUDGET_CATEGORY_CODES as readonly string[]).indexOf(b[0]),
    )
    .map(([category_code, estimated_minor]) => ({
      category_code,
      estimated_minor,
      target_minor:
        target !== null && split ? Math.round(target * (split[category_code] ?? 0)) : null,
    }));
}

// ---- substitutions (14 §11.2, §13) -----------------------------------------------------------------

export type SubstitutionReason = 'availability' | 'season' | 'budget';

export interface SubstitutionRule {
  from_ingredient_id: string;
  to_ingredient_id: string;
  reason: SubstitutionReason | 'allergy' | 'halal' | 'preference';
  ratio: number;
  nutrient_similarity: number;
  culinary_fit: number;
  label?: string | null;
  region_codes?: string[] | null;
}

/**
 * Seed swap rules by ingredient name (14 §11.3 and §13.3 budget and season rows), used until ops
 * fill `ingredient_substitutions`. Names are the 040 catalog names (lower case).
 */
export const BUILT_IN_RULES: Array<{
  from: string;
  to: string;
  reason: SubstitutionReason;
  ratio: number;
  nutrient_similarity: number;
  culinary_fit: number;
  label: string;
}> = [
  {
    from: 'beef, boneless',
    to: 'chicken, whole, with bone',
    reason: 'budget',
    ratio: 1.3,
    nutrient_similarity: 0.85,
    culinary_fit: 3,
    label: 'Chicken with bone instead of boneless beef',
  },
  {
    from: 'mutton (goat meat)',
    to: 'chicken, whole, with bone',
    reason: 'budget',
    ratio: 1.0,
    nutrient_similarity: 0.85,
    culinary_fit: 2,
    label: 'Chicken instead of mutton',
  },
  {
    from: 'olive oil',
    to: 'canola oil',
    reason: 'budget',
    ratio: 1.0,
    nutrient_similarity: 0.9,
    culinary_fit: 3,
    label: 'Canola oil for cooking; keep olive oil for drizzles',
  },
  {
    from: 'walnuts (akhrot)',
    to: 'peanuts (moongphali)',
    reason: 'budget',
    ratio: 1.0,
    nutrient_similarity: 0.8,
    culinary_fit: 2,
    label: 'Peanuts instead of walnuts',
  },
  {
    from: 'almonds (badam)',
    to: 'peanuts (moongphali)',
    reason: 'budget',
    ratio: 1.0,
    nutrient_similarity: 0.85,
    culinary_fit: 2,
    label: 'Peanuts instead of almonds',
  },
  {
    from: 'cashews (kaju)',
    to: 'peanuts (moongphali)',
    reason: 'budget',
    ratio: 1.0,
    nutrient_similarity: 0.85,
    culinary_fit: 2,
    label: 'Peanuts instead of cashews',
  },
  {
    from: 'oats (jai)',
    to: 'broken wheat (daliya)',
    reason: 'budget',
    ratio: 1.0,
    nutrient_similarity: 0.85,
    culinary_fit: 2,
    label: 'Daliya instead of oats',
  },
  {
    from: 'guava (amrood)',
    to: 'kinnow (mandarin)',
    reason: 'season',
    ratio: 1.0,
    nutrient_similarity: 0.8,
    culinary_fit: 3,
    label: 'Seasonal kinnow instead of guava',
  },
  {
    from: 'spinach (palak)',
    to: 'bottle gourd (lauki)',
    reason: 'season',
    ratio: 1.0,
    nutrient_similarity: 0.6,
    culinary_fit: 2,
    label: 'Lauki instead of out-of-season spinach',
  },
  {
    from: 'turnip (shalgam)',
    to: 'bottle gourd (lauki)',
    reason: 'season',
    ratio: 1.0,
    nutrient_similarity: 0.7,
    culinary_fit: 2,
    label: 'Lauki instead of out-of-season turnip',
  },
  {
    from: 'apple (saib)',
    to: 'guava (amrood)',
    reason: 'season',
    ratio: 1.0,
    nutrient_similarity: 0.7,
    culinary_fit: 3,
    label: 'Seasonal guava instead of apples',
  },
];

export function builtInRules(ingredients: Iterable<GroceryIngredient>): SubstitutionRule[] {
  const byName = new Map<string, string>();
  for (const i of ingredients) byName.set(norm(i.name), i.id);
  return BUILT_IN_RULES.flatMap((r) => {
    const from = byName.get(r.from);
    const to = byName.get(r.to);
    return from && to
      ? [
          {
            from_ingredient_id: from,
            to_ingredient_id: to,
            reason: r.reason,
            ratio: r.ratio,
            nutrient_similarity: r.nutrient_similarity,
            culinary_fit: r.culinary_fit,
            label: r.label,
          },
        ]
      : [];
  });
}

export interface OptimiseContext {
  ingredients: Map<string, GroceryIngredient>;
  prices: Map<string, number>;
  /** Household members' allergen codes (any severity): a substitute must contain none. */
  allergenCodes: ReadonlySet<string>;
  allowMashbooh: boolean;
  /** Ingredient ids a member dislikes for religious reasons or strongly (never introduced). */
  avoidIngredientIds: ReadonlySet<string>;
  /** Availability this month for the household region. */
  seasonal: Map<string, 'peak' | 'available' | 'scarce'>;
  regionCode: string | null;
  locale: 'en' | 'ur';
}

export interface AppliedSubstitution {
  from_key: string;
  to_key: string;
  label: string;
  saves_minor: number;
  reason: SubstitutionReason;
}

const NUTRIENT_WEIGHTS = { protein_g: 3, iron_mg: 3, calcium_mg: 2, fiber_g: 2 } as const;

/** Weighted relative loss of key nutrients (0..1) when `from` grams become `to` grams × ratio. */
export function nutrientLoss(
  from: GroceryIngredient,
  to: GroceryIngredient,
  ratio: number,
): number {
  let loss = 0;
  let weights = 0;
  for (const [k, w] of Object.entries(NUTRIENT_WEIGHTS) as Array<
    [keyof typeof NUTRIENT_WEIGHTS, number]
  >) {
    const a = from.nutrients[k];
    const b = to.nutrients[k];
    if (a === null || a <= 0) continue;
    weights += w;
    loss += w * Math.max(0, (a - (b ?? 0) * ratio) / a);
  }
  return weights ? loss / weights : 0;
}

function substituteAllowed(
  to: GroceryIngredient,
  rule: SubstitutionRule,
  ctx: OptimiseContext,
): boolean {
  if (to.halal_status === 'haram') return false;
  if (to.halal_status === 'mashbooh' && !ctx.allowMashbooh) return false;
  if (to.allergen_codes.some((c) => ctx.allergenCodes.has(c))) return false;
  if (ctx.avoidIngredientIds.has(to.id)) return false;
  if (ctx.seasonal.get(to.id) === 'scarce') return false;
  if (rule.region_codes?.length && (!ctx.regionCode || !rule.region_codes.includes(ctx.regionCode)))
    return false;
  return true;
}

const REASON_PRIORITY: Record<SubstitutionReason, number> = {
  availability: 0,
  season: 1,
  budget: 2,
};

/**
 * Greedy marginal-savings optimiser (14 §11.2): when the estimate exceeds the target (×1.10 for
 * `flexible`), apply the swap with the best saving per unit of nutrient loss until under target.
 * Season and availability swaps qualify only when the original is scarce or unpriced this month.
 * Applied swaps keep the original row (`replaced`) and add the substitute with
 * `substitution_for` pointing at it.
 */
export function optimise(
  items: ListItem[],
  target: number,
  strictness: BudgetProfile['strictness'],
  rules: readonly SubstitutionRule[],
  ctx: OptimiseContext,
): { items: ListItem[]; applied: AppliedSubstitution[]; feasible: boolean } {
  const limit = strictness === 'flexible' ? Math.round(target * 1.1) : target;
  const applied: AppliedSubstitution[] = [];
  let total = totalMinor(items);
  if (total <= limit) return { items, applied, feasible: true };

  type Candidate = {
    item: ListItem;
    rule: SubstitutionRule;
    to: GroceryIngredient;
    saving: number;
    score: number;
    reason: SubstitutionReason;
  };
  const candidates: Candidate[] = [];
  for (const item of activeItems(items)) {
    if (item.estimated_minor === null) continue;
    const from = ctx.ingredients.get(item.ingredient_id);
    if (!from) continue;
    for (const rule of rules) {
      if (rule.from_ingredient_id !== item.ingredient_id) continue;
      if (rule.reason !== 'budget' && rule.reason !== 'season' && rule.reason !== 'availability')
        continue;
      if (rule.reason === 'season' && ctx.seasonal.get(from.id) !== 'scarce') continue;
      if (rule.reason === 'availability' && ctx.prices.has(from.id)) continue;
      const to = ctx.ingredients.get(rule.to_ingredient_id);
      const price = ctx.prices.get(rule.to_ingredient_id);
      if (!to || price === undefined || !substituteAllowed(to, rule, ctx)) continue;
      if (items.some((i) => i.ingredient_id === to.id && i.substitution_for === item.key)) continue;
      const sub = itemFor(
        to,
        item.need_grams * (rule.ratio > 0 ? rule.ratio : 1),
        price,
        ctx.locale,
      );
      const saving = item.estimated_minor - (sub.estimated_minor ?? 0);
      if (saving <= 0) continue;
      const loss = nutrientLoss(from, to, rule.ratio > 0 ? rule.ratio : 1);
      candidates.push({
        item,
        rule,
        to,
        saving,
        score: saving / (1 + 10 * loss),
        reason: rule.reason,
      });
    }
  }
  candidates.sort(
    (a, b) =>
      REASON_PRIORITY[a.reason] - REASON_PRIORITY[b.reason] ||
      b.score - a.score ||
      b.rule.culinary_fit * 0.5 +
        b.rule.nutrient_similarity -
        (a.rule.culinary_fit * 0.5 + a.rule.nutrient_similarity),
  );

  let out = [...items];
  const used = new Set<string>();
  for (const c of candidates) {
    if (total <= limit) break;
    if (used.has(c.item.key)) continue;
    used.add(c.item.key);
    const sub = itemFor(
      c.to,
      c.item.need_grams * (c.rule.ratio > 0 ? c.rule.ratio : 1),
      ctx.prices.get(c.to.id) ?? null,
      ctx.locale,
    );
    sub.key = `${c.to.id}:for:${c.item.key}`;
    sub.substitution_for = c.item.key;
    out = out.map((i) => (i.key === c.item.key ? { ...i, replaced: true } : i));
    out.push(sub);
    total = totalMinor(out);
    applied.push({
      from_key: c.item.key,
      to_key: sub.key,
      label: c.rule.label ?? `${sub.label} instead of ${c.item.label}`,
      saves_minor: c.saving,
      reason: c.reason,
    });
  }
  return { items: sortItems(out), applied, feasible: total <= limit };
}

// ---- price book selection (14 §12.5) ----------------------------------------------------------------

export interface PriceProfileRow {
  id: string;
  region_id: string;
  city: string | null;
  currency: string;
  effective_from: string;
}

/**
 * Household price book: (region, city) latest effective, then (region, no city), then a profile in
 * the same country with the same currency (sibling city, no multiplier yet). Null = no price book
 * (FR-GRO-11: quantities only).
 */
export function choosePriceProfile(
  profiles: readonly PriceProfileRow[],
  household: { region_id: string | null; city: string | null; currency: string },
  today: string,
): PriceProfileRow | null {
  const live = profiles
    .filter((p) => p.effective_from <= today && p.currency === household.currency)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
  const city = household.city ? norm(household.city) : null;
  return (
    live.find(
      (p) => p.region_id === household.region_id && city && p.city && norm(p.city) === city,
    ) ??
    live.find((p) => p.region_id === household.region_id && !p.city) ??
    live.find((p) => city && p.city && norm(p.city) === city) ??
    live.find((p) => p.region_id === household.region_id) ??
    live[0] ??
    null
  );
}

/** Cost of planned servings at current prices (raw grams, no purchase rounding), minor units. */
export function servingsCost(
  servings: readonly PlannedServing[],
  meals: Map<string, MealRecipe>,
  prices: Map<string, number>,
): number {
  const { need } = aggregateNeed(servings, meals);
  let total = 0;
  for (const [id, g] of need) {
    const p = prices.get(id);
    if (p !== undefined) total += (g * p) / 1000;
  }
  return Math.round(total);
}
