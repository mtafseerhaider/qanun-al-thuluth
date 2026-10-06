import { describe, expect, it } from 'vitest';

import { findChildRestrictionViolations } from '../src/guardrails/child-restriction.ts';
import { findFeedingPressure, removeFeedingPressure } from '../src/guardrails/feeding-pressure.ts';
import { guardOutput } from '../src/guardrails/guard.ts';
import {
  acceptanceIndex,
  acceptanceSummary,
  applyExposurePairs,
  chainDistance,
  chainLadderSteps,
  chooseExposurePair,
  diffHasChildTargets,
  exposureLadderSteps,
  foodLifecycle,
  growthStatusView,
  ingredientFeatures,
  MAX_HOP,
  maxNewFoodsPerWeek,
  nextLadderAction,
  nextStage,
  nodeOf,
  planFoodChain,
  proposeExposureLadder,
  reassessmentDue,
  snapshotFromAssessment,
  targetsDiff,
} from '../src/health/index.ts';
import type { ExposureObs, GrowthRow, InputSnapshot, TargetSnapshot } from '../src/health/index.ts';
import { buildCandidateSets, planDeterministic } from '../src/planning/index.ts';
import type { CatalogIngredient } from '../src/planning/types.ts';
import { catalog, ibrahim, maryam, member, request } from './planning-fixtures.ts';

const TODAY = '2026-10-06';
const day = (n: number) =>
  new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const ex = (
  ingredientId: string,
  daysAgo: number,
  acceptance: ExposureObs['acceptance'],
  stage: ExposureObs['stage'] = 'taste',
  extra: Partial<ExposureObs> = {},
): ExposureObs => ({ ingredientId, exposedOn: day(daysAgo), stage, acceptance, ...extra });

describe('acceptance analytics (15 §4.7)', () => {
  it('weights recent exposures more (half-life 21 days)', () => {
    const recentGood = [ex('a', 1, '5_ate_well'), ex('a', 60, '0_refused')];
    const recentBad = [ex('a', 1, '0_refused'), ex('a', 60, '5_ate_well')];
    expect(acceptanceIndex(recentGood, TODAY)!).toBeGreaterThan(70);
    expect(acceptanceIndex(recentBad, TODAY)!).toBeLessThan(30);
    expect(acceptanceIndex([ex('a', 120, '5_ate_well')], TODAY)).toBeNull();
  });

  it('counts accepted foods with safe foods, new acceptances and variety', () => {
    const rows = [
      ex('guava', 20, '4_ate_some'),
      ex('guava', 10, '4_ate_some'),
      ex('guava', 2, '5_ate_well'),
      ex('pumpkin', 3, '3_tasted'),
      ex('pumpkin', 1, '1_tolerated'),
    ];
    const s = acceptanceSummary(rows, ['roti', 'banana'], TODAY);
    expect(s.acceptedFoodCount).toBe(3); // roti, banana, guava
    expect(s.newAccepted).toBe(1);
    expect(s.exposures).toBe(5);
    expect(s.varietyLast7Days).toBe(2);
    expect(s.medianExposuresToAcceptance).toBe(3);
    expect(s.foods.find((f) => f.ingredientId === 'guava')?.lifecycle).toBe('accepted');
  });
});

describe('new-food progression (15 §4.5)', () => {
  it('moves introduced -> exposing -> tasting -> accepted', () => {
    expect(foodLifecycle([], TODAY).status).toBe('introduced');
    expect(foodLifecycle([ex('x', 3, '1_tolerated', 'look')], TODAY).status).toBe('exposing');
    expect(foodLifecycle([ex('x', 5, '3_tasted'), ex('x', 2, '3_tasted')], TODAY).status).toBe(
      'tasting',
    );
    const accepted = foodLifecycle(
      [ex('x', 25, '4_ate_some'), ex('x', 12, '4_ate_some'), ex('x', 1, '5_ate_well')],
      TODAY,
    );
    expect(accepted.status).toBe('accepted');
    expect(accepted.suggestSafeFood).toBe(true);
  });

  it('acceptance must happen 3 times within 30 days', () => {
    const spread = [ex('x', 80, '4_ate_some'), ex('x', 40, '4_ate_some'), ex('x', 1, '4_ate_some')];
    expect(foodLifecycle(spread, TODAY).status).toBe('tasting');
  });

  it('pauses for two weeks after 15 exposures without tasting, then suggests a chain', () => {
    const fifteen = Array.from({ length: 15 }, (_, i) => ex('x', 20 - i, '1_tolerated', 'look'));
    const paused = foodLifecycle(fifteen, TODAY);
    expect(paused.status).toBe('paused');
    expect(paused.pausedUntil).toBe(day(6 - 14));
    const later = foodLifecycle(fifteen, '2026-10-30');
    expect(later.status).toBe('exposing');
    expect(later.suggestChain).toBe(true);
  });

  it('pauses after two distress events', () => {
    const rows = [
      ex('x', 3, '0_refused', 'touch', { distress: true }),
      ex('x', 1, '0_refused', 'touch', { distress: true }),
    ];
    expect(foodLifecycle(rows, TODAY).status).toBe('paused');
  });

  it('caps new foods a week: autism 1, picky 1 under 5 and 2 from 5', () => {
    expect(maxNewFoodsPerWeek(96, ['autism'])).toBe(1);
    expect(maxNewFoodsPerWeek(50, ['picky_eater'])).toBe(1);
    expect(maxNewFoodsPerWeek(96, ['picky_eater'])).toBe(2);
  });
});

describe('ladder step progression (15 §3.5)', () => {
  it('advances after three calm passes at the stage', () => {
    const rows = [
      ex('c', 3, '2_touched', 'touch'),
      ex('c', 2, '2_touched', 'touch'),
      ex('c', 1, '3_tasted', 'touch'),
    ];
    expect(nextLadderAction('touch', rows)).toBe('advance');
    expect(nextStage('touch', 'advance')).toBe('smell');
  });

  it('stays below the pass mark, steps back after refusals or distress, pauses on a hard day', () => {
    expect(
      nextLadderAction('touch', [
        ex('c', 2, '1_tolerated', 'touch'),
        ex('c', 1, '2_touched', 'touch'),
      ]),
    ).toBe('stay');
    const refused = [1, 2, 3].map((d) => ex('c', d, '0_refused', 'taste'));
    expect(nextLadderAction('taste', refused)).toBe('step_back');
    expect(nextStage('taste', 'step_back')).toBe('lick');
    const distress = [
      ex('c', 2, '2_touched', 'touch', { distress: true }),
      ex('c', 1, '2_touched', 'touch', { distress: true }),
    ];
    expect(nextLadderAction('touch', distress)).toBe('step_back');
    expect(nextLadderAction('touch', [ex('c', 1, '2_touched', 'touch', { hardDay: true })])).toBe(
      'pause',
    );
    expect(nextStage('tolerate_on_table', 'step_back')).toBe('tolerate_on_table');
  });
});

// ---- food chaining ----

const food = (
  id: string,
  name: string,
  category: string,
  color: string,
  textures: string[],
  extra: Partial<CatalogIngredient> = {},
): CatalogIngredient => ({
  id,
  name,
  category,
  color,
  textures,
  halalStatus: 'halal',
  allergenCodes: [],
  isSunnahFood: false,
  ...extra,
});

const CHAIN_FOODS = [
  food('rice', 'Plain rice', 'grain', 'beige', ['soft']),
  food('potato', 'Boiled potato', 'vegetable', 'beige', ['soft']),
  food('squash', 'Yellow squash', 'vegetable', 'yellow', ['soft']),
  food('carrot', 'Soft carrot sticks', 'vegetable', 'orange', ['soft']),
  food('cucumber', 'Cucumber', 'vegetable', 'green', ['crunchy']),
  food('peanut', 'Peanuts', 'nut_seed', 'brown', ['crunchy'], { allergenCodes: ['peanuts'] }),
  food('pork', 'Pork', 'meat', 'red', ['chewy'], { halalStatus: 'haram' }),
];
const ING = new Map(CHAIN_FOODS.map((i) => [i.id, i]));
const node = (id: string) => nodeOf(ING.get(id)!);

describe('food chaining (15 §3.6)', () => {
  it('derives features from textures, colour and category', () => {
    const f = ingredientFeatures(ING.get('carrot')!);
    expect(f).toMatchObject({ color: 'orange', flavor: 'savory', ladderStep: 3 });
    expect(ingredientFeatures(ING.get('cucumber')!).ladderStep).toBe(6);
  });

  it('chains from a safe food in small steps, each within MAX_HOP', () => {
    const chain = planFoodChain([node('rice')], node('carrot'), CHAIN_FOODS.map(nodeOf));
    expect(chain?.foods.map((f) => f.id)).toEqual(['rice', 'potato', 'squash', 'carrot']);
    expect(chain!.hops.every((h) => h <= MAX_HOP)).toBe(true);
    // A direct jump is too big (two colour steps plus flavour).
    expect(
      chainDistance(ingredientFeatures(ING.get('rice')!), ingredientFeatures(ING.get('carrot')!)),
    ).toBeGreaterThan(MAX_HOP);
  });

  it('respects the sensory profile: an avoided colour cannot be a bridge', () => {
    const profile = { textureLikes: [], textureAvoids: [], colorSensitivities: ['avoid:yellow'] };
    expect(
      planFoodChain([node('rice')], node('carrot'), CHAIN_FOODS.map(nodeOf), profile),
    ).toBeNull();
  });

  it('builds ladder steps: compressed stages for bridges, the full ladder for the target', () => {
    const chain = planFoodChain([node('rice')], node('carrot'), CHAIN_FOODS.map(nodeOf))!;
    const steps = chainLadderSteps(chain);
    expect(steps.filter((s) => s.food_label === 'Boiled potato').map((s) => s.stage)).toEqual([
      'look',
      'touch',
      'taste',
      'eat_small',
    ]);
    expect(steps.filter((s) => s.food_label === 'Soft carrot sticks')).toHaveLength(9);
    expect(steps.map((s) => s.step_no)).toEqual(steps.map((_, i) => i + 1));
    expect(steps[0]!.bridge_from_ingredient_id).toBe('rice');
    expect(exposureLadderSteps('Carrot', 'touch').map((s) => s.stage)[0]).toBe('touch');
    for (const s of steps) expect(findFeedingPressure(s.criteria)).toEqual([]);
  });
});

describe('create_exposure_ladder proposal', () => {
  const child = member({
    id: 'm1',
    ageMonths: 50,
    lifeStage: 'child',
    modules: ['autism'],
    safeFoods: [{ id: 'sf', ingredientId: 'rice', label: 'Plain rice', strength: 3 }],
  });
  const base = { member: child, ingredients: ING, allowMashbooh: false } as const;

  it('proposes a food chain toward the target', () => {
    const r = proposeExposureLadder({
      ...base,
      targetFood: 'carrot sticks',
      strategy: 'food_chaining',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.proposal.strategy).toBe('food_chaining');
      expect(r.proposal.chain.map((c) => c.ingredientId)).toEqual([
        'rice',
        'potato',
        'squash',
        'carrot',
      ]);
      expect(r.proposal.notes.join(' ')).toMatch(/no whole nuts/);
    }
  });

  it('falls back to a plain ladder when no gentle chain exists', () => {
    const r = proposeExposureLadder({
      ...base,
      targetFood: 'carrot',
      strategy: 'food_chaining',
      sensory: { textureLikes: [], textureAvoids: [], colorSensitivities: ['avoid:yellow'] },
    });
    expect(r.ok && r.proposal.fallback).toBe('no_chain');
    expect(r.ok && r.proposal.strategy).toBe('exposure_ladder');
  });

  it('refuses allergen and non-halal targets, and existing safe foods', () => {
    const allergic = member({
      ...child,
      allergies: [{ allergenCode: 'peanuts', severity: 'severe', kind: 'allergy' }],
    });
    expect(
      proposeExposureLadder({
        ...base,
        member: allergic,
        targetFood: 'peanuts',
        strategy: 'exposure_ladder',
      }).ok,
    ).toBe(false);
    expect(
      proposeExposureLadder({ ...base, targetFood: 'pork', strategy: 'exposure_ladder' }).ok,
    ).toBe(false);
    const already = proposeExposureLadder({
      ...base,
      targetFood: 'plain rice',
      strategy: 'exposure_ladder',
    });
    expect(!already.ok && already.code).toBe('ALREADY_SAFE');
  });
});

// ---- weekly exposure pair ----

describe('weekly exposure pair (S6-05)', () => {
  const req = request({ weekCount: 2 });
  const cat = catalog();
  const plan = () =>
    planDeterministic(req, cat, buildCandidateSets(req, cat)).draft.meals.map((m) => ({ ...m }));

  it('adds one new food a week beside a safe food, on at most 4 distinct days', () => {
    const meals = plan();
    const pairs = applyExposurePairs([{ member: ibrahim, exposures: [] }], cat, req, meals, TODAY);
    expect(pairs).toHaveLength(2);
    for (const p of pairs) {
      expect(p.familiarLabel).toBe('Roti');
      expect(['i-atta', 'i-banana']).not.toContain(p.newIngredientId);
      expect(p.slotRefs.length).toBeGreaterThan(0);
      expect(p.slotRefs.length).toBeLessThanOrEqual(4);
      const dates = meals.filter((m) => p.slotRefs.includes(m.slot.ref)).map((m) => m.slot.date);
      expect(new Set(dates).size).toBe(dates.length);
    }
    const notes = meals.map((m) => m.notes ?? '').filter((n) => n.includes('Learning plate'));
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) {
      expect(findFeedingPressure(n)).toEqual([]);
      expect(findChildRestrictionViolations(n)).toEqual([]);
      expect(n.match(/Learning plate for Ibrahim/g)).toHaveLength(1);
    }
  });

  it('continues a food in progress and skips accepted or allergen foods', () => {
    const meals = plan();
    const exposures = [
      ex('i-spinach', 4, '2_touched', 'touch'),
      ex('i-apple', 20, '4_ate_some'),
      ex('i-apple', 10, '4_ate_some'),
      ex('i-apple', 2, '5_ate_well'),
    ];
    const pair = chooseExposurePair(
      { member: ibrahim, exposures },
      cat,
      req,
      meals.filter((m) => m.slot.week === 1),
      TODAY,
    );
    expect(pair?.newIngredientId).toBe('i-spinach');
    expect(pair?.source).toBe('in_progress');
    const allergic = member({
      ...ibrahim,
      allergies: [{ allergenCode: 'eggs', severity: 'mild', kind: 'allergy' }],
    });
    const p2 = chooseExposurePair(
      { member: allergic, exposures: [ex('i-egg', 2, '1_tolerated', 'look')] },
      cat,
      req,
      meals,
      TODAY,
    );
    expect(p2?.newIngredientId).not.toBe('i-egg');
  });

  it('prefers an active ladder target and skips members without the modules', () => {
    const meals = plan();
    const pair = chooseExposurePair(
      { member: maryam, exposures: [], ladderTargets: ['i-lauki'] },
      cat,
      req,
      meals,
      TODAY,
    );
    expect(pair?.newIngredientId).toBe('i-lauki');
    expect(pair?.source).toBe('ladder');
    expect(pair?.familiarLabel).toBe('Plain rice');
    expect(
      chooseExposurePair(
        { member: member({ id: 'adult' }), exposures: [] },
        cat,
        req,
        meals,
        TODAY,
      ),
    ).toBeNull();
  });
});

// ---- reassessment diff ----

const inputs = (over: Partial<InputSnapshot> = {}): InputSnapshot => ({
  ageMonths: 456,
  lifeStage: 'adult',
  weightKg: 92,
  heightCm: 178,
  activityLevel: 'moderate',
  goals: ['weight_loss'],
  modules: [],
  climate: 'hot',
  ...over,
});
const snap = (over: Partial<TargetSnapshot> = {}): TargetSnapshot => ({
  minor: false,
  energyKcal: 2100,
  proteinG: 110,
  carbsG: 250,
  fatG: 70,
  fiberG: 30,
  hydrationMl: 2500,
  ...over,
});

describe('periodic reassessment diff (S6-15)', () => {
  it('lists adult target changes above the threshold with reasons', () => {
    const d = targetsDiff(snap(), snap({ energyKcal: 1980, proteinG: 108, hydrationMl: 2700 }), {
      prev: inputs(),
      next: inputs({ weightKg: 86 }),
    });
    expect(d.changed).toBe(true);
    expect(d.items.map((i) => i.target)).toEqual(['energy_kcal', 'hydration_ml']);
    expect(d.reasons).toEqual(['weight_changed']);
  });

  it('reports no change below thresholds', () => {
    const d = targetsDiff(snap(), snap({ energyKcal: 2120 }), { prev: inputs(), next: inputs() });
    expect(d.changed).toBe(false);
  });

  it('never yields kcal, macro or weight numbers for a child', () => {
    const child = snap({ minor: true, energyKcal: 1700, proteinG: 40, hydrationMl: 1300 });
    const d = targetsDiff(snap({ minor: true, energyKcal: 1500, hydrationMl: 1100 }), child, {
      prev: inputs({ ageMonths: 90, lifeStage: 'child', weightKg: 24 }),
      next: inputs({ ageMonths: 96, lifeStage: 'child', weightKg: 26 }),
    });
    expect(d.items.map((i) => i.target)).toEqual(['hydration_ml']);
    expect(diffHasChildTargets(d)).toBe(false);
    expect(d.reasons).not.toContain('weight_changed');
    // A stored child row with an internal estimate reads as no energy at all.
    const fromRow = snapshotFromAssessment({
      energy_targets: { display: false, internal_estimate: { kcal_per_day: 1700 } },
      macro_targets: { protein_g: 40 },
      hydration_targets: { daily_ml: 1300 },
      minor: true,
    });
    expect(fromRow).toMatchObject({ energyKcal: null, proteinG: null, hydrationMl: 1300 });
  });

  it('a teen turning 18 gets a new adult target without a child "from" value', () => {
    const d = targetsDiff(snap({ minor: true, energyKcal: 2400 }), snap({ energyKcal: 2500 }), {
      prev: inputs({ ageMonths: 215, lifeStage: 'teen' }),
      next: inputs({ ageMonths: 216 }),
    });
    expect(d.items.find((i) => i.target === 'energy_kcal')).toMatchObject({ from: null, to: 2500 });
    expect(d.reasons).toContain('turned_adult');
  });

  it('is due after 28 days', () => {
    const now = new Date('2026-10-06T00:00:00Z');
    expect(reassessmentDue('2026-09-08T00:00:00Z', now)).toBe(true);
    expect(reassessmentDue('2026-09-20T00:00:00Z', now)).toBe(false);
  });
});

// ---- growth status ----

const growth = (measured_on: string, wfa: number, z: number, flags: string[] = []): GrowthRow => ({
  measured_on,
  reference: 'who_2007',
  age_months: 96,
  height_for_age_percentile: 40,
  weight_for_age_percentile: wfa,
  bmi_for_age_percentile: 45,
  head_circumference_for_age_percentile: null,
  weight_for_age_z: z,
  height_for_age_z: -0.25,
  flags,
  computed_at: `${measured_on}T10:00:00Z`,
});

describe('get_growth_status view', () => {
  const rows = [
    growth('2026-04-01', 50, 0),
    growth('2026-07-01', 25, -0.67),
    growth('2026-10-01', 10, -1.28, ['red_flag.crossed_two_major_percentiles']),
    { ...growth('2026-10-05', 5, -1.6), computed_at: null },
  ];

  it('returns percentiles and alerts only, trend for premium', () => {
    const v = growthStatusView(rows, { includeTrend: true, premium: true });
    expect(v.measurements).toBe(3);
    expect(v.latest?.measuredOn).toBe('2026-10-01');
    expect(v.alerts).toEqual(['crossed_two_major_percentiles']);
    expect(v.seeClinician).toBe(true);
    expect(v.trend?.direction).toBe('falling');
    const { instruction: _i, ...data } = v;
    expect(JSON.stringify(data)).not.toMatch(/kg|kcal|calorie|_cm|target|\d+\.\d+ ?(kg|cm)/i);
    expect(growthStatusView(rows, { includeTrend: true, premium: false }).trend).toBeNull();
  });

  it('asks to log a measurement when there is none', () => {
    const v = growthStatusView([], { includeTrend: false, premium: true });
    expect(v.latest).toBeNull();
    expect(v.instruction).toMatch(/log/);
  });
});

// ---- feeding pressure guardrail ----

describe('feeding pressure guardrail', () => {
  it('finds pressure, bribes, rewards and hiding foods', () => {
    for (const s of [
      'Tell him just one more bite before he leaves the table.',
      'Make him finish his plate.',
      'Give her dessert if she eats the carrots.',
      'Hide the spinach in his paratha so he will not notice.',
      'Force her to taste it.',
      'بس ایک اور نوالہ کھا لو۔',
    ])
      expect(findFeedingPressure(s).length, s).toBeGreaterThan(0);
  });

  it('allows calm, negated advice', () => {
    for (const s of [
      'Never bribe or force; looking and touching count.',
      'There is no need to finish the plate.',
      'Offer guava next to banana and let him decide how much.',
    ])
      expect(findFeedingPressure(s), s).toEqual([]);
  });

  it('removes pressure sentences about a child in guarded output', () => {
    const out = guardOutput('Offer carrots at lunch. Give him a sweet if he eats them all up.', {
      locale: 'en',
      aboutMinor: true,
    });
    expect(out.safetyFlags).toContain('feeding_pressure_removed');
    expect(out.text).toMatch(/Offer carrots at lunch/);
    expect(out.text).not.toMatch(/sweet if/);
    expect(removeFeedingPressure('Force him.', 'ur').text).toMatch(/[؀-ۿ]/u);
  });
});

describe('numeric grounding in Urdu (S6 eval finding)', () => {
  it('treats Urdu calorie, gram and litre units as quantities', async () => {
    const { extractQuantities, findUngroundedNumbers } =
      await import('../src/guardrails/numeric-grounding.ts');
    expect(findUngroundedNumbers('روزانہ 900 کیلوری رکھیں۔', {})).toHaveLength(1);
    expect(extractQuantities('دو 1.5 لیٹر')[0]).toMatchObject({ unit: 'ml', value: 1500 });
    expect(findUngroundedNumbers('روزانہ 1500 ملی لیٹر پانی', { ml: [1500] })).toHaveLength(0);
  });
});
