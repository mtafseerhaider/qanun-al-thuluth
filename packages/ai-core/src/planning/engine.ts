import { assemblePlan } from './assemble.ts';
import { solveDeterministic } from './candidates.ts';
import type { CandidateSetWithPool } from './candidates.ts';
import { hardViolations, validatePlan } from './validate.ts';
import type { Catalog, DraftPlan, PlanRequest, Violation } from './types.ts';

export interface Evaluated {
  choices: Map<string, string>;
  draft: DraftPlan;
  violations: Violation[];
}

/** Assemble then validate one set of choices (S5 + S6 in 12 §11). */
export function evaluateChoices(
  req: PlanRequest,
  catalog: Catalog,
  sets: readonly CandidateSetWithPool[],
  choices: ReadonlyMap<string, string>,
): Evaluated {
  const slots = sets.map((s) => s.slot);
  const draft = assemblePlan(req, catalog, slots, choices);
  return { choices: new Map(choices), draft, violations: validatePlan(draft, req, catalog) };
}

/**
 * Deterministic fallback (12 §11 S7): keep every slot that passed, re-solve the failing slots from
 * the engine's own pools, and re-solve the whole plan when a plan-wide rule still fails. Never
 * relaxes a hard rule; the result's `violations` say whether it is usable.
 */
export function fallbackChoices(
  req: PlanRequest,
  catalog: Catalog,
  sets: readonly CandidateSetWithPool[],
  current: Evaluated,
  maxRounds = 3,
): Evaluated & { fallbackSlots: string[] } {
  let result = current;
  const fallbackSlots = new Set<string>();
  for (let round = 0; round < maxRounds; round++) {
    const hard = hardViolations(result.violations);
    if (!hard.length) break;
    const failing = new Set(hard.map((v) => v.slotRef).filter((x): x is string => !!x));
    const planWide = hard.some((v) => !v.slotRef);
    // A plan-wide rule (weekly limits, vitamin K spread) re-solves everything; otherwise only the
    // failing slots are re-solved around the passing ones.
    const fixed = new Map<string, string>();
    if (!planWide && round < maxRounds - 1) {
      for (const [slot, meal] of result.choices) if (!failing.has(slot)) fixed.set(slot, meal);
    }
    for (const s of sets) if (!fixed.has(s.slot.ref)) fallbackSlots.add(s.slot.ref);
    // Unknown or out-of-set picks are dropped by giving the solver only valid fixed ids.
    for (const [slot, meal] of fixed) {
      const set = sets.find((s) => s.slot.ref === slot);
      if (!set?.pool.includes(meal)) fixed.delete(slot);
    }
    result = evaluateChoices(req, catalog, sets, solveDeterministic(sets, req, catalog, fixed));
  }
  return { ...result, fallbackSlots: [...fallbackSlots] };
}

/** Engine-only plan: the deterministic solver, validated, with fallback rounds. */
export function planDeterministic(
  req: PlanRequest,
  catalog: Catalog,
  sets: readonly CandidateSetWithPool[],
  fixed: ReadonlyMap<string, string> = new Map(),
): Evaluated & { fallbackSlots: string[] } {
  const first = evaluateChoices(req, catalog, sets, solveDeterministic(sets, req, catalog, fixed));
  return fallbackChoices(req, catalog, sets, first);
}
