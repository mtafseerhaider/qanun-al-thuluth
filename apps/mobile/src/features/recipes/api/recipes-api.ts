import type { LifeStage } from '@shared';

import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { toDbAppError } from '@/lib/supabase/error-mapping';

/**
 * Recipe detail (05 §7.7 to §7.9, 24 S3-09). RLS returns only verified global recipes (or the
 * household's own); ingredients carry halal status and the Sunnah-food flag; Sunnah sources come
 * from `foods_in_narrations`, which inherits the verified filter of `islamic_sources`.
 */
function client() {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  return supabase;
}

export type HalalStatus = 'halal' | 'haram' | 'mashbooh' | 'depends_on_source';

export interface RecipeStep {
  n: number;
  textI18n: unknown;
  timerMin: number | null;
}

export interface RecipeIngredientView {
  id: string;
  ingredientId: string;
  name: string;
  nameI18n: unknown;
  quantity: number;
  unit: string;
  grams: number;
  optional: boolean;
  prepNote: string | null;
  halalStatus: HalalStatus;
  isSunnahFood: boolean;
}

export interface RecipePortionView {
  lifeStage: LifeStage;
  tier: string;
  householdMeasure: string;
  householdMeasureI18n: unknown;
  grams: number;
}

export interface RecipeNutrition {
  kcal: number | null;
  proteinG: number | null;
  carbsG: number | null;
  fiberG: number | null;
  fatG: number | null;
  sodiumMg: number | null;
  ironMg: number | null;
  calciumMg: number | null;
}

export interface RecipeView {
  id: string;
  title: string;
  titleI18n: unknown;
  servings: number;
  prepMin: number;
  cookMin: number;
  steps: RecipeStep[];
  nutrition: RecipeNutrition;
  kidFriendly: boolean;
  autismFriendly: boolean;
  ramadanSuitable: boolean;
  reviewStatus: string;
  source: string;
  ingredients: RecipeIngredientView[];
  portions: RecipePortionView[];
}

const RECIPE_COLUMNS = `
  id, title, title_i18n, servings, prep_min, cook_min, steps, per_serving_nutrition,
  kid_friendly, autism_friendly, ramadan_suitable, review_status, source,
  recipe_ingredients(id, ingredient_id, quantity, unit, grams, optional, prep_note, sort_order,
    ingredient:ingredients(name, name_i18n, halal_status, is_sunnah_food)),
  portions(life_stage, tier, household_measure, household_measure_i18n, grams)
`;

interface RawRecipe {
  id: string;
  title: string;
  title_i18n: unknown;
  servings: number;
  prep_min: number;
  cook_min: number;
  steps: unknown;
  per_serving_nutrition: unknown;
  kid_friendly: boolean;
  autism_friendly: boolean;
  ramadan_suitable: boolean;
  review_status: string;
  source: string;
  recipe_ingredients: Array<{
    id: string;
    ingredient_id: string;
    quantity: number;
    unit: string;
    grams: number;
    optional: boolean;
    prep_note: string | null;
    sort_order: number;
    ingredient: {
      name: string;
      name_i18n: unknown;
      halal_status: string;
      is_sunnah_food: boolean;
    } | null;
  }> | null;
  portions: Array<{
    life_stage: LifeStage;
    tier: string;
    household_measure: string;
    household_measure_i18n: unknown;
    grams: number;
  }> | null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function parseSteps(json: unknown): RecipeStep[] {
  if (!Array.isArray(json)) return [];
  return json
    .flatMap((s, i): RecipeStep[] => {
      if (!s || typeof s !== 'object') return [];
      const o = s as Record<string, unknown>;
      return [
        {
          n: typeof o.n === 'number' ? o.n : i + 1,
          textI18n: o.text_i18n ?? o.text ?? null,
          timerMin: num(o.timer_min),
        },
      ];
    })
    .sort((a, b) => a.n - b.n);
}

export function parseNutrition(json: unknown): RecipeNutrition {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  return {
    kcal: num(o.kcal),
    proteinG: num(o.protein_g),
    carbsG: num(o.carbs_g),
    fiberG: num(o.fiber_g),
    fatG: num(o.fat_g),
    sodiumMg: num(o.sodium_mg),
    ironMg: num(o.iron_mg),
    calciumMg: num(o.calcium_mg),
  };
}

const HALAL: readonly HalalStatus[] = ['halal', 'haram', 'mashbooh', 'depends_on_source'];

export function toRecipeView(r: RawRecipe): RecipeView {
  return {
    id: r.id,
    title: r.title,
    titleI18n: r.title_i18n,
    servings: r.servings,
    prepMin: r.prep_min,
    cookMin: r.cook_min,
    steps: parseSteps(r.steps),
    nutrition: parseNutrition(r.per_serving_nutrition),
    kidFriendly: r.kid_friendly,
    autismFriendly: r.autism_friendly,
    ramadanSuitable: r.ramadan_suitable,
    reviewStatus: r.review_status,
    source: r.source,
    ingredients: [...(r.recipe_ingredients ?? [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((ri) => ({
        id: ri.id,
        ingredientId: ri.ingredient_id,
        name: ri.ingredient?.name ?? '',
        nameI18n: ri.ingredient?.name_i18n ?? null,
        quantity: Number(ri.quantity),
        unit: ri.unit,
        grams: Number(ri.grams),
        optional: ri.optional,
        prepNote: ri.prep_note,
        halalStatus: (HALAL as readonly string[]).includes(ri.ingredient?.halal_status ?? '')
          ? (ri.ingredient?.halal_status as HalalStatus)
          : 'halal',
        isSunnahFood: ri.ingredient?.is_sunnah_food ?? false,
      })),
    portions: (r.portions ?? []).map((p) => ({
      lifeStage: p.life_stage,
      tier: p.tier,
      householdMeasure: p.household_measure,
      householdMeasureI18n: p.household_measure_i18n,
      grams: Number(p.grams),
    })),
  };
}

export async function fetchRecipe(id: string): Promise<RecipeView | null> {
  const { data, error } = await client()
    .from('recipes')
    .select(RECIPE_COLUMNS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw toDbAppError(error);
  return data ? toRecipeView(data as unknown as RawRecipe) : null;
}

/** Islamic source ids that mention these ingredients (only verified sources are visible). */
export async function fetchSunnahSourceIds(ingredientIds: readonly string[]): Promise<string[]> {
  if (ingredientIds.length === 0) return [];
  const { data, error } = await client()
    .from('foods_in_narrations')
    .select('islamic_source_id')
    .in('ingredient_id', [...ingredientIds]);
  if (error) throw toDbAppError(error);
  return [
    ...new Set(
      ((data ?? []) as Array<{ islamic_source_id: string }>).map((r) => r.islamic_source_id),
    ),
  ];
}
