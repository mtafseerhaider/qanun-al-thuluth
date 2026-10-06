import type { SupabaseClient } from '@supabase/supabase-js';

import { HttpError } from '../errors.ts';
import { check, selectAll } from '../platform.ts';
import { SIDE_GRAMS_PER_ADULT } from './engine.ts';
import type {
  BudgetProfile,
  GroceryIngredient,
  LifeStage,
  ListItem,
  MealComponent,
  MealRecipe,
  PantryRow,
  PlannedServing,
  PriceProfileRow,
  SubstitutionRule,
} from './engine.ts';

/**
 * Catalog and price-book reads for the grocery engine (05 §7, §11, §22.6), shared by
 * `grocery-generate` and `ai-adjust-plan`. Column names follow 05 and the S4 migration.
 */
export interface GroceryCatalogStore {
  /** Non-leftover slots of a plan in [from, to], one row per member serving. */
  planServings(
    mealPlanId: string,
    householdId: string,
    from: string,
    to: string,
  ): Promise<PlannedServing[]>;
  mealRecipes(mealIds: readonly string[]): Promise<Map<string, MealRecipe>>;
  /** All active catalog ingredients (a few hundred rows). */
  ingredients(): Promise<Map<string, GroceryIngredient>>;
  priceProfiles(): Promise<PriceProfileRow[]>;
  /** Current price per kg (minor units) by ingredient for one profile. */
  prices(priceProfileId: string): Promise<Map<string, number>>;
  /** Life stage by family member id (live members). */
  memberStages(householdId: string): Promise<Map<string, LifeStage>>;
}

export interface GroceryHousehold {
  id: string;
  owner_user_id: string;
  country_code: string;
  region_id: string | null;
  region_code: string | null;
  city: string | null;
  timezone: string;
  currency: string;
  preferences: Record<string, unknown>;
}

export interface GroceryPlanRow {
  id: string;
  household_id: string;
  status: string;
  start_date: string;
  end_date: string;
  /** `meal_plans.kind`; 'ramadan' switches on the Ramadan list rules (FR-RAM-06). */
  kind?: string;
}

export interface GroceryListRow {
  id: string;
  household_id: string;
  status: 'open' | 'shopping' | 'done';
}

export interface SaveListArgs {
  replaceListId: string | null;
  list: {
    household_id: string;
    meal_plan_id: string;
    period: 'weekly' | 'monthly' | 'adhoc';
    starts_on: string;
    ends_on: string;
    estimated_total_minor: number;
    currency: string;
    price_profile_id: string | null;
  };
  items: ListItem[];
}

export interface GroceryStore extends GroceryCatalogStore {
  household(householdId: string): Promise<GroceryHousehold | null>;
  userLocale(userId: string): Promise<string | null>;
  plan(mealPlanId: string): Promise<GroceryPlanRow | null>;
  seasonal(
    regionId: string | null,
    month: number,
  ): Promise<Map<string, 'peak' | 'available' | 'scarce'>>;
  substitutionRules(): Promise<SubstitutionRule[]>;
  pantry(householdId: string): Promise<PantryRow[]>;
  /** Allergen codes of live members and ingredient ids disliked for religious reasons. */
  memberAvoidances(
    householdId: string,
  ): Promise<{ allergenCodes: string[]; avoidIngredientIds: string[] }>;
  budgetProfile(householdId: string, id?: string): Promise<BudgetProfile | null>;
  groceryList(id: string): Promise<GroceryListRow | null>;
  /** Writes the list and its items; returns the list id and the row id for each item key. */
  saveList(args: SaveListArgs): Promise<{ id: string; itemIds: Map<string, string> }>;
}

// ---- Supabase implementation ---------------------------------------------------------------------

const live = <T extends { deleted_at?: string | null }>(rows: T[] | null | undefined): T[] =>
  (rows ?? []).filter((r) => !r.deleted_at);

interface ComponentJson {
  recipe_id?: string;
  servings_share?: number;
  ingredient_ids?: string[];
  grams_per_adult?: number;
  grams?: number;
}

export function supabaseGroceryCatalog(admin: SupabaseClient): GroceryCatalogStore {
  return {
    async planServings(mealPlanId, householdId, from, to) {
      const [rows, stages] = await Promise.all([
        selectAll<unknown>((a, b) =>
          admin
            .from('daily_meals')
            .select(
              'id, plan_date, meal_type, meal_id, batch_multiplier, source_daily_meal_id, daily_meal_servings(family_member_id, adapted_meal_id, portions(grams))',
            )
            .eq('meal_plan_id', mealPlanId)
            .eq('household_id', householdId)
            .gte('plan_date', from)
            .lte('plan_date', to)
            .is('source_daily_meal_id', null)
            .order('plan_date')
            .order('id')
            .range(a, b),
        ),
        this.memberStages(householdId),
      ]);
      const out: PlannedServing[] = [];
      for (const r of rows as Array<{
        id: string;
        plan_date: string;
        meal_type: string | null;
        meal_id: string;
        batch_multiplier: number | string;
        daily_meal_servings: Array<{
          family_member_id: string;
          adapted_meal_id: string | null;
          portions: { grams: number | string } | null;
        }>;
      }>) {
        for (const s of r.daily_meal_servings ?? []) {
          out.push({
            plan_date: r.plan_date,
            daily_meal_id: r.id,
            meal_id: s.adapted_meal_id ?? r.meal_id,
            base_meal_id: r.meal_id,
            batch_multiplier: Number(r.batch_multiplier ?? 1),
            life_stage: stages.get(s.family_member_id) ?? 'adult',
            portion_grams: s.portions ? Number(s.portions.grams) : null,
            ...(r.meal_type ? { meal_type: r.meal_type } : {}),
          });
        }
      }
      return out;
    },
    async mealRecipes(mealIds) {
      const ids = [...new Set(mealIds)];
      if (!ids.length) return new Map();
      const meals = check(
        await admin.from('meals').select('id, components').in('id', ids),
      ) as Array<{ id: string; components: ComponentJson[] | null }>;
      const recipeIds = [
        ...new Set(
          meals.flatMap((m) =>
            (m.components ?? []).map((c) => c.recipe_id).filter((x): x is string => !!x),
          ),
        ),
      ];
      const [recipes, portions] = await Promise.all([
        recipeIds.length
          ? (check(
              await admin
                .from('recipes')
                .select('id, servings, recipe_ingredients(ingredient_id, grams, optional)')
                .in('id', recipeIds),
            ) as Array<{
              id: string;
              servings: number;
              recipe_ingredients: Array<{
                ingredient_id: string;
                grams: number | string;
                optional: boolean;
              }>;
            }>)
          : [],
        check(
          await admin
            .from('portions')
            .select('meal_id, grams')
            .in('meal_id', ids)
            .eq('life_stage', 'adult')
            .eq('tier', 'standard'),
        ) as Array<{ meal_id: string; grams: number | string }>,
      ]);
      const recipeById = new Map(recipes.map((r) => [r.id, r]));
      const adult = new Map(portions.map((p) => [p.meal_id, Number(p.grams)]));
      const out = new Map<string, MealRecipe>();
      for (const m of meals) {
        const components: MealComponent[] = [];
        for (const c of m.components ?? []) {
          if (c.recipe_id) {
            const r = recipeById.get(c.recipe_id);
            if (!r) continue;
            components.push({
              kind: 'recipe',
              share: Number(c.servings_share ?? 1),
              servings: Number(r.servings),
              ingredients: (r.recipe_ingredients ?? []).map((ri) => ({
                ingredient_id: ri.ingredient_id,
                grams: Number(ri.grams),
                optional: ri.optional === true,
              })),
            });
          } else if (Array.isArray(c.ingredient_ids) && c.ingredient_ids.length) {
            components.push({
              kind: 'ingredient',
              ingredient_ids: c.ingredient_ids,
              grams_per_adult: Number(c.grams_per_adult ?? c.grams ?? SIDE_GRAMS_PER_ADULT),
            });
          }
        }
        out.set(m.id, { meal_id: m.id, adult_portion_grams: adult.get(m.id) ?? null, components });
      }
      return out;
    },
    async ingredients() {
      const rows = (await selectAll<unknown>((a, b) =>
        admin
          .from('ingredients')
          .select(
            'id, name, name_i18n, category, default_unit, grams_per_unit, shelf_life_days, purchase_units, aisle, halal_status, protein_g, iron_mg, calcium_mg, fiber_g, budget_categories(code), ingredient_allergens(allergens(code))',
          )
          .eq('is_active', true)
          .order('id')
          .range(a, b),
      )) as Array<{
        id: string;
        name: string;
        name_i18n: Record<string, string> | null;
        category: string;
        default_unit: string;
        grams_per_unit: number | string | null;
        shelf_life_days: number | null;
        purchase_units: Array<{ unit: string; grams: number }> | null;
        aisle: string | null;
        halal_status: GroceryIngredient['halal_status'];
        protein_g: number | string | null;
        iron_mg: number | string | null;
        calcium_mg: number | string | null;
        fiber_g: number | string | null;
        budget_categories: { code: string } | null;
        ingredient_allergens: Array<{ allergens: { code: string } | null }> | null;
      }>;
      const num = (v: number | string | null) => (v === null || v === undefined ? null : Number(v));
      return new Map(
        rows.map((r) => [
          r.id,
          {
            id: r.id,
            name: r.name,
            name_i18n: r.name_i18n ?? {},
            category: r.category,
            budget_category: r.budget_categories?.code ?? 'staples',
            default_unit: r.default_unit,
            grams_per_unit: num(r.grams_per_unit),
            shelf_life_days: r.shelf_life_days,
            purchase_units: (r.purchase_units ?? []).map((u) => ({
              unit: u.unit,
              grams: Number(u.grams),
            })),
            aisle: r.aisle,
            halal_status: r.halal_status,
            allergen_codes: (r.ingredient_allergens ?? [])
              .map((a) => a.allergens?.code)
              .filter((c): c is string => !!c),
            nutrients: {
              protein_g: num(r.protein_g),
              iron_mg: num(r.iron_mg),
              calcium_mg: num(r.calcium_mg),
              fiber_g: num(r.fiber_g),
            },
          },
        ]),
      );
    },
    async priceProfiles() {
      return check(
        await admin.from('price_profiles').select('id, region_id, city, currency, effective_from'),
      ) as PriceProfileRow[];
    },
    async prices(priceProfileId) {
      const out = new Map<string, number>();
      // 1. Recency-weighted median from mv_current_prices (14 §12.4).
      const mv = await admin
        .from('mv_current_prices')
        .select('ingredient_id, price_per_kg_minor')
        .eq('price_profile_id', priceProfileId);
      if (!mv.error) {
        for (const r of (mv.data ?? []) as Array<{
          ingredient_id: string;
          price_per_kg_minor: number | string;
        }>) {
          out.set(r.ingredient_id, Number(r.price_per_kg_minor));
        }
      }
      // 2. Ingredients the view does not cover yet (never refreshed): latest accepted observation.
      const obs = (await selectAll<unknown>((a, b) =>
        admin
          .from('price_observations')
          .select('ingredient_id, amount_minor, unit_grams, observed_on')
          .eq('price_profile_id', priceProfileId)
          .eq('moderation_status', 'accepted')
          .not('unit_grams', 'is', null)
          .order('observed_on', { ascending: false })
          .order('id')
          .range(a, b),
      )) as Array<{
        ingredient_id: string;
        amount_minor: number | string;
        unit_grams: number | string;
      }>;
      for (const o of obs) {
        if (out.has(o.ingredient_id)) continue;
        const g = Number(o.unit_grams);
        if (g > 0) out.set(o.ingredient_id, Math.round((Number(o.amount_minor) * 1000) / g));
      }
      return out;
    },
    async memberStages(householdId) {
      const rows = check(
        await admin
          .from('family_members')
          .select('id, life_stage')
          .eq('household_id', householdId)
          .is('deleted_at', null),
      ) as Array<{ id: string; life_stage: LifeStage }>;
      return new Map(rows.map((r) => [r.id, r.life_stage]));
    },
  };
}

export function supabaseGroceryStore(admin: SupabaseClient): GroceryStore {
  const catalog = supabaseGroceryCatalog(admin);
  return {
    ...catalog,
    async household(householdId) {
      const row = check(
        await admin
          .from('households')
          .select(
            'id, owner_user_id, country_code, region_id, city, timezone, currency, preferences, regions(region_code, country_code)',
          )
          .eq('id', householdId)
          .is('deleted_at', null)
          .maybeSingle(),
      ) as
        | (Omit<GroceryHousehold, 'region_code'> & {
            regions: { region_code: string; country_code: string } | null;
          })
        | null;
      if (!row) return null;
      const { regions, ...rest } = row;
      return {
        ...rest,
        preferences: rest.preferences ?? {},
        region_code: regions ? `${regions.country_code}-${regions.region_code}` : null,
      };
    },
    async userLocale(userId) {
      const row = check(await admin.from('users').select('locale').eq('id', userId).maybeSingle());
      return (row?.locale as string | undefined) ?? null;
    },
    async plan(mealPlanId) {
      return check(
        await admin
          .from('meal_plans')
          .select('id, household_id, status, start_date, end_date, kind')
          .eq('id', mealPlanId)
          .is('deleted_at', null)
          .maybeSingle(),
      ) as GroceryPlanRow | null;
    },
    async seasonal(regionId, month) {
      if (!regionId) return new Map();
      const rows = check(
        await admin
          .from('seasonal_produce')
          .select('ingredient_id, availability')
          .eq('region_id', regionId)
          .eq('month', month),
      ) as Array<{ ingredient_id: string; availability: 'peak' | 'available' | 'scarce' }>;
      return new Map(rows.map((r) => [r.ingredient_id, r.availability]));
    },
    async substitutionRules() {
      const res = await admin
        .from('ingredient_substitutions')
        .select(
          'from_ingredient_id, to_ingredient_id, reason, ratio, nutrient_similarity, culinary_fit, notes_i18n, region_codes',
        );
      // The table is optional until the S4 migration lands everywhere; built-in rules cover it.
      if (res.error) return [];
      return (
        (res.data ?? []) as Array<
          Omit<SubstitutionRule, 'label'> & { notes_i18n: Record<string, string> | null }
        >
      ).map(({ notes_i18n, ...r }) => ({
        ...r,
        ratio: Number(r.ratio),
        nutrient_similarity: Number(r.nutrient_similarity),
        label: notes_i18n?.en ?? null,
      }));
    },
    async pantry(householdId) {
      const rows = check(
        await admin
          .from('pantry_items')
          .select('ingredient_id, grams, expires_on')
          .eq('household_id', householdId)
          .is('deleted_at', null),
      ) as Array<{
        ingredient_id: string | null;
        grams: number | string;
        expires_on: string | null;
      }>;
      return rows.map((r) => ({ ...r, grams: Number(r.grams) }));
    },
    async memberAvoidances(householdId) {
      const rows = check(
        await admin
          .from('family_members')
          .select(
            'id, deleted_at, allergies(deleted_at, allergens(code)), food_dislikes(ingredient_id, reason, deleted_at)',
          )
          .eq('household_id', householdId)
          .is('deleted_at', null),
      ) as unknown as Array<{
        allergies: Array<{ deleted_at: string | null; allergens: { code: string } | null }>;
        food_dislikes: Array<{
          ingredient_id: string | null;
          reason: string;
          deleted_at: string | null;
        }>;
      }>;
      return {
        allergenCodes: [
          ...new Set(
            rows.flatMap((r) =>
              live(r.allergies)
                .map((a) => a.allergens?.code)
                .filter((c): c is string => !!c),
            ),
          ),
        ],
        avoidIngredientIds: [
          ...new Set(
            rows.flatMap((r) =>
              live(r.food_dislikes)
                .filter((d) => d.reason === 'religious' && d.ingredient_id)
                .map((d) => d.ingredient_id as string),
            ),
          ),
        ],
      };
    },
    async budgetProfile(householdId, id) {
      let q = admin
        .from('budget_profiles')
        .select('id, monthly_amount_minor, currency, strictness, category_split')
        .eq('household_id', householdId)
        .is('deleted_at', null);
      q = id ? q.eq('id', id) : q.eq('is_active', true);
      const row = check(await q.limit(1).maybeSingle()) as BudgetProfile | null;
      return row
        ? {
            ...row,
            monthly_amount_minor: Number(row.monthly_amount_minor),
            category_split: row.category_split ?? {},
          }
        : null;
    },
    async groceryList(id) {
      return check(
        await admin
          .from('grocery_lists')
          .select('id, household_id, status')
          .eq('id', id)
          .is('deleted_at', null)
          .maybeSingle(),
      ) as GroceryListRow | null;
    },
    async saveList({ replaceListId, list, items }) {
      let id: string;
      if (replaceListId) {
        const rows = check(
          await admin
            .from('grocery_lists')
            .update(list)
            .eq('id', replaceListId)
            .eq('household_id', list.household_id)
            .eq('status', 'open')
            .select('id'),
        ) as { id: string }[];
        if (!rows.length) throw new HttpError('CONFLICT', 'This list is no longer open.');
        id = replaceListId;
        check(await admin.from('shopping_items').delete().eq('grocery_list_id', id));
      } else {
        id = (
          check(await admin.from('grocery_lists').insert(list).select('id').single()) as {
            id: string;
          }
        ).id;
      }
      const itemIds = new Map(items.map((i) => [i.key, crypto.randomUUID()]));
      const row = (i: ListItem, n: number) => ({
        id: itemIds.get(i.key),
        grocery_list_id: id,
        household_id: list.household_id,
        ingredient_id: i.ingredient_id,
        label: i.label.slice(0, 160),
        quantity: i.quantity,
        unit: i.unit,
        estimated_minor: i.estimated_minor,
        is_fresh: i.is_fresh,
        aisle: i.aisle,
        sort_order: n,
        substitution_for_item_id: i.substitution_for
          ? (itemIds.get(i.substitution_for) ?? null)
          : null,
      });
      const rows = items.map(row);
      const originals = rows.filter((r) => !r.substitution_for_item_id);
      const substitutes = rows.filter((r) => r.substitution_for_item_id);
      if (originals.length) check(await admin.from('shopping_items').insert(originals));
      if (substitutes.length) check(await admin.from('shopping_items').insert(substitutes));
      return { id, itemIds: itemIds as Map<string, string> };
    },
  };
}
