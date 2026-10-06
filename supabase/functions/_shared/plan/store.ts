import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AlternativeReason,
  Availability,
  Catalog,
  CatalogIngredient,
  CatalogMeal,
  CatalogPortion,
  HalalStatus,
  PlanMealType,
  PortionTier,
  ReviewStatus,
} from '@thuluth/ai-core';
import type { ConsentKind } from '@thuluth/shared/domain/consent.ts';
import type { GoalType, HouseholdRole, LifeStage, Severity, SpecialModule } from '@thuluth/shared';

import { fromPostgrestError } from '../errors.ts';
import type { PgErrorLike } from '../errors.ts';

/**
 * Data access shared by `ai-generate-plan` and `ai-adjust-plan` (06 §4.3, §4.4), so the handlers
 * and the worker can be tested without a database. Column names follow 05 and the S3-02 migration.
 */

export interface PlanHouseholdRow {
  id: string;
  owner_user_id: string;
  country_code: string;
  timezone: string;
  currency: string;
  region_id: string | null;
  /** `households.preferences`: allow_mashbooh, weekday_cook_limit_min, ... (05 §20.1). */
  preferences: Record<string, unknown>;
}

export interface MemberRecord {
  id: string;
  name: string;
  date_of_birth: string | null;
  life_stage: LifeStage;
  special_modules: SpecialModule[];
  allergies: Array<{ allergen_code: string; severity: Severity; kind: 'allergy' | 'intolerance' }>;
  /**
   * Live allergy rows whose allergen code did not resolve. They cannot be matched against
   * ingredients, so the pipeline refuses to plan for this member (fail closed).
   */
  unresolved_allergy_ids: string[];
  medication_flags: string[];
  goals: GoalType[];
  conditions: string[];
  dislikes: Array<{
    ingredient_id: string | null;
    label: string;
    reason: 'taste' | 'texture' | 'smell' | 'color' | 'religious' | 'other';
  }>;
  likes: Array<{ ingredient_id: string | null; label: string; strength: number }>;
  safe_foods: Array<{ id: string; ingredient_id: string | null; label: string; strength: number }>;
}

export interface AssessmentFacts {
  id: string;
  family_member_id: string;
  risk_flags: string[];
  /** Displayed adult target only (energy_targets.kcal_per_day when display is true). */
  target_kcal: number | null;
}

export interface BudgetProfileRow {
  id: string;
  monthly_amount_minor: number;
  currency: string;
  strictness: 'flexible' | 'target' | 'hard_cap';
}

export interface MealPlanRow {
  id: string;
  household_id: string;
  kind: 'standard' | 'ramadan' | 'growth' | 'weight_management' | 'custom';
  status: 'draft' | 'generating' | 'active' | 'completed' | 'archived' | 'failed';
  title: string | null;
  start_date: string;
  end_date: string;
  week_count: number;
  version: number;
  parent_plan_id: string | null;
  budget_profile_id: string | null;
  created_by_user_id: string | null;
  rationale: string | null;
  generation_progress: Record<string, unknown>;
  generation_meta: Record<string, unknown>;
  weekly_themes?: unknown[];
  failure_reason?: string | null;
  deleted_at: string | null;
}

export type MealPlanInsert = Omit<
  MealPlanRow,
  'id' | 'deleted_at' | 'rationale' | 'parent_plan_id' | 'budget_profile_id' | 'title'
> & {
  parent_plan_id?: string | null;
  budget_profile_id?: string | null;
  title?: string | null;
  generated_by_assessment_id?: string | null;
};

export interface PlanWeekPayload {
  week: number;
  days: Array<{
    plan_date: string;
    meals: Array<{
      meal_type: PlanMealType;
      slot: number;
      meal_id: string;
      scheduled_time: string | null;
      notes: string | null;
      batch_multiplier: number;
      source_daily_meal_id: string | null;
      is_lunchbox: boolean;
      servings: Array<{
        family_member_id: string;
        portion_id: string | null;
        adaptation: string;
        adapted_meal_id: string | null;
      }>;
    }>;
  }>;
  recommendations: Array<{ recommendation_id: string; family_member_id: string | null }>;
}

export interface StoredDailyMeal {
  id: string;
  plan_date: string;
  meal_type: PlanMealType;
  slot: number;
  meal_id: string;
  title: string;
  notes: string | null;
  scheduled_time: string | null;
  batch_multiplier: number;
  is_lunchbox: boolean;
  servings: Array<{
    family_member_id: string;
    portion_id: string | null;
    adaptation: string;
    adapted_meal_id: string | null;
  }>;
}

export interface RecommendationRow {
  id: string;
  code: string;
  applies_to: Record<string, unknown>;
  contraindications: Record<string, unknown>;
}

export interface SafetyEventInsert {
  household_id: string;
  family_member_id: string | null;
  user_id: string;
  source: 'plan_generation';
  category: string;
  urgency: 'emergency_now' | 'same_day' | 'soon' | 'routine';
  evidence: string;
}

export interface QueueMessage {
  msg_id: number;
  read_ct: number;
  message: { meal_plan_id?: string; attempt?: number };
}

export type IdempotencyBegin =
  | { state: 'new'; id: string }
  | { state: 'replay'; status: number; body: unknown }
  | { state: 'in_progress' }
  | { state: 'mismatch' };

export interface PlanStore {
  household(householdId: string): Promise<PlanHouseholdRow | null>;
  membership(householdId: string, userId: string): Promise<HouseholdRole | null>;
  userLocale(userId: string): Promise<string | null>;
  /** Household features follow the owner's entitlement (00 §11). */
  householdPremium(householdId: string): Promise<boolean>;
  activeConsents(userId: string, householdId: string): Promise<ConsentKind[]>;
  /** Kill switches (`plan.generate.enabled`, `ai.plan.enabled`); a missing flag counts as on. */
  featureEnabled(key: string): Promise<boolean>;
  consumeRateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; remaining: number; reset_at: string }>;
  idempotencyBegin(
    scope: string,
    userId: string,
    key: string,
    requestHash: string,
  ): Promise<IdempotencyBegin>;
  idempotencyComplete(id: string, status: number, body: unknown): Promise<void>;
  idempotencyFail(id: string): Promise<void>;

  /** Active members, optionally limited to `ids`. */
  members(householdId: string, ids?: readonly string[]): Promise<MemberRecord[]>;
  /** Latest assessment per member (or the given ids). */
  latestAssessments(householdId: string, ids?: readonly string[]): Promise<AssessmentFacts[]>;
  /** Members with an unresolved `safety_events` row (null = household-wide). */
  openSafetyEventMembers(householdId: string): Promise<Array<string | null>>;
  budgetProfile(householdId: string, id?: string): Promise<BudgetProfileRow | null>;
  /**
   * The planning catalog: global rows whose `review_status = any(catalog_review_statuses())`
   * (meals, recipes, portions, meal_alternatives) plus the household's own rows.
   */
  catalog(householdId: string): Promise<{ catalog: Catalog; includeInReview: boolean }>;
  seasonal(regionId: string | null, month: number): Promise<Map<string, Availability>>;
  verifiedRecommendations(): Promise<RecommendationRow[]>;

  /** Non-deleted plans of the household, newest first (status, kind, created order). */
  planHistory(householdId: string): Promise<Array<Pick<MealPlanRow, 'id' | 'status' | 'kind'>>>;
  insertPlan(row: MealPlanInsert): Promise<MealPlanRow>;
  plan(id: string): Promise<MealPlanRow | null>;
  /**
   * Claims a queued plan for one worker: `generating` with `generation_progress.phase = 'queued'`
   * moves to `safety_check`. False when another worker already took it.
   */
  claimPlan(id: string, attempt: number): Promise<boolean>;
  updatePlan(
    id: string,
    patch: Partial<MealPlanRow> & { failure_reason?: string | null },
  ): Promise<void>;
  /** Archive the household's active plan of a kind (free-tier `replace_active`). */
  archiveActive(householdId: string, kind: string): Promise<string[]>;
  /**
   * Puts a plan archived by `replace_active` back to `active` after the replacement failed, unless
   * another plan of the household is active by now. Returns whether it was restored.
   */
  restoreReplaced(householdId: string, planId: string): Promise<boolean>;
  enqueue(mealPlanId: string, attempt: number): Promise<number | null>;
  dequeue(visibilitySeconds: number, qty: number): Promise<QueueMessage[]>;
  ack(msgId: number): Promise<void>;
  writePlanWeek(mealPlanId: string, week: PlanWeekPayload): Promise<number>;
  planMeals(mealPlanId: string): Promise<StoredDailyMeal[]>;
  insertSafetyEvents(rows: SafetyEventInsert[]): Promise<void>;
  audit(entry: {
    actor: string | null;
    householdId: string;
    action: string;
    entity: string;
    entityId: string | null;
    diff: Record<string, unknown>;
  }): Promise<void>;
}

// ---- Supabase implementation ---------------------------------------------------------------------

function check<T>(result: { data: T; error: PgErrorLike | null }): T {
  if (result.error) throw fromPostgrestError(result.error);
  return result.data;
}

const live = <T extends { deleted_at?: string | null }>(rows: T[] | null | undefined): T[] =>
  (rows ?? []).filter((r) => !r.deleted_at);

const PAGE = 1000;

/** Reads every row of a query in pages (PostgREST caps responses at `max_rows`). */
async function selectAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PgErrorLike | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const rows = check(await page(from, from + PAGE - 1)) ?? [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

const MEMBER_SELECT = `id, name, date_of_birth, life_stage, special_modules,
  allergies(id, kind, severity, deleted_at, allergens(code)),
  medications(food_interaction_flags, deleted_at),
  nutrition_goals(goal_type, deleted_at),
  medical_conditions(label, deleted_at),
  food_dislikes(ingredient_id, label, reason, deleted_at),
  food_preferences(id, ingredient_id, label, strength, is_safe_food, deleted_at)`;

interface MemberRow {
  id: string;
  name: string;
  date_of_birth: string | null;
  life_stage: LifeStage;
  special_modules: SpecialModule[] | null;
  allergies: Array<{
    id: string;
    kind: string;
    severity: Severity;
    deleted_at: string | null;
    allergens: { code: string } | null;
  }>;
  medications: Array<{ food_interaction_flags: string[] | null; deleted_at: string | null }>;
  nutrition_goals: Array<{ goal_type: GoalType; deleted_at: string | null }>;
  medical_conditions: Array<{ label: string; deleted_at: string | null }>;
  food_dislikes: Array<{
    ingredient_id: string | null;
    label: string;
    reason: MemberRecord['dislikes'][number]['reason'];
    deleted_at: string | null;
  }>;
  food_preferences: Array<{
    id: string;
    ingredient_id: string | null;
    label: string;
    strength: number;
    is_safe_food: boolean;
    deleted_at: string | null;
  }>;
}

function toMember(r: MemberRow): MemberRecord {
  const prefs = live(r.food_preferences);
  return {
    id: r.id,
    name: r.name,
    date_of_birth: r.date_of_birth,
    life_stage: r.life_stage,
    special_modules: r.special_modules ?? [],
    // An allergy whose allergen code does not resolve cannot be matched; it is carried as
    // unresolved and blocks planning for the member (see assertAllergiesResolved).
    unresolved_allergy_ids: live(r.allergies)
      .filter((a) => !a.allergens?.code)
      .map((a) => a.id),
    allergies: live(r.allergies)
      .filter((a) => a.allergens?.code)
      .map((a) => ({
        allergen_code: a.allergens?.code ?? '',
        severity: a.severity,
        kind: a.kind === 'intolerance' ? 'intolerance' : 'allergy',
      })),
    medication_flags: live(r.medications).flatMap((m) => m.food_interaction_flags ?? []),
    goals: live(r.nutrition_goals).map((g) => g.goal_type),
    conditions: live(r.medical_conditions).map((c) => c.label.toLowerCase()),
    dislikes: live(r.food_dislikes).map((d) => ({
      ingredient_id: d.ingredient_id,
      label: d.label,
      reason: d.reason,
    })),
    likes: prefs
      .filter((p) => !p.is_safe_food)
      .map((p) => ({ ingredient_id: p.ingredient_id, label: p.label, strength: p.strength })),
    safe_foods: prefs
      .filter((p) => p.is_safe_food)
      .map((p) => ({
        id: p.id,
        ingredient_id: p.ingredient_id,
        label: p.label,
        strength: p.strength,
      })),
  };
}

interface ComponentJson {
  recipe_id?: string;
  ingredient_ids?: string[];
}

interface RecipeRow {
  id: string;
  cost_tier: number;
  prep_min: number;
  cook_min: number;
  kid_friendly: boolean;
  autism_friendly: boolean;
  review_status: ReviewStatus;
  household_id: string | null;
  recipe_ingredients: Array<{ ingredient_id: string }>;
}

const REVIEW_RANK: Record<ReviewStatus, number> = {
  rejected: 0,
  unverified: 1,
  in_review: 2,
  verified: 3,
};

/** Builds `CatalogMeal`s; a meal with a component that did not load (filtered out) is dropped. */
export function buildCatalog(args: {
  meals: Array<{
    id: string;
    code: string | null;
    title: string;
    meal_type: PlanMealType;
    components: ComponentJson[];
    plate_split: { veg_fruit: number; protein: number; carb: number };
    household_id: string | null;
    source: string;
    review_status: ReviewStatus;
  }>;
  recipes: RecipeRow[];
  ingredients: CatalogIngredient[];
  portions: Array<{
    id: string;
    meal_id: string;
    life_stage: LifeStage;
    tier: string;
    grams: number;
    kcal: number | null;
  }>;
  alternatives: Array<{ meal_id: string; alternative_meal_id: string; reason: string }>;
}): Catalog {
  const recipes = new Map(args.recipes.map((r) => [r.id, r]));
  const ingredients = new Map(args.ingredients.map((i) => [i.id, i]));
  const portions = new Map<string, CatalogPortion[]>();
  for (const p of args.portions) {
    const list = portions.get(p.meal_id) ?? [];
    list.push({
      id: p.id,
      lifeStage: p.life_stage,
      tier: p.tier as PortionTier,
      grams: Number(p.grams),
      kcal: p.kcal === null ? null : Number(p.kcal),
    });
    portions.set(p.meal_id, list);
  }
  const alternatives = new Map<string, Array<{ mealId: string; reason: AlternativeReason }>>();
  for (const a of args.alternatives) {
    const list = alternatives.get(a.meal_id) ?? [];
    list.push({ mealId: a.alternative_meal_id, reason: a.reason as AlternativeReason });
    alternatives.set(a.meal_id, list);
  }
  const meals = new Map<string, CatalogMeal>();
  for (const m of args.meals) {
    const comps = Array.isArray(m.components) ? m.components : [];
    const used: RecipeRow[] = [];
    const ingredientIds = new Set<string>();
    let complete = comps.length > 0;
    for (const c of comps) {
      if (c.recipe_id) {
        const r = recipes.get(c.recipe_id);
        if (!r) {
          complete = false;
          break;
        }
        used.push(r);
        for (const ri of r.recipe_ingredients) ingredientIds.add(ri.ingredient_id);
      } else if (Array.isArray(c.ingredient_ids) && c.ingredient_ids.length) {
        for (const id of c.ingredient_ids) ingredientIds.add(id);
      } else {
        complete = false;
        break;
      }
    }
    if (!complete) continue;
    const statuses = [m.review_status, ...used.map((r) => r.review_status)];
    const least = statuses.reduce((a, b) => (REVIEW_RANK[b] < REVIEW_RANK[a] ? b : a));
    const ps = m.plate_split ?? { veg_fruit: 0, protein: 0, carb: 0 };
    meals.set(m.id, {
      id: m.id,
      code: m.code,
      title: m.title,
      mealType: m.meal_type,
      ingredientIds: [...ingredientIds],
      plateSplit: {
        veg_fruit: Number(ps.veg_fruit ?? 0),
        protein: Number(ps.protein ?? 0),
        carb: Number(ps.carb ?? 0),
      },
      costTier: Math.min(3, Math.max(1, ...used.map((r) => r.cost_tier), 1)) as 1 | 2 | 3,
      prepMin: Math.max(0, ...used.map((r) => r.prep_min + r.cook_min)),
      kidFriendly: used.length > 0 && used.every((r) => r.kid_friendly),
      autismFriendly: used.length > 0 && used.every((r) => r.autism_friendly),
      portions: portions.get(m.id) ?? [],
      alternatives: alternatives.get(m.id) ?? [],
      householdId: m.household_id,
      source: m.source === 'ai_generated' || m.source === 'user' ? m.source : 'curated',
      reviewStatus: least,
    });
  }
  // Alternatives must point at meals that loaded.
  for (const [id, meal] of meals) {
    const alts = meal.alternatives.filter((a) => meals.has(a.mealId));
    if (alts.length !== meal.alternatives.length) meals.set(id, { ...meal, alternatives: alts });
  }
  return { meals, ingredients };
}

/** Service-role implementation. Every write sets `household_id` explicitly (06 §2.2). */
export function supabasePlanStore(admin: SupabaseClient): PlanStore {
  /** Global rows in a reviewed status, or this household's own rows (RLS is bypassed here). */
  const reviewed = (statuses: string[], householdId: string) =>
    `household_id.eq.${householdId},and(household_id.is.null,review_status.in.(${statuses.join(',')}))`;

  return {
    async household(householdId) {
      return check(
        await admin
          .from('households')
          .select('id, owner_user_id, country_code, timezone, currency, region_id, preferences')
          .eq('id', householdId)
          .is('deleted_at', null)
          .maybeSingle(),
      ) as PlanHouseholdRow | null;
    },
    async membership(householdId, userId) {
      const data = check(
        await admin
          .from('household_members')
          .select('role')
          .eq('household_id', householdId)
          .eq('user_id', userId)
          .is('deleted_at', null)
          .maybeSingle(),
      );
      return (data?.role as HouseholdRole | undefined) ?? null;
    },
    async userLocale(userId) {
      const row = check(await admin.from('users').select('locale').eq('id', userId).maybeSingle());
      return (row?.locale as string | undefined) ?? null;
    },
    async householdPremium(householdId) {
      return (
        check(await admin.rpc('household_has_premium', { p_household_id: householdId })) === true
      );
    },
    async activeConsents(userId, householdId) {
      const rows = check(
        await admin
          .from('consents')
          .select('kind, household_id')
          .eq('user_id', userId)
          .is('withdrawn_at', null),
      ) as { kind: ConsentKind; household_id: string | null }[];
      return rows
        .filter((r) => r.household_id === null || r.household_id === householdId)
        .map((r) => r.kind);
    },
    async featureEnabled(key) {
      const row = check(
        await admin.from('feature_flags').select('enabled').eq('key', key).maybeSingle(),
      );
      return row ? row.enabled === true : true;
    },
    async consumeRateLimit(key, limit, windowSeconds) {
      const rows = check(
        await admin.rpc('consume_rate_limit', {
          p_key: key,
          p_limit: limit,
          p_window_seconds: windowSeconds,
        }),
      ) as { allowed: boolean; remaining: number; reset_at: string }[];
      const row = rows[0];
      if (!row) throw new Error('consume_rate_limit returned no row');
      return row;
    },
    async idempotencyBegin(scope, userId, key, requestHash) {
      const inserted = await admin
        .from('idempotency_keys')
        .insert({ scope, user_id: userId, key, request_hash: requestHash, status: 'in_progress' })
        .select('id')
        .maybeSingle();
      if (!inserted.error && inserted.data) return { state: 'new', id: inserted.data.id as string };
      if (inserted.error && inserted.error.code !== '23505')
        throw fromPostgrestError(inserted.error);
      const existing = check(
        await admin
          .from('idempotency_keys')
          .select('id, request_hash, status, response_code, response_body, updated_at, expires_at')
          .eq('scope', scope)
          .eq('user_id', userId)
          .eq('key', key)
          .maybeSingle(),
      ) as {
        id: string;
        request_hash: string;
        status: 'in_progress' | 'completed' | 'failed';
        response_code: number | null;
        response_body: unknown;
        updated_at: string;
        expires_at: string;
      } | null;
      if (!existing) return { state: 'in_progress' };
      const expired = new Date(existing.expires_at).getTime() < Date.now();
      if (!expired && existing.request_hash !== requestHash) return { state: 'mismatch' };
      if (!expired && existing.status === 'completed') {
        return {
          state: 'replay',
          status: existing.response_code ?? 200,
          body: existing.response_body,
        };
      }
      const abandoned = Date.now() - new Date(existing.updated_at).getTime() > 5 * 60_000;
      if (existing.status === 'in_progress' && !abandoned && !expired)
        return { state: 'in_progress' };
      const taken = check(
        await admin
          .from('idempotency_keys')
          .update({
            status: 'in_progress',
            request_hash: requestHash,
            response_code: null,
            response_body: null,
            expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          })
          .eq('id', existing.id)
          .eq('updated_at', existing.updated_at)
          .select('id'),
      ) as { id: string }[];
      return taken.length ? { state: 'new', id: existing.id } : { state: 'in_progress' };
    },
    async idempotencyComplete(id, status, body) {
      check(
        await admin
          .from('idempotency_keys')
          .update({ status: 'completed', response_code: status, response_body: body })
          .eq('id', id),
      );
    },
    async idempotencyFail(id) {
      check(await admin.from('idempotency_keys').update({ status: 'failed' }).eq('id', id));
    },

    async members(householdId, ids) {
      let q = admin
        .from('family_members')
        .select(MEMBER_SELECT)
        .eq('household_id', householdId)
        .is('deleted_at', null)
        .order('sort_order');
      if (ids?.length) q = q.in('id', ids as string[]);
      return (check(await q) as unknown as MemberRow[]).map(toMember);
    },
    async latestAssessments(householdId, ids) {
      let q = admin
        .from('ai_assessments')
        .select('id, family_member_id, risk_flags, energy_targets, created_at')
        .eq('household_id', householdId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (ids?.length) q = q.in('id', ids as string[]);
      const rows = check(await q) as Array<{
        id: string;
        family_member_id: string;
        risk_flags: string[] | null;
        energy_targets: { display?: boolean; kcal_per_day?: number } | null;
      }>;
      const seen = new Set<string>();
      const out: AssessmentFacts[] = [];
      for (const r of rows) {
        if (seen.has(r.family_member_id)) continue;
        seen.add(r.family_member_id);
        const e = r.energy_targets ?? {};
        out.push({
          id: r.id,
          family_member_id: r.family_member_id,
          risk_flags: r.risk_flags ?? [],
          target_kcal:
            e.display === true && typeof e.kcal_per_day === 'number' ? e.kcal_per_day : null,
        });
      }
      return out;
    },
    async openSafetyEventMembers(householdId) {
      const rows = check(
        await admin
          .from('safety_events')
          .select('family_member_id')
          .eq('household_id', householdId)
          .is('resolved_at', null),
      ) as { family_member_id: string | null }[];
      return rows.map((r) => r.family_member_id);
    },
    async budgetProfile(householdId, id) {
      let q = admin
        .from('budget_profiles')
        .select('id, monthly_amount_minor, currency, strictness')
        .eq('household_id', householdId)
        .is('deleted_at', null);
      q = id ? q.eq('id', id) : q.eq('is_active', true);
      const row = check(await q.limit(1).maybeSingle()) as BudgetProfileRow | null;
      return row ? { ...row, monthly_amount_minor: Number(row.monthly_amount_minor) } : null;
    },
    async catalog(householdId) {
      const statuses = (check(await admin.rpc('catalog_review_statuses')) as string[] | null) ?? [
        'verified',
      ];
      const filter = reviewed(statuses, householdId);
      const [meals, recipes, ingredients, portions, alternatives] = await Promise.all([
        selectAll((from, to) =>
          admin
            .from('meals')
            .select(
              'id, code, title, meal_type, components, plate_split, household_id, source, review_status',
            )
            .is('deleted_at', null)
            .or(filter)
            .order('id')
            .range(from, to),
        ),
        selectAll((from, to) =>
          admin
            .from('recipes')
            .select(
              'id, cost_tier, prep_min, cook_min, kid_friendly, autism_friendly, review_status, household_id, recipe_ingredients(ingredient_id)',
            )
            .is('deleted_at', null)
            .or(filter)
            .order('id')
            .range(from, to),
        ),
        selectAll((from, to) =>
          admin
            .from('ingredients')
            .select(
              'id, name, category, halal_status, is_sunnah_food, ingredient_allergens(allergens(code))',
            )
            .eq('is_active', true)
            .order('id')
            .range(from, to),
        ),
        selectAll((from, to) =>
          admin
            .from('portions')
            .select('id, meal_id, life_stage, tier, grams, kcal')
            .not('meal_id', 'is', null)
            .or(filter)
            .order('id')
            .range(from, to),
        ),
        // meal_alternatives has no household_id: global review gating only.
        selectAll((from, to) =>
          admin
            .from('meal_alternatives')
            .select('meal_id, alternative_meal_id, reason')
            .in('review_status', statuses)
            .order('id')
            .range(from, to),
        ),
      ]);
      const ings = (
        ingredients as unknown as Array<{
          id: string;
          name: string;
          category: string;
          halal_status: HalalStatus;
          is_sunnah_food: boolean;
          ingredient_allergens: Array<{ allergens: { code: string } | null }>;
        }>
      ).map((i) => ({
        id: i.id,
        name: i.name,
        category: i.category,
        halalStatus: i.halal_status,
        isSunnahFood: i.is_sunnah_food,
        allergenCodes: (i.ingredient_allergens ?? [])
          .map((a) => a.allergens?.code)
          .filter((c): c is string => !!c),
      }));
      return {
        catalog: buildCatalog({
          meals: meals as Parameters<typeof buildCatalog>[0]['meals'],
          recipes: recipes as RecipeRow[],
          ingredients: ings,
          portions: portions as Parameters<typeof buildCatalog>[0]['portions'],
          alternatives: alternatives as Parameters<typeof buildCatalog>[0]['alternatives'],
        }),
        includeInReview: statuses.includes('in_review'),
      };
    },
    async seasonal(regionId, month) {
      if (!regionId) return new Map();
      const rows = check(
        await admin
          .from('seasonal_produce')
          .select('ingredient_id, availability')
          .eq('region_id', regionId)
          .eq('month', month),
      ) as { ingredient_id: string; availability: Availability }[];
      return new Map(rows.map((r) => [r.ingredient_id, r.availability]));
    },
    async verifiedRecommendations() {
      return check(
        await admin
          .from('recommendations')
          .select('id, code, applies_to, contraindications')
          .eq('review_status', 'verified')
          .order('code'),
      ) as RecommendationRow[];
    },

    async planHistory(householdId) {
      return check(
        await admin
          .from('meal_plans')
          .select('id, status, kind')
          .eq('household_id', householdId)
          .is('deleted_at', null)
          .order('created_at', { ascending: false })
          .limit(50),
      ) as Array<Pick<MealPlanRow, 'id' | 'status' | 'kind'>>;
    },
    async insertPlan(row) {
      return check(await admin.from('meal_plans').insert(row).select('*').single()) as MealPlanRow;
    },
    async plan(id) {
      return check(
        await admin
          .from('meal_plans')
          .select('*')
          .eq('id', id)
          .is('deleted_at', null)
          .maybeSingle(),
      ) as MealPlanRow | null;
    },
    async claimPlan(id, attempt) {
      const plan = check(
        await admin
          .from('meal_plans')
          .select('generation_progress')
          .eq('id', id)
          .eq('status', 'generating')
          .eq('generation_progress->>phase', 'queued')
          .maybeSingle(),
      ) as { generation_progress: Record<string, unknown> } | null;
      if (!plan) return false;
      const rows = check(
        await admin
          .from('meal_plans')
          .update({
            generation_progress: { ...plan.generation_progress, phase: 'safety_check', attempt },
          })
          .eq('id', id)
          .eq('status', 'generating')
          .eq('generation_progress->>phase', 'queued')
          .select('id'),
      ) as { id: string }[];
      return rows.length === 1;
    },
    async updatePlan(id, patch) {
      check(await admin.from('meal_plans').update(patch).eq('id', id));
    },
    async archiveActive(householdId, kind) {
      const rows = check(
        await admin
          .from('meal_plans')
          .update({ status: 'archived' })
          .eq('household_id', householdId)
          .eq('kind', kind)
          .eq('status', 'active')
          .is('deleted_at', null)
          .select('id'),
      ) as { id: string }[];
      return rows.map((r) => r.id);
    },
    async restoreReplaced(householdId, planId) {
      const active = check(
        await admin
          .from('meal_plans')
          .select('id')
          .eq('household_id', householdId)
          .in('status', ['active', 'generating'])
          .is('deleted_at', null)
          .limit(1),
      ) as { id: string }[];
      if (active.length) return false;
      // The entitlement trigger re-checks the one-active rule under its advisory lock.
      const res = await admin
        .from('meal_plans')
        .update({ status: 'active' })
        .eq('id', planId)
        .eq('household_id', householdId)
        .eq('status', 'archived')
        .is('deleted_at', null)
        .select('id');
      if (res.error?.message === 'PLAN_ALREADY_ACTIVE') return false;
      return (check(res) as { id: string }[]).length === 1;
    },
    async enqueue(mealPlanId, attempt) {
      const res = await admin.rpc('plan_generation_enqueue', {
        p_meal_plan_id: mealPlanId,
        p_attempt: attempt,
        p_delay_seconds: 0,
      });
      // Without pgmq (local test cluster) the caller runs the worker inline (S3-02 migration note).
      if (res.error?.message === 'QUEUE_UNAVAILABLE') return null;
      return check(res) as number;
    },
    async dequeue(visibilitySeconds, qty) {
      const res = await admin.rpc('plan_generation_read', {
        p_vt_seconds: visibilitySeconds,
        p_qty: qty,
      });
      if (res.error?.message === 'QUEUE_UNAVAILABLE') return [];
      return (check(res) ?? []) as QueueMessage[];
    },
    async ack(msgId) {
      const res = await admin.rpc('plan_generation_ack', { p_msg_id: msgId, p_archive: true });
      if (res.error?.message === 'QUEUE_UNAVAILABLE') return;
      check(res);
    },
    async writePlanWeek(mealPlanId, week) {
      return check(
        await admin.rpc('write_plan_week', { p_meal_plan_id: mealPlanId, p_week: week }),
      ) as number;
    },
    async planMeals(mealPlanId) {
      const rows = (await selectAll<unknown>((from, to) =>
        admin
          .from('daily_meals')
          .select(
            'id, plan_date, meal_type, slot, meal_id, notes, scheduled_time, batch_multiplier, is_lunchbox, meals!daily_meals_meal_id_fkey(title), daily_meal_servings(family_member_id, portion_id, adaptation, adapted_meal_id)',
          )
          .eq('meal_plan_id', mealPlanId)
          .order('plan_date')
          .order('meal_type')
          .order('slot')
          .range(from, to),
      )) as Array<
        Omit<StoredDailyMeal, 'title' | 'servings'> & {
          meals: { title: string } | null;
          daily_meal_servings: StoredDailyMeal['servings'];
        }
      >;
      return rows.map(({ meals, daily_meal_servings, ...r }) => ({
        ...r,
        batch_multiplier: Number(r.batch_multiplier),
        title: meals?.title ?? '',
        servings: daily_meal_servings ?? [],
      }));
    },
    async insertSafetyEvents(rows) {
      if (rows.length) check(await admin.from('safety_events').insert(rows));
    },
    async audit(e) {
      check(
        await admin.from('audit_log').insert({
          actor_user_id: e.actor,
          household_id: e.householdId,
          action: e.action,
          entity: e.entity,
          entity_id: e.entityId,
          diff: e.diff,
        }),
      );
    },
  };
}
