import { EXPOSURE_STAGES } from '@thuluth/shared';
import type { ExposureStage, Texture } from '@thuluth/shared';

import type { CatalogIngredient } from '../planning/types.ts';

/**
 * Food chaining (15 §3.6): small sensory steps from a safe food toward a target food. Each food
 * has a feature vector built from `ingredients.textures`, `ingredients.color` and its category;
 * Dijkstra runs over catalog foods with edges only where `chainDistance <= MAX_HOP`. The chain is a
 * suggestion: the parent picks the target, confirms every step, and can stop at any time.
 */

export type Flavor = 'sweet' | 'salty' | 'savory' | 'sour' | 'bitter' | 'mild';
export type Shape = 'strip' | 'coin' | 'cube' | 'round' | 'mash' | 'liquid' | 'irregular';
export type Temperature = 'warm' | 'room' | 'cold';
export type LadderStep = 1 | 2 | 3 | 4 | 5 | 6;

export interface FoodFeatures {
  texture: readonly string[];
  color: string;
  flavor: Flavor;
  shape: Shape;
  temperature: Temperature;
  ladderStep: LadderStep;
}

export interface FoodNode {
  id: string;
  label: string;
  features: FoodFeatures;
}

/** The sensory facts the chain respects (`sensory_profiles`, `SensoryProfileInput`). */
export interface SensoryLite {
  textureLikes: readonly string[];
  textureAvoids: readonly string[];
  /** `'avoid:green'`, `'prefer:beige'` (15 §3.2). */
  colorSensitivities: readonly string[];
  temperaturePrefs?: readonly string[] | undefined;
}

export const MAX_HOP = 1.2;
export const MAX_CHAIN_FOODS = 6;

/** Texture ladder step per texture (15 §3.5). */
const TEXTURE_STEP: Record<Texture, LadderStep> = {
  smooth: 1,
  wet: 2,
  lumpy: 3,
  soft: 3,
  dry: 4,
  chewy: 4,
  crispy: 5,
  crunchy: 6,
  mixed: 6,
};

/** By `ingredients.category` (05 check constraint). */
const CATEGORY_FLAVOR: Record<string, Flavor> = {
  fruit: 'sweet',
  sweetener: 'sweet',
  dairy: 'mild',
  grain: 'mild',
  egg: 'mild',
  nut_seed: 'mild',
  oil_fat: 'mild',
  beverage: 'mild',
  vegetable: 'savory',
  legume: 'savory',
  meat: 'savory',
  poultry: 'savory',
  fish: 'savory',
  prepared: 'savory',
  spice_herb: 'savory',
  condiment: 'salty',
};

export function ingredientFeatures(ing: CatalogIngredient): FoodFeatures {
  const textures = (ing.textures ?? []).filter((t): t is Texture => t in TEXTURE_STEP);
  const step = textures.length
    ? (Math.max(...textures.map((t) => TEXTURE_STEP[t])) as LadderStep)
    : 4;
  const color = (ing.color ?? 'mixed').toLowerCase();
  const flavor = CATEGORY_FLAVOR[ing.category] ?? 'mild';
  const shape: Shape = textures.includes('smooth')
    ? 'mash'
    : (ing.category === 'dairy' || ing.category === 'beverage') && textures.includes('wet')
      ? 'liquid'
      : 'irregular';
  return { texture: textures, color, flavor, shape, temperature: 'room', ladderStep: step };
}

export const nodeOf = (ing: CatalogIngredient): FoodNode => ({
  id: ing.id,
  label: ing.name,
  features: ingredientFeatures(ing),
});

/** Natural colour bridge order (15 §3.6): beige -> yellow -> orange -> red -> green. */
const COLOR_RANK: Record<string, number> = {
  white: 0,
  beige: 0,
  brown: 0,
  yellow: 1,
  orange: 2,
  red: 3,
  pink: 3,
  green: 4,
  purple: 4,
  blue: 4,
  black: 4,
  mixed: 5,
};

export function avoidedColors(profile: SensoryLite | null | undefined): Set<string> {
  return new Set(
    (profile?.colorSensitivities ?? [])
      .filter((c) => c.startsWith('avoid:'))
      .map((c) => c.slice(6).toLowerCase()),
  );
}

export function colorBridgeCost(from: string, to: string, profile?: SensoryLite | null): number {
  if (from === to) return 0;
  const a = COLOR_RANK[from] ?? 5;
  const b = COLOR_RANK[to] ?? 5;
  const steps = Math.abs(a - b);
  const base = steps === 0 ? 0.25 : steps === 1 ? 0.5 : 1.5;
  return base + (avoidedColors(profile).has(to) ? 0.5 : 0);
}

export function textureDistance(a: FoodFeatures, b: FoodFeatures): number {
  const sa = new Set(a.texture);
  const sb = new Set(b.texture);
  const union = new Set([...sa, ...sb]);
  const inter = [...sa].filter((t) => sb.has(t)).length;
  const jaccard = union.size ? 1 - inter / union.size : 0;
  return jaccard + Math.abs(a.ladderStep - b.ladderStep) / 5;
}

/** 15 §3.6 weighted sensory distance between two foods. */
export function chainDistance(
  a: FoodFeatures,
  b: FoodFeatures,
  profile?: SensoryLite | null,
): number {
  return (
    1.5 * textureDistance(a, b) +
    1.0 * colorBridgeCost(a.color, b.color, profile) +
    0.8 * (a.flavor === b.flavor ? 0 : 1) +
    0.4 * (a.shape === b.shape ? 0 : 1) +
    0.3 * (a.temperature === b.temperature ? 0 : 1)
  );
}

/** A food the child can be offered as a chain step: no avoided texture or colour (15 §3.4). */
export function sensoryOk(f: FoodFeatures, profile: SensoryLite | null | undefined): boolean {
  if (!profile) return true;
  if (f.texture.some((t) => profile.textureAvoids.includes(t))) return false;
  return !avoidedColors(profile).has(f.color);
}

export interface ChainResult {
  /** Safe start, bridge foods, target (in order). */
  foods: FoodNode[];
  /** Distance of each hop (foods.length - 1 values), all <= MAX_HOP. */
  hops: number[];
  cost: number;
}

/**
 * Dijkstra from any safe food to the target over `candidates` (already halal, allergen-safe and
 * not hard rejections). Bridge foods must pass the sensory profile; the target is the parent's
 * choice, so it is kept even when its texture is one the child avoids today. Returns null when no
 * chain of at most `MAX_CHAIN_FOODS` foods exists; the app then offers a plain exposure ladder.
 */
export function planFoodChain(
  safe: readonly FoodNode[],
  target: FoodNode,
  candidates: readonly FoodNode[],
  profile?: SensoryLite | null,
  maxHop = MAX_HOP,
): ChainResult | null {
  if (!safe.length) return null;
  if (safe.some((s) => s.id === target.id)) return null; // already a safe food
  const safeIds = new Set(safe.map((s) => s.id));
  const nodes = new Map<string, FoodNode>();
  for (const s of safe) nodes.set(s.id, s);
  for (const c of candidates) {
    if (c.id === target.id || safeIds.has(c.id)) continue;
    if (sensoryOk(c.features, profile)) nodes.set(c.id, c);
  }
  nodes.set(target.id, target);

  const dist = new Map<string, number>();
  const hopsTo = new Map<string, number>();
  const prev = new Map<string, string>();
  const done = new Set<string>();
  for (const s of safe) {
    dist.set(s.id, 0);
    hopsTo.set(s.id, 1);
  }
  while (true) {
    let cur: string | null = null;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (done.has(id)) continue;
      if (d < best || (d === best && cur !== null && id < cur)) {
        best = d;
        cur = id;
      }
    }
    if (cur === null) break;
    done.add(cur);
    if (cur === target.id) break;
    const count = hopsTo.get(cur) ?? 1;
    if (count >= MAX_CHAIN_FOODS) continue;
    const from = nodes.get(cur);
    if (!from) continue;
    for (const [id, node] of nodes) {
      if (done.has(id) || safeIds.has(id)) continue;
      const w = chainDistance(from.features, node.features, profile);
      if (w > maxHop) continue;
      const nd = best + w;
      if (nd < (dist.get(id) ?? Infinity) - 1e-9) {
        dist.set(id, nd);
        prev.set(id, cur);
        hopsTo.set(id, count + 1);
      }
    }
  }
  if (!done.has(target.id)) return null;
  const path: FoodNode[] = [];
  for (let id: string | undefined = target.id; id; id = prev.get(id)) {
    const n = nodes.get(id);
    if (n) path.unshift(n);
  }
  const hops: number[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    if (a && b) hops.push(chainDistance(a.features, b.features, profile));
  }
  return { foods: path, hops, cost: dist.get(target.id) ?? 0 };
}

// ---- ladder steps (exposure_ladder_steps rows) ---------------------------------------------------

export interface LadderStepProposal {
  step_no: number;
  stage: ExposureStage;
  food_label: string;
  bridge_from_ingredient_id: string | null;
  criteria: string;
}

/** Bridge foods are close to accepted ones, so their stages are compressed (15 §3.6). */
export const BRIDGE_STAGES: readonly ExposureStage[] = ['look', 'touch', 'taste', 'eat_small'];

const STAGE_WORDS: Record<ExposureStage, string> = {
  tolerate_on_table: 'is happy with it on the table',
  look: 'looks at it',
  touch: 'touches it',
  smell: 'smells it',
  lick: 'licks it',
  taste: 'tastes it',
  chew_spit: 'chews it (spitting out is fine)',
  eat_small: 'eats a small piece',
  eat_portion: 'eats it as part of a meal',
};

export function stageCriteria(stage: ExposureStage): string {
  return `Three calm tries where your child ${STAGE_WORDS[stage]}. No pressure; you choose when to move on, and stepping back is fine.`;
}

/** Steps for a plain exposure ladder toward one food, from `startStage` to `eat_portion`. */
export function exposureLadderSteps(
  targetLabel: string,
  startStage: ExposureStage = 'tolerate_on_table',
): LadderStepProposal[] {
  const from = Math.max(0, EXPOSURE_STAGES.indexOf(startStage));
  return EXPOSURE_STAGES.slice(from).map((stage, i) => ({
    step_no: i + 1,
    stage,
    food_label: targetLabel,
    bridge_from_ingredient_id: null,
    criteria: stageCriteria(stage),
  }));
}

/** Steps for a food chain: compressed stages for bridge foods, the full ladder for the target. */
export function chainLadderSteps(
  chain: ChainResult,
  startStage?: ExposureStage,
): LadderStepProposal[] {
  const steps: LadderStepProposal[] = [];
  const foods = chain.foods;
  for (let i = 1; i < foods.length; i++) {
    const food = foods[i];
    const from = foods[i - 1];
    if (!food || !from) continue;
    const isTarget = i === foods.length - 1;
    const stages = isTarget
      ? EXPOSURE_STAGES.slice(
          Math.max(0, EXPOSURE_STAGES.indexOf(startStage ?? 'tolerate_on_table')),
        )
      : BRIDGE_STAGES;
    for (const stage of stages) {
      steps.push({
        step_no: steps.length + 1,
        stage,
        food_label: food.label,
        bridge_from_ingredient_id: from.id,
        criteria: stageCriteria(stage),
      });
    }
  }
  return steps;
}
