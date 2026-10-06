import {
  householdExclusions,
  isAdultStage,
  isMinor,
  isServed,
  MAIN_MEAL_TYPES,
  mealIngredients,
  mealTags,
  needsSafeFood,
  needsVitaminKConsistency,
  plateSplitOk,
  resolveServing,
  usableSafeFoods,
} from './rules.ts';
import { PlanningError } from './types.ts';
import type {
  Candidate,
  CandidateSet,
  Catalog,
  CatalogMeal,
  PlanMealType,
  PlanRequest,
  Slot,
} from './types.ts';

/**
 * Candidate selection and scoring (14 §8.3-8.5, 12 §4.4 `buildCandidates`). Hard constraints
 * filter; soft ones score. The model later ranks among the top-k ids of each slot.
 */

const SLOT_ORDER: readonly PlanMealType[] = [
  'suhoor',
  'breakfast',
  'lunch',
  'snack',
  'dinner',
  'iftar',
];
export const CANDIDATES_PER_SLOT = 5;

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function planEndDate(startDate: string, weekCount: number): string {
  return addDays(startDate, weekCount * 7 - 1);
}

export function buildSlots(
  req: Pick<PlanRequest, 'startDate' | 'weekCount' | 'mealTypes'>,
): Slot[] {
  const types = SLOT_ORDER.filter((t) => req.mealTypes.includes(t));
  const slots: Slot[] = [];
  for (let day = 0; day < req.weekCount * 7; day++) {
    const date = addDays(req.startDate, day);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    for (const mealType of types) {
      slots.push({
        ref: `s${slots.length + 1}`,
        date,
        week: Math.floor(day / 7) + 1,
        weekday,
        mealType,
      });
    }
  }
  return slots;
}

/** Saturday and Sunday allow long cooking (14 §8.3 rule 5). */
const isWeekend = (slot: Slot) => slot.weekday === 0 || slot.weekday === 6;

export function prepLimit(slot: Slot, req: PlanRequest): number {
  if (isWeekend(slot)) return req.household.weekendCookLimitMin;
  return Math.min(
    req.household.weekdayCookLimitMin,
    req.maxPrepMinWeekday ?? Number.POSITIVE_INFINITY,
  );
}

export interface Feasibility {
  ok: boolean;
  /** Hard reasons; never relaxed. */
  hard: string[];
  /** Soft reasons that may be relaxed when a slot has no candidate. */
  soft: string[];
}

/** Hard constraints for one meal in one slot, for every served member. */
export function feasibility(
  meal: CatalogMeal,
  slot: Slot,
  req: PlanRequest,
  catalog: Catalog,
): Feasibility {
  const hard: string[] = [];
  const soft: string[] = [];
  if (meal.mealType !== slot.mealType) hard.push('meal_type');
  hard.push(...householdExclusions(meal, req, catalog));
  const h = req.household;
  if (h.budgetStrictness === 'hard_cap' && h.budgetTier !== null && meal.costTier > h.budgetTier)
    hard.push('budget_hard_cap');
  const served = req.members.filter(isServed);
  if (MAIN_MEAL_TYPES.includes(slot.mealType) && served.some(isAdultStage) && !plateSplitOk(meal))
    hard.push('plate_split');
  for (const m of served) {
    const safe = usableSafeFoods(m, req, catalog).length > 0;
    const r = resolveServing(meal, m, req, catalog, safe);
    if (!r.ok) hard.push(`member:${m.id}:${r.reasons.join('+')}`);
  }
  if (meal.prepMin > prepLimit(slot, req)) soft.push('prep_time');
  return { ok: hard.length === 0 && soft.length === 0, hard, soft };
}

/** FNV-1a hash in [0, 1) for deterministic tie-breaks. */
export function hash01(...parts: Array<string | number>): number {
  let h = 2166136261;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

const AVAILABILITY_SCORE = { peak: 1, available: 0.6, scarce: 0.1 } as const;

/** Context-free score (14 §8.4 without the variety term). Higher is better. */
export function staticScore(
  meal: CatalogMeal,
  slot: Slot,
  req: PlanRequest,
  catalog: Catalog,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  const ings = mealIngredients(meal, catalog);
  const ingIds = new Set(ings.map((i) => i.id));
  const served = req.members.filter(isServed);
  const n = Math.max(1, served.length);

  // Nutrition fit: closeness of the adult plate to the Thuluth plate (half, quarter, quarter).
  const p = meal.plateSplit;
  let carbTarget = 0.25;
  if (req.lighterCarbs) carbTarget = 0.2;
  const plate = Math.max(
    0,
    1 -
      (Math.abs(p.veg_fruit - 0.5) + Math.abs(p.protein - 0.25) + Math.abs(p.carb - carbTarget)) *
        2,
  );
  if (plate > 0.8) reasons.push('thuluth_plate');

  // Preference: likes and non-religious dislikes of served members, plus brief favourites.
  let pref = 0;
  for (const m of served) {
    for (const l of m.likes)
      if (l.ingredientId && ingIds.has(l.ingredientId)) pref += l.strength / 3 / n;
    for (const d of m.dislikes)
      if (d.reason !== 'religious' && d.ingredientId && ingIds.has(d.ingredientId)) pref -= 1 / n;
  }
  const preferred = (req.preferredIngredientIds ?? []).filter((id) => ingIds.has(id)).length;
  pref += Math.min(1, preferred * 0.5);
  if (pref > 0.3) reasons.push('family_favourite');
  if (pref < -0.3) reasons.push('some_dislikes');

  // Cost: relative to the household budget tier (default mid); cheaper requests favour tier 1.
  const tier = req.cheaper ? 1 : (req.household.budgetTier ?? 2);
  const over = Math.max(0, meal.costTier - tier);
  const cost = 1 - over / 2 - (req.cheaper ? (meal.costTier - 1) * 0.25 : 0);
  const costWeight = req.household.budgetStrictness === 'hard_cap' || req.cheaper ? 1.2 : 0.7;
  if (meal.costTier <= tier) reasons.push('fits_budget');

  // Season: mean availability of the produce in the meal (no row = 0, 14 §14).
  const produce = ings.filter((i) => i.category === 'vegetable' || i.category === 'fruit');
  const season = produce.length
    ? produce.reduce((s, i) => {
        const a = req.household.seasonal.get(i.id);
        return s + (a ? AVAILABILITY_SCORE[a] : 0);
      }, 0) / produce.length
    : 0.5;
  if (produce.length && season >= 0.8) reasons.push('in_season');

  // Prep fit.
  const limit = prepLimit(slot, req);
  const prep = Number.isFinite(limit) && limit > 0 ? Math.max(0, 1 - meal.prepMin / limit) : 0.5;
  if (meal.prepMin <= 30) reasons.push('quick');

  // Sunnah foods (never as medicine).
  const sunnah = ings.length ? ings.filter((i) => i.isSunnahFood).length / ings.length : 0;
  if (sunnah > 0) reasons.push('sunnah_food');

  // Child acceptance: kid- and autism-friendly flags when children with modules are served.
  const kids = served.filter(isMinor);
  const sensitiveKids = kids.filter(needsSafeFood).length;
  let acceptance = 0;
  if (kids.length) acceptance += meal.kidFriendly ? 1 : 0;
  if (sensitiveKids) acceptance += meal.autismFriendly ? 1 : 0;
  if (kids.length && meal.kidFriendly) reasons.push('kid_friendly');
  const accWeight = sensitiveKids ? 0.8 : 0.3;

  const score =
    1.0 * plate +
    0.8 * pref +
    costWeight * cost +
    0.5 * season +
    0.4 * prep +
    (req.sunnahEmphasis === false ? 0 : 0.3) * sunnah +
    accWeight * acceptance +
    0.05 * hash01(req.seed, slot.ref, meal.id);
  return { score: Math.round(score * 1000) / 1000, reasons };
}

export interface CandidateSetWithPool extends CandidateSet {
  /** Every feasible meal id for the slot, best first (the fallback draws from these). */
  pool: string[];
}

/** Candidate sets for every slot (hard constraints applied, soft relaxed only when empty). */
export function buildCandidateSets(
  req: PlanRequest,
  catalog: Catalog,
  slots: readonly Slot[] = buildSlots(req),
  k = CANDIDATES_PER_SLOT,
): CandidateSetWithPool[] {
  if (!req.members.some(isServed))
    throw new PlanningError('NO_MEMBERS', 'No family member can be served a plan.');
  const meals = [...catalog.meals.values()].sort((a, b) => a.id.localeCompare(b.id));
  return slots.map((slot) => {
    const strict: CatalogMeal[] = [];
    const relaxable: CatalogMeal[] = [];
    for (const meal of meals) {
      if (meal.mealType !== slot.mealType) continue;
      const f = feasibility(meal, slot, req, catalog);
      if (f.ok) strict.push(meal);
      else if (!f.hard.length) relaxable.push(meal);
    }
    const relaxed = strict.length ? [] : relaxable.length ? ['prep_time'] : [];
    const usable = strict.length ? strict : relaxable;
    if (!usable.length) {
      throw new PlanningError(
        'NO_CANDIDATES',
        `No safe meal fits ${slot.mealType} on ${slot.date}.`,
        slot.ref,
      );
    }
    const scored = usable
      .map((meal) => ({ meal, ...staticScore(meal, slot, req, catalog) }))
      .sort((a, b) => b.score - a.score || a.meal.id.localeCompare(b.meal.id));
    const candidates: Candidate[] = scored.slice(0, k).map((s, i) => ({
      ref: `c${i + 1}`,
      mealId: s.meal.id,
      score: s.score,
      reasons: s.reasons,
    }));
    return { slot, candidates, relaxed, pool: scored.map((s) => s.meal.id) };
  });
}

// ---- variety (14 §8.5) -----------------------------------------------------------------------

export interface VarietyState {
  bySlot: Map<string, string>;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

/**
 * Variety penalty for placing `meal` in `slot` given the other chosen slots. `Infinity` means a
 * hard rule (red-meat dinners at most 3 a week, deep-fried mains at most 1 a week, at most one
 * high-vitamin-K meal a day for members on warfarin).
 */
export function varietyPenalty(
  meal: CatalogMeal,
  slot: Slot,
  chosen: ReadonlyArray<{ slot: Slot; mealId: string }>,
  req: PlanRequest,
  catalog: Catalog,
): number {
  const tags = mealTags(meal, catalog);
  const factor = req.repeatTolerance === 'high' ? 0.5 : req.repeatTolerance === 'low' ? 1.5 : 1;
  let penalty = 0;
  let redMeatDinners = 0;
  let deepFried = 0;
  for (const c of chosen) {
    if (c.slot.ref === slot.ref) continue;
    const other = catalog.meals.get(c.mealId);
    if (!other) continue;
    const gap = Math.abs(daysBetween(slot.date, c.slot.date));
    const otherTags = mealTags(other, catalog);
    if (c.slot.week === slot.week) {
      if (c.slot.mealType === 'dinner' && otherTags.has('red_meat')) redMeatDinners++;
      if (MAIN_MEAL_TYPES.includes(c.slot.mealType) && otherTags.has('deep_fried')) deepFried++;
    }
    if (c.mealId === meal.id) {
      if (gap === 0) penalty += 5;
      else if (MAIN_MEAL_TYPES.includes(slot.mealType) && gap < 7) penalty += 10 * factor;
      else if (gap === 1) penalty += 2 * factor;
    }
    if (gap === 1 && slot.mealType === 'dinner' && c.slot.mealType === 'dinner') {
      for (const t of ['red_meat', 'poultry', 'fish', 'legume'])
        if (tags.has(t) && otherTags.has(t)) penalty += 1;
    }
    if (gap === 0 && tags.has('high_vitamin_k') && otherTags.has('high_vitamin_k')) {
      if (req.members.some(needsVitaminKConsistency)) return Number.POSITIVE_INFINITY;
    }
  }
  if (slot.mealType === 'dinner' && tags.has('red_meat') && redMeatDinners >= 3)
    return Number.POSITIVE_INFINITY;
  if (MAIN_MEAL_TYPES.includes(slot.mealType) && tags.has('deep_fried') && deepFried >= 1)
    return Number.POSITIVE_INFINITY;
  return penalty;
}

/**
 * Deterministic greedy solver over the candidate pools, slot by slot in date order (14 §8.9 without
 * the beam). `fixed` slots keep their meal (template slots, model choices that passed, pinned
 * slots); the rest take the best-scoring feasible meal after variety penalties.
 */
export function solveDeterministic(
  sets: readonly CandidateSetWithPool[],
  req: PlanRequest,
  catalog: Catalog,
  fixed: ReadonlyMap<string, string> = new Map(),
): Map<string, string> {
  const chosen: Array<{ slot: Slot; mealId: string }> = [];
  const out = new Map<string, string>();
  for (const set of sets) {
    const f = fixed.get(set.slot.ref);
    if (f) chosen.push({ slot: set.slot, mealId: f });
  }
  for (const set of sets) {
    if (fixed.has(set.slot.ref)) {
      out.set(set.slot.ref, fixed.get(set.slot.ref) ?? '');
      continue;
    }
    let best: { id: string; value: number } | null = null;
    for (const id of set.pool) {
      const meal = catalog.meals.get(id);
      if (!meal) continue;
      const base = staticScore(meal, set.slot, req, catalog).score;
      const pen = varietyPenalty(meal, set.slot, chosen, req, catalog);
      if (!Number.isFinite(pen)) continue;
      const value = base - pen;
      if (!best || value > best.value) best = { id, value };
    }
    // Every pool meal broke a hard variety rule: take the first pool meal; the validator reports it.
    const pick = best?.id ?? set.pool[0] ?? '';
    out.set(set.slot.ref, pick);
    chosen.push({ slot: set.slot, mealId: pick });
  }
  return out;
}
