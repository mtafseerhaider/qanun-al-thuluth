import {
  goalFor,
  hasAutism,
  isServed,
  resolveServing,
  sourcingIngredients,
  usableSafeFoods,
} from './rules.ts';
import type {
  Catalog,
  DraftPlan,
  PlannedMeal,
  PlannedServing,
  PlanRequest,
  Slot,
  Violation,
} from './types.ts';

/**
 * `assemblePlan` (12 §4.4, 14 §8.9): turns per-slot meal choices into per-member servings with
 * portions from `portions` for each member's life stage, adaptations from `meal_alternatives`,
 * a rotating safe food for autism and picky members, and halal-sourcing notes.
 */
export function assemblePlan(
  req: PlanRequest,
  catalog: Catalog,
  slots: readonly Slot[],
  choices: ReadonlyMap<string, string>,
): DraftPlan {
  const warnings: Violation[] = [];
  const served = req.members.filter(isServed);
  const skippedMembers = req.members
    .filter((m) => !isServed(m))
    .map((m) => ({ memberId: m.id, reason: 'infant' as const }));
  const safeFoods = new Map(served.map((m) => [m.id, usableSafeFoods(m, req, catalog)]));
  for (const m of served) {
    if (
      (m.modules.includes('autism') || m.modules.includes('picky_eater')) &&
      !safeFoods.get(m.id)?.length
    ) {
      warnings.push({
        code: 'safe_food_missing',
        message:
          'Add at least one safe food (linked to an ingredient) so every plate can hold one.',
        hard: false,
        memberId: m.id,
      });
    }
  }

  const meals: PlannedMeal[] = [];
  slots.forEach((slot, index) => {
    const mealId = choices.get(slot.ref);
    const meal = mealId ? catalog.meals.get(mealId) : undefined;
    if (!mealId || !meal) {
      meals.push({ slot, mealId: mealId ?? '', notes: null, servings: [] });
      return;
    }
    const notes: string[] = [];
    const sourcing = sourcingIngredients(meal, catalog).map((i) => i.name);
    const servings: PlannedServing[] = [];
    for (const m of served) {
      const safe = safeFoods.get(m.id) ?? [];
      const r = resolveServing(meal, m, req, catalog, safe.length > 0);
      if (!r.ok || !r.portion) continue; // the validator reports the missing serving
      const wantsSafe = m.modules.includes('autism') || m.modules.includes('picky_eater');
      // Rotate safe foods across slots (15 §4.4), strongest first.
      const safeFood = wantsSafe && safe.length ? (safe[index % safe.length] ?? null) : null;
      if (r.adaptedMealId) {
        const alt = catalog.meals.get(r.adaptedMealId);
        for (const i of alt ? sourcingIngredients(alt, catalog) : [])
          if (!sourcing.includes(i.name)) sourcing.push(i.name);
      }
      if (safeFood) notes.push(`Safe food on the side for ${m.name}: ${safeFood.label}.`);
      if (hasAutism(m) && r.adaptation === 'autism' && !r.adaptedMealId) {
        notes.push(
          `Serve ${m.name}'s portion deconstructed: lift it out before chilli goes in, keep foods separate, sauce on the side.`,
        );
      }
      servings.push({
        memberId: m.id,
        portionId: r.portion.id,
        portionTier: r.portion.tier,
        lifeStage: m.lifeStage,
        adaptation: r.adaptation,
        adaptedMealId: r.adaptedMealId,
        safeFood,
        goalApplied: goalFor(m, req.kind),
      });
    }
    if (sourcing.length)
      notes.unshift(`Buy from a halal (zabiha or certified) source: ${sourcing.join(', ')}.`);
    meals.push({ slot, mealId, notes: notes.length ? notes.join(' ') : null, servings });
  });
  return { meals, skippedMembers, warnings };
}
