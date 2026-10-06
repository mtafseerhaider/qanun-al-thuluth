import type {
  Catalog,
  CatalogIngredient,
  CatalogMeal,
  CatalogPortion,
  PlanHousehold,
  PlanMember,
  PlanRequest,
} from '../src/planning/types.ts';

/** Small Lahore-style catalog for engine tests. Ids are readable strings, not UUIDs. */

const ing = (
  id: string,
  name: string,
  category: string,
  extra: Partial<CatalogIngredient> = {},
): CatalogIngredient => ({
  id,
  name,
  category,
  halalStatus: 'halal',
  allergenCodes: [],
  isSunnahFood: false,
  ...extra,
});

export const INGREDIENTS: CatalogIngredient[] = [
  ing('i-chicken', 'Chicken', 'poultry', { halalStatus: 'depends_on_source' }),
  ing('i-beef', 'Beef', 'meat', { halalStatus: 'depends_on_source' }),
  ing('i-fish', 'Rohu fish', 'fish', { halalStatus: 'depends_on_source', allergenCodes: ['fish'] }),
  ing('i-rice', 'Basmati rice', 'grain'),
  ing('i-atta', 'Whole wheat atta', 'grain', { allergenCodes: ['gluten_cereals', 'wheat'] }),
  ing('i-masoor', 'Masoor daal', 'legume'),
  ing('i-chana', 'Chickpeas', 'legume'),
  ing('i-spinach', 'Spinach (palak)', 'vegetable'),
  ing('i-lauki', 'Bottle gourd (lauki)', 'vegetable'),
  ing('i-cucumber', 'Cucumber (kheera)', 'vegetable'),
  ing('i-tomato', 'Tomato', 'vegetable'),
  ing('i-yogurt', 'Yogurt (dahi)', 'dairy', { allergenCodes: ['milk'] }),
  ing('i-milk', 'Milk', 'dairy', { allergenCodes: ['milk'] }),
  ing('i-egg', 'Egg', 'egg', { allergenCodes: ['eggs'] }),
  ing('i-peanut', 'Peanuts', 'nut_seed', { allergenCodes: ['peanuts'] }),
  ing('i-oats', 'Oats', 'grain', { allergenCodes: ['gluten_cereals'] }),
  ing('i-dates', 'Dates (khajoor)', 'fruit', { isSunnahFood: true }),
  ing('i-banana', 'Banana', 'fruit'),
  ing('i-apple', 'Apple', 'fruit'),
  ing('i-pork', 'Pork sausage', 'meat', { halalStatus: 'haram' }),
  ing('i-gelatin', 'Gelatin', 'condiment', { halalStatus: 'mashbooh' }),
  ing('i-soy-sauce', 'Soy sauce', 'condiment', { allergenCodes: ['soy'] }),
  ing('i-paneer', 'Paneer', 'dairy', { allergenCodes: ['milk'] }),
];

const STAGES: Array<[CatalogPortion['lifeStage'], CatalogPortion['tier'], number, number | null]> =
  [
    ['adult', 'standard', 430, 600],
    ['older_adult', 'standard', 380, 520],
    ['teen', 'ideal', 400, null],
    ['teen', 'extra', 120, null],
    ['child', 'start', 160, null],
    ['child', 'ideal', 280, null],
    ['child', 'extra', 120, null],
    ['toddler', 'start', 120, null],
    ['toddler', 'extra', 60, null],
  ];

export function portions(mealId: string): CatalogPortion[] {
  return STAGES.map(([lifeStage, tier, grams, kcal]) => ({
    id: `${mealId}:${lifeStage}:${tier}`,
    lifeStage,
    tier,
    grams,
    kcal,
  }));
}

export function meal(
  id: string,
  title: string,
  mealType: CatalogMeal['mealType'],
  ingredientIds: string[],
  extra: Partial<CatalogMeal> = {},
): CatalogMeal {
  return {
    id,
    code: null,
    title,
    mealType,
    ingredientIds,
    plateSplit: { veg_fruit: 0.5, protein: 0.25, carb: 0.25 },
    costTier: 1,
    prepMin: 30,
    kidFriendly: true,
    autismFriendly: false,
    portions: portions(id),
    alternatives: [],
    householdId: null,
    source: 'curated',
    reviewStatus: 'verified',
    ...extra,
  };
}

export const MEALS: CatalogMeal[] = [
  // breakfasts
  meal('b-oats', 'Oats with milk and dates', 'breakfast', ['i-oats', 'i-milk', 'i-dates'], {
    code: 'B001',
  }),
  meal('b-egg', 'Anday ka khagina with roti', 'breakfast', ['i-egg', 'i-tomato', 'i-atta'], {
    code: 'B002',
  }),
  meal('b-chana', 'Lahori chanay with roti', 'breakfast', ['i-chana', 'i-atta', 'i-tomato'], {
    code: 'B003',
  }),
  meal('b-yogurt', 'Dahi with banana and dates', 'breakfast', ['i-yogurt', 'i-banana', 'i-dates'], {
    code: 'B004',
  }),
  meal('b-rice', 'Plain rice porridge with banana', 'breakfast', ['i-rice', 'i-banana'], {
    code: 'B005',
    autismFriendly: true,
  }),
  // lunches
  meal(
    'l-daal',
    'Masoor daal with rice and kachumber',
    'lunch',
    ['i-masoor', 'i-rice', 'i-cucumber', 'i-tomato'],
    { code: 'L001' },
  ),
  meal(
    'l-chana',
    'Chana pulao with raita',
    'lunch',
    ['i-chana', 'i-rice', 'i-yogurt', 'i-cucumber'],
    { code: 'L002' },
  ),
  meal('l-lauki', 'Lauki chana daal with roti', 'lunch', ['i-lauki', 'i-masoor', 'i-atta'], {
    code: 'L003',
  }),
  meal('l-chicken', 'Chicken wrap with salad', 'lunch', ['i-chicken', 'i-atta', 'i-cucumber'], {
    code: 'L004',
    costTier: 2,
  }),
  meal('l-palak', 'Palak daal with rice', 'lunch', ['i-spinach', 'i-masoor', 'i-rice'], {
    code: 'L005',
  }),
  meal('l-khichdi', 'Moong khichdi with cucumber', 'lunch', ['i-masoor', 'i-rice', 'i-cucumber'], {
    code: 'L006',
    autismFriendly: true,
  }),
  meal('l-egg', 'Anda curry with rice', 'lunch', ['i-egg', 'i-tomato', 'i-rice'], { code: 'L007' }),
  meal('l-fish', 'Fish roll with salad', 'lunch', ['i-fish', 'i-atta', 'i-cucumber'], {
    code: 'L008',
    costTier: 3,
  }),
  // snacks
  meal('s-fruit', 'Fruit chaat', 'snack', ['i-apple', 'i-banana'], { code: 'S001' }),
  meal('s-dates', 'Dates and milk', 'snack', ['i-dates', 'i-milk'], { code: 'S002' }),
  meal('s-peanut', 'Peanut chikki', 'snack', ['i-peanut', 'i-dates'], { code: 'S003' }),
  meal('s-chana', 'Chana chaat', 'snack', ['i-chana', 'i-tomato', 'i-cucumber'], { code: 'S004' }),
  meal('s-banana', 'Banana slices', 'snack', ['i-banana'], { code: 'S005', autismFriendly: true }),
  // dinners
  meal(
    'd-karahi',
    'Chicken karahi with roti and kachumber',
    'dinner',
    ['i-chicken', 'i-tomato', 'i-atta', 'i-cucumber'],
    {
      code: 'D001',
      costTier: 2,
      alternatives: [
        { mealId: 'd-karahi-a', reason: 'autism' },
        { mealId: 'd-karahi-gf', reason: 'allergy' },
      ],
    },
  ),
  meal(
    'd-karahi-a',
    'Deconstructed chicken, cucumber and roti strips',
    'dinner',
    ['i-chicken', 'i-atta', 'i-cucumber'],
    {
      code: 'D001-A',
      costTier: 2,
      autismFriendly: true,
    },
  ),
  meal(
    'd-karahi-gf',
    'Chicken karahi with rice and kachumber',
    'dinner',
    ['i-chicken', 'i-tomato', 'i-rice', 'i-cucumber'],
    {
      costTier: 2,
    },
  ),
  meal(
    'd-daal',
    'Masoor daal, rice and salad',
    'dinner',
    ['i-masoor', 'i-rice', 'i-cucumber', 'i-tomato'],
    { code: 'D002' },
  ),
  meal('d-fish', 'Tawa fish with roti and salad', 'dinner', ['i-fish', 'i-atta', 'i-cucumber'], {
    code: 'D003',
    costTier: 3,
  }),
  meal('d-beef', 'Aloo gosht with roti', 'dinner', ['i-beef', 'i-atta', 'i-tomato'], {
    code: 'D004',
    costTier: 3,
  }),
  meal('d-palak', 'Palak murgh with rice', 'dinner', ['i-spinach', 'i-chicken', 'i-rice'], {
    code: 'D005',
    costTier: 2,
  }),
  meal('d-lauki', 'Lauki chicken with roti', 'dinner', ['i-lauki', 'i-chicken', 'i-atta'], {
    code: 'D006',
    costTier: 2,
  }),
  meal('d-chana', 'Chana masala with rice', 'dinner', ['i-chana', 'i-rice', 'i-tomato'], {
    code: 'D007',
  }),
  meal('d-egg', 'Egg and spinach curry with roti', 'dinner', ['i-egg', 'i-spinach', 'i-atta'], {
    code: 'D008',
  }),
  meal('d-paneer', 'Paneer and peas with rice', 'dinner', ['i-paneer', 'i-rice', 'i-tomato'], {
    code: 'D009',
    costTier: 2,
  }),
  // never allowed
  meal('d-pork', 'Sausage and mash', 'dinner', ['i-pork', 'i-tomato'], { code: 'D090' }),
  meal('d-jelly', 'Chicken with jelly salad', 'dinner', ['i-chicken', 'i-gelatin', 'i-rice'], {
    code: 'D091',
  }),
  meal(
    'd-stirfry',
    'Chicken stir fry with soy sauce',
    'dinner',
    ['i-chicken', 'i-soy-sauce', 'i-rice', 'i-cucumber'],
    {
      code: 'D092',
    },
  ),
  meal('d-unreviewed', 'Draft mutton pulao', 'dinner', ['i-beef', 'i-rice'], {
    reviewStatus: 'in_review',
  }),
  meal('l-heavy', 'Biryani (rice heavy)', 'lunch', ['i-chicken', 'i-rice'], {
    plateSplit: { veg_fruit: 0.2, protein: 0.3, carb: 0.5 },
  }),
];

export function catalog(
  meals: CatalogMeal[] = MEALS,
  ingredients: CatalogIngredient[] = INGREDIENTS,
): Catalog {
  return {
    meals: new Map(meals.map((m) => [m.id, m])),
    ingredients: new Map(ingredients.map((i) => [i.id, i])),
  };
}

export function member(over: Partial<PlanMember> & Pick<PlanMember, 'id'>): PlanMember {
  return {
    name: over.id,
    ageMonths: 38 * 12,
    lifeStage: 'adult',
    allergies: [],
    dislikes: [],
    likes: [],
    safeFoods: [],
    modules: [],
    medicationFlags: [],
    goals: [],
    energyTargetKcal: null,
    ...over,
  };
}

/** The Usman family (01 §3.2): two adults, an 8-year-old picky eater and a 4-year-old with autism. */
export const usman = member({
  id: 'usman',
  name: 'Usman',
  goals: ['weight_loss'],
  energyTargetKcal: 2100,
});
export const hina = member({
  id: 'hina',
  name: 'Hina',
  modules: ['breastfeeding'],
  energyTargetKcal: 2300,
});
export const ibrahim = member({
  id: 'ibrahim',
  name: 'Ibrahim',
  ageMonths: 96,
  lifeStage: 'child',
  modules: ['picky_eater'],
  goals: ['weight_loss'],
  safeFoods: [
    { id: 'sf-roti', ingredientId: 'i-atta', label: 'Roti', strength: 3 },
    { id: 'sf-banana', ingredientId: 'i-banana', label: 'Banana', strength: 2 },
  ],
});
export const maryam = member({
  id: 'maryam',
  name: 'Maryam',
  ageMonths: 50,
  lifeStage: 'child',
  modules: ['autism'],
  safeFoods: [{ id: 'sf-rice', ingredientId: 'i-rice', label: 'Plain rice', strength: 3 }],
});

export function household(over: Partial<PlanHousehold> = {}): PlanHousehold {
  return {
    id: 'hh-1',
    allowMashbooh: false,
    weekdayCookLimitMin: 60,
    weekendCookLimitMin: 180,
    budgetTier: 2,
    budgetStrictness: 'target',
    seasonal: new Map([
      ['i-lauki', 'peak'],
      ['i-spinach', 'peak'],
      ['i-cucumber', 'available'],
      ['i-tomato', 'peak'],
      ['i-banana', 'available'],
      ['i-apple', 'peak'],
    ]),
    includeInReview: false,
    ...over,
  };
}

export function request(over: Partial<PlanRequest> = {}): PlanRequest {
  return {
    startDate: '2026-10-12',
    weekCount: 1,
    mealTypes: ['breakfast', 'lunch', 'snack', 'dinner'],
    kind: 'standard',
    members: [usman, hina, ibrahim, maryam],
    household: household(),
    seed: 7,
    ...over,
  };
}
