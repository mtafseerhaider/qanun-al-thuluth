import { FoodExposureInput, type Texture } from '@shared';
import { FoodPreferenceInput } from '@shared/domain/intake';
import type { ExposureLadderStatus, ExposureLadderStrategy } from '@shared/domain/family-modules';

import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { toDbAppError } from '@/lib/supabase/error-mapping';

import type {
  ExposureContext,
  ExposureView,
  FoodFeatures,
  LadderStepDraft,
  LadderView,
} from '../utils/exposure-rules';

/**
 * Picky-eater and autism data through PostgREST and RLS (05 §12.10 to §12.12, §8 food_preferences).
 * `food_exposures` writes go through the outbox (offline-safe; the client id is the row id), so a
 * replay never logs a try twice. Ladders and steps are written online by owners and caregivers.
 */
function client() {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  return supabase;
}

export interface ExposureWrite {
  id: string;
  householdId: string;
  familyMemberId: string;
  ingredientId: string;
  /** Kept on the device for the queued row; never sent (the server label is the ingredient's). */
  foodLabel: string;
  exposedOn: string;
  stage: ExposureView['stage'];
  acceptance: ExposureView['acceptance'];
  context: ExposureContext | null;
  ladderStepId: string | null;
  notes: string | null;
}

export interface IngredientLite extends FoodFeatures {
  nameI18n: Record<string, string>;
}

const INGREDIENT_COLUMNS = 'id, name, name_i18n, textures, color';

interface RawIngredient {
  id: string;
  name: string;
  name_i18n: unknown;
  textures: Texture[] | null;
  color: string | null;
}

function toIngredient(r: RawIngredient, locale: string): IngredientLite {
  const i18n = (r.name_i18n && typeof r.name_i18n === 'object' ? r.name_i18n : {}) as Record<
    string,
    string
  >;
  return {
    id: r.id,
    label: (typeof i18n[locale] === 'string' && i18n[locale]) || r.name,
    nameI18n: i18n,
    textures: r.textures ?? [],
    color: r.color,
  };
}

/** Ingredient search for the food pickers (catalog RLS: active ingredients only). */
export async function searchIngredients(query: string, locale: string): Promise<IngredientLite[]> {
  const q = query.trim().replace(/[%,()]/g, ' ');
  if (q.length < 2) return [];
  const { data, error } = await client()
    .from('ingredients')
    .select(INGREDIENT_COLUMNS)
    .ilike('name', `%${q}%`)
    .order('name')
    .limit(20);
  if (error) throw toDbAppError(error);
  return ((data ?? []) as RawIngredient[]).map((r) => toIngredient(r, locale));
}

export async function fetchIngredients(
  ids: readonly string[],
  locale: string,
): Promise<IngredientLite[]> {
  if (ids.length === 0) return [];
  const { data, error } = await client()
    .from('ingredients')
    .select(INGREDIENT_COLUMNS)
    .in('id', [...ids]);
  if (error) throw toDbAppError(error);
  return ((data ?? []) as RawIngredient[]).map((r) => toIngredient(r, locale));
}

/** A sample of the catalog with sensory features, for client-side chain suggestions. */
export async function fetchChainCatalog(locale: string): Promise<IngredientLite[]> {
  const { data, error } = await client()
    .from('ingredients')
    .select(INGREDIENT_COLUMNS)
    .not('color', 'is', null)
    .eq('halal_status', 'halal')
    .limit(400);
  if (error) throw toDbAppError(error);
  return ((data ?? []) as RawIngredient[]).map((r) => toIngredient(r, locale));
}

/* --- food_exposures ---------------------------------------------------------------------------- */

export async function fetchExposures(
  familyMemberId: string,
  since: string,
  locale: string,
): Promise<ExposureView[]> {
  const { data, error } = await client()
    .from('food_exposures')
    .select(
      'id, family_member_id, ingredient_id, exposed_on, stage, acceptance, context, ladder_step_id, notes, ingredients(name, name_i18n)',
    )
    .eq('family_member_id', familyMemberId)
    .gte('exposed_on', since)
    .order('exposed_on', { ascending: false })
    .limit(500);
  if (error) throw toDbAppError(error);
  return (data ?? []).map((r) => {
    const ing = (r as unknown as { ingredients: { name: string; name_i18n: unknown } | null })
      .ingredients;
    const i18n = (ing?.name_i18n ?? {}) as Record<string, string>;
    return {
      id: r.id,
      familyMemberId: r.family_member_id,
      ingredientId: r.ingredient_id,
      foodLabel: i18n[locale] || ing?.name || '',
      exposedOn: r.exposed_on,
      stage: r.stage,
      acceptance: r.acceptance,
      context: (r.context as ExposureContext | null) ?? null,
      ladderStepId: r.ladder_step_id,
      notes: r.notes,
    };
  });
}

/** Insert with the client id; a replay of the same id is a no-op. */
export async function insertExposure(w: ExposureWrite): Promise<void> {
  const parsed = FoodExposureInput.parse({
    id: w.id,
    ingredient_id: w.ingredientId,
    exposed_on: w.exposedOn,
    stage: w.stage,
    acceptance: w.acceptance,
    context: w.context,
    ladder_step_id: w.ladderStepId,
    notes: w.notes,
  });
  const { error } = await client()
    .from('food_exposures')
    .upsert(
      {
        id: parsed.id,
        household_id: w.householdId,
        family_member_id: w.familyMemberId,
        ingredient_id: parsed.ingredient_id,
        exposed_on: parsed.exposed_on,
        stage: parsed.stage,
        acceptance: parsed.acceptance,
        context: parsed.context ?? null,
        ladder_step_id: parsed.ladder_step_id ?? null,
        notes: parsed.notes ?? null,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    );
  if (error) throw toDbAppError(error);
}

/* --- exposure_ladders and steps ------------------------------------------------------------- */

const LADDER_COLUMNS =
  'id, family_member_id, target_ingredient_id, strategy, status, current_step, updated_at, ingredients(name, name_i18n), exposure_ladder_steps(id, step_no, stage, food_label, bridge_from_ingredient_id, criteria, completed_on)';

interface RawLadder {
  id: string;
  family_member_id: string;
  target_ingredient_id: string;
  strategy: string;
  status: string;
  current_step: number;
  updated_at: string;
  ingredients: { name: string; name_i18n: unknown } | null;
  exposure_ladder_steps: Array<{
    id: string;
    step_no: number;
    stage: LadderStepDraft['stage'];
    food_label: string;
    bridge_from_ingredient_id: string | null;
    criteria: string;
    completed_on: string | null;
  }>;
}

function toLadder(r: RawLadder, locale: string): LadderView {
  const i18n = (r.ingredients?.name_i18n ?? {}) as Record<string, string>;
  return {
    id: r.id,
    familyMemberId: r.family_member_id,
    targetIngredientId: r.target_ingredient_id,
    targetLabel: i18n[locale] || r.ingredients?.name || '',
    strategy: r.strategy as ExposureLadderStrategy,
    status: r.status as ExposureLadderStatus,
    currentStep: r.current_step,
    updatedAt: r.updated_at,
    steps: [...(r.exposure_ladder_steps ?? [])]
      .sort((a, b) => a.step_no - b.step_no)
      .map((s) => ({
        id: s.id,
        stepNo: s.step_no,
        stage: s.stage,
        foodLabel: s.food_label,
        bridgeFromIngredientId: s.bridge_from_ingredient_id,
        criteria: s.criteria,
        completedOn: s.completed_on,
      })),
  };
}

export async function fetchLadders(familyMemberId: string, locale: string): Promise<LadderView[]> {
  const { data, error } = await client()
    .from('exposure_ladders')
    .select(LADDER_COLUMNS)
    .eq('family_member_id', familyMemberId)
    .is('deleted_at', null)
    .order('updated_at', { ascending: false });
  if (error) throw toDbAppError(error);
  return ((data ?? []) as unknown as RawLadder[]).map((r) => toLadder(r, locale));
}

export async function fetchLadder(ladderId: string, locale: string): Promise<LadderView | null> {
  const { data, error } = await client()
    .from('exposure_ladders')
    .select(LADDER_COLUMNS)
    .eq('id', ladderId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw toDbAppError(error);
  return data ? toLadder(data as unknown as RawLadder, locale) : null;
}

/** Creates a ladder with its steps (client ids, so a retry after a lost response is safe). */
export async function createLadder(input: {
  id: string;
  householdId: string;
  familyMemberId: string;
  targetIngredientId: string;
  strategy: ExposureLadderStrategy;
  steps: readonly LadderStepDraft[];
}): Promise<void> {
  const db = client();
  const { error } = await db.from('exposure_ladders').insert({
    id: input.id,
    household_id: input.householdId,
    family_member_id: input.familyMemberId,
    target_ingredient_id: input.targetIngredientId,
    strategy: input.strategy,
  });
  if (error) {
    const mapped = toDbAppError(error);
    // 23505 on our own id is a retry; on the one-active-target index it is a real conflict.
    if (mapped.code !== 'CONFLICT' || !(await ladderExists(input.id))) throw mapped;
  }
  await replaceSteps(input.id, input.householdId, input.steps);
}

async function ladderExists(id: string): Promise<boolean> {
  const { data } = await client().from('exposure_ladders').select('id').eq('id', id).maybeSingle();
  return Boolean(data);
}

/** Makes the ladder's steps equal `steps` (steps are hard-deletable, 05 §11). */
export async function replaceSteps(
  ladderId: string,
  householdId: string,
  steps: readonly LadderStepDraft[],
): Promise<void> {
  const db = client();
  const { error: delError } = await db
    .from('exposure_ladder_steps')
    .delete()
    .eq('ladder_id', ladderId);
  if (delError) throw toDbAppError(delError);
  if (steps.length === 0) return;
  const { error } = await db.from('exposure_ladder_steps').insert(
    steps.map((s) => ({
      ladder_id: ladderId,
      household_id: householdId,
      step_no: s.stepNo,
      stage: s.stage,
      food_label: s.foodLabel.trim().slice(0, 120),
      bridge_from_ingredient_id: s.bridgeFromIngredientId,
      criteria: s.criteria.trim().slice(0, 500),
      completed_on: s.completedOn ?? null,
    })),
  );
  if (error) throw toDbAppError(error);
}

export async function updateLadder(
  ladderId: string,
  patch: { status?: ExposureLadderStatus; currentStep?: number },
): Promise<void> {
  const update: { status?: string; current_step?: number } = {};
  if (patch.status) update.status = patch.status;
  if (patch.currentStep !== undefined) update.current_step = patch.currentStep;
  const { error } = await client().from('exposure_ladders').update(update).eq('id', ladderId);
  if (error) throw toDbAppError(error);
}

export async function completeStep(stepId: string, on: string | null): Promise<void> {
  const { error } = await client()
    .from('exposure_ladder_steps')
    .update({ completed_on: on })
    .eq('id', stepId);
  if (error) throw toDbAppError(error);
}

export async function deleteLadder(ladderId: string): Promise<void> {
  const { error } = await client().rpc('soft_delete', {
    p_table: 'exposure_ladders',
    p_id: ladderId,
  });
  if (error) throw toDbAppError(error);
}

/* --- Safe foods (food_preferences.is_safe_food) and sensory profile ------------------------- */

export interface SafeFoodView {
  id: string;
  label: string;
  ingredientId: string | null;
  strength: number;
  createdAt: string;
}

export async function fetchSafeFoods(familyMemberId: string): Promise<SafeFoodView[]> {
  const { data, error } = await client()
    .from('food_preferences')
    .select('id, label, ingredient_id, strength, created_at')
    .eq('family_member_id', familyMemberId)
    .eq('is_safe_food', true)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (error) throw toDbAppError(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    label: r.label,
    ingredientId: r.ingredient_id,
    strength: r.strength,
    createdAt: r.created_at,
  }));
}

export async function upsertSafeFood(input: {
  id: string;
  householdId: string;
  familyMemberId: string;
  label: string;
  ingredientId: string | null;
  strength: number;
}): Promise<void> {
  const parsed = FoodPreferenceInput.parse({
    label: input.label,
    ingredient_id: input.ingredientId,
    strength: input.strength,
    is_safe_food: true,
  });
  const { error } = await client()
    .from('food_preferences')
    .upsert(
      {
        id: input.id,
        household_id: input.householdId,
        family_member_id: input.familyMemberId,
        label: parsed.label,
        ingredient_id: parsed.ingredient_id ?? null,
        strength: parsed.strength,
        is_safe_food: true,
      },
      { onConflict: 'id' },
    );
  if (error) throw toDbAppError(error);
}

/**
 * "No longer safe" (02 §7.10.3): never deleted silently. The safe food is soft-deleted and kept as a
 * dislike, because losing a safe food is important information for the feeding team.
 */
export async function markNoLongerSafe(input: {
  safeFood: SafeFoodView;
  householdId: string;
  familyMemberId: string;
  dislikeId: string;
}): Promise<void> {
  const db = client();
  const { error: insertError } = await db.from('food_dislikes').upsert(
    {
      id: input.dislikeId,
      household_id: input.householdId,
      family_member_id: input.familyMemberId,
      label: input.safeFood.label,
      ingredient_id: input.safeFood.ingredientId,
      reason: 'other',
    },
    { onConflict: 'id' },
  );
  if (insertError) throw toDbAppError(insertError);
  const { error } = await db.rpc('soft_delete', {
    p_table: 'food_preferences',
    p_id: input.safeFood.id,
  });
  if (error) throw toDbAppError(error);
}

export interface SensoryProfileView {
  id: string | null;
  textureLikes: Texture[];
  textureAvoids: Texture[];
  colorSensitivities: string[];
  presentationPrefs: Record<string, unknown>;
  temperaturePrefs: string[];
  brandRigidity: boolean;
}

export async function fetchSensoryProfile(
  familyMemberId: string,
): Promise<SensoryProfileView | null> {
  const { data, error } = await client()
    .from('sensory_profiles')
    .select(
      'id, texture_likes, texture_avoids, color_sensitivities, presentation_prefs, temperature_prefs, brand_rigidity',
    )
    .eq('family_member_id', familyMemberId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw toDbAppError(error);
  if (!data) return null;
  return {
    id: data.id,
    textureLikes: data.texture_likes ?? [],
    textureAvoids: data.texture_avoids ?? [],
    colorSensitivities: data.color_sensitivities ?? [],
    presentationPrefs: (data.presentation_prefs ?? {}) as Record<string, unknown>,
    temperaturePrefs: data.temperature_prefs ?? [],
    brandRigidity: data.brand_rigidity,
  };
}

/* --- Coaching tips (verified only), the picky summary RPC and the plan's exposure pairs --------- */

export interface CoachingTipView {
  id: string;
  code: string;
  body: string;
  ageMin: number;
  ageMax: number;
}

export async function fetchCoachingTips(
  module: 'picky' | 'autism',
  locale: string,
): Promise<CoachingTipView[]> {
  const { data, error } = await client()
    .from('coaching_tips')
    .select('id, code, body_i18n, age_min_months, age_max_months')
    .eq('module', module)
    .eq('is_active', true)
    .eq('review_status', 'verified')
    .limit(100);
  if (error) throw toDbAppError(error);
  return (data ?? []).flatMap((r) => {
    const body = (r.body_i18n ?? {}) as Record<string, string>;
    const text = body[locale] || body.en;
    return text
      ? [{ id: r.id, code: r.code, body: text, ageMin: r.age_min_months, ageMax: r.age_max_months }]
      : [];
  });
}

export interface PickySummary {
  acceptedFoodCount: number;
  mealAcceptanceRate: number | null;
  exposures: number;
  newAccepted: number;
}

export async function fetchPickySummary(
  familyMemberId: string,
  days: number,
): Promise<PickySummary | null> {
  const { data, error } = await client().rpc('picky_acceptance_summary', {
    p_member: familyMemberId,
    p_days: days,
  });
  if (error) throw toDbAppError(error);
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        accepted_food_count: number;
        meal_acceptance_rate: number | null;
        exposures: number;
        new_accepted: number;
      }
    | undefined;
  if (!row) return null;
  return {
    acceptedFoodCount: Number(row.accepted_food_count ?? 0),
    mealAcceptanceRate: row.meal_acceptance_rate === null ? null : Number(row.meal_acceptance_rate),
    exposures: Number(row.exposures ?? 0),
    newAccepted: Number(row.new_accepted ?? 0),
  };
}

/** Acceptance scores of a member's planned servings since a date (for the weekly chart). */
export async function fetchServingAcceptance(
  familyMemberId: string,
  since: string,
): Promise<Array<{ date: string; acceptance: ExposureView['acceptance'] }>> {
  const { data, error } = await client()
    .from('daily_meal_servings')
    .select('acceptance, daily_meals!inner(plan_date)')
    .eq('family_member_id', familyMemberId)
    .not('acceptance', 'is', null)
    .gte('daily_meals.plan_date', since)
    .limit(1000);
  if (error) throw toDbAppError(error);
  return (data ?? []).flatMap((r) => {
    const row = r as unknown as {
      acceptance: ExposureView['acceptance'] | null;
      daily_meals: { plan_date: string } | null;
    };
    return row.acceptance && row.daily_meals
      ? [{ date: row.daily_meals.plan_date, acceptance: row.acceptance }]
      : [];
  });
}

/** Generation metadata of the household's active or most recent plans (exposure pairs live there). */
export async function fetchPlanMeta(householdId: string): Promise<unknown[]> {
  const { data, error } = await client()
    .from('meal_plans')
    .select('generation_meta, status, start_date')
    .eq('household_id', householdId)
    .in('status', ['active', 'draft'])
    .is('deleted_at', null)
    .order('start_date', { ascending: false })
    .limit(3);
  if (error) throw toDbAppError(error);
  return (data ?? []).map((r) => r.generation_meta);
}
