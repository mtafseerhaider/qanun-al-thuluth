import { LIFE_STAGE_FACTOR } from './engine.ts';
import type { GroceryIngredient, ListItem, PlannedServing } from './engine.ts';

/**
 * Ramadan grocery handling (FR-RAM-06, 14 §10.4, 15 §5): `grocery-generate` on a `kind = 'ramadan'`
 * plan opens every iftar with dates, treats the Ramadan staples (dates, atta and other flour,
 * daals and gram flour, oil and ghee) as monthly purchases, and prices the list with a Ramadan
 * uplift because food prices in Pakistan rise through the month.
 */

/** Three dates (about 8 g each) per adult iftar serving: the Sunnah opening (15 §5.3). */
export const IFTAR_DATES_GRAMS = 24;

const norm = (s: string) => s.trim().toLowerCase();

/** Dried dates (khajoor). Fresh dates (dang, doka) are seasonal produce, not a staple. */
export function isDriedDates(i: Pick<GroceryIngredient, 'name' | 'name_i18n'>): boolean {
  const name = norm(i.name);
  if (/\bfresh\b|\bdoka\b|\bdang\b/.test(name)) return false;
  return /\bdates?\b|khajoor|khajur/.test(name) || (i.name_i18n?.ur ?? '').includes('کھجور');
}

/** The catalog's dried dates ingredient (Aseel first). */
export function datesIngredient(
  ingredients: Map<string, GroceryIngredient>,
): GroceryIngredient | null {
  const all = [...ingredients.values()].filter(isDriedDates);
  return all.find((i) => /aseel/i.test(i.name)) ?? all[0] ?? null;
}

const STAPLE_CATEGORIES = new Set(['grain', 'legume', 'oil_fat']);

/** FR-RAM-06 monthly staples: dates, flour, lentils (daal, chana, besan) and oil. */
export function isRamadanStaple(
  i: Pick<GroceryIngredient, 'name' | 'name_i18n' | 'category'>,
): boolean {
  return isDriedDates(i) || STAPLE_CATEGORIES.has(i.category);
}

/**
 * Adds the iftar dates: per iftar serving, `IFTAR_DATES_GRAMS` scaled by life stage. Iftar meals
 * that already contain dates count toward it (the larger of the two is kept, never the sum).
 * Returns the grams added, 0 when the catalog has no dates or the range has no iftar.
 */
export function addIftarDates(
  need: Map<string, number>,
  servings: readonly PlannedServing[],
  ingredients: Map<string, GroceryIngredient>,
): number {
  const dates = datesIngredient(ingredients);
  if (!dates) return 0;
  let grams = 0;
  for (const s of servings) {
    if (s.meal_type !== 'iftar') continue;
    grams += IFTAR_DATES_GRAMS * (LIFE_STAGE_FACTOR[s.life_stage] ?? 1);
  }
  const current = need.get(dates.id) ?? 0;
  if (grams <= current) return 0;
  need.set(dates.id, grams);
  return Math.round(grams - current);
}

/**
 * Interim Ramadan price uplift per budget category, applied to the price book when a list covers
 * Ramadan days. FR-RAM-06 asks for a factor from price observations; until a full Ramadan of
 * observations exists per profile (first: Ramadan 1448, February 2027) these are fixed,
 * conservative planning factors that need review by ops before launch, then replacement by factors
 * computed from `price_observations` (Ramadan median over the median of the 60 days before).
 */
export const RAMADAN_PRICE_UPLIFT: Record<string, number> = {
  produce_fruit: 1.25,
  produce_veg: 1.15,
  snacks: 1.2,
  protein_animal: 1.1,
  protein_plant: 1.08,
  oils_fats: 1.08,
  staples: 1.05,
  dairy: 1.05,
  beverages: 1.1,
  spices: 1.05,
};
export const RAMADAN_UPLIFT_VERSION = 'interim_2026_10';
const DEFAULT_UPLIFT = 1.05;

/** The price book with the Ramadan uplift applied (per kg, minor units, rounded). */
export function ramadanPrices(
  prices: Map<string, number>,
  ingredients: Map<string, GroceryIngredient>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, perKg] of prices) {
    const cat = ingredients.get(id)?.budget_category ?? '';
    out.set(id, Math.round(perKg * (RAMADAN_PRICE_UPLIFT[cat] ?? DEFAULT_UPLIFT)));
  }
  return out;
}

/**
 * 14 §10.4 for Ramadan: staples are bought once for the month (never `is_fresh`, so the weekly
 * fresh lists skip them), and a premium monthly list holds the staples only while the fresh food
 * goes on the weekly lists. Free lists stay weekly with everything on them.
 */
export function ramadanListItems(
  items: ListItem[],
  ingredients: Map<string, GroceryIngredient>,
  period: 'weekly' | 'monthly',
): ListItem[] {
  const out: ListItem[] = [];
  for (const item of items) {
    const ing = ingredients.get(item.ingredient_id);
    const staple = ing ? isRamadanStaple(ing) : false;
    const fresh = staple ? false : item.is_fresh;
    if (period === 'monthly' && fresh) continue;
    out.push(fresh === item.is_fresh ? item : { ...item, is_fresh: fresh });
  }
  return out;
}
