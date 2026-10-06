import { choosePriceProfile, servingsCost } from './engine.ts';
import type { LifeStage, PlannedServing } from './engine.ts';
import type { GroceryCatalogStore } from './store.ts';
import type { PlanWeekPayload, StoredDailyMeal } from '../plan/store.ts';

/**
 * `budget_delta_minor` for `ai-adjust-plan` (06 §4.4, 14 §16): the cost of the new version's meals
 * in scope minus the parent's, from the household's live price book. Both sides use life-stage
 * shares and batch multipliers with no portion rows, so unchanged meals cancel exactly. Leftover
 * slots cost nothing. Returns 0 when there is no price book for the household's currency.
 */
export async function budgetDelta(
  catalog: GroceryCatalogStore,
  input: {
    household: { id: string; region_id: string | null; city?: string | null; currency: string };
    today: string;
    from: string;
    to: string;
    parentMeals: readonly StoredDailyMeal[];
    payloads: readonly PlanWeekPayload[];
  },
): Promise<number> {
  const profile = choosePriceProfile(
    await catalog.priceProfiles(),
    {
      region_id: input.household.region_id,
      city: input.household.city ?? null,
      currency: input.household.currency,
    },
    input.today,
  );
  if (!profile) return 0;
  const stages = await catalog.memberStages(input.household.id);
  const inScope = (d: string) => d >= input.from && d <= input.to;
  const serving = (
    plan_date: string,
    daily_meal_id: string,
    meal_id: string,
    batch: number,
    s: { family_member_id: string; adapted_meal_id: string | null },
  ): PlannedServing => ({
    plan_date,
    daily_meal_id,
    meal_id: s.adapted_meal_id ?? meal_id,
    base_meal_id: meal_id,
    batch_multiplier: batch,
    life_stage: stages.get(s.family_member_id) ?? ('adult' as LifeStage),
    portion_grams: null,
  });

  const before: PlannedServing[] = [];
  for (const m of input.parentMeals) {
    if (!inScope(m.plan_date)) continue;
    if ((m as { source_daily_meal_id?: string | null }).source_daily_meal_id) continue;
    for (const s of m.servings) {
      before.push(serving(m.plan_date, m.id, m.meal_id, Number(m.batch_multiplier ?? 1), s));
    }
  }
  const after: PlannedServing[] = [];
  for (const week of input.payloads) {
    for (const day of week.days) {
      if (!inScope(day.plan_date)) continue;
      day.meals.forEach((m, i) => {
        if (m.source_daily_meal_id) return;
        for (const s of m.servings) {
          after.push(
            serving(day.plan_date, `${day.plan_date}:${i}`, m.meal_id, m.batch_multiplier ?? 1, s),
          );
        }
      });
    }
  }
  const ids = [...new Set([...before, ...after].flatMap((s) => [s.meal_id, s.base_meal_id]))];
  if (!ids.length) return 0;
  const [recipes, prices] = await Promise.all([
    catalog.mealRecipes(ids),
    catalog.prices(profile.id),
  ]);
  return servingsCost(after, recipes, prices) - servingsCost(before, recipes, prices);
}
