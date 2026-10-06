/**
 * Periodic reassessment diff (FR-AI-11, S6-15). Compares the targets of a member's previous
 * assessment with freshly recomputed ones and lists what changed and why, for the app's
 * "targets updated" card. Under 18 only the fluid target can ever appear: no kcal, macro or weight
 * numbers (00 §10.3), whatever the inputs say.
 */

export const REASSESS_INTERVAL_DAYS = 28;

export interface TargetSnapshot {
  minor: boolean;
  /** Adults only; always null for minors. */
  energyKcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fatG: number | null;
  fiberG: number | null;
  hydrationMl: number | null;
}

export interface InputSnapshot {
  ageMonths: number | null;
  lifeStage: string | null;
  weightKg: number | null;
  heightCm: number | null;
  activityLevel: string | null;
  goals: readonly string[];
  modules: readonly string[];
  climate: string | null;
}

export type DiffTarget =
  'energy_kcal' | 'protein_g' | 'carbs_g' | 'fat_g' | 'fiber_g' | 'hydration_ml';
export type DiffReason =
  | 'weight_changed'
  | 'height_changed'
  | 'activity_changed'
  | 'life_stage_changed'
  | 'turned_adult'
  | 'goals_changed'
  | 'modules_changed'
  | 'climate_changed'
  | 'age';

export interface TargetChange {
  target: DiffTarget;
  from: number | null;
  to: number | null;
  unit: 'kcal' | 'g' | 'ml';
}

export interface TargetsDiff {
  changed: boolean;
  items: TargetChange[];
  reasons: DiffReason[];
  /** True when the member is under 18: the items hold the fluid target only. */
  minor: boolean;
}

/** Smallest change worth telling the family about. */
const THRESHOLD: Record<DiffTarget, number> = {
  energy_kcal: 50,
  protein_g: 5,
  carbs_g: 10,
  fat_g: 5,
  fiber_g: 2,
  hydration_ml: 100,
};

const UNIT: Record<DiffTarget, TargetChange['unit']> = {
  energy_kcal: 'kcal',
  protein_g: 'g',
  carbs_g: 'g',
  fat_g: 'g',
  fiber_g: 'g',
  hydration_ml: 'ml',
};

const ADULT_ONLY: readonly DiffTarget[] = [
  'energy_kcal',
  'protein_g',
  'carbs_g',
  'fat_g',
  'fiber_g',
];

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v !== '' && Number.isFinite(Number(v))
      ? Number(v)
      : null;

/**
 * Reads the stored `ai_assessments` target columns. A child's row never yields energy or macro
 * numbers, even if an internal estimate was stored (display false).
 */
export function snapshotFromAssessment(row: {
  energy_targets: unknown;
  macro_targets: unknown;
  hydration_targets: unknown;
  minor: boolean;
}): TargetSnapshot {
  const e = (row.energy_targets ?? {}) as Record<string, unknown>;
  const m = (row.macro_targets ?? {}) as Record<string, unknown>;
  const h = (row.hydration_targets ?? {}) as Record<string, unknown>;
  const adult = !row.minor && e.display === true;
  return {
    minor: row.minor,
    energyKcal: adult ? num(e.kcal_per_day) : null,
    proteinG: adult ? num(m.protein_g) : null,
    carbsG: adult ? num(m.carbs_g) : null,
    fatG: adult ? num(m.fat_g) : null,
    fiberG: adult ? num(m.fiber_g) : null,
    hydrationMl: num(h.daily_ml),
  };
}

const value = (s: TargetSnapshot, t: DiffTarget): number | null =>
  ({
    energy_kcal: s.energyKcal,
    protein_g: s.proteinG,
    carbs_g: s.carbsG,
    fat_g: s.fatG,
    fiber_g: s.fiberG,
    hydration_ml: s.hydrationMl,
  })[t];

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

export function targetsDiff(
  prev: TargetSnapshot | null,
  next: TargetSnapshot,
  inputs: { prev: InputSnapshot | null; next: InputSnapshot },
): TargetsDiff {
  const minor = next.minor;
  const targets: DiffTarget[] = minor
    ? ['hydration_ml']
    : ['energy_kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'hydration_ml'];
  const items: TargetChange[] = [];
  for (const t of targets) {
    const from = prev ? value(prev, t) : null;
    const to = value(next, t);
    if (to === null && from === null) continue;
    // A child's previous row cannot leak an adult-only number into the diff (turned 18 included).
    const safeFrom = prev?.minor && ADULT_ONLY.includes(t) ? null : from;
    if (safeFrom !== null && to !== null && Math.abs(to - safeFrom) < THRESHOLD[t]) continue;
    items.push({ target: t, from: safeFrom, to, unit: UNIT[t] });
  }
  const reasons: DiffReason[] = [];
  const p = inputs.prev;
  const n = inputs.next;
  if (p) {
    if (prev?.minor && !minor) reasons.push('turned_adult');
    else if (p.lifeStage !== n.lifeStage) reasons.push('life_stage_changed');
    // Under 18 the body measures stay inside the growth module; they are not a "reason" here.
    if (!minor && p.weightKg !== n.weightKg) reasons.push('weight_changed');
    if (!minor && p.heightCm !== n.heightCm) reasons.push('height_changed');
    if (p.activityLevel !== n.activityLevel) reasons.push('activity_changed');
    if (!sameSet(p.goals, n.goals)) reasons.push('goals_changed');
    if (!sameSet(p.modules, n.modules)) reasons.push('modules_changed');
    if (p.climate !== n.climate) reasons.push('climate_changed');
  }
  if (items.length && !reasons.length) reasons.push('age');
  return { changed: items.length > 0, items, reasons, minor };
}

/** Safety net for tests and evals: a child's diff never carries an energy, macro or weight number. */
export function diffHasChildTargets(diff: TargetsDiff): boolean {
  return diff.minor && diff.items.some((i) => i.unit !== 'ml');
}

/** True when the latest assessment is at least `REASSESS_INTERVAL_DAYS` old. */
export function reassessmentDue(lastAssessedAt: string, now: Date): boolean {
  return now.getTime() - Date.parse(lastAssessedAt) >= REASSESS_INTERVAL_DAYS * 86_400_000;
}
