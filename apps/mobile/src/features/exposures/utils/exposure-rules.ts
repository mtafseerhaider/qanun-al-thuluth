import {
  ACCEPTANCE_SCORES,
  EXPOSURE_STAGES,
  type AcceptanceScore,
  type ExposureStage,
  type Texture,
} from '@shared';
import {
  acceptanceValue,
  EXPOSURE_CONTEXTS,
  type ExposureContext,
  type ExposureLadderStatus,
  type ExposureLadderStrategy,
} from '@shared/domain/family-modules';

import { addDays } from '@/lib/dates/local-date';

/**
 * Exposure, ladder and new-food rules shared by the picky-eater and autism modules (15 §3.5 to §3.6,
 * §4.3 to §4.7; FR-PCK-02, -04, -05; FR-AUT-03, -04). Pure and unit-tested. The app proposes,
 * the parent confirms: nothing advances silently, and no rule ever restricts or rewards with food.
 *
 * The AI lane keeps the canonical chaining and progression engines in `packages/ai-core/src/health`
 * (server-only); these are the client-side equivalents used for display and suggestions until they
 * move to `packages/shared/src/health`.
 */

export { EXPOSURE_CONTEXTS, type ExposureContext };
export const STAGES: readonly ExposureStage[] = EXPOSURE_STAGES;
export const SCORES: readonly AcceptanceScore[] = ACCEPTANCE_SCORES;

export interface ExposureView {
  id: string;
  familyMemberId: string;
  ingredientId: string;
  foodLabel: string;
  exposedOn: string;
  stage: ExposureStage;
  acceptance: AcceptanceScore;
  context: ExposureContext | null;
  ladderStepId: string | null;
  notes: string | null;
  queued?: boolean;
}

/** Stage inferred from an acceptance score when the parent does not pick one (02 §7.13.7). */
export function stageForAcceptance(score: AcceptanceScore): ExposureStage {
  switch (score) {
    case '0_refused':
    case '1_tolerated':
      return 'tolerate_on_table';
    case '2_touched':
      return 'touch';
    case '3_tasted':
      return 'taste';
    case '4_ate_some':
      return 'eat_small';
    case '5_ate_well':
      return 'eat_portion';
  }
}

/** Score that counts as a calm pass at each stage (15 §3.5 `STAGE_PASS`). */
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

export const passes = (stage: ExposureStage, score: AcceptanceScore): boolean =>
  acceptanceValue(score) >= acceptanceValue(STAGE_PASS[stage]);

/** Tries needed at a stage before the app proposes moving on (02 §7.10.4: "3 calm tries"). */
export const PASSES_TO_ADVANCE = 3;

/**
 * Next suggestion for a ladder step (15 §3.5 `nextLadderAction`, simplified: distress and hard-day
 * tags are not in the `food_exposures.context` values the DB accepts, so two "Not today" tries in
 * a row at a step suggest stepping back instead). The parent always confirms.
 */
export function nextLadderAction(
  stage: ExposureStage,
  triesAtStep: readonly Pick<ExposureView, 'acceptance' | 'exposedOn'>[],
): 'advance' | 'stay' | 'step_back' {
  const ordered = [...triesAtStep].sort((a, b) => a.exposedOn.localeCompare(b.exposedOn));
  const last3 = ordered.slice(-PASSES_TO_ADVANCE);
  if (last3.length === PASSES_TO_ADVANCE && last3.every((e) => passes(stage, e.acceptance)))
    return 'advance';
  const last2 = ordered.slice(-2);
  if (last2.length === 2 && last2.every((e) => e.acceptance === '0_refused')) return 'step_back';
  return 'stay';
}

/* --- Ladders (05 §12.11 to §12.12) ------------------------------------------------------------ */

export interface LadderStepDraft {
  stepNo: number;
  stage: ExposureStage;
  foodLabel: string;
  bridgeFromIngredientId: string | null;
  criteria: string;
  completedOn?: string | null;
  id?: string;
}

export interface LadderView {
  id: string;
  familyMemberId: string;
  targetIngredientId: string;
  targetLabel: string;
  strategy: ExposureLadderStrategy;
  status: ExposureLadderStatus;
  currentStep: number;
  steps: Array<LadderStepDraft & { id: string }>;
  updatedAt: string;
}

/** Stages of a chain's intermediate foods, which are close to accepted ones (15 §3.6). */
export const CHAIN_LINK_STAGES: readonly ExposureStage[] = ['look', 'touch', 'taste', 'eat_small'];

/** The full nine-stage ladder for one food; `criteria` text comes from the caller (localized). */
export function exposureLadderSteps(
  foodLabel: string,
  criteria: (stage: ExposureStage) => string,
  stages: readonly ExposureStage[] = STAGES,
  startAt = 1,
  bridgeFromIngredientId: string | null = null,
): LadderStepDraft[] {
  return stages.map((stage, i) => ({
    stepNo: startAt + i,
    stage,
    foodLabel,
    bridgeFromIngredientId,
    criteria: criteria(stage),
  }));
}

/** Food-chaining ladder: each link gets the short stages, the target the full ladder (15 §3.6). */
export function chainLadderSteps(
  links: ReadonlyArray<{ label: string; ingredientId: string | null }>,
  target: { label: string },
  criteria: (stage: ExposureStage) => string,
): LadderStepDraft[] {
  const out: LadderStepDraft[] = [];
  let prev: string | null = null;
  for (const link of links) {
    out.push(...exposureLadderSteps(link.label, criteria, CHAIN_LINK_STAGES, out.length + 1, prev));
    prev = link.ingredientId;
  }
  out.push(...exposureLadderSteps(target.label, criteria, STAGES, out.length + 1, prev));
  return out;
}

/** Renumbers steps 1..n after an edit (remove or reorder) so `unique (ladder_id, step_no)` holds. */
export function renumber<T extends { stepNo: number }>(steps: readonly T[]): T[] {
  return steps.map((s, i) => ({ ...s, stepNo: i + 1 }));
}

export function moveStep<T extends { stepNo: number }>(
  steps: readonly T[],
  index: number,
  by: -1 | 1,
): T[] {
  const j = index + by;
  if (index < 0 || j < 0 || index >= steps.length || j >= steps.length) return [...steps];
  const copy = [...steps];
  const [item] = copy.splice(index, 1);
  copy.splice(j, 0, item as T);
  return renumber(copy);
}

/** Step after a confirmed move; a ladder whose last step passes becomes `completed`. */
export function moveLadder(
  ladder: Pick<LadderView, 'currentStep' | 'steps'>,
  direction: 'up' | 'down',
): { currentStep: number; status: 'active' | 'completed' } {
  const total = ladder.steps.length;
  if (direction === 'down')
    return { currentStep: Math.max(1, ladder.currentStep - 1), status: 'active' };
  if (ladder.currentStep >= total) return { currentStep: total, status: 'completed' };
  return { currentStep: ladder.currentStep + 1, status: 'active' };
}

/* --- Exposure log by food (02 §7.11.3) and new-food progression (15 §4.5) ---------------------- */

export interface FoodSummary {
  ingredientId: string;
  foodLabel: string;
  count: number;
  last: ExposureView;
  lifecycle: FoodLifecycle;
}

export type FoodLifecycle = 'introduced' | 'exposing' | 'tasting' | 'accepted' | 'paused';

/**
 * New-food lifecycle (15 §4.5): accepted at 4+ on 3 occasions within 30 days; tasting at 3+ twice;
 * paused after 15 exposures without tasting (try a chain); exposing otherwise.
 */
export function foodLifecycle(
  exposures: readonly Pick<ExposureView, 'acceptance' | 'exposedOn'>[],
  today: string,
): FoodLifecycle {
  if (exposures.length === 0) return 'introduced';
  const since = addDays(today, -30);
  const recentHigh = exposures.filter(
    (e) => e.exposedOn >= since && acceptanceValue(e.acceptance) >= 4,
  ).length;
  if (recentHigh >= 3) return 'accepted';
  const tasted = exposures.filter((e) => acceptanceValue(e.acceptance) >= 3).length;
  if (tasted >= 2) return 'tasting';
  if (exposures.length >= 15) return 'paused';
  return exposures.length === 1 ? 'introduced' : 'exposing';
}

export function groupByFood(exposures: readonly ExposureView[], today: string): FoodSummary[] {
  const map = new Map<string, ExposureView[]>();
  for (const e of exposures) map.set(e.ingredientId, [...(map.get(e.ingredientId) ?? []), e]);
  return [...map.entries()]
    .map(([ingredientId, list]) => {
      const sorted = [...list].sort((a, b) => a.exposedOn.localeCompare(b.exposedOn));
      const last = sorted[sorted.length - 1] as ExposureView;
      return {
        ingredientId,
        foodLabel: last.foodLabel,
        count: sorted.length,
        last,
        lifecycle: foodLifecycle(sorted, today),
      };
    })
    .sort((a, b) => b.last.exposedOn.localeCompare(a.last.exposedOn));
}

/** Foods ready to be suggested as safe foods (15 §4.4 "Upgrade"), excluding ones already safe. */
export function safeFoodSuggestions(
  summaries: readonly FoodSummary[],
  safeIngredientIds: ReadonlySet<string>,
): FoodSummary[] {
  return summaries.filter(
    (s) => s.lifecycle === 'accepted' && !safeIngredientIds.has(s.ingredientId),
  );
}

/* --- Acceptance analytics (15 §4.7, 02 §7.11.5), computed from the member's own logs ----------- */

export interface WeekBucket {
  weekStart: string;
  counts: number[]; // index = acceptance value 0..5
}

/** Monday of the ISO week of a date. */
export function weekStart(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(date, -dow);
}

export function weeklyAcceptance(
  scores: ReadonlyArray<{ date: string; acceptance: AcceptanceScore }>,
  today: string,
  weeks: number,
): WeekBucket[] {
  const first = weekStart(addDays(today, -7 * (weeks - 1)));
  const buckets: WeekBucket[] = Array.from({ length: weeks }, (_, i) => ({
    weekStart: addDays(first, 7 * i),
    counts: [0, 0, 0, 0, 0, 0],
  }));
  for (const s of scores) {
    if (s.date < first) continue;
    const idx = Math.floor((Date.parse(weekStart(s.date)) - Date.parse(first)) / (7 * 864e5));
    const b = buckets[idx];
    if (b)
      b.counts[acceptanceValue(s.acceptance)] = (b.counts[acceptanceValue(s.acceptance)] ?? 0) + 1;
  }
  return buckets;
}

/**
 * Food acceptance index (15 §4.7): exponentially weighted mean over 90 days, half-life 21 days,
 * scaled 0 to 100. Null without exposures in the window.
 */
export function acceptanceIndex(
  exposures: readonly Pick<ExposureView, 'acceptance' | 'exposedOn'>[],
  today: string,
): number | null {
  const since = addDays(today, -90);
  let num = 0;
  let den = 0;
  for (const e of exposures) {
    if (e.exposedOn < since || e.exposedOn > today) continue;
    const ageDays = (Date.parse(today) - Date.parse(e.exposedOn)) / 864e5;
    const w = Math.pow(0.5, ageDays / 21);
    num += w * acceptanceValue(e.acceptance);
    den += w;
  }
  return den === 0 ? null : Math.round((num / den / 5) * 100);
}

/** "Getting easier" when the second half of the last 90 days scores higher than the first half. */
export function easierFoods(
  exposures: readonly ExposureView[],
  today: string,
): Array<{ ingredientId: string; foodLabel: string; from: number; to: number }> {
  const mid = addDays(today, -45);
  const since = addDays(today, -90);
  const byFood = new Map<string, ExposureView[]>();
  for (const e of exposures)
    if (e.exposedOn >= since)
      byFood.set(e.ingredientId, [...(byFood.get(e.ingredientId) ?? []), e]);
  const out: Array<{ ingredientId: string; foodLabel: string; from: number; to: number }> = [];
  for (const [id, list] of byFood) {
    const early = list.filter((e) => e.exposedOn < mid).map((e) => acceptanceValue(e.acceptance));
    const late = list.filter((e) => e.exposedOn >= mid).map((e) => acceptanceValue(e.acceptance));
    if (early.length === 0 || late.length === 0) continue;
    const from = early.reduce((a, b) => a + b, 0) / early.length;
    const to = late.reduce((a, b) => a + b, 0) / late.length;
    if (to > from) out.push({ ingredientId: id, foodLabel: list[0]?.foodLabel ?? '', from, to });
  }
  return out.sort((a, b) => b.to - b.from - (a.to - a.from));
}

/* --- Food chaining suggestions (15 §3.6), client-side ----------------------------------------- */

export interface FoodFeatures {
  id: string;
  label: string;
  textures: readonly Texture[];
  color: string | null;
}

/** Colour bridge order from the reference protocol: beige, yellow, orange, red, green. */
const COLOR_ORDER = ['white', 'beige', 'yellow', 'orange', 'red', 'green'];

function colorCost(a: string | null, b: string | null, avoid: ReadonlySet<string>): number {
  if (!a || !b || a === b) return b && avoid.has(b) ? 0.5 : 0;
  const ia = COLOR_ORDER.indexOf(a);
  const ib = COLOR_ORDER.indexOf(b);
  const steps = ia < 0 || ib < 0 ? 2 : Math.abs(ia - ib);
  return (steps <= 1 ? 0.5 : 1.5) + (avoid.has(b) ? 0.5 : 0);
}

function textureDistance(a: readonly Texture[], b: readonly Texture[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  const union = new Set([...a, ...b]);
  const inter = a.filter((x) => b.includes(x)).length;
  return 1 - inter / union.size;
}

/** Sensory distance between two foods (15 §3.6 `chainDistance`, texture and colour terms only). */
export function chainDistance(
  a: FoodFeatures,
  b: FoodFeatures,
  avoidColors: ReadonlySet<string> = new Set(),
  avoidTextures: ReadonlySet<Texture> = new Set(),
): number {
  const avoided = b.textures.some((t) => avoidTextures.has(t)) ? 0.75 : 0;
  return (
    1.5 * textureDistance(a.textures, b.textures) +
    colorCost(a.color, b.color, avoidColors) +
    avoided
  );
}

export const MAX_HOP = 1.6;

/**
 * Greedy chain from a safe food to the target through catalog foods, each hop at most `MAX_HOP`
 * and each hop closer to the target. Returns the intermediate links (0 to `maxLinks`), or null
 * when the target is unreachable that way (the parent can still add links by hand).
 */
export function suggestChain(
  start: FoodFeatures,
  target: FoodFeatures,
  catalog: readonly FoodFeatures[],
  opts: {
    avoidColors?: ReadonlySet<string>;
    avoidTextures?: ReadonlySet<Texture>;
    maxLinks?: number;
  } = {},
): FoodFeatures[] | null {
  const avoidColors = opts.avoidColors ?? new Set<string>();
  const avoidTextures = opts.avoidTextures ?? new Set<Texture>();
  const maxLinks = opts.maxLinks ?? 3;
  const links: FoodFeatures[] = [];
  let current = start;
  const used = new Set([start.id, target.id]);
  while (chainDistance(current, target, avoidColors, avoidTextures) > MAX_HOP) {
    if (links.length >= maxLinks) return null;
    const here = chainDistance(current, target, avoidColors, avoidTextures);
    const next = catalog
      .filter((f) => !used.has(f.id))
      .map((f) => ({
        f,
        hop: chainDistance(current, f, avoidColors, avoidTextures),
        rest: chainDistance(f, target, avoidColors, avoidTextures),
      }))
      .filter((c) => c.hop <= MAX_HOP && c.rest < here)
      .sort((x, y) => x.hop + x.rest - (y.hop + y.rest))[0];
    if (!next) return null;
    links.push(next.f);
    used.add(next.f.id);
    current = next.f;
  }
  return links;
}

/* --- Weekly exposure pair from the plan (`meal_plans.generation_meta.exposure_pairs`) ----------- */

export interface ExposurePair {
  familyMemberId: string;
  week: number;
  newFood: string;
  newIngredientId: string | null;
  familiarLabel: string;
  slots: Array<{ planDate: string; mealType: string }>;
}

export function parseExposurePairs(meta: unknown): ExposurePair[] {
  if (!meta || typeof meta !== 'object') return [];
  const raw = (meta as Record<string, unknown>).exposure_pairs;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((p: unknown) => {
    if (!p || typeof p !== 'object') return [];
    const r = p as Record<string, unknown>;
    if (typeof r.family_member_id !== 'string' || typeof r.new_food !== 'string') return [];
    const slots = Array.isArray(r.slots)
      ? r.slots.flatMap((s: unknown) => {
          const o = (s ?? {}) as Record<string, unknown>;
          return typeof o.plan_date === 'string' && typeof o.meal_type === 'string'
            ? [{ planDate: o.plan_date, mealType: o.meal_type }]
            : [];
        })
      : [];
    return [
      {
        familyMemberId: r.family_member_id,
        week: typeof r.week === 'number' ? r.week : 1,
        newFood: r.new_food,
        newIngredientId: typeof r.new_ingredient_id === 'string' ? r.new_ingredient_id : null,
        familiarLabel: typeof r.familiar_label === 'string' ? r.familiar_label : '',
        slots,
      },
    ];
  });
}

/** This week's pairs for a member: slots within [weekStart(today), +6 days], else week 1. */
export function pairsThisWeek(
  pairs: readonly ExposurePair[],
  memberId: string,
  today: string,
): ExposurePair[] {
  const from = weekStart(today);
  const to = addDays(from, 6);
  const mine = pairs.filter((p) => p.familyMemberId === memberId);
  const current = mine.filter((p) => p.slots.some((s) => s.planDate >= from && s.planDate <= to));
  return current.length > 0 ? current : mine.filter((p) => p.week === 1 && p.slots.length === 0);
}

/** Whole months between a birth date and today (both YYYY-MM-DD). */
export function ageInMonths(dateOfBirth: string, today: string): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  return Math.max(0, (ty - by) * 12 + (tm - bm) - (td < bd ? 1 : 0));
}

/* --- Ladder proposal from chat (AI lane card `exposure_ladder_proposal`, pending contract) ------ */

export interface LadderProposal {
  familyMemberId: string;
  targetFood: string;
  targetIngredientId: string | null;
  strategy: ExposureLadderStrategy;
  steps: LadderStepDraft[];
}

/**
 * Parses a chat ladder proposal for the editor, which the parent confirms before anything is saved.
 * Unknown stages are dropped and steps are renumbered; returns null for anything malformed.
 */
export function parseLadderProposal(raw: unknown): LadderProposal | null {
  let value = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  if (r.kind !== undefined && r.kind !== 'exposure_ladder_proposal') return null;
  if (typeof r.family_member_id !== 'string' || typeof r.target_food !== 'string') return null;
  const strategy: ExposureLadderStrategy =
    r.strategy === 'food_chaining' ? 'food_chaining' : 'exposure_ladder';
  const steps = (Array.isArray(r.steps) ? r.steps : []).flatMap((s: unknown, i: number) => {
    const o = (s ?? {}) as Record<string, unknown>;
    if (typeof o.stage !== 'string' || !(STAGES as readonly string[]).includes(o.stage)) return [];
    return [
      {
        stepNo: typeof o.step_no === 'number' ? o.step_no : i + 1,
        stage: o.stage as ExposureStage,
        foodLabel:
          typeof o.food_label === 'string' && o.food_label.trim()
            ? o.food_label.trim()
            : (r.target_food as string),
        bridgeFromIngredientId:
          typeof o.bridge_from_ingredient_id === 'string' ? o.bridge_from_ingredient_id : null,
        criteria: typeof o.criteria === 'string' ? o.criteria.slice(0, 500) : '',
      },
    ];
  });
  if (steps.length === 0) return null;
  return {
    familyMemberId: r.family_member_id,
    targetFood: r.target_food,
    targetIngredientId: typeof r.target_ingredient_id === 'string' ? r.target_ingredient_id : null,
    strategy,
    steps: renumber([...steps].sort((a, b) => a.stepNo - b.stepNo)),
  };
}

/** Colour sensitivities are stored as `avoid:<colour>` (intake); the chain search wants bare names. */
export function avoidColours(colorSensitivities: readonly string[]): Set<string> {
  return new Set(colorSensitivities.map((c) => c.replace(/^avoid:/, '')));
}
