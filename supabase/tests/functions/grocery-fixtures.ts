import type {
  BudgetProfile,
  GroceryIngredient,
  LifeStage,
  MealRecipe,
  PantryRow,
  PlannedServing,
  PriceProfileRow,
  SubstitutionRule,
} from '../../functions/_shared/grocery/engine.ts';
import type {
  GroceryHousehold,
  GroceryListRow,
  GroceryPlanRow,
  GroceryStore,
  SaveListArgs,
} from '../../functions/_shared/grocery/store.ts';

/**
 * A small Lahore catalog and a one-week plan for a family of four (two adults, a child and a
 * toddler) with the 14 §16.2 seed prices, for the grocery engine and grocery-generate tests.
 */

export const HH = '00000000-0000-4000-b000-000000000001';
export const OTHER_HH = '00000000-0000-4000-b000-000000000009';
export const OWNER = '00000000-0000-4000-a000-000000000001';
export const VIEWER = '00000000-0000-4000-a000-000000000002';
export const PLAN = '00000000-0000-4000-e000-000000000001';
export const OTHER_PLAN = '00000000-0000-4000-e000-000000000002';
export const LAHORE = '7f3c0000-0000-4000-8000-00000000a001';
export const REGION_PB = '00000000-0000-4000-9900-000000000001';
export const BUDGET = '00000000-0000-4000-9800-000000000001';
export const NOW = new Date('2026-10-06T08:00:00Z');

const ing = (
  id: string,
  name: string,
  category: string,
  budget_category: string,
  extra: Partial<GroceryIngredient> = {},
): GroceryIngredient => ({
  id,
  name,
  name_i18n: { en: name },
  category,
  budget_category,
  default_unit: 'kg',
  grams_per_unit: null,
  shelf_life_days: null,
  purchase_units: [],
  aisle: null,
  halal_status: 'halal',
  allergen_codes: [],
  nutrients: { protein_g: 2, iron_mg: 0.5, calcium_mg: 20, fiber_g: 2 },
  ...extra,
});

export const INGREDIENTS: GroceryIngredient[] = [
  ing('i-masoor', 'Masoor daal', 'legume', 'protein_plant', {
    nutrients: { protein_g: 24, iron_mg: 7, calcium_mg: 35, fiber_g: 11 },
  }),
  ing('i-onion', 'Onion', 'vegetable', 'produce_veg', { name_i18n: { en: 'Onion', ur: 'پیاز' } }),
  ing('i-tomato', 'Tomato', 'vegetable', 'produce_veg'),
  ing('i-cucumber', 'Cucumber (kheera)', 'vegetable', 'produce_veg'),
  ing('i-beef', 'Beef, boneless', 'meat', 'protein_animal', {
    halal_status: 'depends_on_source',
    nutrients: { protein_g: 26, iron_mg: 2.6, calcium_mg: 18, fiber_g: 0 },
  }),
  ing('i-chicken', 'Chicken, whole, with bone', 'poultry', 'protein_animal', {
    halal_status: 'depends_on_source',
    nutrients: { protein_g: 19, iron_mg: 0.9, calcium_mg: 11, fiber_g: 0 },
  }),
  ing('i-rice', 'Basmati rice (chawal)', 'grain', 'staples'),
  ing('i-canola', 'Canola oil', 'oil_fat', 'oils_fats', { default_unit: 'l', grams_per_unit: 920 }),
  ing('i-olive', 'Olive oil', 'oil_fat', 'oils_fats', { default_unit: 'l', grams_per_unit: 920 }),
  ing('i-eggs', 'Eggs, farm', 'egg', 'protein_animal', {
    purchase_units: [
      { unit: 'dozen', grams: 660 },
      { unit: 'piece', grams: 55 },
    ],
    allergen_codes: ['egg'],
  }),
  ing('i-atta', 'Chakki atta (whole wheat flour)', 'grain', 'staples', {
    allergen_codes: ['wheat', 'gluten'],
  }),
  ing('i-almonds', 'Almonds (badam)', 'nut_seed', 'snacks', {
    allergen_codes: ['tree_nuts'],
    nutrients: { protein_g: 21, iron_mg: 3.7, calcium_mg: 269, fiber_g: 12 },
  }),
  ing('i-peanuts', 'Peanuts (moongphali)', 'legume', 'snacks', {
    allergen_codes: ['peanut'],
    nutrients: { protein_g: 26, iron_mg: 4.6, calcium_mg: 92, fiber_g: 8.5 },
  }),
  ing('i-water', 'Water', 'beverage', 'beverages'),
  ing('i-guava', 'Guava (amrood)', 'fruit', 'produce_fruit'),
  ing('i-dates', 'Dates (Aseel)', 'fruit', 'produce_fruit', {
    name_i18n: { en: 'Dates (Aseel)', ur: 'کھجور (اصیل)' },
  }),
  ing('i-dates-fresh', 'Fresh dates (doka)', 'fruit', 'produce_fruit'),
];

/** Price per kg, minor units (14 §16.2 Lahore seed: unit price × 1000 / unit_grams). */
export const PRICES: Record<string, number> = {
  'i-masoor': 30000,
  'i-onion': 12000,
  'i-tomato': 17500,
  'i-cucumber': 11000,
  'i-beef': 130000,
  'i-chicken': 57000,
  'i-rice': 42000,
  'i-canola': 62500,
  'i-olive': 391300,
  'i-eggs': 47727,
  'i-atta': 13500,
  'i-almonds': 360000,
  'i-peanuts': 90000,
  'i-dates': 60000,
};

const recipe = (servings: number, ingredients: Array<[string, number]>) => ({
  kind: 'recipe' as const,
  share: 1,
  servings,
  ingredients: ingredients.map(([ingredient_id, grams]) => ({
    ingredient_id,
    grams,
    optional: false,
  })),
});

export const MEAL = {
  breakfast: '00000000-0000-4000-9000-000000000001',
  lunch: '00000000-0000-4000-9000-000000000002',
  dinner: '00000000-0000-4000-9000-000000000003',
  snack: '00000000-0000-4000-9000-000000000004',
};

export const MEALS: MealRecipe[] = [
  {
    meal_id: MEAL.breakfast,
    adult_portion_grams: 200,
    components: [
      recipe(2, [
        ['i-eggs', 110],
        ['i-atta', 80],
      ]),
    ],
  },
  {
    meal_id: MEAL.lunch,
    adult_portion_grams: 300,
    components: [
      recipe(4, [
        ['i-masoor', 200],
        ['i-onion', 100],
        ['i-tomato', 100],
        ['i-canola', 20],
        ['i-water', 800],
      ]),
      { kind: 'ingredient', ingredient_ids: ['i-cucumber'], grams_per_adult: 80 },
    ],
  },
  {
    meal_id: MEAL.dinner,
    adult_portion_grams: 350,
    components: [
      recipe(4, [
        ['i-beef', 600],
        ['i-onion', 200],
        ['i-tomato', 200],
        ['i-olive', 40],
      ]),
      recipe(4, [['i-rice', 300]]),
    ],
  },
  {
    meal_id: MEAL.snack,
    adult_portion_grams: 30,
    components: [{ kind: 'ingredient', ingredient_ids: ['i-almonds'], grams_per_adult: 30 }],
  },
];

export const FAMILY: Array<{ id: string; stage: LifeStage }> = [
  { id: 'm-usman', stage: 'adult' },
  { id: 'm-hina', stage: 'adult' },
  { id: 'm-ibrahim', stage: 'child' },
  { id: 'm-maryam', stage: 'toddler' },
];
/** 1 + 1 + 1/2 + 1/3 adult servings per slot. */
export const FAMILY_FACTOR = 1 + 1 + 0.5 + 1 / 3;

export const WEEK = [
  '2026-10-12',
  '2026-10-13',
  '2026-10-14',
  '2026-10-15',
  '2026-10-16',
  '2026-10-17',
  '2026-10-18',
];

export function weekServings(): PlannedServing[] {
  const out: PlannedServing[] = [];
  for (const date of WEEK) {
    for (const meal of Object.values(MEAL)) {
      for (const m of FAMILY) {
        out.push({
          plan_date: date,
          daily_meal_id: `${date}:${meal}`,
          meal_id: meal,
          base_meal_id: meal,
          batch_multiplier: 1,
          life_stage: m.stage,
          portion_grams: null,
        });
      }
    }
  }
  return out;
}

export interface GroceryMemoryOptions {
  profiles?: PriceProfileRow[];
  budget?: BudgetProfile | null;
  pantry?: PantryRow[];
  allergens?: string[];
  seasonal?: Map<string, 'peak' | 'available' | 'scarce'>;
  rules?: SubstitutionRule[];
  lists?: GroceryListRow[];
  planStatus?: string;
  /** `meal_plans.kind` of PLAN (default 'standard'). */
  kind?: string;
  /** Replaces the week of servings for PLAN. */
  servings?: PlannedServing[];
}

export const LAHORE_PROFILE: PriceProfileRow = {
  id: LAHORE,
  region_id: REGION_PB,
  city: 'Lahore',
  currency: 'PKR',
  effective_from: '2026-10-01',
};

export function groceryStore(opts: GroceryMemoryOptions = {}) {
  const household: GroceryHousehold = {
    id: HH,
    owner_user_id: OWNER,
    country_code: 'PK',
    region_id: REGION_PB,
    region_code: 'PK-PB',
    city: 'Lahore',
    timezone: 'Asia/Karachi',
    currency: 'PKR',
    preferences: {},
  };
  const plans: GroceryPlanRow[] = [
    {
      id: PLAN,
      household_id: HH,
      status: opts.planStatus ?? 'active',
      start_date: WEEK[0]!,
      end_date: WEEK[6]!,
      kind: opts.kind ?? 'standard',
    },
    {
      id: OTHER_PLAN,
      household_id: OTHER_HH,
      status: 'active',
      start_date: WEEK[0]!,
      end_date: WEEK[6]!,
    },
  ];
  const state = {
    saved: [] as Array<SaveListArgs & { id: string; itemIds: Map<string, string> }>,
    lists: new Map((opts.lists ?? []).map((l) => [l.id, l])),
  };
  const ingredients = new Map(INGREDIENTS.map((i) => [i.id, i]));
  const store: GroceryStore = {
    household: async (id) => (id === HH ? household : null),
    userLocale: async () => 'en',
    plan: async (id) => plans.find((p) => p.id === id) ?? null,
    planServings: async (planId, _h, from, to) =>
      planId === PLAN
        ? (opts.servings ?? weekServings()).filter((s) => s.plan_date >= from && s.plan_date <= to)
        : [],
    mealRecipes: async (ids) =>
      new Map(MEALS.filter((m) => ids.includes(m.meal_id)).map((m) => [m.meal_id, m])),
    ingredients: async () => ingredients,
    priceProfiles: async () => opts.profiles ?? [LAHORE_PROFILE],
    prices: async (id) => (id === LAHORE ? new Map(Object.entries(PRICES)) : new Map()),
    memberStages: async () => new Map(FAMILY.map((m) => [m.id, m.stage])),
    seasonal: async () => opts.seasonal ?? new Map(),
    substitutionRules: async () => opts.rules ?? [],
    pantry: async () => opts.pantry ?? [],
    memberAvoidances: async () => ({ allergenCodes: opts.allergens ?? [], avoidIngredientIds: [] }),
    budgetProfile: async (_h, id) => {
      const b = opts.budget ?? null;
      return b && (!id || b.id === id) ? b : null;
    },
    groceryList: async (id) => state.lists.get(id) ?? null,
    saveList: async (args) => {
      const id = args.replaceListId ?? crypto.randomUUID();
      const itemIds = new Map(args.items.map((i) => [i.key, crypto.randomUUID()]));
      state.saved.push({ ...args, id, itemIds });
      return { id, itemIds };
    },
  };
  return { store, state };
}
