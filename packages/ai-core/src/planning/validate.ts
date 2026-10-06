import {
  householdExclusions,
  isAdultStage,
  isMinor,
  isPregnantOrBreastfeeding,
  isServed,
  MAIN_MEAL_TYPES,
  mealAllergenCodes,
  mealTags,
  memberConflicts,
  needsSafeFood,
  needsVitaminKConsistency,
  plateSplitOk,
  referencePortionGrams,
  sourcingIngredients,
  usableSafeFoods,
} from './rules.ts';
import type {
  Catalog,
  CatalogMeal,
  DraftPlan,
  PlanMember,
  PlanRequest,
  Violation,
} from './types.ts';

/**
 * Plan validators (06 §4.3, 14 §9 gates, 12 §11.1). They recompute everything from the catalog and
 * trust nothing from the candidate filter, the assembler or a model: every meal id exists and is
 * halal-safe, no serving holds a member's allergen, minors get their own life stage's reference
 * portion or more with no weight adaptation, pregnancy and breastfeeding get no deficit, autism and
 * picky servings reference a curated alternative or a safe food, adult main plates are in band.
 */

const MINOR_TIERS: Record<string, readonly string[]> = {
  toddler: ['start', 'ideal'],
  child: ['start', 'ideal'],
  teen: ['ideal', 'standard', 'start'],
};

export function validatePlan(draft: DraftPlan, req: PlanRequest, catalog: Catalog): Violation[] {
  const out: Violation[] = [...draft.warnings];
  const v = (code: string, message: string, extra: Partial<Violation> = {}, hard = true) =>
    out.push({ code, message, hard, ...extra });
  const members = new Map(req.members.map((m) => [m.id, m]));
  const served = req.members.filter(isServed);
  const kPerDay = new Map<string, number>();
  const weekCounts = new Map<string, number>();
  const lastSeen = new Map<string, string>();
  const dayKcal = new Map<string, { kcal: number; complete: boolean }>();

  for (const pm of draft.meals) {
    const slotRef = pm.slot.ref;
    const meal = catalog.meals.get(pm.mealId);
    if (!meal) {
      v('unknown_meal', `Slot ${slotRef} has a meal that is not in the catalog.`, { slotRef });
      continue;
    }
    if (meal.mealType !== pm.slot.mealType)
      v('meal_type', `${meal.title} is not a ${pm.slot.mealType}.`, { slotRef });
    for (const reason of householdExclusions(meal, req, catalog))
      v(reason, `${meal.title} breaks the household rule "${reason}".`, { slotRef });
    const h = req.household;
    if (h.budgetStrictness === 'hard_cap' && h.budgetTier !== null && meal.costTier > h.budgetTier)
      v('budget_hard_cap', `${meal.title} is above the budget cap.`, { slotRef });
    const sourcing = sourcingIngredients(meal, catalog);
    if (sourcing.length && !/halal/i.test(pm.notes ?? ''))
      v('sourcing_note_missing', `${meal.title} needs a halal-source note.`, { slotRef });

    // Variety counters (14 §8.5 hard rules).
    const tags = mealTags(meal, catalog);
    const wk = `w${pm.slot.week}`;
    if (pm.slot.mealType === 'dinner' && tags.has('red_meat'))
      weekCounts.set(`${wk}:red`, (weekCounts.get(`${wk}:red`) ?? 0) + 1);
    if (MAIN_MEAL_TYPES.includes(pm.slot.mealType) && tags.has('deep_fried'))
      weekCounts.set(`${wk}:fried`, (weekCounts.get(`${wk}:fried`) ?? 0) + 1);
    if (MAIN_MEAL_TYPES.includes(pm.slot.mealType)) {
      const prev = lastSeen.get(meal.id);
      if (prev && (Date.parse(pm.slot.date) - Date.parse(prev)) / 86_400_000 < 7) {
        v('repeat_within_7_days', `${meal.title} repeats within a week.`, { slotRef }, false);
      }
      lastSeen.set(meal.id, pm.slot.date);
    }

    // Exactly one serving per served member; none for others.
    const seen = new Set<string>();
    for (const s of pm.servings) {
      const member = members.get(s.memberId);
      if (!member || !isServed(member)) {
        v('unexpected_serving', 'A serving was planned for someone who cannot be served.', {
          slotRef,
          memberId: s.memberId,
        });
        continue;
      }
      if (seen.has(s.memberId))
        v('duplicate_serving', 'Two servings for one member.', { slotRef, memberId: s.memberId });
      seen.add(s.memberId);
      validateServing(meal, member, s, pm.slot.mealType, pm.slot.date, slotRef);
    }
    for (const m of served)
      if (!seen.has(m.id))
        v('missing_serving', `No safe serving of ${meal.title} for a member.`, {
          slotRef,
          memberId: m.id,
        });
  }

  function validateServing(
    base: CatalogMeal,
    member: PlanMember,
    s: DraftPlan['meals'][number]['servings'][number],
    mealType: string,
    date: string,
    slotRef: string,
  ) {
    const memberId = member.id;
    let meal = base;
    if (s.adaptedMealId) {
      const alt = catalog.meals.get(s.adaptedMealId);
      if (!alt || !base.alternatives.some((a) => a.mealId === s.adaptedMealId)) {
        v('adapted_meal_not_alternative', 'An adapted meal must come from meal_alternatives.', {
          slotRef,
          memberId,
        });
        return;
      }
      for (const reason of householdExclusions(alt, req, catalog))
        v(reason, `${alt.title} breaks the household rule "${reason}".`, { slotRef, memberId });
      meal = alt;
    }
    if (s.adaptation === 'none' && s.adaptedMealId)
      v('adaptation_mismatch', 'Adapted meal without adaptation.', { slotRef, memberId });

    // G1/G2 per member: allergens (any severity) and medication conflicts on what they eat.
    const allergenCodes = mealAllergenCodes(meal, catalog);
    const own = member.allergies.filter((a) => allergenCodes.has(a.allergenCode));
    if (own.length)
      v('allergen', `${meal.title} contains an allergen for this member.`, { slotRef, memberId });
    for (const c of memberConflicts(meal, member, catalog).filter((x) =>
      x.startsWith('medication:'),
    ))
      v('medication_conflict', `${meal.title} conflicts with a medication (${c.slice(11)}).`, {
        slotRef,
        memberId,
      });
    if (needsVitaminKConsistency(member) && mealTags(meal, catalog).has('high_vitamin_k')) {
      const key = `${memberId}:${date}`;
      kPerDay.set(key, (kPerDay.get(key) ?? 0) + 1);
    }

    // Safe food: must be one this member can safely eat (allergens, halal, avoid list).
    if (s.safeFood) {
      const usable = usableSafeFoods(member, req, catalog);
      if (!usable.some((f) => f.id === s.safeFood?.id))
        v('safe_food_unsafe', 'The safe food chosen is not safe for this member.', {
          slotRef,
          memberId,
        });
    }

    // Portions come from `portions` of the meal actually served.
    const portion = meal.portions.find((p) => p.id === s.portionId);
    if (!portion) {
      v('portion_not_found', `No portion of ${meal.title} with that id.`, { slotRef, memberId });
      return;
    }
    if (isMinor(member)) {
      if (portion.lifeStage !== member.lifeStage)
        v('child_portion_stage', 'A child portion must come from their own life stage.', {
          slotRef,
          memberId,
        });
      if (!(MINOR_TIERS[member.lifeStage] ?? []).includes(portion.tier))
        v('child_portion_tier', `Tier ${portion.tier} is not a child serving tier.`, {
          slotRef,
          memberId,
        });
      const ref = referencePortionGrams(meal, member.lifeStage);
      if (ref !== null && portion.grams < ref)
        v('child_portion_below_reference', 'A child portion was reduced below the reference.', {
          slotRef,
          memberId,
        });
      if (s.goalApplied !== 'none')
        v('child_weight_adaptation', 'No weight adaptation for anyone under 18.', {
          slotRef,
          memberId,
        });
      if (
        member.lifeStage === 'child' &&
        !meal.portions.some((p) => p.lifeStage === 'child' && p.tier === 'extra')
      )
        v(
          'child_extra_missing',
          `${meal.title} has no "extra" child portion; seconds still allowed.`,
          { slotRef, memberId },
          false,
        );
    } else {
      if (!isAdultStage(member) || !['adult', 'older_adult'].includes(portion.lifeStage))
        v('adult_portion_stage', 'An adult portion must come from an adult life stage.', {
          slotRef,
          memberId,
        });
      if (MAIN_MEAL_TYPES.includes(mealType as never) && !plateSplitOk(meal))
        v('plate_split', `${meal.title} is outside the adult plate split band.`, {
          slotRef,
          memberId,
        });
    }
    if (isPregnantOrBreastfeeding(member)) {
      if (s.goalApplied !== 'none' || portion.tier !== 'standard')
        v(
          'pregnancy_deficit',
          'No calorie deficit or reduced portion in pregnancy or breastfeeding.',
          { slotRef, memberId },
        );
      const key = `${memberId}:${date}`;
      const prev = dayKcal.get(key) ?? { kcal: 0, complete: true };
      dayKcal.set(key, {
        kcal: prev.kcal + (portion.kcal ?? 0),
        complete: prev.complete && portion.kcal !== null,
      });
    }

    // G10: autism and picky servings reference a curated alternative or a safe food.
    if (needsSafeFood(member)) {
      const usable = usableSafeFoods(member, req, catalog);
      const curated = s.adaptedMealId !== null;
      if (!curated && !s.safeFood) {
        const possible = usable.length > 0;
        v(
          'safe_food_missing',
          'Autism and picky-eater servings need a safe food or a curated alternative.',
          { slotRef, memberId },
          possible,
        );
      }
    }
  }

  for (const [key, n] of kPerDay)
    if (n > 1)
      v(
        'vitamin_k_inconsistent',
        'More than one high-vitamin-K meal in a day for a member on warfarin.',
        {
          memberId: key.split(':')[0],
        },
      );
  for (const [key, n] of weekCounts) {
    if (key.endsWith(':red') && n > 3)
      v('red_meat_limit', 'More than 3 red-meat dinners in a week.');
    if (key.endsWith(':fried') && n > 1)
      v('deep_fried_limit', 'More than 1 deep-fried main in a week.');
  }
  const mealTypes = new Set(draft.meals.map((m) => m.slot.mealType));
  for (const [key, d] of dayKcal) {
    const member = members.get(key.split(':')[0] ?? '');
    // Only judged on full days with every portion's kcal known (main meals and a snack).
    if (!member?.energyTargetKcal || !d.complete || !mealTypes.has('snack')) continue;
    if (d.kcal < member.energyTargetKcal * 0.9)
      v(
        'pregnancy_energy_below_target',
        'Planned portions are below the pregnancy or breastfeeding target; offer seconds or an extra snack.',
        { memberId: member.id },
        false,
      );
  }
  return dedupe(out);
}

function dedupe(vs: Violation[]): Violation[] {
  const seen = new Set<string>();
  return vs.filter((x) => {
    const k = `${x.code}|${x.slotRef ?? ''}|${x.memberId ?? ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export const hardViolations = (vs: readonly Violation[]) => vs.filter((x) => x.hard);
