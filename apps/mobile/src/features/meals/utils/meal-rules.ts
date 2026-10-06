import type { AcceptanceScore, LifeStage, MealStatus, MealType, SpecialModule } from '@shared';

import type { OutboxEntry } from '@/lib/offline/outbox';

import type { DailyMealView, ServingStatusWrite, ServingView } from '../api/meals-api';

/** Pure rules for meal views and logging (02 §1.1, §5.5, §7.5). */

export const SERVING_STATUS_KIND = 'serving.status';

const MINOR_STAGES: readonly LifeStage[] = ['infant', 'toddler', 'child', 'teen'];

/** Under 18: no kcal, grams, targets or stop-point messages anywhere (02 §1.1 rule 1). */
export function isMinorStage(stage: LifeStage | null | undefined): boolean {
  return stage ? MINOR_STAGES.includes(stage) : false;
}

export interface MemberLite {
  id: string;
  name: string;
  lifeStage: LifeStage;
  specialModules: readonly SpecialModule[];
}

/** Children get the acceptance picker (24 S3-12, FR-TRK-04). */
export function showAcceptanceFor(member: Pick<MemberLite, 'lifeStage'> | undefined): boolean {
  return isMinorStage(member?.lifeStage);
}

/** "Ask me about new foods" defaults on for picky and autism members (02 §5.5). */
export function asksAcceptanceByDefault(
  member: Pick<MemberLite, 'lifeStage' | 'specialModules'> | undefined,
): boolean {
  return (
    showAcceptanceFor(member) &&
    Boolean(
      member?.specialModules.includes('picky_eater') || member?.specialModules.includes('autism'),
    )
  );
}

/** Main meals carry the Thuluth guidance (FR-PLAN-08); snacks do not. */
export function isMainMeal(mealType: MealType): boolean {
  return mealType !== 'snack';
}

export const MEAL_STATUS_OPTIONS = ['eaten', 'partly_eaten', 'skipped'] as const;
export const ACCEPTANCE_OPTIONS: readonly AcceptanceScore[] = [
  '0_refused',
  '1_tolerated',
  '2_touched',
  '3_tasted',
  '4_ate_some',
  '5_ate_well',
];

/** Queued serving writes keyed by serving id (latest wins). */
export function pendingServingWrites(
  entries: readonly OutboxEntry[],
): Map<string, ServingStatusWrite> {
  const out = new Map<string, ServingStatusWrite>();
  for (const e of entries) {
    if (e.kind !== SERVING_STATUS_KIND) continue;
    const w = e.payload as ServingStatusWrite;
    out.set(w.servingId, w);
  }
  return out;
}

/**
 * Overlays queued writes on server rows so a log made offline (or not yet synced) shows at once and
 * survives refetches and app restarts (02 P10). Returns new objects; inputs are not mutated.
 */
export function applyPendingServingWrites(
  meals: readonly DailyMealView[],
  pending: ReadonlyMap<string, ServingStatusWrite>,
): DailyMealView[] {
  if (pending.size === 0) return [...meals];
  return meals.map((m) => ({
    ...m,
    servings: m.servings.map((s): ServingView => {
      const w = pending.get(s.id);
      if (!w) return s;
      return {
        ...s,
        status: w.status,
        acceptance: w.status === 'planned' ? null : w.acceptance,
        loggedAt: w.status === 'planned' ? null : w.at,
      };
    }),
  }));
}

export function isLogged(status: MealStatus): boolean {
  return status !== 'planned';
}

export function loggedCount(meal: Pick<DailyMealView, 'servings'>): number {
  return meal.servings.filter((s) => isLogged(s.status)).length;
}

export function isFullyLogged(meal: Pick<DailyMealView, 'servings'>): boolean {
  return meal.servings.length > 0 && loggedCount(meal) === meal.servings.length;
}

/** Servings "Everyone ate" changes: only the ones not logged yet (02 §5.5). */
export function servingsForBulkLog(meal: Pick<DailyMealView, 'servings'>): ServingView[] {
  return meal.servings.filter((s) => s.status === 'planned');
}

const MEAL_ORDER: Record<MealType, number> = {
  suhoor: 0,
  breakfast: 1,
  lunch: 2,
  snack: 3,
  iftar: 4,
  dinner: 5,
};

function minutesOf(time: string | null): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** Orders a day's meals by scheduled time, then meal type, then slot. */
export function sortMeals<T extends Pick<DailyMealView, 'scheduledTime' | 'mealType' | 'slot'>>(
  meals: readonly T[],
): T[] {
  return [...meals].sort((a, b) => {
    const ta = minutesOf(a.scheduledTime) ?? MEAL_ORDER[a.mealType] * 240;
    const tb = minutesOf(b.scheduledTime) ?? MEAL_ORDER[b.mealType] * 240;
    return ta - tb || MEAL_ORDER[a.mealType] - MEAL_ORDER[b.mealType] || a.slot - b.slot;
  });
}

/**
 * The next meal for Today (FR-DASH-02): the first meal not fully logged whose time has not passed by
 * more than an hour; otherwise the first meal not fully logged; null when everything is logged.
 */
export function pickNextMeal<T extends DailyMealView>(
  meals: readonly T[],
  nowMinutes: number,
): T | null {
  const sorted = sortMeals(meals);
  const open = sorted.filter((m) => !isFullyLogged(m));
  const upcoming = open.find((m) => {
    const t = minutesOf(m.scheduledTime);
    return t === null || t >= nowMinutes - 60;
  });
  return upcoming ?? open[0] ?? null;
}

/** The member's portion as a household measure in the UI locale (14 §6.2); never grams or kcal. */
export function portionLabel(
  portion: { householdMeasure: string; householdMeasureI18n: unknown } | null,
  locale: string,
): string | null {
  if (!portion) return null;
  const map = portion.householdMeasureI18n;
  if (map && typeof map === 'object') {
    const v = (map as Record<string, unknown>)[locale] ?? (map as Record<string, unknown>).en;
    if (typeof v === 'string' && v.trim()) return v;
  }
  return portion.householdMeasure;
}

/** Card-ready servings for MealCard: names from the member lookup, queued from the outbox overlay. */
export function cardServings(
  meal: Pick<DailyMealView, 'servings'>,
  members: ReadonlyMap<string, MemberLite>,
  pending: ReadonlyMap<string, unknown>,
): Array<{
  memberId: string;
  name: string;
  status: MealStatus;
  adapted: boolean;
  queued: boolean;
}> {
  return meal.servings.map((s) => ({
    memberId: s.familyMemberId,
    name: members.get(s.familyMemberId)?.name ?? '',
    status: s.status,
    adapted: s.adaptation !== 'none',
    queued: pending.has(s.id),
  }));
}

/** Tags shown on a card (max two render): swapped first, then catalog tags when known. */
export function cardTags(
  meal: Pick<DailyMealView, 'swappedFromMealId' | 'servings'>,
): Array<'swapped' | 'autism_friendly'> {
  const tags: Array<'swapped' | 'autism_friendly'> = [];
  if (meal.swappedFromMealId) tags.push('swapped');
  if (meal.servings.some((s) => s.adaptation === 'autism')) tags.push('autism_friendly');
  return tags;
}
