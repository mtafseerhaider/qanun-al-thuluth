import { describe, expect, it } from 'vitest';

import {
  adjustSafetyEscalation,
  assemblePlan,
  budgetTierFor,
  buildCandidateSets,
  buildSlots,
  chooseTemplate,
  evaluateChoices,
  fallbackChoices,
  feasibility,
  guestMultiplier,
  hardViolations,
  interactionTagsFor,
  planDeterministic,
  PlanningError,
  plateSplitOk,
  portionFor,
  rationaleProblems,
  resolveSelection,
  templateChoices,
  templateRationale,
  validatePlan,
} from '../src/planning/index.ts';
import type { PlanRequest, WeeklyTemplate } from '../src/planning/index.ts';
import {
  catalog,
  hina,
  household,
  ibrahim,
  maryam,
  meal,
  MEALS,
  member,
  request,
  usman,
} from './planning-fixtures.ts';

const cat = catalog();
const servedMealIds = (req: PlanRequest) => {
  const sets = buildCandidateSets(req, cat);
  const plan = planDeterministic(req, cat, sets);
  return { sets, plan };
};

describe('slots', () => {
  it('builds one slot per day and meal type in canonical order', () => {
    const slots = buildSlots({
      startDate: '2026-10-12',
      weekCount: 2,
      mealTypes: ['dinner', 'breakfast'],
    });
    expect(slots).toHaveLength(28);
    expect(slots[0]).toMatchObject({
      ref: 's1',
      date: '2026-10-12',
      mealType: 'breakfast',
      week: 1,
      weekday: 1,
    });
    expect(slots[1]?.mealType).toBe('dinner');
    expect(slots[27]).toMatchObject({ date: '2026-10-25', week: 2, weekday: 0 });
  });
});

describe('hard constraints', () => {
  const slot = buildSlots({ startDate: '2026-10-12', weekCount: 1, mealTypes: ['dinner'] })[0];
  const f = (id: string, req: PlanRequest = request()) =>
    feasibility(cat.meals.get(id)!, slot!, req, cat);

  it('excludes haram always and mashbooh unless the household allows it', () => {
    expect(f('d-pork').hard).toContain('haram');
    expect(f('d-jelly').hard).toContain('mashbooh');
    expect(
      f('d-jelly', request({ household: household({ allowMashbooh: true }) })).hard,
    ).not.toContain('mashbooh');
  });

  it('excludes severe allergens household-wide, including members not being served', () => {
    const req = request({ household: household({ severeAllergenCodes: ['fish'] }) });
    expect(f('d-fish', req).hard).toContain('household_severe_allergen');
  });

  it('needs an allergy alternative for a mild allergy, else excludes the meal', () => {
    const coeliacKid = member({
      id: 'k',
      ageMonths: 100,
      lifeStage: 'child',
      allergies: [{ allergenCode: 'gluten_cereals', severity: 'mild', kind: 'intolerance' }],
    });
    const req = request({ members: [usman, coeliacKid] });
    expect(f('d-karahi', req).ok).toBe(true); // rice-based allergy alternative exists
    expect(f('d-fish', req).hard.join()).toMatch(/member:k:allergen/);
  });

  it('applies religious dislikes and the avoid list household-wide', () => {
    const m = member({
      id: 'x',
      dislikes: [{ ingredientId: 'i-beef', label: 'Beef', reason: 'religious' }],
    });
    expect(f('d-beef', request({ members: [m] })).hard).toContain('religious_dislike');
    expect(f('d-daal', request({ avoidIngredientIds: ['i-masoor'] })).hard).toContain(
      'avoided_ingredient',
    );
  });

  it('hides unreviewed meals unless include_in_review is on', () => {
    expect(f('d-unreviewed').hard).toContain('not_reviewed');
    expect(
      f('d-unreviewed', request({ household: household({ includeInReview: true }) })).hard,
    ).not.toContain('not_reviewed');
  });

  it('enforces the adult plate split on main meals', () => {
    expect(plateSplitOk(cat.meals.get('l-heavy')!)).toBe(false);
    const lunch = buildSlots({ startDate: '2026-10-12', weekCount: 1, mealTypes: ['lunch'] })[0]!;
    expect(feasibility(cat.meals.get('l-heavy')!, lunch, request(), cat).hard).toContain(
      'plate_split',
    );
  });

  it('excludes tyramine for MAOI and respects the hard budget cap', () => {
    const m = member({ id: 'p', medicationFlags: ['maoi_tyramine'] });
    const tagged = meal('d-cheese', 'Aged cheddar bake', 'dinner', ['i-cheddar']);
    const c2 = catalog(
      [...MEALS, tagged],
      [
        ...cat.ingredients.values(),
        {
          id: 'i-cheddar',
          name: 'Aged cheddar',
          category: 'dairy',
          halalStatus: 'halal',
          allergenCodes: ['milk'],
          isSunnahFood: false,
        },
      ],
    );
    expect(feasibility(tagged, slot!, request({ members: [m] }), c2).hard.join()).toMatch(
      /medication:maoi_tyramine/,
    );
    const capped = request({
      household: household({ budgetTier: 1, budgetStrictness: 'hard_cap' }),
    });
    expect(f('d-beef', capped).hard).toContain('budget_hard_cap');
  });

  it('tags vitamin K and tyramine ingredients from names', () => {
    expect(interactionTagsFor(cat.ingredients.get('i-spinach')!)).toContain('high_vitamin_k');
    expect(interactionTagsFor(cat.ingredients.get('i-soy-sauce')!)).toContain('high_tyramine');
  });
});

describe('portions and child rules', () => {
  it('serves minors from their own life stage, start tier first', () => {
    const p = portionFor(cat.meals.get('d-daal')!, ibrahim);
    expect(p).toMatchObject({ lifeStage: 'child', tier: 'start' });
    const teen = member({ id: 't', ageMonths: 180, lifeStage: 'teen' });
    expect(portionFor(cat.meals.get('d-daal')!, teen)?.tier).toBe('ideal');
  });

  it('never falls back to another life stage for a minor', () => {
    const noChild = meal('d-x', 'No child portion', 'dinner', ['i-masoor', 'i-rice'], {
      portions: [{ id: 'p', lifeStage: 'adult', tier: 'standard', grams: 400, kcal: 500 }],
    });
    expect(portionFor(noChild, ibrahim)).toBeNull();
  });

  it('flags a reduced child portion and any weight adaptation for a minor', () => {
    const req = request();
    const { sets, plan } = servedMealIds(req);
    expect(hardViolations(plan.violations)).toEqual([]);
    const draft = structuredClone(plan.draft);
    const firstDinner = draft.meals.find((m) => m.slot.mealType === 'dinner')!;
    const kid = firstDinner.servings.find((s) => s.memberId === 'ibrahim')!;
    kid.goalApplied = 'weight_loss';
    kid.portionId = `${kid.adaptedMealId ?? firstDinner.mealId}:adult:standard`;
    const codes = validatePlan(draft, req, cat).map((v) => v.code);
    expect(codes).toContain('child_weight_adaptation');
    expect(codes).toContain('child_portion_stage');
    expect(sets.length).toBe(28);
  });

  it('never applies a weight goal to a child or a breastfeeding mother', () => {
    const { plan } = servedMealIds(request());
    for (const m of plan.draft.meals) {
      for (const s of m.servings) {
        if (s.memberId === 'ibrahim' || s.memberId === 'maryam' || s.memberId === 'hina')
          expect(s.goalApplied).toBe('none');
        if (s.memberId === 'usman') expect(s.goalApplied).toBe('weight_loss');
      }
    }
  });
});

describe('adaptations', () => {
  it('gives the autistic child the curated alternative or a safe food on every plate', () => {
    const { plan } = servedMealIds(request());
    for (const m of plan.draft.meals) {
      const s = m.servings.find((x) => x.memberId === 'maryam')!;
      expect(s.adaptation).toBe('autism');
      expect(s.adaptedMealId !== null || s.safeFood !== null).toBe(true);
      if (m.mealId === 'd-karahi') expect(s.adaptedMealId).toBe('d-karahi-a');
    }
  });

  it('keeps the family meal for the picky child and adds a safe food', () => {
    const { plan } = servedMealIds(request());
    for (const m of plan.draft.meals) {
      const s = m.servings.find((x) => x.memberId === 'ibrahim')!;
      expect(s.adaptation).toBe('picky');
      expect(s.safeFood).not.toBeNull();
      expect(m.notes).toMatch(/Safe food on the side for Ibrahim/);
    }
  });

  it('rejects a safe food that holds the member allergen', () => {
    const kid = member({
      ...ibrahim,
      allergies: [{ allergenCode: 'gluten_cereals', severity: 'mild', kind: 'allergy' }],
    });
    const req = request({ members: [usman, kid] });
    const { plan } = servedMealIds(req);
    for (const m of plan.draft.meals)
      expect(m.servings.find((s) => s.memberId === kid.id)?.safeFood?.id).toBe('sf-banana');
  });

  it('adds halal sourcing notes for depends_on_source meat', () => {
    const { plan } = servedMealIds(request());
    const chicken = plan.draft.meals.find((m) =>
      cat.meals.get(m.mealId)?.ingredientIds.includes('i-chicken'),
    );
    expect(chicken?.notes).toMatch(/halal/i);
  });
});

describe('validator', () => {
  it('rejects unknown meals, haram picks and allergens even if the assembler is bypassed', () => {
    const req = request({
      members: [
        usman,
        member({
          id: 'a',
          allergies: [{ allergenCode: 'peanuts', severity: 'mild', kind: 'allergy' }],
        }),
      ],
    });
    const slots = buildSlots(req);
    const choices = new Map(
      slots.map((s) => [
        s.ref,
        s.mealType === 'snack' ? 's-peanut' : s.mealType === 'dinner' ? 'd-pork' : 'zzz',
      ]),
    );
    const draft = assemblePlan(req, cat, slots, choices);
    // force the peanut serving in
    for (const m of draft.meals)
      if (m.mealId === 's-peanut')
        m.servings.push({
          memberId: 'a',
          portionId: 's-peanut:adult:standard',
          portionTier: 'standard',
          lifeStage: 'adult',
          adaptation: 'none',
          adaptedMealId: null,
          safeFood: null,
          goalApplied: 'none',
        });
    const codes = new Set(validatePlan(draft, req, cat).map((v) => v.code));
    for (const c of ['unknown_meal', 'haram', 'allergen']) expect(codes).toContain(c);
  });

  it('limits red meat dinners, deep-fried mains and spreads vitamin K for warfarin', () => {
    const req = request({
      members: [member({ id: 'w', medicationFlags: ['warfarin_vitamin_k_consistency'] })],
      mealTypes: ['lunch', 'dinner'],
    });
    const slots = buildSlots(req);
    const choices = new Map(
      slots.map((s) => [s.ref, s.mealType === 'lunch' ? 'l-palak' : 'd-beef']),
    );
    const codes = new Set(
      validatePlan(assemblePlan(req, cat, slots, choices), req, cat).map((v) => v.code),
    );
    expect(codes).toContain('red_meat_limit');
    // palak lunch and a palak dinner on the same day
    const choices2 = new Map(
      slots.map((s) => [s.ref, s.mealType === 'lunch' ? 'l-palak' : 'd-palak']),
    );
    const codes2 = new Set(
      validatePlan(assemblePlan(req, cat, slots, choices2), req, cat).map((v) => v.code),
    );
    expect(codes2).toContain('vitamin_k_inconsistent');
    const ok = planDeterministic(req, cat, buildCandidateSets(req, cat));
    expect(hardViolations(ok.violations)).toEqual([]);
  });

  it('falls back deterministically from bad choices to a valid plan', () => {
    const req = request();
    const sets = buildCandidateSets(req, cat);
    const bad = new Map(
      sets.map((s) => [s.slot.ref, s.slot.mealType === 'dinner' ? 'd-pork' : (s.pool[0] ?? '')]),
    );
    const first = evaluateChoices(req, cat, sets, bad);
    expect(hardViolations(first.violations).length).toBeGreaterThan(0);
    const fixed = fallbackChoices(req, cat, sets, first);
    expect(hardViolations(fixed.violations)).toEqual([]);
    // Seven pork dinners also break the weekly red-meat rule, so the whole week is re-solved.
    expect(fixed.fallbackSlots.length).toBeGreaterThanOrEqual(7);
    expect([...fixed.choices.values()]).not.toContain('d-pork');
  });

  it('throws NO_CANDIDATES when nothing safe fits a slot', () => {
    const allergic = member({
      id: 'z',
      allergies: ['peanuts', 'milk', 'eggs', 'gluten_cereals', 'fish'].map((c) => ({
        allergenCode: c,
        severity: 'anaphylactic' as const,
        kind: 'allergy' as const,
      })),
    });
    const req = request({ members: [allergic], mealTypes: ['breakfast'] });
    const onlyDairy = catalog(MEALS.filter((m) => m.mealType !== 'breakfast' || m.id === 'b-oats'));
    expect(() => buildCandidateSets(req, onlyDairy)).toThrow(PlanningError);
  });

  it('serves no portions to infants', () => {
    const baby = member({ id: 'baby', ageMonths: 8, lifeStage: 'infant' });
    const req = request({ members: [usman, baby] });
    const { plan } = servedMealIds(req);
    expect(plan.draft.skippedMembers).toEqual([{ memberId: 'baby', reason: 'infant' }]);
    expect(plan.draft.meals.every((m) => m.servings.every((s) => s.memberId !== 'baby'))).toBe(
      true,
    );
  });
});

describe('model composition', () => {
  it('accepts candidate refs only', () => {
    const sets = buildCandidateSets(request(), cat);
    const s1 = sets[0]!;
    const { choices, issues } = resolveSelection(sets, {
      choices: [
        { slot: s1.slot.ref, pick: 'c1' },
        { slot: 's2', pick: 'c99' },
        { slot: 's999', pick: 'c1' },
      ],
      rationale: 'ok',
    });
    expect(choices.get(s1.slot.ref)).toBe(s1.candidates[0]?.mealId);
    expect(issues.join('\n')).toMatch(/s2: c99 is not one of its candidates/);
    expect(issues.join('\n')).toMatch(/s999/);
  });

  it('screens rationales for child restriction, numbers, rulings and cure claims', () => {
    expect(
      rationaleProblems('Ibrahim should eat less rice to lose weight.', true).length,
    ).toBeGreaterThan(0);
    expect(rationaleProblems('Each dinner gives 650 kcal.', false)).toContain('number:650 kcal');
    expect(rationaleProblems('Dates cure anaemia.', false).length).toBeGreaterThan(0);
    expect(rationaleProblems(templateRationale('en', { hasMinor: true }), true)).toEqual([]);
    expect(
      rationaleProblems(templateRationale('ur', { hasMinor: true, template: true }), true),
    ).toEqual([]);
  });
});

describe('templates', () => {
  const t: WeeklyTemplate = {
    key: 't',
    title: 'Test',
    countryCode: 'PK',
    budgetTier: 1,
    days: Array.from({ length: 7 }, () => ({
      breakfast: 'B001',
      lunch: 'L001',
      snack: 'S003',
      dinner: 'D090',
    })) as unknown as WeeklyTemplate['days'],
  };
  it('keeps feasible template meals and swaps the rest', () => {
    const peanut = member({
      id: 'pa',
      allergies: [{ allergenCode: 'peanuts', severity: 'anaphylactic', kind: 'allergy' }],
    });
    const req = request({ members: [usman, peanut] });
    const sets = buildCandidateSets(req, cat);
    const { fixed, swapSlots } = templateChoices(t, sets, cat);
    expect([...fixed.values()].every((id) => id === 'b-oats' || id === 'l-daal')).toBe(true);
    expect(swapSlots).toHaveLength(14); // peanut snack and haram dinner, every day
  });
  it('picks budget tiers and rotates', () => {
    expect(budgetTierFor(3_000_000, 'PKR', 4)).toBe(1);
    expect(budgetTierFor(6_000_000, 'PKR', 4)).toBe(2);
    expect(budgetTierFor(12_000_000, 'PKR', 4)).toBe(3);
    expect(budgetTierFor(50_000, 'GBP', 4)).toBe(2);
    expect(chooseTemplate(1, 0, [t])?.key).toBe('t');
    expect(chooseTemplate(3, 5, [t])?.key).toBe('t');
  });
});

describe('adjust safety', () => {
  const fam = [usman, hina, ibrahim, maryam];
  it('escalates child-restriction requests', () => {
    for (const text of [
      'Make my 12-year-old eat less',
      'Ibrahim needs smaller portions so he loses weight',
      'Put the whole family on a diet',
      'میرے بیٹے کا کھانا کم کر دیں',
    ]) {
      const esc = adjustSafetyEscalation(text, fam, null, 'en');
      expect(esc?.reason, text).toBe('other_clinical');
      expect(esc?.recommend).toBe('see_pediatrician');
    }
    expect(
      adjustSafetyEscalation('Smaller portions please', fam, ['maryam'], 'en')?.family_member_id,
    ).toBe('maryam');
  });
  it('lets ordinary adult changes through and escalates red flags', () => {
    expect(
      adjustSafetyEscalation('Less rice on weekdays, guests on Friday', fam, null, 'en'),
    ).toBeNull();
    expect(
      adjustSafetyEscalation(
        'Usman wants smaller portions to lose weight',
        [usman, hina],
        null,
        'en',
      ),
    ).toBeNull();
    expect(
      adjustSafetyEscalation('I take insulin and want to fast, plan suhoor', fam, null, 'en')
        ?.reason,
    ).toBe('insulin_or_sulfonylurea_fasting');
  });
  it('sizes guest pots', () => {
    expect(guestMultiplier(4, 4)).toBe(2);
    expect(guestMultiplier(4, 30)).toBe(4);
  });
});

describe('hina is breastfeeding', () => {
  it('gets standard adult portions, never a deficit', () => {
    const { plan } = servedMealIds(request({ members: [hina] }));
    expect(hardViolations(plan.violations)).toEqual([]);
    for (const m of plan.draft.meals) expect(m.servings[0]?.portionTier).toBe('standard');
  });
});

describe('curated templates (S3-05)', () => {
  it('ships 8 Pakistani weeks across budget tiers with seed codes of the right meal type', async () => {
    const { PLAN_TEMPLATES } = await import('../src/planning/templates.ts');
    expect(PLAN_TEMPLATES).toHaveLength(8);
    expect(PLAN_TEMPLATES.map((t) => t.budgetTier).sort()).toEqual([1, 1, 1, 2, 2, 2, 3, 3]);
    const { readFileSync, existsSync } = await import('node:fs');
    const seedPath = new URL('../../../supabase/seed/catalog/092_meals.sql', import.meta.url);
    const seed = existsSync(seedPath) ? readFileSync(seedPath, 'utf8') : null;
    const prefix = { breakfast: 'B', lunch: 'L', snack: 'S', dinner: 'D' } as const;
    for (const t of PLAN_TEMPLATES) {
      expect(new Set(PLAN_TEMPLATES.map((x) => x.key)).size).toBe(8);
      const mains: string[] = [];
      for (const day of t.days) {
        for (const [type, code] of Object.entries(day)) {
          expect(code).toMatch(new RegExp(`^${prefix[type as keyof typeof prefix]}\\d{3}$`));
          if (seed) expect(seed, `${t.key} ${code}`).toContain(`('${code}', `);
          if (type === 'lunch' || type === 'dinner') mains.push(code);
        }
      }
      expect(new Set(mains).size, t.key).toBe(14);
    }
  });
});
