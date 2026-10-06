import { ACCEPTANCE_SCORES, EXPOSURE_STAGES } from '@thuluth/shared';
import type { AcceptanceScore, ExposureStage, SpecialModule } from '@thuluth/shared';

/**
 * Picky-eater and autism exposure engine (15 §3.5, §4.5, §4.7; 12 §4.6). Pure functions over
 * `food_exposures` rows. The engine proposes; a parent always confirms an advance or a pause.
 */

/** One `food_exposures` row (05 §12.10) in engine shape. */
export interface ExposureObs {
  ingredientId: string;
  /** `YYYY-MM-DD`. */
  exposedOn: string;
  stage: ExposureStage;
  acceptance: AcceptanceScore;
  /** `food_exposures.context` (05 base list: family_meal, snack, cooking_together, ...). */
  context?: string | null | undefined;
  ladderStepId?: string | null | undefined;
  /**
   * Distress or a hard sensory day (15 §3.5). The 05 `context` list has no such tag yet, so the
   * store sets these only when a future column or tag carries them.
   */
  distress?: boolean | undefined;
  hardDay?: boolean | undefined;
}

export const acceptanceNumber = (a: AcceptanceScore): number => ACCEPTANCE_SCORES.indexOf(a);
export const stageIndex = (s: ExposureStage): number => EXPOSURE_STAGES.indexOf(s);

const DAY = 86_400_000;
export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

const byDate = (a: ExposureObs, b: ExposureObs) => a.exposedOn.localeCompare(b.exposedOn);

// ---- acceptance analytics (15 §4.7) --------------------------------------------------------------

/** Food acceptance index: exponentially weighted mean over 90 days, half-life 21 days, 0..100. */
export function acceptanceIndex(rows: readonly ExposureObs[], today: string): number | null {
  let w = 0;
  let sum = 0;
  for (const r of rows) {
    const age = daysBetween(r.exposedOn, today);
    if (age < 0 || age > 90) continue;
    const weight = 0.5 ** (age / 21);
    w += weight;
    sum += weight * acceptanceNumber(r.acceptance);
  }
  return w ? Math.round((sum / w / 5) * 100) : null;
}

export interface FoodAcceptance {
  ingredientId: string;
  exposures: number;
  index: number | null;
  lastExposedOn: string;
  bestStage: ExposureStage;
  lifecycle: FoodLifecycle;
}

export interface AcceptanceSummary {
  /** Distinct foods with acceptance >= 4 on 2+ occasions in 60 days, union safe foods. */
  acceptedFoodCount: number;
  /** Exposures logged in the period. */
  exposures: number;
  /** Foods whose lifecycle reached `accepted` inside the period. */
  newAccepted: number;
  /** Distinct foods eaten (acceptance >= 3) in the last 7 days. */
  varietyLast7Days: number;
  /** Median exposures until `accepted`, over foods that got there; null when none. */
  medianExposuresToAcceptance: number | null;
  foods: FoodAcceptance[];
}

const groupByFood = (rows: readonly ExposureObs[]) => {
  const out = new Map<string, ExposureObs[]>();
  for (const r of [...rows].sort(byDate))
    out.set(r.ingredientId, [...(out.get(r.ingredientId) ?? []), r]);
  return out;
};

export function acceptanceSummary(
  rows: readonly ExposureObs[],
  safeFoodIngredientIds: readonly string[],
  today: string,
  periodDays = 30,
): AcceptanceSummary {
  const foods: FoodAcceptance[] = [];
  const accepted = new Set(safeFoodIngredientIds);
  let newAccepted = 0;
  const toAcceptance: number[] = [];
  for (const [id, list] of groupByFood(rows)) {
    const recent60 = list.filter((r) => daysBetween(r.exposedOn, today) <= 60);
    if (recent60.filter((r) => acceptanceNumber(r.acceptance) >= 4).length >= 2) accepted.add(id);
    const life = foodLifecycle(list, today);
    if (life.status === 'accepted' && life.since && daysBetween(life.since, today) <= periodDays)
      newAccepted++;
    if (life.status === 'accepted') toAcceptance.push(life.exposuresToAcceptance ?? list.length);
    foods.push({
      ingredientId: id,
      exposures: list.length,
      index: acceptanceIndex(list, today),
      lastExposedOn: list.at(-1)?.exposedOn ?? today,
      bestStage: list.reduce<ExposureStage>(
        (best, r) => (stageIndex(r.stage) > stageIndex(best) ? r.stage : best),
        'tolerate_on_table',
      ),
      lifecycle: life.status,
    });
  }
  toAcceptance.sort((a, b) => a - b);
  const mid = toAcceptance.length >> 1;
  return {
    acceptedFoodCount: accepted.size,
    exposures: rows.filter((r) => daysBetween(r.exposedOn, today) <= periodDays).length,
    newAccepted,
    varietyLast7Days: new Set(
      rows
        .filter((r) => daysBetween(r.exposedOn, today) <= 7 && acceptanceNumber(r.acceptance) >= 3)
        .map((r) => r.ingredientId),
    ).size,
    medianExposuresToAcceptance: toAcceptance.length
      ? toAcceptance.length % 2
        ? (toAcceptance[mid] ?? null)
        : ((toAcceptance[mid - 1] ?? 0) + (toAcceptance[mid] ?? 0)) / 2
      : null,
    foods: foods.sort(
      (a, b) =>
        b.lastExposedOn.localeCompare(a.lastExposedOn) ||
        a.ingredientId.localeCompare(b.ingredientId),
    ),
  };
}

// ---- new-food progression (15 §4.5) --------------------------------------------------------------

export type FoodLifecycle = 'introduced' | 'exposing' | 'tasting' | 'accepted' | 'paused';

export const PAUSE_DAYS = 14;
export const PAUSE_AFTER_EXPOSURES = 15;

export interface LifecycleResult {
  status: FoodLifecycle;
  /** Date the status was reached (accepted or paused). */
  since: string | null;
  pausedUntil: string | null;
  /** After a pause, try a food chain toward this food instead (15 §4.5). */
  suggestChain: boolean;
  /** Suggest adding it to safe foods (15 §4.4 "Upgrade"); the parent decides. */
  suggestSafeFood: boolean;
  exposuresToAcceptance: number | null;
}

const addDays = (iso: string, n: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/**
 * Lifecycle of one new food from its exposures:
 * introduced -> exposing -> tasting -> accepted | paused (15 §4.5).
 * - tasting: acceptance >= 3 at least twice;
 * - accepted: acceptance >= 4 on 3 occasions within 30 days;
 * - paused: 2 distress events, or 15 exposures without reaching tasting; the pause lasts 2 weeks,
 *   then the food is offered again and a food chain is suggested.
 */
export function foodLifecycle(rows: readonly ExposureObs[], today: string): LifecycleResult {
  const list = [...rows].sort(byDate).filter((r) => r.exposedOn <= today);
  const base: LifecycleResult = {
    status: 'introduced',
    since: null,
    pausedUntil: null,
    suggestChain: false,
    suggestSafeFood: false,
    exposuresToAcceptance: null,
  };
  if (!list.length) return base;
  let tastes = 0;
  let distress = 0;
  let pausedAt: string | null = null;
  let resumedAfterPause = false;
  for (const [i, r] of list.entries()) {
    const n = acceptanceNumber(r.acceptance);
    if (n >= 3) tastes++;
    if (r.distress) distress++;
    const goodRecent = list
      .slice(0, i + 1)
      .filter(
        (x) => acceptanceNumber(x.acceptance) >= 4 && daysBetween(x.exposedOn, r.exposedOn) <= 30,
      );
    if (goodRecent.length >= 3) {
      return {
        ...base,
        status: 'accepted',
        since: r.exposedOn,
        suggestSafeFood: true,
        exposuresToAcceptance: i + 1,
        suggestChain: resumedAfterPause,
      };
    }
    if (!pausedAt && (distress >= 2 || (i + 1 >= PAUSE_AFTER_EXPOSURES && tastes < 2))) {
      pausedAt = r.exposedOn;
    } else if (pausedAt && daysBetween(pausedAt, r.exposedOn) >= PAUSE_DAYS) {
      resumedAfterPause = true;
    }
  }
  if (pausedAt) {
    const until = addDays(pausedAt, PAUSE_DAYS);
    if (today < until)
      return { ...base, status: 'paused', since: pausedAt, pausedUntil: until, suggestChain: true };
    resumedAfterPause = true;
  }
  return {
    ...base,
    status: tastes >= 2 ? 'tasting' : 'exposing',
    suggestChain: resumedAfterPause,
  };
}

/** New foods a week (15 §4.5; 12 §4.6): autism 1; picky 1 under 5 years, else 2. */
export function maxNewFoodsPerWeek(ageMonths: number, modules: readonly SpecialModule[]): number {
  if (modules.includes('autism')) return 1;
  return ageMonths < 60 ? 1 : 2;
}

// ---- ladder step progression (15 §3.5) -----------------------------------------------------------

/** The acceptance that passes each stage (15 §3.5). */
export const STAGE_PASS: Record<ExposureStage, AcceptanceScore> = {
  tolerate_on_table: '1_tolerated',
  look: '1_tolerated',
  touch: '2_touched',
  smell: '2_touched',
  lick: '3_tasted',
  taste: '3_tasted',
  chew_spit: '3_tasted',
  eat_small: '4_ate_some',
  eat_portion: '5_ate_well',
};

export type LadderAction = 'advance' | 'stay' | 'step_back' | 'pause';

/**
 * What to propose for the current ladder step. Recent exposures are those of the ladder's food.
 * Hard day -> pause; 2 distress events or 3 refusals in a row at this stage -> step back; the last
 * 3 tries at this stage all passed calmly -> advance; otherwise stay. Parents confirm every move.
 */
export function nextLadderAction(
  stage: ExposureStage,
  recent: readonly ExposureObs[],
): LadderAction {
  const sorted = [...recent].sort(byDate);
  if (sorted.slice(-3).some((e) => e.hardDay)) return 'pause';
  const atStage = sorted.filter((e) => e.stage === stage).slice(-5);
  if (atStage.filter((e) => e.distress).length >= 2) return 'step_back';
  const lastThree = atStage.slice(-3);
  if (lastThree.length === 3 && lastThree.every((e) => e.acceptance === '0_refused'))
    return 'step_back';
  const pass = acceptanceNumber(STAGE_PASS[stage]);
  if (
    lastThree.length === 3 &&
    lastThree.every((e) => !e.distress && acceptanceNumber(e.acceptance) >= pass)
  )
    return stage === 'eat_portion' ? 'stay' : 'advance';
  return 'stay';
}

export function nextStage(stage: ExposureStage, action: LadderAction): ExposureStage {
  const i = stageIndex(stage);
  const to =
    action === 'advance'
      ? EXPOSURE_STAGES[Math.min(i + 1, EXPOSURE_STAGES.length - 1)]
      : action === 'step_back'
        ? EXPOSURE_STAGES[Math.max(i - 1, 0)]
        : stage;
  return to ?? stage;
}
