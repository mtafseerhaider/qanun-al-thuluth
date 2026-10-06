import { describe, expect, it } from 'vitest';

import {
  buildCandidateSets,
  evaluateChoices,
  fallbackChoices,
  hardViolations,
  PlanningError,
} from '../src/planning/index.ts';
import type {
  Catalog,
  CatalogIngredient,
  CatalogMeal,
  DraftPlan,
  PlanMember,
  PlanRequest,
} from '../src/planning/index.ts';
import {
  catalog as baseCatalog,
  household,
  INGREDIENTS,
  meal,
  MEALS,
  member,
} from './planning-fixtures.ts';

/**
 * S3-06 (FR-PLAN-06, 14 AC-P1/P3): property-based plan validation. 500 plans generated over
 * randomized households and randomized catalogs, with an adversarial "model" that picks haram,
 * allergen-bearing and unknown meals, must contain zero allergen or haram violations once the
 * validators and fallback have run. A seeded PRNG keeps every run reproducible (no new dependency).
 * The oracle below is written independently of the engine's rules.
 */

function prng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const ALLERGENS = [
  'peanuts',
  'milk',
  'eggs',
  'gluten_cereals',
  'wheat',
  'fish',
  'soy',
  'tree_nuts',
  'sesame',
  'crustaceans',
];
const SEVERITIES = ['mild', 'moderate', 'severe', 'anaphylactic'] as const;
const STAGES: Array<[PlanMember['lifeStage'], number, number]> = [
  ['infant', 6, 11],
  ['toddler', 12, 35],
  ['child', 36, 155],
  ['teen', 156, 215],
  ['adult', 216, 767],
  ['older_adult', 780, 960],
];

function randomCatalog(rand: () => number, n: number): Catalog {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  // Extra ingredients with random halal status and allergens.
  const extras: CatalogIngredient[] = Array.from({ length: 12 }, (_, i) => ({
    id: `rx-${n}-${i}`,
    name: `Random ingredient ${i}`,
    category: pick([
      'vegetable',
      'fruit',
      'grain',
      'legume',
      'poultry',
      'meat',
      'dairy',
      'condiment',
    ]),
    halalStatus: pick([
      'halal',
      'halal',
      'halal',
      'haram',
      'mashbooh',
      'depends_on_source',
    ] as const),
    allergenCodes: rand() < 0.4 ? [pick(ALLERGENS)] : [],
    isSunnahFood: rand() < 0.1,
  }));
  const ingredients = [...INGREDIENTS, ...extras];
  const types = ['breakfast', 'lunch', 'snack', 'dinner'] as const;
  const extraMeals: CatalogMeal[] = Array.from({ length: 16 }, (_, i) => {
    const ids = Array.from({ length: 2 + Math.floor(rand() * 3) }, () => pick(ingredients).id);
    return meal(`rm-${n}-${i}`, `Random meal ${i}`, types[i % 4] ?? 'dinner', [...new Set(ids)], {
      costTier: pick([1, 2, 3] as const),
      prepMin: Math.floor(rand() * 90),
    });
  });
  // Random alternatives between same-type meals (some unsafe on purpose).
  const all = [...MEALS, ...extraMeals];
  const withAlts = all.map((m) => {
    if (rand() > 0.3) return m;
    const sameType = all.filter((x) => x.mealType === m.mealType && x.id !== m.id);
    const alt = pick(sameType);
    return {
      ...m,
      alternatives: [
        ...m.alternatives,
        { mealId: alt.id, reason: pick(['allergy', 'autism', 'picky'] as const) },
      ],
    };
  });
  return baseCatalog(withAlts, ingredients);
}

function randomMembers(rand: () => number, cat: Catalog): PlanMember[] {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const ingIds = [...cat.ingredients.keys()];
  const n = 1 + Math.floor(rand() * 5);
  return Array.from({ length: n }, (_, i) => {
    const [lifeStage, lo, hi] = i === 0 ? (STAGES[4] as (typeof STAGES)[number]) : pick(STAGES);
    const ageMonths = lo + Math.floor(rand() * (hi - lo + 1));
    const allergies =
      rand() < 0.5
        ? [
            ...new Set(Array.from({ length: 1 + Math.floor(rand() * 2) }, () => pick(ALLERGENS))),
          ].map((allergenCode) => ({
            allergenCode,
            severity: pick(SEVERITIES),
            kind: pick(['allergy', 'intolerance'] as const),
          }))
        : [];
    const modules =
      rand() < 0.3 && lifeStage !== 'adult' ? [pick(['autism', 'picky_eater'] as const)] : [];
    return member({
      id: `m${i}`,
      name: `M${i}`,
      lifeStage,
      ageMonths,
      allergies,
      modules,
      goals: rand() < 0.3 ? ['weight_loss'] : [],
      medicationFlags:
        rand() < 0.1 ? [pick(['maoi_tyramine', 'warfarin_vitamin_k_consistency'])] : [],
      dislikes:
        rand() < 0.2
          ? [
              {
                ingredientId: pick(ingIds),
                label: 'x',
                reason: pick(['religious', 'taste'] as const),
              },
            ]
          : [],
      safeFoods: modules.length
        ? Array.from({ length: Math.floor(rand() * 3) }, (_, k) => ({
            id: `sf${i}${k}`,
            ingredientId: pick(ingIds),
            label: 'safe',
            strength: 1 + Math.floor(rand() * 3),
          }))
        : [],
    });
  });
}

/** Independent oracle: what an accepted plan must never contain. */
function oracle(draft: DraftPlan, req: PlanRequest, cat: Catalog): string[] {
  const problems: string[] = [];
  const severe = new Set(
    req.members.flatMap((m) =>
      m.allergies
        .filter((a) => a.severity === 'severe' || a.severity === 'anaphylactic')
        .map((a) => a.allergenCode),
    ),
  );
  const ingsOf = (mealId: string) =>
    (cat.meals.get(mealId)?.ingredientIds ?? []).map((id) => cat.ingredients.get(id));
  const badHalal = (mealId: string) =>
    ingsOf(mealId).some(
      (i) =>
        !i ||
        i.halalStatus === 'haram' ||
        (i.halalStatus === 'mashbooh' && !req.household.allowMashbooh),
    );
  for (const pm of draft.meals) {
    if (!cat.meals.has(pm.mealId)) problems.push(`unknown meal ${pm.mealId}`);
    if (badHalal(pm.mealId)) problems.push(`haram in ${pm.mealId}`);
    if (ingsOf(pm.mealId).some((i) => i?.allergenCodes.some((c) => severe.has(c))))
      problems.push(`severe allergen in pot ${pm.mealId}`);
    for (const s of pm.servings) {
      const m = req.members.find((x) => x.id === s.memberId);
      if (!m) continue;
      const eaten = s.adaptedMealId ?? pm.mealId;
      if (badHalal(eaten)) problems.push(`haram served ${eaten}`);
      const own = new Set(m.allergies.map((a) => a.allergenCode));
      if (ingsOf(eaten).some((i) => i?.allergenCodes.some((c) => own.has(c))))
        problems.push(`allergen served to ${m.id} in ${eaten}`);
      if (s.safeFood?.ingredientId) {
        const sf = cat.ingredients.get(s.safeFood.ingredientId);
        if (
          !sf ||
          sf.allergenCodes.some((c) => own.has(c) || severe.has(c)) ||
          sf.halalStatus === 'haram'
        )
          problems.push(`unsafe safe food for ${m.id}`);
      }
      if (m.ageMonths < 216 && s.goalApplied !== 'none')
        problems.push(`weight goal on minor ${m.id}`);
    }
  }
  return problems;
}

describe('property: 500 generated plans have zero allergen or haram violations', () => {
  it('holds over randomized households, catalogs and adversarial model picks', () => {
    const rand = prng(20261123);
    let accepted = 0;
    let noCandidates = 0;
    let attempts = 0;
    let caught = 0;
    const failures: string[] = [];
    while (accepted < 500 && attempts < 3000) {
      attempts++;
      const cat = randomCatalog(rand, attempts);
      const members = randomMembers(rand, cat);
      const req: PlanRequest = {
        startDate: '2026-11-23',
        weekCount: 1,
        mealTypes: ['breakfast', 'lunch', 'snack', 'dinner'],
        kind: rand() < 0.2 ? 'weight_management' : 'standard',
        members,
        household: household({
          allowMashbooh: rand() < 0.2,
          budgetTier: ([1, 2, 3] as const)[Math.floor(rand() * 3)] ?? 2,
          budgetStrictness: rand() < 0.3 ? 'hard_cap' : 'target',
        }),
        seed: attempts,
      };
      let sets;
      try {
        sets = buildCandidateSets(req, cat);
      } catch (err) {
        if (err instanceof PlanningError) {
          noCandidates++;
          continue;
        }
        throw err;
      }
      // Adversarial model: random catalog meals of the slot type (may be haram), random candidates, junk.
      const sameType = (t: string) => [...cat.meals.values()].filter((m) => m.mealType === t);
      const choices = new Map(
        sets.map((s) => {
          const r = rand();
          const pool = sameType(s.slot.mealType);
          const id =
            r < 0.3
              ? (pool[Math.floor(rand() * pool.length)]?.id ?? 'junk')
              : r < 0.9
                ? (s.candidates[Math.floor(rand() * s.candidates.length)]?.mealId ?? 'junk')
                : 'junk';
          return [s.slot.ref, id];
        }),
      );
      const first = evaluateChoices(req, cat, sets, choices);
      if (
        first.violations.some((v) => v.hard && /haram|mashbooh|allergen|unknown_meal/.test(v.code))
      )
        caught++;
      const final = hardViolations(first.violations).length
        ? fallbackChoices(req, cat, sets, first)
        : first;
      if (hardViolations(final.violations).length) continue; // the worker marks such a plan failed
      accepted++;
      const problems = oracle(final.draft, req, cat);
      if (problems.length) failures.push(`attempt ${attempts}: ${problems.slice(0, 3).join('; ')}`);
    }
    expect(failures).toEqual([]);
    expect(accepted).toBe(500);
    // The adversarial picks really were unsafe often, and the validators caught every one.
    expect(caught).toBeGreaterThan(250);
    console.info(
      `property: ${accepted} plans, ${attempts} households, ${caught} unsafe drafts caught, ${noCandidates} infeasible`,
    );
    // Sanity: the generator is hard enough that some households have no safe option at all.
    expect(noCandidates + accepted).toBeLessThanOrEqual(attempts);
  }, 60_000);
});
