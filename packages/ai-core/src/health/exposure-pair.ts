import type { Locale } from '../guardrails/text.ts';
import { isServed, needsSafeFood } from '../planning/rules.ts';
import type {
  Catalog,
  CatalogIngredient,
  PlanMember,
  PlannedMeal,
  PlanRequest,
} from '../planning/types.ts';
import { avoidedColors, chainDistance, ingredientFeatures, sensoryOk } from './chaining.ts';
import type { SensoryLite } from './chaining.ts';
import { foodLifecycle } from './exposure.ts';
import type { ExposureObs, FoodLifecycle } from './exposure.ts';

/**
 * Weekly exposure pair (15 §4.5, §3.4 rule 4, S6-05): for each picky or autism member, one new
 * food per week on a learning plate, always beside one familiar (safe) food. The new food comes
 * from the member's exposure history: a food already in progress continues; otherwise a food the
 * family eats this week that the child has not accepted yet. Never more than one new item per
 * meal, never forced, and nothing changes the meal itself: the pair is a serving note.
 */

export interface ExposurePairMember {
  member: PlanMember;
  exposures: readonly ExposureObs[];
  sensory?: SensoryLite | null | undefined;
  /** Target ingredients of the member's active `exposure_ladders` (offered first). */
  ladderTargets?: readonly string[] | undefined;
}

export interface ExposurePair {
  memberId: string;
  week: number;
  newIngredientId: string;
  newFood: string;
  familiarIngredientId: string | null;
  familiarLabel: string;
  /** Why this food: continuing a food in progress, an active ladder, or new this week. */
  source: 'ladder' | 'in_progress' | 'new';
  lifecycle: FoodLifecycle;
  /** Slot refs of the planned meals that carry the learning plate. */
  slotRefs: string[];
}

/** Learning-plate exposures a week (15 §3.5, §4.5: 3 to 5 a week). */
export const EXPOSURES_PER_WEEK = 4;

const PRODUCE = new Set(['vegetable', 'fruit', 'legume']);
const NEVER_NEW = new Set(['oil_fat', 'spice_herb', 'sweetener', 'condiment', 'beverage']);

function allowedFor(
  ing: CatalogIngredient,
  m: PlanMember,
  req: PlanRequest,
  sensory: SensoryLite | null | undefined,
): boolean {
  if (ing.halalStatus === 'haram') return false;
  if (ing.halalStatus !== 'halal' && !req.household.allowMashbooh) return false;
  const own = new Set(m.allergies.map((a) => a.allergenCode));
  const severe = new Set(req.household.severeAllergenCodes ?? []);
  if (ing.allergenCodes.some((c) => own.has(c) || severe.has(c))) return false;
  if ((req.avoidIngredientIds ?? []).includes(ing.id)) return false;
  if (m.dislikes.some((d) => d.ingredientId === ing.id)) return false;
  // Choking safety under 5 (15 §3.8 rule 6): no whole nuts or seeds as a learning item.
  if (m.ageMonths < 60 && ing.category === 'nut_seed') return false;
  if (m.modules.includes('autism') && sensory) {
    // Autism: change one thing at a time; avoid textures and colours the child avoids (15 §4.7).
    if (!sensoryOk(ingredientFeatures(ing), sensory)) return false;
  }
  return true;
}

/** Chooses the member's pair for one week of planned meals; null when nothing fits. */
export function chooseExposurePair(
  input: ExposurePairMember,
  catalog: Catalog,
  req: PlanRequest,
  weekMeals: readonly PlannedMeal[],
  today: string,
): ExposurePair | null {
  const m = input.member;
  if (!needsSafeFood(m) || !isServed(m)) return null;
  const week = weekMeals[0]?.slot.week ?? 1;
  const safeIds = new Set(m.safeFoods.map((s) => s.ingredientId).filter((x): x is string => !!x));
  const byFood = new Map<string, ExposureObs[]>();
  for (const e of input.exposures)
    byFood.set(e.ingredientId, [...(byFood.get(e.ingredientId) ?? []), e]);
  const life = (id: string) => foodLifecycle(byFood.get(id) ?? [], today);
  const usable = (id: string) => {
    const ing = catalog.ingredients.get(id);
    if (!ing || safeIds.has(id) || NEVER_NEW.has(ing.category)) return false;
    if (!allowedFor(ing, m, req, input.sensory)) return false;
    const s = life(id).status;
    return s !== 'accepted' && s !== 'paused';
  };

  let chosen: { id: string; source: ExposurePair['source'] } | null = null;
  // 1. An active ladder target the parent already chose.
  const ladder = (input.ladderTargets ?? []).find(usable);
  if (ladder) chosen = { id: ladder, source: 'ladder' };
  // 2. A food already in progress (most recently offered first): continuity beats novelty.
  if (!chosen) {
    const inProgress = [...byFood.entries()]
      .filter(([id]) => usable(id))
      .sort(
        ([a, ra], [b, rb]) =>
          (
            rb
              .map((r) => r.exposedOn)
              .sort()
              .at(-1) ?? ''
          ).localeCompare(
            ra
              .map((r) => r.exposedOn)
              .sort()
              .at(-1) ?? '',
          ) || a.localeCompare(b),
      )[0];
    if (inProgress) chosen = { id: inProgress[0], source: 'in_progress' };
  }
  // 3. A new food the family eats this week (modelling), produce first.
  if (!chosen) {
    const counts = new Map<string, number>();
    for (const pm of weekMeals) {
      if (!pm.servings.some((s) => s.memberId === m.id)) continue;
      const meal = catalog.meals.get(pm.mealId);
      for (const id of meal?.ingredientIds ?? [])
        if (!byFood.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const safeFeatures = [...safeIds]
      .map((id) => catalog.ingredients.get(id))
      .filter((x): x is CatalogIngredient => !!x)
      .map(ingredientFeatures);
    const scored = [...counts.entries()]
      .flatMap(([id, n]) => {
        const ing = catalog.ingredients.get(id);
        if (!ing || !usable(id)) return [];
        const f = ingredientFeatures(ing);
        // Sensory closeness to a safe food (autism especially); 0 when no safe food is linked.
        const near = safeFeatures.length
          ? Math.min(...safeFeatures.map((s) => chainDistance(s, f, input.sensory)))
          : 0;
        const avoidColour = avoidedColors(input.sensory).has(f.color) ? 2 : 0;
        const seasonal = req.household.seasonal.get(id) === 'peak' ? 0.5 : 0;
        const score =
          (PRODUCE.has(ing.category) ? 2 : 0) +
          Math.min(n, 3) * 0.3 +
          seasonal -
          (m.modules.includes('autism') ? near : near * 0.3) -
          avoidColour;
        return [{ id, score }];
      })
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    if (scored[0]) chosen = { id: scored[0].id, source: 'new' };
  }
  if (!chosen) return null;
  const pickedId = chosen.id;
  const newIng = catalog.ingredients.get(pickedId);
  if (!newIng) return null;

  // Familiar partner: the safe food closest in feel to the new one, strongest first, rotating weekly.
  const safe = m.safeFoods.filter((s) => {
    if (!s.ingredientId) return true;
    const ing = catalog.ingredients.get(s.ingredientId);
    return !!ing && allowedFor(ing, m, { ...req, avoidIngredientIds: [] }, null);
  });
  let familiar: { id: string | null; label: string } | null = null;
  if (safe.length) {
    const nf = ingredientFeatures(newIng);
    const distance = (id: string | null) => {
      const ing = id ? catalog.ingredients.get(id) : undefined;
      return ing ? chainDistance(ingredientFeatures(ing), nf) : 9;
    };
    const ranked = [...safe].sort(
      (a, b) =>
        b.strength - a.strength ||
        distance(a.ingredientId) - distance(b.ingredientId) ||
        a.id.localeCompare(b.id),
    );
    const top = ranked.filter((s) => s.strength === ranked[0]?.strength);
    const pick = top[(week - 1) % top.length];
    if (pick) familiar = { id: pick.ingredientId, label: pick.label };
  } else {
    const liked = m.likes.find((l) => l.ingredientId !== pickedId);
    if (liked) familiar = { id: liked.ingredientId, label: liked.label };
  }

  // Slots: main meals on distinct days where the member is served; meals with the food first.
  const served = weekMeals.filter((pm) => pm.servings.some((s) => s.memberId === m.id));
  const rank = (pm: PlannedMeal) =>
    (catalog.meals.get(pm.mealId)?.ingredientIds.includes(pickedId) ? 0 : 2) +
    (pm.slot.mealType === 'lunch' || pm.slot.mealType === 'dinner' ? 0 : 1);
  const ordered = [...served].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.slot.date.localeCompare(b.slot.date) ||
      a.slot.ref.localeCompare(b.slot.ref),
  );
  const days = new Set<string>();
  const slotRefs: string[] = [];
  for (const pm of ordered) {
    if (slotRefs.length >= EXPOSURES_PER_WEEK) break;
    if (days.has(pm.slot.date)) continue;
    days.add(pm.slot.date);
    slotRefs.push(pm.slot.ref);
  }
  if (!slotRefs.length) return null;
  return {
    memberId: m.id,
    week,
    newIngredientId: newIng.id,
    newFood: newIng.name,
    familiarIngredientId: familiar?.id ?? null,
    familiarLabel: familiar?.label ?? DEFAULT_FAMILIAR_LABEL,
    source: chosen.source,
    lifecycle: life(newIng.id).status,
    slotRefs: slotRefs.sort(),
  };
}

/** The familiar side when the member has no safe food or like on record (stored in the pair). */
export const DEFAULT_FAMILIAR_LABEL = 'a food they already enjoy';

/**
 * The serving note for a learning plate, in the plan's locale (the requester's `generation_meta`
 * locale, like the plan rationale). Calm, Division of Responsibility, no pressure (15 §4.5).
 * The food name comes from the catalog (English) and the familiar label as the parent wrote it.
 * Urdu is a draft PENDING URDU NATIVE REVIEW (S4-19 / S7-05 process).
 */
export function exposurePairNote(
  memberName: string,
  pair: Pick<ExposurePair, 'newFood' | 'familiarLabel'>,
  locale: Locale = 'en',
): string {
  if (locale === 'ur') {
    const familiar =
      pair.familiarLabel === DEFAULT_FAMILIAR_LABEL
        ? 'کسی ایسی چیز جو اسے پہلے سے پسند ہے'
        : pair.familiarLabel;
    return `${memberName} کے لیے سیکھنے کی پلیٹ: ${familiar} کے ساتھ ${pair.newFood.toLowerCase()} کا ایک چھوٹا سا ٹکڑا رکھیں۔ سکون سے پیش کریں؛ دیکھنا، چھونا یا سونگھنا بھی شمار ہوتا ہے، اور اسے چھوڑ دینا بالکل ٹھیک ہے۔`;
  }
  return `Learning plate for ${memberName}: a small piece of ${pair.newFood.toLowerCase()} beside ${pair.familiarLabel.toLowerCase()}. Offer it calmly; looking, touching or smelling all count, and leaving it is fine.`;
}

/** Adds a learning-plate note to a meal's notes (once). */
export function withExposureNote(notes: string | null, note: string): string {
  if (!notes) return note;
  return notes.includes(note) ? notes : `${notes} ${note}`;
}

/** Removes a pair's learning-plate note, in either locale, from a meal's notes. */
export function withoutExposureNote(
  notes: string | null,
  memberName: string,
  pair: Pick<ExposurePair, 'newFood' | 'familiarLabel'>,
): string | null {
  if (!notes) return notes;
  let out = notes;
  for (const locale of ['en', 'ur'] as const) {
    out = out.split(exposurePairNote(memberName, pair, locale)).join(' ');
  }
  out = out.replace(/\s+/gu, ' ').trim();
  return out || null;
}

/**
 * Adds the week's pairs to the planned meals' notes (one learning item per member per meal) and
 * returns the pairs. Meals are changed in place only in their `notes`.
 */
export function applyExposurePairs(
  members: readonly ExposurePairMember[],
  catalog: Catalog,
  req: PlanRequest,
  meals: PlannedMeal[],
  today: string,
  locale: Locale = 'en',
): ExposurePair[] {
  const pairs: ExposurePair[] = [];
  const weeks = [...new Set(meals.map((pm) => pm.slot.week))].sort((a, b) => a - b);
  for (const week of weeks) {
    const weekMeals = meals.filter((pm) => pm.slot.week === week);
    for (const input of members) {
      const pair = chooseExposurePair(input, catalog, req, weekMeals, today);
      if (!pair) continue;
      pairs.push(pair);
      const note = exposurePairNote(input.member.name, pair, locale);
      for (const pm of weekMeals) {
        if (!pair.slotRefs.includes(pm.slot.ref)) continue;
        pm.notes = withExposureNote(pm.notes, note);
      }
    }
  }
  return pairs;
}
