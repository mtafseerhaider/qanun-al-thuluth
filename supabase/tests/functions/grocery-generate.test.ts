import { assert, assertAlmostEquals, assertEquals, assertExists } from 'jsr:@std/assert@1';
import { GroceryGenerateResponse } from '@thuluth/shared/contracts/grocery-generate.ts';

import { createGroceryGenerateHandler } from '../../functions/grocery-generate/handler.ts';
import {
  aggregateNeed,
  choosePriceProfile,
  choosePurchaseUnit,
  deductPantry,
  matchesExclusion,
  periodTarget,
} from '../../functions/_shared/grocery/engine.ts';
import type { BudgetProfile, PlannedServing } from '../../functions/_shared/grocery/engine.ts';
import {
  addIftarDates,
  datesIngredient,
  isDriedDates,
  isRamadanStaple,
} from '../../functions/_shared/grocery/ramadan.ts';
import {
  BUDGET,
  FAMILY,
  FAMILY_FACTOR,
  groceryStore,
  HH,
  INGREDIENTS,
  LAHORE,
  LAHORE_PROFILE,
  MEAL,
  MEALS,
  NOW,
  OTHER_PLAN,
  OWNER,
  PLAN,
  REGION_PB,
  VIEWER,
  WEEK,
  weekServings,
} from './grocery-fixtures.ts';
import type { GroceryMemoryOptions } from './grocery-fixtures.ts';
import { memoryPlatform } from './platform-fixtures.ts';

function setup(opts: GroceryMemoryOptions & { premium?: boolean } = {}) {
  const mem = groceryStore(opts);
  const plat = memoryPlatform({
    roles: { [OWNER]: 'owner', [VIEWER]: 'viewer' },
    premium: opts.premium ?? false,
  });
  const handler = createGroceryGenerateHandler({
    verify: async (jwt) =>
      jwt === 'owner' ? { sub: OWNER } : jwt === 'viewer' ? { sub: VIEWER } : null,
    platform: plat.platform,
    entitlements: plat.entitlements,
    store: mem.store,
    now: () => NOW,
  });
  return { handler, ...mem, plat: plat.state };
}

let n = 0;
function post(
  body: Record<string, unknown> = {},
  opts: { jwt?: string; key?: string } = {},
): Request {
  return new Request('http://localhost/functions/v1/grocery-generate', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${opts.jwt ?? 'owner'}`,
      'content-type': 'application/json',
      'idempotency-key': opts.key ?? `grocery-key-${String(++n).padStart(4, '0')}`,
    },
    body: JSON.stringify({
      household_id: HH,
      meal_plan_id: PLAN,
      starts_on: '2026-10-12',
      ends_on: '2026-10-18',
      ...body,
    }),
  });
}

const budget = (
  monthlyPkr: number,
  strictness: BudgetProfile['strictness'] = 'hard_cap',
): BudgetProfile => ({
  id: BUDGET,
  monthly_amount_minor: monthlyPkr * 100,
  currency: 'PKR',
  strictness,
  category_split: {},
});

Deno.test(
  'free: basic weekly list, aggregated in purchase units, priced from the Lahore book',
  async () => {
    const { handler, state } = setup({ budget: budget(35_000) });
    const res = await handler(post({ period: 'monthly' }));
    assertEquals(res.status, 200);
    const body = GroceryGenerateResponse.parse(await res.json());
    const saved = state.saved[0];
    assertExists(saved);
    // Free: no monthly split, no optimisation, no substitutions even when over budget.
    assertEquals(saved.list.period, 'weekly');
    assertEquals(body.substitutions, []);
    assertEquals(body.budget.status, 'over');
    assertEquals(saved.list.price_profile_id, LAHORE);
    // Water never goes on a list; 11 ingredients remain.
    assertEquals(body.items_count, 11);
    assert(!saved.items.some((i) => i.ingredient_id === 'i-water'));
    // AC-G1: total equals the sum of item estimates; quantities are positive.
    const sum = saved.items.reduce((s, i) => s + (i.estimated_minor ?? 0), 0);
    assertEquals(body.estimated_total_minor, sum);
    assert(saved.items.every((i) => i.quantity > 0));
    assertEquals(body.price_coverage, 1);
    // Fresh vs staples: produce, meat and eggs are fresh; daal, rice, oil, atta, nuts are not.
    assertEquals(body.fresh_items_count, 5);
    const masoor = saved.items.find((i) => i.ingredient_id === 'i-masoor');
    // 7 lunches x 50 g per adult serving x 2.83 adult servings = 992 g -> 1 kg (0.25 kg steps).
    assertEquals(
      [masoor?.need_grams, masoor?.quantity, masoor?.unit, masoor?.is_fresh],
      [992, 1, 'kg', false],
    );
    // Produce gets 5 percent trim: onion 7 x 75 g x 2.83 x 1.05 = 1,562 g -> 1.75 kg.
    const onion = saved.items.find((i) => i.ingredient_id === 'i-onion');
    assertEquals([onion?.need_grams, onion?.quantity, onion?.aisle], [1562, 1.75, 'sabzi']);
    assertEquals(onion?.estimated_minor, 21000);
    // Category roll-up carries the default split target when the profile has none.
    const veg = body.budget.by_category.find((c) => c.category_code === 'produce_veg');
    assertEquals(veg?.estimated_minor, 19250 + 21000 + 30625);
    assertEquals(veg?.target_minor, Math.round(periodTarget(budget(35_000), 7, 'weekly') * 0.12));
    assertEquals(state.saved.length, 1);
  },
);

Deno.test(
  'premium hard cap: cheapest-loss swaps until under budget, originals kept and linked',
  async () => {
    const { handler, state } = setup({ premium: true, budget: budget(35_000) });
    const res = await handler(post());
    const body = GroceryGenerateResponse.parse(await res.json());
    const target = periodTarget(budget(35_000), 7, 'weekly');
    assertEquals(body.budget.target_minor, target);
    assert(body.estimated_total_minor <= target, `${body.estimated_total_minor} > ${target}`);
    assertEquals(body.budget.status === 'over', false);
    assertEquals(
      body.substitutions.map((s) => [s.label, s.reason]),
      [
        ['Canola oil for cooking; keep olive oil for drizzles', 'budget'],
        ['Peanuts instead of almonds', 'budget'],
      ],
    );
    const saved = state.saved[0]!;
    for (const s of body.substitutions) {
      const fromKey = [...saved.itemIds].find(([, id]) => id === s.item_id)?.[0];
      const toKey = [...saved.itemIds].find(([, id]) => id === s.substitute_item_id)?.[0];
      const original = saved.items.find((i) => i.key === fromKey);
      const substitute = saved.items.find((i) => i.key === toKey);
      assertEquals(original?.replaced, true);
      assertEquals(substitute?.substitution_for, fromKey);
      assert(s.saves_minor > 0);
    }
    // Replaced originals do not count: items_count is the active list.
    assertEquals(body.items_count, saved.items.filter((i) => !i.replaced).length);
  },
);

Deno.test(
  'premium: a peanut allergy blocks the peanut swap; the optimiser moves on to chicken',
  async () => {
    const { handler } = setup({ premium: true, budget: budget(35_000), allergens: ['peanut'] });
    const body = GroceryGenerateResponse.parse(await (await handler(post())).json());
    const labels = body.substitutions.map((s) => s.label);
    assert(!labels.some((l) => l.includes('Peanuts')));
    assert(labels.includes('Chicken with bone instead of boneless beef'));
  },
);

Deno.test('premium flexible budget allows 10 percent over before swapping', async () => {
  const { handler } = setup({ premium: true, budget: budget(40_000, 'flexible') });
  const body = GroceryGenerateResponse.parse(await (await handler(post())).json());
  assertEquals(body.substitutions, []);
  assertEquals(body.budget.status, 'over');
});

Deno.test('premium: optimize=false and no budget leave the list untouched', async () => {
  const a = setup({ premium: true, budget: budget(35_000) });
  const off = GroceryGenerateResponse.parse(
    await (await a.handler(post({ optimize: false }))).json(),
  );
  assertEquals(off.substitutions, []);
  const b = setup({ premium: true, budget: null });
  const none = GroceryGenerateResponse.parse(await (await b.handler(post())).json());
  assertEquals(none.budget, {
    target_minor: null,
    status: 'no_budget',
    by_category: none.budget.by_category,
  });
  assert(none.budget.by_category.every((c) => c.target_minor === null));
});

Deno.test('season swap only when the original is scarce this month', async () => {
  const rules = [
    {
      from_ingredient_id: 'i-almonds',
      to_ingredient_id: 'i-peanuts',
      reason: 'season' as const,
      ratio: 1,
      nutrient_similarity: 0.5,
      culinary_fit: 1,
      label: 'Seasonal swap',
    },
  ];
  const a = setup({ premium: true, budget: budget(35_000), rules });
  const notScarce = GroceryGenerateResponse.parse(await (await a.handler(post())).json());
  assert(!notScarce.substitutions.some((s) => s.reason === 'season'));
  // Scarce this month: the season rule ranks ahead of budget rules (14 §13.1).
  const b = setup({
    premium: true,
    budget: budget(35_000),
    rules,
    seasonal: new Map([['i-almonds', 'scarce']]),
  });
  const scarce = GroceryGenerateResponse.parse(await (await b.handler(post())).json());
  assertEquals(scarce.substitutions[0]?.label, 'Seasonal swap');
  assertEquals(scarce.substitutions[0]?.reason, 'season');
});

Deno.test(
  'premium monthly list keeps the period; pantry stock and exclusions reduce the list',
  async () => {
    const { handler, state } = setup({
      premium: true,
      pantry: [
        { ingredient_id: 'i-rice', grams: 5000, expires_on: null },
        { ingredient_id: 'i-masoor', grams: 5000, expires_on: '2026-10-01' }, // expired: ignored
      ],
    });
    const res = await handler(post({ period: 'monthly', pantry_exclusions: ['onion', 'KHEERA'] }));
    assertEquals(res.status, 200);
    const saved = state.saved[0]!;
    assertEquals(saved.list.period, 'monthly');
    const ids = saved.items.map((i) => i.ingredient_id);
    assert(!ids.includes('i-rice'));
    assert(ids.includes('i-masoor'));
    assert(!ids.includes('i-onion'));
    assert(!ids.includes('i-cucumber'));
  },
);

Deno.test('free: pantry_items are not deducted automatically (premium only)', async () => {
  const { handler, state } = setup({
    pantry: [{ ingredient_id: 'i-rice', grams: 5000, expires_on: null }],
  });
  await handler(post());
  assert(state.saved[0]!.items.some((i) => i.ingredient_id === 'i-rice'));
});

Deno.test('no price book: quantities only, no total, status no_budget (FR-GRO-11)', async () => {
  const { handler, state } = setup({ profiles: [], budget: budget(35_000) });
  const body = GroceryGenerateResponse.parse(await (await handler(post())).json());
  assertEquals(body.estimated_total_minor, 0);
  assertEquals(body.price_coverage, 0);
  assertEquals(body.budget.status, 'no_budget');
  assertEquals(state.saved[0]!.list.price_profile_id, null);
  assert(state.saved[0]!.items.every((i) => i.estimated_minor === null));
});

Deno.test('an explicit price profile must exist', async () => {
  const { handler } = setup();
  assertEquals((await handler(post({ price_profile_id: LAHORE }))).status, 200);
  const missing = await handler(post({ price_profile_id: '00000000-0000-4000-9600-000000000001' }));
  assertEquals(missing.status, 404);
});

Deno.test('idempotent replay and key reuse', async () => {
  const { handler, state } = setup();
  const first = await handler(post({}, { key: 'grocery-same-key' }));
  const replay = await handler(post({}, { key: 'grocery-same-key' }));
  assertEquals(replay.headers.get('idempotent-replayed'), 'true');
  assertEquals(await replay.json(), await first.json());
  assertEquals(state.saved.length, 1);
  const reused = await handler(post({ ends_on: '2026-10-14' }, { key: 'grocery-same-key' }));
  assertEquals(reused.status, 422);
});

Deno.test(
  'errors: auth, role, missing key, other household plan, range, closed list, rate limit',
  async () => {
    const { handler } = setup({
      lists: [{ id: '00000000-0000-4000-9700-000000000001', household_id: HH, status: 'done' }],
    });
    assertEquals((await handler(post({}, { jwt: 'nobody' }))).status, 401);
    assertEquals((await handler(post({}, { jwt: 'viewer' }))).status, 403);
    const noKey = new Request('http://localhost/functions/v1/grocery-generate', {
      method: 'POST',
      headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
      body: JSON.stringify({
        household_id: HH,
        meal_plan_id: PLAN,
        starts_on: '2026-10-12',
        ends_on: '2026-10-18',
      }),
    });
    assertEquals((await handler(noKey)).status, 400);
    assertEquals((await handler(post({ meal_plan_id: OTHER_PLAN }))).status, 404);
    assertEquals((await handler(post({ ends_on: '2026-12-31' }))).status, 400);
    assertEquals(
      (await handler(post({ starts_on: '2026-10-19', ends_on: '2026-10-11' }))).status,
      400,
    );
    const closed = await handler(post({ replace_list_id: '00000000-0000-4000-9700-000000000001' }));
    assertEquals(closed.status, 409);
    // Three per minute (requests rejected earlier did not consume the window).
    for (let i = 0; i < 3; i++) assertEquals((await handler(post())).status, 200);
    const limited = await handler(post());
    assertEquals(limited.status, 429);
    assertEquals((await limited.json()).error.code, 'RATE_LIMITED');
  },
);

Deno.test('a generating plan is not listable yet', async () => {
  const { handler } = setup({ planStatus: 'generating' });
  const res = await handler(post());
  assertEquals(res.status, 409);
});

Deno.test('regenerating into an open list reuses its id', async () => {
  const listId = '00000000-0000-4000-9700-000000000002';
  const { handler, state } = setup({ lists: [{ id: listId, household_id: HH, status: 'open' }] });
  const body = GroceryGenerateResponse.parse(
    await (await handler(post({ replace_list_id: listId }))).json(),
  );
  assertEquals(body.grocery_list_id, listId);
  assertEquals(state.saved[0]!.replaceListId, listId);
  assertEquals(state.saved.length, 1);
});

// ---- engine units ------------------------------------------------------------------------------------

Deno.test('engine: aggregation scales by portion or life stage and batch multiplier', () => {
  const meals = new Map(MEALS.map((m) => [m.meal_id, m]));
  const { need } = aggregateNeed(weekServings(), meals);
  assertAlmostEquals(need.get('i-masoor') ?? 0, 7 * 50 * FAMILY_FACTOR, 1e-6);
  const one = weekServings()
    .slice(0, 1)
    .map((s) => ({ ...s, portion_grams: 100, batch_multiplier: 1.5 }));
  // Breakfast adult portion is 200 g: a 100 g portion is half an adult serving, cooked 1.5x.
  assertAlmostEquals(aggregateNeed(one, meals).need.get('i-eggs') ?? 0, 55 * 0.5 * 1.5, 1e-6);
  const missing = aggregateNeed([{ ...one[0]!, meal_id: 'nope', base_meal_id: 'nope' }], meals);
  assertEquals(missing.missingMeals, ['nope']);
});

Deno.test('engine: purchase units and rounding (14 §10.2)', () => {
  assertEquals(
    choosePurchaseUnit(
      1091,
      [
        { unit: 'dozen', grams: 660 },
        { unit: 'piece', grams: 55 },
      ],
      47727,
    ),
    {
      unit: 'piece',
      unit_grams: 55,
      quantity: 20,
    },
  );
  assertEquals(choosePurchaseUnit(1300, [{ unit: 'dozen', grams: 660 }], null).quantity, 2);
  assertEquals(choosePurchaseUnit(2600, [{ unit: 'kg', grams: 1000 }], 100).quantity, 3);
  assertEquals(choosePurchaseUnit(10, [{ unit: 'kg', grams: 1000 }], 100).quantity, 0.25);
});

Deno.test('engine: pantry deduction ignores expired stock and drops covered items (AC-G2)', () => {
  const need = new Map([
    ['a', 500],
    ['b', 300],
  ]);
  const out = deductPantry(
    need,
    [
      { ingredient_id: 'a', grams: 200, expires_on: '2026-10-10' },
      { ingredient_id: 'b', grams: 400, expires_on: null },
      { ingredient_id: 'a', grams: 900, expires_on: '2026-10-01' },
    ],
    '2026-10-06',
  );
  assertEquals([...out], [['a', 300]]);
});

Deno.test('engine: exclusion labels match names, translations and bracketed names', () => {
  const onion = INGREDIENTS.find((i) => i.id === 'i-onion')!;
  const cucumber = INGREDIENTS.find((i) => i.id === 'i-cucumber')!;
  assert(matchesExclusion(onion, new Set(['پیاز'])));
  assert(matchesExclusion(cucumber, new Set(['cucumber'])));
  assert(!matchesExclusion(onion, new Set(['tomato'])));
});

Deno.test('engine: price book resolution order (14 §12.5)', () => {
  const regionWide = { ...LAHORE_PROFILE, id: 'region', city: null };
  const karachi = { ...LAHORE_PROFILE, id: 'khi', region_id: 'sd', city: 'Karachi' };
  const future = { ...LAHORE_PROFILE, id: 'future', effective_from: '2027-01-01' };
  const hh = { region_id: REGION_PB, city: 'lahore', currency: 'PKR' };
  assertEquals(
    choosePriceProfile([regionWide, LAHORE_PROFILE, future], hh, '2026-10-06')?.id,
    LAHORE,
  );
  assertEquals(choosePriceProfile([regionWide, karachi], hh, '2026-10-06')?.id, 'region');
  assertEquals(
    choosePriceProfile([karachi], { ...hh, city: 'Karachi', region_id: null }, '2026-10-06')?.id,
    'khi',
  );
  assertEquals(choosePriceProfile([karachi], { ...hh, currency: 'GBP' }, '2026-10-06'), null);
});

// ---- Ramadan lists (S5-12, FR-RAM-06) -------------------------------------------------------------

const RAMADAN_SLOTS: Array<[string, string]> = [
  ['suhoor', MEAL.breakfast],
  ['iftar', MEAL.lunch],
  ['snack', MEAL.snack],
];

function ramadanWeek(): PlannedServing[] {
  const out: PlannedServing[] = [];
  for (const date of WEEK) {
    for (const [meal_type, meal] of RAMADAN_SLOTS) {
      for (const m of FAMILY) {
        out.push({
          plan_date: date,
          daily_meal_id: `${date}:${meal_type}`,
          meal_id: meal,
          base_meal_id: meal,
          batch_multiplier: 1,
          life_stage: m.stage,
          portion_grams: null,
          meal_type,
        });
      }
    }
  }
  return out;
}

Deno.test(
  'ramadan (free): iftar dates added, staples not fresh, Ramadan price uplift applied',
  async () => {
    const { handler, state, plat } = setup({ kind: 'ramadan', servings: ramadanWeek() });
    const res = await handler(post());
    assertEquals(res.status, 200);
    const body = GroceryGenerateResponse.parse(await res.json());
    const saved = state.saved[0];
    assertExists(saved);
    assertEquals(saved.list.period, 'weekly');
    // 7 iftars x 24 g x 2.83 adult servings = 476 g dried dates (+5 percent fruit trim).
    const dates = saved.items.find((i) => i.ingredient_id === 'i-dates');
    assertExists(dates);
    assertEquals(dates.need_grams, Math.round(7 * 24 * FAMILY_FACTOR * 1.05));
    assertEquals(dates.is_fresh, false);
    // Fresh dates (doka) are never the iftar dates.
    assert(!saved.items.some((i) => i.ingredient_id === 'i-dates-fresh'));
    // Uplift: fruit 1.25, plant protein 1.08, vegetables 1.15.
    assertEquals(dates.price_per_kg_minor, 75000);
    const masoor = saved.items.find((i) => i.ingredient_id === 'i-masoor');
    assertEquals([masoor?.price_per_kg_minor, masoor?.is_fresh], [32400, false]);
    const onion = saved.items.find((i) => i.ingredient_id === 'i-onion');
    assertEquals([onion?.price_per_kg_minor, onion?.is_fresh], [13800, true]);
    const sum = saved.items.reduce((s, i) => s + (i.estimated_minor ?? 0), 0);
    assertEquals(body.estimated_total_minor, sum);
    const audit = plat.audits.at(-1);
    assertEquals(audit?.diff.ramadan, {
      price_uplift: 'interim_2026_10',
      iftar_dates_grams: Math.round(7 * 24 * FAMILY_FACTOR),
    });
  },
);

Deno.test('ramadan (premium monthly): staples only, fresh food left to weekly lists', async () => {
  const { handler, state } = setup({
    premium: true,
    kind: 'ramadan',
    servings: ramadanWeek(),
  });
  const res = await handler(post({ period: 'monthly', optimize: false }));
  assertEquals(res.status, 200);
  const body = GroceryGenerateResponse.parse(await res.json());
  const saved = state.saved[0];
  assertExists(saved);
  assertEquals(saved.list.period, 'monthly');
  assertEquals(body.fresh_items_count, 0);
  const ids = saved.items.map((i) => i.ingredient_id).sort();
  // Dates, atta, daal and oil (FR-RAM-06) plus other dry goods; no onion, tomato, eggs, cucumber.
  for (const staple of ['i-dates', 'i-atta', 'i-masoor', 'i-canola']) assert(ids.includes(staple));
  for (const fresh of ['i-onion', 'i-tomato', 'i-eggs', 'i-cucumber']) {
    assert(!ids.includes(fresh), fresh);
  }
});

Deno.test('a standard plan gets no iftar dates and no uplift', async () => {
  const { handler, state, plat } = setup({ servings: ramadanWeek() });
  assertEquals((await handler(post())).status, 200);
  const saved = state.saved[0];
  assert(!saved?.items.some((i) => i.ingredient_id === 'i-dates'));
  const masoor = saved?.items.find((i) => i.ingredient_id === 'i-masoor');
  assertEquals(masoor?.price_per_kg_minor, 30000);
  assertEquals(plat.audits.at(-1)?.diff.ramadan, undefined);
});

Deno.test('engine: dates matching and iftar dates keep the larger of meal and Sunnah grams', () => {
  const byId = new Map(INGREDIENTS.map((i) => [i.id, i]));
  assertEquals(datesIngredient(byId)?.id, 'i-dates');
  assert(!isDriedDates({ name: 'Fresh dates (doka)', name_i18n: {} }));
  assert(isDriedDates({ name: 'Khajoor', name_i18n: {} }));
  assert(isRamadanStaple(byId.get('i-atta')!));
  assert(!isRamadanStaple(byId.get('i-onion')!));
  const iftar = ramadanWeek().filter((s) => s.meal_type === 'iftar');
  const need = new Map([['i-dates', 1000]]);
  assertEquals(addIftarDates(need, iftar, byId), 0);
  assertEquals(need.get('i-dates'), 1000);
  const empty = new Map<string, number>();
  assertAlmostEquals(addIftarDates(empty, iftar, byId), 7 * 24 * FAMILY_FACTOR, 1);
  assertEquals(addIftarDates(new Map(), iftar, new Map()), 0);
});
