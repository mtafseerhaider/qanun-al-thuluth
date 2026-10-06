import type { AcceptanceScore, LifeStage, MealStatus, MealType } from '@shared';

import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { toDbAppError } from '@/lib/supabase/error-mapping';

import { parseComponents, parsePlateSplit, type MealComponent } from '../utils/meal-parsing';

/**
 * Planned meals and per-member servings (05 §11.3 to §11.4, 06 §3.3). Rows are written by the plan
 * functions; the client reads them, updates serving status through the outbox, and swaps a slot
 * with `swap_daily_meal` (DB lane, Sprint 3).
 */
function client() {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  return supabase;
}

export type Adaptation = 'none' | 'autism' | 'picky' | 'allergy' | 'pregnancy';

export interface MealSummary {
  id: string;
  title: string;
  titleI18n: unknown;
  mealType: MealType;
  plateSplit: { veg_fruit: number; protein: number; carb: number } | null;
  components: MealComponent[];
}

export interface PortionView {
  householdMeasure: string;
  householdMeasureI18n: unknown;
  grams: number;
  /** Stored for adults only; never displayed for minors (02 §1.1). */
  kcal: number | null;
  lifeStage: LifeStage;
}

export interface ServingView {
  id: string;
  dailyMealId: string;
  familyMemberId: string;
  status: MealStatus;
  acceptance: AcceptanceScore | null;
  adaptation: Adaptation;
  adaptedMeal: { id: string; title: string; titleI18n: unknown } | null;
  portion: PortionView | null;
  loggedAt: string | null;
  updatedAt: string;
}

export interface DailyMealView {
  id: string;
  mealPlanId: string;
  householdId: string;
  planDate: string;
  mealType: MealType;
  slot: number;
  scheduledTime: string | null;
  notes: string | null;
  swappedFromMealId: string | null;
  meal: MealSummary;
  servings: ServingView[];
}

const DAILY_MEAL_COLUMNS = `
  id, meal_plan_id, household_id, plan_date, meal_type, slot, scheduled_time, notes, swapped_from_meal_id,
  meal:meals!daily_meals_meal_id_fkey(id, title, title_i18n, meal_type, plate_split, components),
  servings:daily_meal_servings(id, daily_meal_id, family_member_id, status, acceptance, adaptation, logged_at, updated_at,
    adapted:meals!daily_meal_servings_adapted_meal_id_fkey(id, title, title_i18n),
    portion:portions(household_measure, household_measure_i18n, grams, kcal, life_stage))
`;

interface RawMeal {
  id: string;
  title: string;
  title_i18n: unknown;
  meal_type: MealType;
  plate_split: unknown;
  components: unknown;
}

interface RawServing {
  id: string;
  daily_meal_id: string;
  family_member_id: string;
  status: MealStatus;
  acceptance: AcceptanceScore | null;
  adaptation: Adaptation;
  logged_at: string | null;
  updated_at: string;
  adapted: { id: string; title: string; title_i18n: unknown } | null;
  portion: {
    household_measure: string;
    household_measure_i18n: unknown;
    grams: number;
    kcal: number | null;
    life_stage: LifeStage;
  } | null;
}

interface RawDailyMeal {
  id: string;
  meal_plan_id: string;
  household_id: string;
  plan_date: string;
  meal_type: MealType;
  slot: number;
  scheduled_time: string | null;
  notes: string | null;
  swapped_from_meal_id?: string | null;
  meal: RawMeal | null;
  servings: RawServing[] | null;
}

export function toMealSummary(m: RawMeal): MealSummary {
  return {
    id: m.id,
    title: m.title,
    titleI18n: m.title_i18n,
    mealType: m.meal_type,
    plateSplit: parsePlateSplit(m.plate_split),
    components: parseComponents(m.components),
  };
}

export function toDailyMealView(r: RawDailyMeal): DailyMealView | null {
  if (!r.meal) return null; // the base meal is hidden (unverified catalog row); skip the slot
  return {
    id: r.id,
    mealPlanId: r.meal_plan_id,
    householdId: r.household_id,
    planDate: r.plan_date,
    mealType: r.meal_type,
    slot: r.slot,
    scheduledTime: r.scheduled_time,
    notes: r.notes,
    swappedFromMealId: r.swapped_from_meal_id ?? null,
    meal: toMealSummary(r.meal),
    servings: (r.servings ?? []).map((s) => ({
      id: s.id,
      dailyMealId: s.daily_meal_id,
      familyMemberId: s.family_member_id,
      status: s.status,
      acceptance: s.acceptance,
      adaptation: s.adaptation,
      adaptedMeal: s.adapted
        ? { id: s.adapted.id, title: s.adapted.title, titleI18n: s.adapted.title_i18n }
        : null,
      portion: s.portion
        ? {
            householdMeasure: s.portion.household_measure,
            householdMeasureI18n: s.portion.household_measure_i18n,
            grams: Number(s.portion.grams),
            kcal: s.portion.kcal === null ? null : Number(s.portion.kcal),
            lifeStage: s.portion.life_stage,
          }
        : null,
      loggedAt: s.logged_at,
      updatedAt: s.updated_at,
    })),
  };
}

/** Planned meals of one plan between two household-local dates (inclusive). */
export async function fetchDailyMeals(
  householdId: string,
  mealPlanId: string,
  from: string,
  to: string,
): Promise<DailyMealView[]> {
  const { data, error } = await client()
    .from('daily_meals')
    .select(DAILY_MEAL_COLUMNS)
    .eq('household_id', householdId)
    .eq('meal_plan_id', mealPlanId)
    .gte('plan_date', from)
    .lte('plan_date', to)
    .order('plan_date', { ascending: true })
    .order('scheduled_time', { ascending: true })
    .order('slot', { ascending: true });
  if (error) throw toDbAppError(error);
  return ((data ?? []) as unknown as RawDailyMeal[]).flatMap((r) => {
    const v = toDailyMealView(r);
    return v ? [v] : [];
  });
}

export async function fetchDailyMeal(dailyMealId: string): Promise<DailyMealView | null> {
  const { data, error } = await client()
    .from('daily_meals')
    .select(DAILY_MEAL_COLUMNS)
    .eq('id', dailyMealId)
    .maybeSingle();
  if (error) throw toDbAppError(error);
  return data ? toDailyMealView(data as unknown as RawDailyMeal) : null;
}

/** Payload of an outbox `serving.status` entry. */
export interface ServingStatusWrite {
  servingId: string;
  householdId: string;
  status: MealStatus;
  acceptance: AcceptanceScore | null;
  /** Client time of the action (ISO): becomes `logged_at` and the last-write-wins guard. */
  at: string;
}

/**
 * Sets a serving's status (06 §3.3). Idempotent by value; the `logged_at` guard makes it last write
 * wins by client time (09 §4.1): an older replay never overwrites a newer log from another device.
 * Reverting to `planned` clears `logged_at`.
 */
export async function updateServingStatus(w: ServingStatusWrite): Promise<void> {
  const { error } = await client()
    .from('daily_meal_servings')
    .update({
      status: w.status,
      acceptance: w.status === 'planned' ? null : w.acceptance,
      logged_at: w.status === 'planned' ? null : w.at,
    })
    .eq('id', w.servingId)
    .or(`logged_at.is.null,logged_at.lte.${w.at}`);
  if (error) throw toDbAppError(error);
}

export interface MealAlternativeView {
  id: string;
  reason: 'allergy' | 'budget' | 'autism' | 'picky' | 'season' | 'preference';
  notes: string | null;
  meal: MealSummary;
}

/** Catalog swaps for a meal (05 §7.10); only verified alternatives are visible through RLS. */
export async function fetchMealAlternatives(mealId: string): Promise<MealAlternativeView[]> {
  const { data, error } = await client()
    .from('meal_alternatives')
    .select(
      'id, reason, notes, alternative:meals!meal_alternatives_alternative_meal_id_fkey(id, title, title_i18n, meal_type, plate_split, components)',
    )
    .eq('meal_id', mealId);
  if (error) throw toDbAppError(error);
  return (
    (data ?? []) as unknown as Array<{
      id: string;
      reason: MealAlternativeView['reason'];
      notes: string | null;
      alternative: RawMeal | null;
    }>
  ).flatMap((r) =>
    r.alternative
      ? [{ id: r.id, reason: r.reason, notes: r.notes, meal: toMealSummary(r.alternative) }]
      : [],
  );
}

/** Free swap through PostgREST (24 S3-13): `swap_daily_meal` re-points the slot and its planned servings. */
export async function swapDailyMeal(dailyMealId: string, alternativeMealId: string): Promise<void> {
  const { error } = await client().rpc('swap_daily_meal', {
    p_daily_meal_id: dailyMealId,
    p_alternative_meal_id: alternativeMealId,
  });
  if (error) throw toDbAppError(error);
}

/** Whether the household's owner has Premium (server truth; UI gating only, 17). */
export async function fetchHouseholdPremium(householdId: string): Promise<boolean> {
  const { data, error } = await client().rpc('household_has_premium', {
    p_household_id: householdId,
  });
  if (error) throw toDbAppError(error);
  return data === true;
}

/** `activate_meal_plan` (05 §22.12): draft to active, archiving the previous active plan of the kind. */
export async function activateMealPlan(mealPlanId: string): Promise<void> {
  const { error } = await client().rpc('activate_meal_plan', { p_meal_plan_id: mealPlanId });
  if (error) throw toDbAppError(error);
}

export interface RecipeTitle {
  id: string;
  title: string;
  titleI18n: unknown;
}

/** Titles of the recipes a meal is made of (components with `recipe_id`). */
export async function fetchRecipeTitles(recipeIds: readonly string[]): Promise<RecipeTitle[]> {
  if (recipeIds.length === 0) return [];
  const { data, error } = await client()
    .from('recipes')
    .select('id, title, title_i18n')
    .in('id', [...recipeIds]);
  if (error) throw toDbAppError(error);
  return ((data ?? []) as unknown as Array<{ id: string; title: string; title_i18n: unknown }>).map(
    (r) => ({ id: r.id, title: r.title, titleI18n: r.title_i18n }),
  );
}
