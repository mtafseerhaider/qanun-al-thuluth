import type { ExposureStage } from '@thuluth/shared';

import type { CatalogIngredient, PlanMember } from '../planning/types.ts';
import { MATCH_THRESHOLD, nameSimilarity } from '../vision/meal.ts';
import { chainLadderSteps, exposureLadderSteps, nodeOf, planFoodChain } from './chaining.ts';
import type { ChainResult, FoodNode, LadderStepProposal, SensoryLite } from './chaining.ts';

/**
 * `create_exposure_ladder` proposal (12 §8.12, 15 §3.5-3.6). Pure: resolves the target food in
 * the catalog, refuses unsafe targets (allergens, non-halal), and builds the ladder or food chain
 * steps. Nothing is written: the parent reviews and saves the proposal in the app.
 */

export interface LadderProposalInput {
  member: PlanMember;
  targetFood: string;
  strategy: 'exposure_ladder' | 'food_chaining';
  startStage?: ExposureStage | undefined;
  bridgeFromSafeFood?: string | null | undefined;
  ingredients: ReadonlyMap<string, CatalogIngredient>;
  sensory?: SensoryLite | null | undefined;
  allowMashbooh: boolean;
  /** Severe allergens anywhere in the household (cross-contact). */
  severeAllergenCodes?: readonly string[] | undefined;
}

export interface LadderProposal {
  familyMemberId: string;
  targetFood: string;
  targetIngredientId: string | null;
  strategy: 'exposure_ladder' | 'food_chaining';
  /** Set when food chaining was asked for but no gentle chain exists. */
  fallback: 'no_safe_food' | 'no_chain' | null;
  chain: Array<{ ingredientId: string; label: string }>;
  steps: LadderStepProposal[];
  notes: string[];
}

export type LadderProposalResult =
  | { ok: true; proposal: LadderProposal }
  | { ok: false; code: 'UNSAFE_TARGET' | 'ALREADY_SAFE'; message: string };

const NOT_A_FOOD_STEP = new Set(['oil_fat', 'spice_herb', 'sweetener', 'condiment', 'beverage']);

export function resolveIngredient(
  label: string,
  ingredients: ReadonlyMap<string, CatalogIngredient>,
): CatalogIngredient | null {
  const q = label.trim().toLowerCase();
  let best: { ing: CatalogIngredient; score: number } | null = null;
  for (const ing of ingredients.values()) {
    const name = ing.name.toLowerCase();
    const score = name === q ? 2 : nameSimilarity(name, q);
    if (!best || score > best.score || (score === best.score && ing.id < best.ing.id))
      best = { ing, score };
  }
  return best && best.score >= MATCH_THRESHOLD ? best.ing : null;
}

function safeIngredient(ing: CatalogIngredient, input: LadderProposalInput): boolean {
  if (ing.halalStatus === 'haram') return false;
  if (ing.halalStatus !== 'halal' && !input.allowMashbooh) return false;
  const own = new Set(input.member.allergies.map((a) => a.allergenCode));
  const severe = new Set(input.severeAllergenCodes ?? []);
  return !ing.allergenCodes.some((c) => own.has(c) || severe.has(c));
}

export function proposeExposureLadder(input: LadderProposalInput): LadderProposalResult {
  const m = input.member;
  const label = input.targetFood
    .replace(/[<>\n\r]/g, ' ')
    .trim()
    .slice(0, 100);
  const target = resolveIngredient(label, input.ingredients);
  if (target && !safeIngredient(target, input)) {
    return {
      ok: false,
      code: 'UNSAFE_TARGET',
      message:
        'This food is not safe for this child (an allergen in the family, or not halal). Do not build a ladder for it; suggest choosing a different food.',
    };
  }
  if (target && m.safeFoods.some((s) => s.ingredientId === target.id)) {
    return {
      ok: false,
      code: 'ALREADY_SAFE',
      message:
        'This is already one of the child’s safe foods. Celebrate that; no ladder is needed.',
    };
  }
  const notes: string[] = [
    'Offer the step food 3 to 5 times a week beside a safe food, calmly. The child decides whether and how much; looking and touching count.',
    'You decide when to move to the next step. Stepping back on a hard day is fine.',
  ];
  if (m.ageMonths < 60)
    notes.push(
      'Under 5: offer soft, small pieces; no whole nuts, whole grapes or hard raw carrot.',
    );
  if (target?.category === 'nut_seed' && m.ageMonths < 60)
    notes.push('For nuts under 5, offer only finely ground nuts or a thin nut butter.');

  const targetLabel = target?.name ?? label;
  const ladder = (fallback: LadderProposal['fallback']): LadderProposalResult => ({
    ok: true,
    proposal: {
      familyMemberId: m.id,
      targetFood: targetLabel,
      targetIngredientId: target?.id ?? null,
      strategy: 'exposure_ladder',
      fallback,
      chain: [],
      steps: exposureLadderSteps(targetLabel, input.startStage),
      notes,
    },
  });
  if (input.strategy === 'exposure_ladder') return ladder(null);
  if (!target) return ladder('no_chain');

  // Safe starting points: the named safe food, else every safe food linked to an ingredient.
  const safeIngs = m.safeFoods
    .map((s) => (s.ingredientId ? input.ingredients.get(s.ingredientId) : undefined))
    .filter((x): x is CatalogIngredient => !!x && safeIngredient(x, input));
  let starts: FoodNode[] = safeIngs.map(nodeOf);
  if (input.bridgeFromSafeFood) {
    const named = input.bridgeFromSafeFood.toLowerCase();
    const match = m.safeFoods.find(
      (s) =>
        s.label.toLowerCase() === named ||
        nameSimilarity(s.label.toLowerCase(), named) >= MATCH_THRESHOLD,
    );
    const ing = match?.ingredientId ? input.ingredients.get(match.ingredientId) : undefined;
    if (ing && safeIngredient(ing, input)) starts = [nodeOf(ing)];
  }
  if (!starts.length) return ladder('no_safe_food');

  const disliked = new Set(m.dislikes.map((d) => d.ingredientId).filter((x): x is string => !!x));
  const candidates = [...input.ingredients.values()]
    .filter(
      (ing) =>
        !NOT_A_FOOD_STEP.has(ing.category) &&
        !disliked.has(ing.id) &&
        safeIngredient(ing, input) &&
        !(m.ageMonths < 60 && ing.category === 'nut_seed'),
    )
    .map(nodeOf);
  const chain: ChainResult | null = planFoodChain(
    starts,
    nodeOf(target),
    candidates,
    input.sensory,
  );
  if (!chain) return ladder('no_chain');
  return {
    ok: true,
    proposal: {
      familyMemberId: m.id,
      targetFood: targetLabel,
      targetIngredientId: target.id,
      strategy: 'food_chaining',
      fallback: null,
      chain: chain.foods.map((f) => ({ ingredientId: f.id, label: f.label })),
      steps: chainLadderSteps(chain, input.startStage),
      notes,
    },
  };
}
