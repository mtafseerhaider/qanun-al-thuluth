import {
  GroceryGenerateRequest,
  GroceryGenerateResponse,
} from '@thuluth/shared/contracts/grocery-generate.ts';

import { requireUser } from '../_shared/auth.ts';
import type { ClaimsVerifier } from '../_shared/auth.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { sha256Hex } from '../_shared/crypto.ts';
import { HttpError } from '../_shared/errors.ts';
import {
  aggregateNeed,
  applyWaste,
  budgetStatus,
  buildItems,
  builtInRules,
  byCategory,
  choosePriceProfile,
  deductPantry,
  matchesExclusion,
  optimise,
  periodTarget,
  priceCoverage,
  totalMinor,
} from '../_shared/grocery/engine.ts';
import type { AppliedSubstitution, ListItem, SubstitutionRule } from '../_shared/grocery/engine.ts';
import {
  addIftarDates,
  ramadanListItems,
  ramadanPrices,
  RAMADAN_UPLIFT_VERSION,
} from '../_shared/grocery/ramadan.ts';
import type { GroceryStore } from '../_shared/grocery/store.ts';
import { jsonHandler } from '../_shared/http.ts';
import { daysBetween, localDate } from '../_shared/plan/pipeline.ts';
import type { PlatformStore } from '../_shared/platform.ts';
import { consumeTierQuota, resolveEntitlement, TIER_LIMITS } from '../_shared/entitlements.ts';
import type { EntitlementStore } from '../_shared/entitlements.ts';

export const SCOPE = 'grocery-generate';
/** 06 §2.7: 10/day free (basic), 30/day premium, 3/min (`TIER_LIMITS`, `_shared/entitlements.ts`). */
export const DAILY_LIMIT = TIER_LIMITS['grocery-generate'].daily;
export const BURST_PER_MINUTE = TIER_LIMITS['grocery-generate'].perMinute.premium;
/** Longest list range: a monthly list plus a few days of slack. */
export const MAX_RANGE_DAYS = 35;

export interface GroceryGenerateDeps {
  verify: ClaimsVerifier;
  platform: PlatformStore;
  /** Server-side tier (17 §9): optimisation, pantry and monthly lists follow the owner (FR-HH-06). */
  entitlements: EntitlementStore;
  store: GroceryStore;
  now?: () => Date;
}

const LISTABLE_PLAN_STATUSES = new Set(['draft', 'active', 'completed']);

/**
 * 06 §4.7, 14 §10 to §13. Deterministic (no AI). Free households get the basic list: aggregated
 * quantities in purchase units, price estimate and budget status, no pantry automation, no
 * optimisation, no monthly split (17 §6 "downgraded response"). Premium adds pantry deduction,
 * the monthly staples list and budget optimisation with substitutions under the budget strictness.
 */
export function createGroceryGenerateHandler(deps: GroceryGenerateDeps) {
  const now = deps.now ?? (() => new Date());

  return jsonHandler(GroceryGenerateRequest, async ({ req, input }) => {
    const user = await requireUser(req, deps.verify);
    const key = req.headers.get('idempotency-key')?.trim() ?? '';
    if (key.length < 8 || key.length > 128) {
      throw new HttpError('VALIDATION_FAILED', 'Idempotency-Key header is required.', {
        header: 'Idempotency-Key',
      });
    }
    const found = await deps.store.household(input.household_id);
    if (!found) throw new HttpError('NOT_FOUND', 'Household not found.');
    const household = found;
    const role = await deps.platform.membership(input.household_id, user.userId);
    if (!role) throw new HttpError('NOT_FOUND', 'Household not found.');
    if (role !== 'owner' && role !== 'caregiver') {
      throw new HttpError(
        'FORBIDDEN',
        'Only the household owner or a caregiver can make a grocery list.',
      );
    }
    if (!(await deps.platform.featureEnabled('grocery.generate.enabled'))) {
      throw new HttpError('FEATURE_DISABLED', 'Grocery lists are paused right now.', {
        flag: 'grocery.generate.enabled',
      });
    }

    const begin = await deps.platform.idempotencyBegin(
      SCOPE,
      user.userId,
      key,
      await sha256Hex(JSON.stringify(input)),
    );
    if (begin.state === 'replay') {
      return Response.json(begin.body, {
        status: begin.status,
        headers: { ...corsHeaders, 'idempotent-replayed': 'true' },
      });
    }
    if (begin.state === 'mismatch') {
      throw new HttpError(
        'IDEMPOTENCY_KEY_REUSED',
        'This request key was used for a different request.',
      );
    }
    if (begin.state === 'in_progress') {
      throw new HttpError('IDEMPOTENCY_IN_PROGRESS', 'This grocery list is still being made.', {
        retry_after_seconds: 2,
      });
    }

    try {
      const out = await generate();
      await deps.platform.idempotencyComplete(begin.id, 200, out.body);
      return Response.json(out.body, { status: 200, headers: out.headers });
    } catch (err) {
      await deps.platform.idempotencyFail(begin.id).catch(() => {});
      throw err;
    }

    async function generate() {
      const plan = await deps.store.plan(input.meal_plan_id);
      if (!plan || plan.household_id !== input.household_id) {
        throw new HttpError('NOT_FOUND', 'Meal plan not found.');
      }
      if (!LISTABLE_PLAN_STATUSES.has(plan.status)) {
        throw new HttpError('CONFLICT', 'This plan is not ready for a grocery list yet.', {
          current_status: plan.status,
        });
      }
      const days = daysBetween(input.starts_on, input.ends_on) + 1;
      if (days > MAX_RANGE_DAYS) {
        throw new HttpError(
          'VALIDATION_FAILED',
          `A list can cover at most ${MAX_RANGE_DAYS} days.`,
          {
            field: 'ends_on',
          },
        );
      }
      if (input.ends_on < plan.start_date || input.starts_on > plan.end_date) {
        throw new HttpError('VALIDATION_FAILED', 'The dates must overlap the plan.', {
          field: 'starts_on',
          min: plan.start_date,
          max: plan.end_date,
        });
      }
      if (input.replace_list_id) {
        const existing = await deps.store.groceryList(input.replace_list_id);
        if (!existing || existing.household_id !== input.household_id) {
          throw new HttpError('NOT_FOUND', 'Grocery list not found.');
        }
        if (existing.status !== 'open') {
          throw new HttpError('CONFLICT', 'Only an open list can be regenerated.', {
            current_status: existing.status,
          });
        }
      }

      const ent = await resolveEntitlement(deps.entitlements, {
        userId: user.userId,
        householdId: input.household_id,
        scope: 'household',
      });
      const premium = ent.premium;
      const quota = await consumeTierQuota(deps.platform, SCOPE, user.userId, ent.tier);

      const today = localDate(now(), household.timezone);
      const from = input.starts_on < plan.start_date ? plan.start_date : input.starts_on;
      const to = input.ends_on > plan.end_date ? plan.end_date : input.ends_on;
      const header = req.headers.get('accept-language')?.slice(0, 2);
      const locale =
        (header === 'ur' || header === 'en' ? header : await deps.store.userLocale(user.userId)) ===
        'ur'
          ? 'ur'
          : 'en';

      // 1. Price book (14 §12.5): requested profile or the household's region/city profile.
      const profiles = await deps.store.priceProfiles();
      let profile = input.price_profile_id
        ? (profiles.find((p) => p.id === input.price_profile_id) ?? null)
        : choosePriceProfile(profiles, household, today);
      if (input.price_profile_id && !profile) {
        throw new HttpError('NOT_FOUND', 'Price profile not found.', { field: 'price_profile_id' });
      }
      if (profile && profile.currency !== household.currency) profile = null;

      const budget = await deps.store.budgetProfile(input.household_id, input.budget_profile_id);
      if (input.budget_profile_id && !budget) {
        throw new HttpError('NOT_FOUND', 'Budget profile not found.', {
          field: 'budget_profile_id',
        });
      }

      // 2. Aggregate the plan (14 §10.1).
      const servings = await deps.store.planServings(plan.id, input.household_id, from, to);
      const [meals, ingredients, bookPrices] = await Promise.all([
        deps.store.mealRecipes([...new Set(servings.flatMap((s) => [s.meal_id, s.base_meal_id]))]),
        deps.store.ingredients(),
        profile ? deps.store.prices(profile.id) : Promise.resolve(new Map<string, number>()),
      ]);
      // FR-RAM-06: Ramadan plans price with the Ramadan uplift and open every iftar with dates.
      const ramadan = plan.kind === 'ramadan';
      const prices = ramadan ? ramadanPrices(bookPrices, ingredients) : bookPrices;
      const raw = aggregateNeed(servings, meals).need;
      const iftarDatesGrams = ramadan ? addIftarDates(raw, servings, ingredients) : 0;
      let need = applyWaste(raw, ingredients);
      if (premium) need = deductPantry(need, await deps.store.pantry(input.household_id), today);
      const exclusions = new Set(
        input.pantry_exclusions.map((l) => l.trim().toLowerCase()).filter(Boolean),
      );
      for (const id of [...need.keys()]) {
        const ing = ingredients.get(id);
        if (ing && matchesExclusion(ing, exclusions)) need.delete(id);
      }
      // 3. Budget (14 §11) and the premium optimiser.
      const period = premium ? input.period : 'weekly';
      let items: ListItem[] = buildItems(need, ingredients, prices, locale);
      // Ramadan staples are monthly; a premium monthly Ramadan list carries the staples only.
      if (ramadan) items = ramadanListItems(items, ingredients, period);
      const target =
        budget && budget.currency === household.currency
          ? periodTarget(budget, days, period)
          : null;
      let applied: AppliedSubstitution[] = [];
      let feasible = true;
      if (premium && input.optimize && target !== null && profile && budget) {
        const avoid = await deps.store.memberAvoidances(input.household_id);
        const seasonal = await deps.store.seasonal(household.region_id, Number(from.slice(5, 7)));
        const tableRules = await deps.store.substitutionRules();
        const rules: SubstitutionRule[] = [...tableRules, ...builtInRules(ingredients.values())];
        const result = optimise(items, target, budget.strictness, rules, {
          ingredients,
          prices,
          allergenCodes: new Set(avoid.allergenCodes),
          allowMashbooh: household.preferences.allow_mashbooh === true,
          avoidIngredientIds: new Set(avoid.avoidIngredientIds),
          seasonal,
          regionCode: household.region_code,
          locale,
        });
        items = result.items;
        applied = result.applied;
        feasible = result.feasible;
      }

      const total = profile ? totalMinor(items) : 0;
      const saved = await deps.store.saveList({
        replaceListId: input.replace_list_id ?? null,
        list: {
          household_id: input.household_id,
          meal_plan_id: plan.id,
          period,
          starts_on: input.starts_on,
          ends_on: input.ends_on,
          estimated_total_minor: total,
          currency: household.currency,
          price_profile_id: profile?.id ?? null,
        },
        items,
      });
      await deps.platform.audit({
        actor: user.userId,
        householdId: input.household_id,
        action: input.replace_list_id ? 'update' : 'insert',
        entity: 'grocery_lists',
        entityId: saved.id,
        diff: {
          meal_plan_id: plan.id,
          period,
          items: items.length,
          substitutions: applied.length,
          estimated_total_minor: total,
          ...(ramadan
            ? {
                ramadan: {
                  price_uplift: RAMADAN_UPLIFT_VERSION,
                  iftar_dates_grams: iftarDatesGrams,
                },
              }
            : {}),
        },
      });

      const active = items.filter((i) => !i.replaced);
      const body = GroceryGenerateResponse.parse({
        grocery_list_id: saved.id,
        currency: household.currency,
        estimated_total_minor: total,
        items_count: active.length,
        fresh_items_count: active.filter((i) => i.is_fresh).length,
        budget: {
          target_minor: target,
          // Without a price book there is no estimate to compare (FR-GRO-11).
          status: profile ? budgetStatus(total, target) : 'no_budget',
          by_category: profile ? byCategory(items, target, budget) : [],
        },
        substitutions: applied.map((s) => ({
          item_id: saved.itemIds.get(s.from_key),
          substitute_item_id: saved.itemIds.get(s.to_key),
          label: s.label,
          saves_minor: s.saves_minor,
          reason: s.reason,
        })),
        price_coverage: profile ? priceCoverage(items) : 0,
      });
      if (!feasible) {
        // AC-G5: hard cap not reachable with the available swaps. The list is still useful; the
        // app shows status 'over' with the substitutions that were possible.
        console.warn(
          JSON.stringify({ level: 'warn', scope: SCOPE, msg: 'budget_infeasible', list: saved.id }),
        );
      }
      return {
        body,
        headers: {
          ...corsHeaders,
          ...quota,
        },
      };
    }
  });
}
