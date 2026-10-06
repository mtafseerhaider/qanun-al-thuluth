import { CHILD_AGE_YEARS } from '@thuluth/shared';

import type {
  Catalog,
  CatalogIngredient,
  CatalogMeal,
  CatalogPortion,
  PlanHousehold,
  PlanMealType,
  PlanMember,
  PlanRequest,
  SafeFood,
} from './types.ts';

/**
 * Hard constraints of the Meal Planning Engine (14 §8.3, 12 §4.4 C1-C3, C9; 06 §4.3 validators).
 * Pure functions over catalog rows; the candidate filter and the validator both use them, so a
 * model can never choose a meal the filter would reject.
 */

// ---- medication interactions (14 §8.2, G11) ------------------------------------------------------

/**
 * Name lexicon for interaction tags until `ingredients` carries them as data. Clinician review
 * pending: the lists are conservative (they over-flag rather than miss).
 */
const TAG_LEXICON: Record<string, RegExp> = {
  high_vitamin_k:
    /\b(spinach|palak|mustard greens|sarson|saag|fenugreek leaves|methi|kale|broccoli|bathua|collard|swiss chard|turnip greens)\b/i,
  high_tyramine:
    /\b(aged cheese|cheddar|parmesan|blue cheese|soy sauce|fish sauce|miso|salami|pepperoni|cured|smoked|fermented|yeast extract|sauerkraut|kimchi|tempeh)\b/i,
  grapefruit: /\b(grapefruit|chakotra|pomelo)\b/i,
};

export function interactionTagsFor(ing: CatalogIngredient): readonly string[] {
  if (ing.interactionTags) return ing.interactionTags;
  return Object.entries(TAG_LEXICON)
    .filter(([, re]) => re.test(ing.name))
    .map(([tag]) => tag);
}

/** Medication flag → ingredient tag that conflicts with it for that member. */
const MEDICATION_CONFLICTS: Record<string, string> = {
  maoi_tyramine: 'high_tyramine',
  avoid_tyramine: 'high_tyramine',
  avoid_grapefruit: 'grapefruit',
};

/** Flags that need even spread (at most one high-vitamin-K meal a day) rather than exclusion. */
export const VITAMIN_K_FLAGS = ['warfarin_vitamin_k_consistency', 'vitamin_k_consistency'];

export function needsVitaminKConsistency(m: PlanMember): boolean {
  return m.medicationFlags.some((f) => VITAMIN_K_FLAGS.includes(f));
}

// ---- members ------------------------------------------------------------------------------------

export const isMinor = (m: PlanMember): boolean => m.ageMonths < CHILD_AGE_YEARS * 12;
/** 14 §4.5: no plan portions for infants (milk feeding, then complementary-food notes only). */
export const isServed = (m: PlanMember): boolean => m.lifeStage !== 'infant';
export const isPregnantOrBreastfeeding = (m: PlanMember): boolean =>
  m.modules.includes('pregnancy') || m.modules.includes('breastfeeding');
export const hasAutism = (m: PlanMember): boolean => m.modules.includes('autism');
export const isPicky = (m: PlanMember): boolean => m.modules.includes('picky_eater');
export const needsSafeFood = (m: PlanMember): boolean => hasAutism(m) || isPicky(m);
export const isAdultStage = (m: PlanMember): boolean =>
  m.lifeStage === 'adult' || m.lifeStage === 'older_adult';

/** Weight-loss portion handling applies only to adults who are not pregnant or breastfeeding. */
export function goalFor(m: PlanMember, kind: PlanRequest['kind']): 'none' | 'weight_loss' {
  if (isMinor(m) || isPregnantOrBreastfeeding(m) || !isAdultStage(m)) return 'none';
  return m.goals.includes('weight_loss') || kind === 'weight_management' ? 'weight_loss' : 'none';
}

// ---- meals --------------------------------------------------------------------------------------

export const MAIN_MEAL_TYPES: readonly PlanMealType[] = ['lunch', 'dinner'];

export function mealIngredients(meal: CatalogMeal, catalog: Catalog): CatalogIngredient[] {
  const out: CatalogIngredient[] = [];
  for (const id of meal.ingredientIds) {
    const ing = catalog.ingredients.get(id);
    if (ing) out.push(ing);
  }
  return out;
}

export function mealAllergenCodes(meal: CatalogMeal, catalog: Catalog): Set<string> {
  const codes = new Set<string>();
  for (const ing of mealIngredients(meal, catalog)) for (const c of ing.allergenCodes) codes.add(c);
  return codes;
}

const TAG_CACHE = new WeakMap<CatalogMeal, Set<string>>();

export function mealTags(meal: CatalogMeal, catalog: Catalog): Set<string> {
  const cached = TAG_CACHE.get(meal);
  if (cached) return cached;
  const tags = new Set<string>();
  for (const ing of mealIngredients(meal, catalog)) {
    for (const t of interactionTagsFor(ing)) tags.add(t);
    if (ing.category === 'fish') tags.add('fish');
    if (ing.category === 'meat') tags.add('red_meat');
    if (ing.category === 'poultry') tags.add('poultry');
    if (ing.category === 'legume') tags.add('legume');
    if (ing.isSunnahFood) tags.add('sunnah');
  }
  if (/\b(fried|pakor|samosa|bhaji|pakode)/i.test(meal.title) && !/stir/i.test(meal.title))
    tags.add('deep_fried');
  TAG_CACHE.set(meal, tags);
  return tags;
}

/** Ingredients that need a halal-source note on the meal card and grocery list (G1). */
export function sourcingIngredients(meal: CatalogMeal, catalog: Catalog): CatalogIngredient[] {
  return mealIngredients(meal, catalog).filter((i) => i.halalStatus === 'depends_on_source');
}

export function reviewAllowed(meal: CatalogMeal, household: PlanHousehold): boolean {
  if (meal.reviewStatus === 'rejected') return false;
  if (meal.householdId !== null) return meal.householdId === household.id;
  if (meal.reviewStatus === 'verified') return true;
  return household.includeInReview && meal.reviewStatus === 'in_review';
}

export function plateSplitOk(meal: CatalogMeal): boolean {
  const p = meal.plateSplit;
  const eps = 1e-9;
  return (
    p.veg_fruit >= 0.4 - eps &&
    p.veg_fruit <= 0.6 + eps &&
    p.protein >= 0.2 - eps &&
    p.protein <= 0.3 + eps &&
    p.carb >= 0.2 - eps &&
    p.carb <= 0.3 + eps
  );
}

function severeCodes(req: PlanRequest): Set<string> {
  const out = new Set<string>(req.household.severeAllergenCodes ?? []);
  for (const m of req.members)
    for (const a of m.allergies)
      if (a.severity === 'severe' || a.severity === 'anaphylactic') out.add(a.allergenCode);
  return out;
}

/**
 * Household-wide exclusion reasons for a meal (empty = allowed for the family pot): halal,
 * severe allergens of anyone in the household, religious dislikes, avoid list, review status.
 */
export function householdExclusions(
  meal: CatalogMeal,
  req: PlanRequest,
  catalog: Catalog,
): string[] {
  const reasons: string[] = [];
  if (!reviewAllowed(meal, req.household)) reasons.push('not_reviewed');
  if (meal.ingredientIds.some((id) => !catalog.ingredients.has(id)))
    reasons.push('unknown_ingredient');
  const ings = mealIngredients(meal, catalog);
  if (ings.some((i) => i.halalStatus === 'haram')) reasons.push('haram');
  if (!req.household.allowMashbooh && ings.some((i) => i.halalStatus === 'mashbooh'))
    reasons.push('mashbooh');
  const severe = severeCodes(req);
  if (ings.some((i) => i.allergenCodes.some((c) => severe.has(c))))
    reasons.push('household_severe_allergen');
  const religious = new Set(
    req.members.flatMap((m) =>
      m.dislikes
        .filter((d) => d.reason === 'religious' && d.ingredientId)
        .map((d) => d.ingredientId),
    ),
  );
  if (ings.some((i) => religious.has(i.id))) reasons.push('religious_dislike');
  const avoid = new Set(req.avoidIngredientIds ?? []);
  if (ings.some((i) => avoid.has(i.id))) reasons.push('avoided_ingredient');
  return reasons;
}

/** Per-member conflicts of a meal: any allergy or intolerance (any severity), medication tags. */
export function memberConflicts(meal: CatalogMeal, member: PlanMember, catalog: Catalog): string[] {
  const reasons: string[] = [];
  const codes = mealAllergenCodes(meal, catalog);
  if (member.allergies.some((a) => codes.has(a.allergenCode))) reasons.push('allergen');
  const tags = mealTags(meal, catalog);
  for (const flag of member.medicationFlags) {
    const tag = MEDICATION_CONFLICTS[flag];
    if (tag && tags.has(tag)) reasons.push(`medication:${flag}`);
  }
  return reasons;
}

// ---- portions (14 §6, 06 §4.3 child rules) -------------------------------------------------------

/** Tier order per life stage. Minors never fall back to another life stage's portion. */
const TIER_ORDER: Record<string, readonly CatalogPortion['tier'][]> = {
  toddler: ['start', 'ideal'],
  child: ['start', 'ideal'],
  teen: ['ideal', 'standard', 'start'],
  adult: ['standard'],
  older_adult: ['standard'],
};

export function portionFor(meal: CatalogMeal, member: PlanMember): CatalogPortion | null {
  if (!isServed(member)) return null;
  const order = TIER_ORDER[member.lifeStage] ?? [];
  for (const tier of order) {
    const p = meal.portions.find((x) => x.lifeStage === member.lifeStage && x.tier === tier);
    if (p) return p;
  }
  if (member.lifeStage === 'older_adult') {
    return meal.portions.find((x) => x.lifeStage === 'adult' && x.tier === 'standard') ?? null;
  }
  return null;
}

/** The reference (smallest non-extra) portion for a stage; a minor's serving never goes below it. */
export function referencePortionGrams(meal: CatalogMeal, lifeStage: string): number | null {
  const rows = meal.portions.filter((p) => p.lifeStage === lifeStage && p.tier !== 'extra');
  return rows.length ? Math.min(...rows.map((p) => p.grams)) : null;
}

// ---- safe foods and adaptations (14 §7.2, 15 §3.4, §4.4) ----------------------------------------

/** Safe foods this member can be given beside a meal in this household (allergen- and halal-safe). */
export function usableSafeFoods(
  member: PlanMember,
  req: PlanRequest,
  catalog: Catalog,
): SafeFood[] {
  const severe = severeCodes(req);
  const own = new Set(member.allergies.map((a) => a.allergenCode));
  const avoid = new Set(req.avoidIngredientIds ?? []);
  const ok = member.safeFoods.filter((f) => {
    if (!f.ingredientId) return false;
    const ing = catalog.ingredients.get(f.ingredientId);
    if (!ing || avoid.has(ing.id)) return false;
    if (ing.halalStatus === 'haram') return false;
    if (ing.halalStatus === 'mashbooh' && !req.household.allowMashbooh) return false;
    return !ing.allergenCodes.some((c) => own.has(c) || severe.has(c));
  });
  return [...ok].sort((a, b) => b.strength - a.strength || a.id.localeCompare(b.id));
}

export interface ServingResolution {
  ok: boolean;
  adaptation: 'none' | 'autism' | 'picky' | 'allergy';
  adaptedMealId: string | null;
  portion: CatalogPortion | null;
  reasons: string[];
}

/**
 * How one member is served one family meal: the meal itself, or a `meal_alternatives` row that
 * resolves their conflicts (allergy first), or an autism / picky alternative. Never invents a meal.
 */
export function resolveServing(
  meal: CatalogMeal,
  member: PlanMember,
  req: PlanRequest,
  catalog: Catalog,
  hasSafeFood: boolean,
): ServingResolution {
  const conflicts = memberConflicts(meal, member, catalog);
  const usableAlt = (reason: string): { meal: CatalogMeal; portion: CatalogPortion } | null => {
    for (const alt of meal.alternatives.filter((a) => a.reason === reason)) {
      const m = catalog.meals.get(alt.mealId);
      if (!m) continue;
      if (householdExclusions(m, req, catalog).length) continue;
      if (memberConflicts(m, member, catalog).length) continue;
      if (isAdultStage(member) && MAIN_MEAL_TYPES.includes(meal.mealType) && !plateSplitOk(m))
        continue;
      const portion = portionFor(m, member);
      if (portion) return { meal: m, portion };
    }
    return null;
  };

  if (conflicts.length) {
    // Allergy alternatives first, then any other curated alternative that is conflict-free.
    const reasons = ['allergy', 'autism', 'picky', 'preference', 'budget', 'season'] as const;
    for (const reason of reasons) {
      const alt = usableAlt(reason);
      if (alt) {
        return {
          ok: true,
          // The serving enum has no medication value; a conflict swap is recorded as 'allergy'.
          adaptation:
            reason === 'autism' && hasAutism(member) && !conflicts.includes('allergen')
              ? 'autism'
              : 'allergy',
          adaptedMealId: alt.meal.id,
          portion: alt.portion,
          reasons: conflicts,
        };
      }
    }
    return {
      ok: false,
      adaptation: 'none',
      adaptedMealId: null,
      portion: null,
      reasons: conflicts,
    };
  }

  const portion = portionFor(meal, member);
  if (hasAutism(member)) {
    const alt = usableAlt('autism');
    if (alt) {
      return {
        ok: true,
        adaptation: 'autism',
        adaptedMealId: alt.meal.id,
        portion: alt.portion,
        reasons: [],
      };
    }
    // No curated alternative: the family meal served deconstructed beside a safe food (15 §3.4).
    if (portion)
      return { ok: true, adaptation: 'autism', adaptedMealId: null, portion, reasons: [] };
  }
  if (isPicky(member)) {
    // Keep the family meal and add a safe food; a picky alternative only without one (14 §7.2).
    if (portion && hasSafeFood)
      return { ok: true, adaptation: 'picky', adaptedMealId: null, portion, reasons: [] };
    const alt = usableAlt('picky');
    if (alt)
      return {
        ok: true,
        adaptation: 'picky',
        adaptedMealId: alt.meal.id,
        portion: alt.portion,
        reasons: [],
      };
    if (portion)
      return { ok: true, adaptation: 'picky', adaptedMealId: null, portion, reasons: [] };
  }
  if (!portion)
    return {
      ok: false,
      adaptation: 'none',
      adaptedMealId: null,
      portion: null,
      reasons: ['no_portion'],
    };
  return { ok: true, adaptation: 'none', adaptedMealId: null, portion, reasons: [] };
}
