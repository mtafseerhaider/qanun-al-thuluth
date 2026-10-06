import type { SupabaseClient } from '@supabase/supabase-js';
import type { FoodEntry, Nutrition } from '@thuluth/ai-core';
import type { LifeStage } from '@thuluth/shared';
import type { ConsentKind } from '@thuluth/shared/domain/consent.ts';

import { check, selectAll } from '../_shared/platform.ts';
import { supabasePlanStore } from '../_shared/plan/store.ts';

/** Data access for `ai-analyze-meal` (06 §4.5, 12 §14). Service role; the handler checks access. */

export interface EaterRecord {
  id: string;
  name: string;
  date_of_birth: string | null;
  life_stage: LifeStage;
  linked_user_id: string | null;
  allergen_codes: string[];
}

export interface MealLogInsert {
  household_id: string;
  family_member_id: string;
  eaten_at: string;
  meal_type: string;
  description: string;
  photo_path: string;
  estimated_nutrition: Record<string, unknown>;
  source: 'photo_ai';
  logged_by_user_id: string;
}

export interface MealStore {
  household(householdId: string): Promise<{ id: string; timezone: string } | null>;
  member(householdId: string, memberId: string): Promise<EaterRecord | null>;
  activeConsents(userId: string, householdId: string): Promise<ConsentKind[]>;
  userLocale(userId: string): Promise<string | null>;
  /** `meal-photos/{path}`; null when the object is missing. */
  downloadPhoto(path: string): Promise<Uint8Array | null>;
  /** Ingredients and recipes with nutrition per 100 g: global verified rows plus the household's. */
  foods(householdId: string): Promise<FoodEntry[]>;
  insertMealLog(row: MealLogInsert): Promise<{ id: string }>;
}

const NUTRIENTS = [
  'kcal',
  'protein_g',
  'carbs_g',
  'fiber_g',
  'fat_g',
  'sugar_g',
  'sodium_mg',
  'iron_mg',
  'calcium_mg',
] as const;

function per100(row: Record<string, unknown>, scale = 1): Nutrition | null {
  if (row.kcal == null) return null;
  const n = (k: string) => (row[k] == null ? 0 : Number(row[k]) * scale);
  const out: Nutrition = {
    kcal: n('kcal'),
    protein_g: n('protein_g'),
    carbs_g: n('carbs_g'),
    fiber_g: n('fiber_g'),
    fat_g: n('fat_g'),
  };
  for (const k of NUTRIENTS.slice(5)) if (row[k] != null) out[k] = Number(row[k]) * scale;
  return out;
}

const INGREDIENT_COLUMNS =
  'id, name, name_i18n, halal_status, kcal, protein_g, carbs_g, fiber_g, fat_g, sugar_g, sodium_mg, iron_mg, calcium_mg, ingredient_allergens(allergens(code))';

const names = (primary: string, i18n: unknown): string[] => {
  const values =
    i18n && typeof i18n === 'object' ? Object.values(i18n as Record<string, unknown>) : [];
  return [...new Set([primary, ...values.filter((v): v is string => typeof v === 'string')])];
};

/** Global foods change rarely: cached per isolate for 10 minutes. */
let globalCache: { at: number; foods: FoodEntry[] } | null = null;
let rawIngredients: ReadonlyMap<string, Record<string, unknown>> = new Map();
const CACHE_MS = 600_000;

export function supabaseMealStore(admin: SupabaseClient): MealStore {
  const plan = supabasePlanStore(admin);

  async function load(
    filter: { householdId: string | null },
    globalIngredients: ReadonlyMap<string, Record<string, unknown>> = new Map(),
  ): Promise<FoodEntry[]> {
    // Ingredients are a global catalog (no household rows).
    const ingredients = filter.householdId
      ? []
      : await selectAll<Record<string, unknown>>(
          (from, to) =>
            admin
              .from('ingredients')
              .select(INGREDIENT_COLUMNS)
              .order('id')
              .range(from, to) as unknown as PromiseLike<{
              data: Record<string, unknown>[] | null;
              error: { message?: string } | null;
            }>,
        );
    const allergensOf = (r: Record<string, unknown>) =>
      ((r.ingredient_allergens as Array<{ allergens: { code: string } | null }> | null) ?? [])
        .map((a) => a.allergens?.code)
        .filter((c): c is string => !!c);
    const byIngredient = new Map([
      ...globalIngredients,
      ...ingredients.map((r) => [String(r.id), r] as const),
    ]);
    if (!filter.householdId) rawIngredients = byIngredient;
    const out: FoodEntry[] = ingredients.map((r) => ({
      kind: 'ingredient',
      id: String(r.id),
      names: names(String(r.name), r.name_i18n),
      per100g: per100(r),
      allergenCodes: allergensOf(r),
      halalStatus: r.halal_status as FoodEntry['halalStatus'],
    }));
    const recipes = await selectAll<Record<string, unknown>>((from, to) => {
      const q = admin
        .from('recipes')
        .select('id, title, title_i18n, per_serving_nutrition, recipe_ingredients(ingredient_id)')
        .is('deleted_at', null);
      return (
        filter.householdId
          ? q.eq('household_id', filter.householdId)
          : q.is('household_id', null).eq('review_status', 'verified')
      )
        .order('id')
        .range(from, to);
    });
    for (const r of recipes) {
      const n = (r.per_serving_nutrition ?? {}) as Record<string, unknown>;
      const grams = Number(n.grams ?? 0);
      const parts = ((r.recipe_ingredients as Array<{ ingredient_id: string }> | null) ?? []).map(
        (x) => byIngredient.get(x.ingredient_id),
      );
      out.push({
        kind: 'recipe',
        id: String(r.id),
        names: names(String(r.title), r.title_i18n),
        per100g: grams > 0 ? per100(n, 100 / grams) : null,
        allergenCodes: [...new Set(parts.flatMap((p) => (p ? allergensOf(p) : [])))],
      });
    }
    return out;
  }

  return {
    async household(householdId) {
      const row = await plan.household(householdId);
      return row ? { id: row.id, timezone: row.timezone } : null;
    },
    async member(householdId, memberId) {
      const row = check(
        await admin
          .from('family_members')
          .select('id, name, date_of_birth, life_stage, linked_user_id')
          .eq('household_id', householdId)
          .eq('id', memberId)
          .is('deleted_at', null)
          .maybeSingle(),
      ) as Omit<EaterRecord, 'allergen_codes'> | null;
      if (!row) return null;
      const [record] = await plan.members(householdId, [memberId]);
      return { ...row, allergen_codes: (record?.allergies ?? []).map((a) => a.allergen_code) };
    },
    activeConsents: (u, h) => plan.activeConsents(u, h),
    userLocale: (u) => plan.userLocale(u),
    async downloadPhoto(path) {
      const { data, error } = await admin.storage.from('meal-photos').download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async foods(householdId) {
      if (!globalCache || Date.now() - globalCache.at > CACHE_MS) {
        globalCache = { at: Date.now(), foods: await load({ householdId: null }) };
      }
      const own = await load({ householdId }, rawIngredients).catch(() => []);
      return [...globalCache.foods, ...own];
    },
    async insertMealLog(row) {
      return check(await admin.from('meal_logs').insert(row).select('id').single()) as {
        id: string;
      };
    },
  };
}
