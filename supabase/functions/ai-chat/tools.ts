import {
  calculateEnergy,
  checkRamadanParticipation,
  climateBand,
  growthStatusView,
  dailyFluidTarget,
  hydrationSchedule,
  householdExclusions,
  macroTargets,
  memberConflicts,
  MissingAnthropometricsError,
  nameSimilarity,
  NOT_AVAILABLE_TOOLS,
  notAvailable,
  proposeExposureLadder,
} from '@thuluth/ai-core';
import type {
  AgentToolName,
  CatalogMeal,
  KnowledgeRetriever,
  PlanMealType,
  PlanRequest,
  RequestMetadata,
  ToolContext,
  ToolExecutor,
  ToolInput,
  ToolResult,
} from '@thuluth/ai-core';
import { formatMinor } from '@thuluth/shared';
import { ChatToolCard } from '@thuluth/shared/contracts/ai-chat.ts';

import { ageMonthsOf, isMinor, memberView } from './context.ts';
import type { ChatContext } from './context.ts';
import type { ChatMember, ChatStore } from './store.ts';

/**
 * `ai-chat` tool handlers (12 §8). Read tools answer from the context and deterministic engines;
 * write tools return proposal cards that the user confirms in the app (06 §4.1), so nothing here
 * writes. `escalate_to_clinician` is handled by the turn engine (it records a safety event).
 */

export interface ExecutorDeps {
  store: ChatStore;
  ctx: ChatContext;
  retriever: KnowledgeRetriever;
  metadata: RequestMetadata;
}

const SEVEN_YEARS = 84;

type Locale = 'en' | 'ur';
const t = (locale: Locale, en: string, ur: string) => (locale === 'ur' ? ur : en);

const fail = (code: string, message: string): ToolResult => ({
  ok: false,
  error: { code, message },
});

function memberOf(ctx: ChatContext, id: string): ChatMember | undefined {
  return ctx.members.find((m) => m.id === id);
}

const unknownMember = () =>
  fail('NOT_FOUND', 'That family member is not in this household. Use an id from the snapshot.');

export function chatToolExecutor(deps: ExecutorDeps): ToolExecutor {
  const { ctx } = deps;
  return async (name, input, tc) => {
    if (NOT_AVAILABLE_TOOLS.has(name)) return notAvailable(name, tc.locale);
    switch (name) {
      case 'get_household_snapshot':
        return snapshot(ctx, input as ToolInput<'get_household_snapshot'>, tc);
      case 'calculate_energy_needs':
        return energy(ctx, input as ToolInput<'calculate_energy_needs'>, tc);
      case 'search_meals':
        return searchMeals(deps, input as ToolInput<'search_meals'>, tc);
      case 'adjust_meal_plan':
        return adjustProposal(ctx, input as ToolInput<'adjust_meal_plan'>, tc);
      case 'estimate_cost':
        return estimateCost(deps, input as ToolInput<'estimate_cost'>, tc);
      case 'compute_hydration_target':
        return hydration(ctx, input as ToolInput<'compute_hydration_target'>, tc);
      case 'search_islamic_sources':
        return islamicSources(deps, input as ToolInput<'search_islamic_sources'>, tc);
      case 'log_meal':
        return logMeal(ctx, input as ToolInput<'log_meal'>, tc);
      case 'log_hydration':
        return logHydration(ctx, input as ToolInput<'log_hydration'>, tc);
      case 'log_fasting':
        return logFasting(ctx, input as ToolInput<'log_fasting'>, tc);
      case 'plan_ramadan':
        return planRamadan(ctx, input as ToolInput<'plan_ramadan'>, tc);
      case 'get_growth_status':
        return growthStatus(deps, input as ToolInput<'get_growth_status'>, tc);
      case 'create_exposure_ladder':
        return exposureLadder(deps, input as ToolInput<'create_exposure_ladder'>, tc);
      default:
        return notAvailable(name as AgentToolName, tc.locale);
    }
  };
}

// ---- read tools ----------------------------------------------------------------------------------

function snapshot(
  ctx: ChatContext,
  input: ToolInput<'get_household_snapshot'>,
  tc: ToolContext,
): ToolResult {
  const ids = input.familyMemberIds?.length ? new Set(input.familyMemberIds) : null;
  const members = ctx.members.filter((m) => !ids || ids.has(m.id));
  const include = new Set(input.include ?? ['members', 'active_plan', 'budget']);
  const data: Record<string, unknown> = {};
  if (include.has('members')) data.members = members.map((m) => memberView(ctx, m));
  if (include.has('active_plan')) data.activePlan = ctx.activePlan;
  if (include.has('budget') && ctx.budget) {
    data.budget = {
      monthly: formatMinor(ctx.budget.monthly_amount_minor, ctx.budget.currency, tc.locale),
      strictness: ctx.budget.strictness,
    };
  }
  const missing = [...include].filter((k) => !['members', 'active_plan', 'budget'].includes(k));
  if (missing.length) data.notAvailable = missing;
  return {
    ok: true,
    data,
    summary: t(tc.locale, `${members.length} family members`, `گھر کے ${members.length} افراد`),
  };
}

function energy(
  ctx: ChatContext,
  input: ToolInput<'calculate_energy_needs'>,
  tc: ToolContext,
): ToolResult {
  const m = memberOf(ctx, input.familyMemberId);
  if (!m) return unknownMember();
  const o = input.overrides ?? {};
  const ageMonths = ageMonthsOf(ctx, m);
  const trimester = (o.pregnancyTrimester ?? m.pregnancy?.trimester ?? null) as 1 | 2 | 3 | null;
  const pregnant = !!m.pregnancy || m.special_modules.includes('pregnancy');
  const breastfeeding = m.special_modules.includes('breastfeeding');
  const person = {
    ageMonths,
    sex: m.sex_at_birth,
    weightKg: o.weightKg ?? m.weight_kg,
    heightCm: o.heightCm ?? m.height_cm,
    activity: o.activityLevel ?? m.activity_level,
    pregnancy: pregnant
      ? { trimester, gestationalDiabetes: m.pregnancy?.gestational_diabetes ?? false }
      : undefined,
    lactation: breastfeeding ? { infantAgeMonths: o.lactationInfantAgeMonths ?? null } : undefined,
    goals: m.goals.map((g, i) => ({ goalType: g, isPrimary: i === 0 })),
  };
  let result;
  try {
    result = calculateEnergy(person);
  } catch (err) {
    if (err instanceof MissingAnthropometricsError) {
      return fail(
        'MISSING_MEASUREMENTS',
        'Weight and height are missing. Ask the user to add them in the profile; do not estimate.',
      );
    }
    throw err;
  }
  if (!result.displayToUser) {
    // Under 18: an internal estimate only. Any appearance in the reply is blocked (00 §10.3).
    tc.internalKcal.push(result.targetKcal, result.maintenanceKcal);
    return {
      ok: true,
      data: {
        displayToUser: false,
        instruction:
          'This member is under 18. Do not give any calorie, macro or weight number. Talk about food groups, variety, responsive feeding and regular meals instead.',
      },
      summary: t(tc.locale, `${m.name}: growing-child needs`, `${m.name}: بڑھتے بچے کی ضروریات`),
    };
  }
  const macros = macroTargets(person, result);
  return {
    ok: true,
    data: {
      displayToUser: true,
      method: result.method,
      maintenanceKcal: result.maintenanceKcal,
      targetKcal: result.targetKcal,
      increments: result.increments,
      goalAdjustmentKcal: result.goalAdjustmentKcal,
      ...(input.include?.includes('macros') !== false
        ? {
            macros: {
              proteinG: macros.proteinG,
              carbsG: macros.carbsG,
              fatG: macros.fatG,
              fiberG: macros.fiberG,
            },
          }
        : {}),
      warnings: result.warnings,
    },
    summary: t(
      tc.locale,
      `${m.name}: about ${result.targetKcal} kcal a day`,
      `${m.name}: تقریباً ${result.targetKcal} کیلوری روزانہ`,
    ),
  };
}

async function searchMeals(
  deps: ExecutorDeps,
  input: ToolInput<'search_meals'>,
  tc: ToolContext,
): Promise<ToolResult> {
  const { ctx } = deps;
  const targets = input.forFamilyMemberIds.map((id) => ctx.planMembers.find((p) => p.id === id));
  if (targets.some((p) => !p)) return unknownMember();
  const { catalog, includeInReview } = await deps.store.catalog(ctx.household.id);
  const prefs = ctx.household.preferences ?? {};
  const severe = ctx.planMembers.flatMap((m) =>
    m.allergies
      .filter((a) => a.severity === 'severe' || a.severity === 'anaphylactic')
      .map((a) => a.allergenCode),
  );
  const request = {
    startDate: ctx.today,
    weekCount: 1,
    mealTypes: [] as PlanMealType[],
    kind: 'standard' as const,
    members: ctx.planMembers,
    household: {
      id: ctx.household.id,
      allowMashbooh: prefs.allow_mashbooh === true,
      weekdayCookLimitMin: 240,
      weekendCookLimitMin: 240,
      budgetTier: null,
      budgetStrictness: null,
      seasonal: new Map(),
      includeInReview,
      severeAllergenCodes: severe,
    },
    seed: 1,
  } satisfies PlanRequest as PlanRequest;
  const f = input.filters ?? {};
  const ingredientNames = (meal: CatalogMeal) =>
    meal.ingredientIds.map((id) => catalog.ingredients.get(id)?.name.toLowerCase() ?? '');
  const query = input.query?.trim().toLowerCase() ?? '';
  const scored: Array<{ meal: CatalogMeal; score: number }> = [];
  for (const meal of catalog.meals.values()) {
    if (input.mealTypes?.length && !input.mealTypes.includes(meal.mealType as PlanMealType))
      continue;
    if (f.kidFriendly && !meal.kidFriendly) continue;
    if (f.autismFriendly && !meal.autismFriendly) continue;
    if (f.ramadanSuitable && !meal.ramadanSuitable) continue;
    if (f.maxCostTier && meal.costTier > f.maxCostTier) continue;
    if (f.maxTotalMinutes && meal.prepMin > f.maxTotalMinutes) continue;
    const names = ingredientNames(meal);
    const has = (word: string) => names.some((n) => n.includes(word.toLowerCase()));
    if (f.includeIngredients?.length && !f.includeIngredients.every(has)) continue;
    if (f.excludeIngredients?.some(has)) continue;
    if (
      f.sunnahFoods &&
      !meal.ingredientIds.some((id) => catalog.ingredients.get(id)?.isSunnahFood)
    )
      continue;
    if (householdExclusions(meal, request, catalog).length) continue;
    if (targets.some((p) => p && memberConflicts(meal, p, catalog).length)) continue;
    let score = 0;
    if (query) {
      const title = meal.title.toLowerCase();
      score = title.includes(query) ? 1 : nameSimilarity(title, query);
      if (score < 0.2 && !names.some((n) => query.includes(n) && n.length > 2)) continue;
    }
    scored.push({ meal, score });
  }
  scored.sort((a, b) => b.score - a.score || a.meal.prepMin - b.meal.prepMin);
  const meals = scored.slice(0, input.limit ?? 5).map(({ meal }) => ({
    mealId: meal.id,
    title: meal.title,
    mealType: meal.mealType,
    prepMinutes: meal.prepMin,
    costTier: meal.costTier,
    kidFriendly: meal.kidFriendly,
    autismFriendly: meal.autismFriendly,
  }));
  return {
    ok: true,
    data: {
      meals,
      note: meals.length
        ? 'Every meal here is halal and free of the listed members’ allergens. Suggest only these.'
        : 'No catalog meal matched. Say so and suggest the user relax a filter; do not invent a meal.',
    },
    summary: t(tc.locale, `${meals.length} meals found`, `${meals.length} کھانے ملے`),
  };
}

async function estimateCost(
  deps: ExecutorDeps,
  input: ToolInput<'estimate_cost'>,
  tc: ToolContext,
): Promise<ToolResult> {
  const target = input.target;
  if (target.kind === 'meal') return notAvailable('estimate_cost', tc.locale);
  const est = await deps.store.groceryEstimate(
    deps.ctx.household.id,
    target.kind === 'meal_plan'
      ? { mealPlanId: target.mealPlanId }
      : { groceryListId: target.groceryListId },
  );
  if (!est) {
    return fail(
      'NO_ESTIMATE',
      'There is no grocery list for this yet. Tell the user to build one from the Grocery tab to see the cost.',
    );
  }
  const total = formatMinor(est.estimated_total_minor, est.currency, tc.locale);
  return {
    ok: true,
    data: {
      estimatedTotal: total,
      currency: est.currency,
      startsOn: est.starts_on,
      endsOn: est.ends_on,
      source: 'latest saved grocery list (regional price book)',
    },
    summary: t(tc.locale, `About ${total}`, `تقریباً ${total}`),
  };
}

function hydration(
  ctx: ChatContext,
  input: ToolInput<'compute_hydration_target'>,
  tc: ToolContext,
): ToolResult {
  const m = memberOf(ctx, input.familyMemberId);
  if (!m) return unknownMember();
  const ageMonths = ageMonthsOf(ctx, m);
  const month = input.date ? Number(input.date.slice(5, 7)) : ctx.month;
  const climate = climateBand(ctx.household.climate_zone, month);
  const target = dailyFluidTarget({
    ageMonths,
    sex: m.sex_at_birth,
    weightKg: m.weight_kg,
    climate,
    activity: m.activity_level,
    pregnant: !!m.pregnancy || m.special_modules.includes('pregnancy'),
    breastfeeding: m.special_modules.includes('breastfeeding'),
  });
  const minor = isMinor(ctx, m);
  const fastingAsked = !!input.fasting;
  const fastingAllowed = fastingAsked && ageMonths >= SEVEN_YEARS;
  const schedule = fastingAllowed
    ? []
    : hydrationSchedule({
        dailyMl: target.dailyMl,
        isChild: minor,
        meals: (ctx.activePlan?.todays_meals ?? [])
          .filter((x) => x.time && ['breakfast', 'lunch', 'dinner'].includes(x.meal_type))
          .map((x) => ({
            mealType: x.meal_type as 'breakfast' | 'lunch' | 'dinner',
            time: (x.time ?? '').slice(0, 5),
          })),
      }).map((w) => ({ window: w.window, start: w.start, end: w.end, ml: w.ml }));
  return {
    ok: true,
    data: {
      dailyMl: target.dailyMl,
      climate,
      schedule,
      ...(fastingAllowed
        ? {
            fasting: {
              iftarMl: minor ? 150 : 250,
              suhoorMl: minor ? 300 : 500,
              note: 'Spread the rest between iftar and suhoor, at least 45 minutes apart.',
            },
          }
        : {}),
      ...(fastingAsked && !fastingAllowed
        ? { note: 'Children under 7 do not fast; give the normal day schedule.' }
        : {}),
      ...(target.note ? { engineNote: target.note } : {}),
      saved: false,
    },
    summary: t(
      tc.locale,
      `${m.name}: ${target.dailyMl} ml a day`,
      `${m.name}: روزانہ ${target.dailyMl} ملی لیٹر`,
    ),
  };
}

async function islamicSources(
  deps: ExecutorDeps,
  input: ToolInput<'search_islamic_sources'>,
  tc: ToolContext,
): Promise<ToolResult> {
  const preference = deps.ctx.user.tradition_preference;
  const args = {
    query: input.query,
    preference,
    traditionOverride: input.traditionOverride,
  };
  const [sources, recs] = await Promise.all([
    deps.retriever.searchSources(
      { ...args, kinds: input.kinds, limit: input.limit ?? 5 },
      deps.metadata,
    ),
    deps.retriever
      .match({ ...args, itemKinds: ['recommendation'], limit: 3 }, deps.metadata)
      .catch(() => []),
  ]);
  const recRows = recs.filter((r) => r.item_kind === 'recommendation');
  // Defence in depth: only rows that are citable right now (verified, approved, not retracted).
  const citable = await deps.store.citable(
    sources.map((s) => s.islamic_source_id),
    recRows.map((r) => r.item_id),
  );
  const okSources = sources.filter((s) => citable.sources.has(s.islamic_source_id));
  const okRecs = recRows.filter((r) => citable.recommendations.has(r.item_id));
  for (const s of okSources) {
    tc.citations.add('src', s.code, {
      kind: 'islamic_source',
      refId: s.islamic_source_id,
      label: s.citation_text,
      tradition: s.tradition,
    });
  }
  for (const r of okRecs) {
    tc.citations.add('rec', r.code, { kind: 'recommendation', refId: r.item_id, label: r.label });
  }
  const n = okSources.length + okRecs.length;
  return {
    ok: true,
    data: {
      sources: okSources.map((s) => ({
        code: s.code,
        kind: s.kind,
        tradition: s.tradition,
        citation: s.citation_text,
      })),
      recommendations: okRecs.map((r) => ({ code: r.code, title: r.label })),
      instruction: n
        ? 'Cite only these, with [[src:CODE]] or [[rec:CODE]] right after the sentence that uses them. Do not quote text that is not shown here.'
        : 'No verified source was found. Say so plainly and do not cite or quote any source.',
    },
    summary: t(tc.locale, `${n} verified sources`, `${n} تصدیق شدہ حوالے`),
  };
}

// ---- proposal tools (never write) ----------------------------------------------------------------

function adjustProposal(
  ctx: ChatContext,
  input: ToolInput<'adjust_meal_plan'>,
  tc: ToolContext,
): ToolResult {
  const plan = ctx.activePlan;
  if (!plan || plan.id !== input.mealPlanId) {
    return fail(
      'NOT_FOUND',
      'That plan is not the household’s active plan. Use the active plan id.',
    );
  }
  if (ctx.role !== 'owner' && ctx.role !== 'caregiver') {
    return fail('FORBIDDEN', 'Only the household owner or a caregiver can change the plan.');
  }
  const s = input.scope ?? {};
  const names = (s.familyMemberIds ?? [])
    .map((id) => memberOf(ctx, id)?.name)
    .filter((x): x is string => !!x);
  const parts = [
    s.fromDate || s.toDate
      ? `${s.fromDate ?? plan.start_date} to ${s.toDate ?? plan.end_date}`
      : 'whole plan',
    s.mealTypes?.length ? s.mealTypes.join(', ') : null,
    names.length ? `for ${names.join(', ')}` : null,
  ].filter(Boolean);
  return {
    ok: true,
    data: {
      proposed: true,
      instruction:
        'A confirmation card is shown. Nothing changes until the user taps Confirm; say that plainly.',
    },
    summary: t(tc.locale, 'Plan change ready to confirm', 'پلان کی تبدیلی تصدیق کے لیے تیار'),
    card: {
      kind: 'plan_adjustment_proposal',
      meal_plan_id: plan.id,
      change_request: input.changeRequest,
      scope_summary: parts.join('; '),
    },
  };
}

const proposal = (
  table: 'meal_logs' | 'hydration_logs' | 'fasting_logs',
  values: Record<string, unknown>,
  summary: string,
): ToolResult => ({
  ok: true,
  data: {
    proposed: true,
    instruction: 'A confirmation card is shown. It is saved only when the user taps Save.',
  },
  summary,
  card: {
    kind: 'log_proposal',
    table,
    values: Object.fromEntries(
      Object.entries(values).filter(([, v]) => v !== undefined && v !== null),
    ),
  },
});

function logMeal(ctx: ChatContext, input: ToolInput<'log_meal'>, tc: ToolContext): ToolResult {
  const m = memberOf(ctx, input.familyMemberId);
  if (!m) return unknownMember();
  return proposal(
    'meal_logs',
    {
      household_id: ctx.household.id,
      family_member_id: m.id,
      eaten_at: input.eatenAt,
      meal_type: input.mealType,
      description: input.description,
      fullness_before: input.fullnessBefore,
      fullness_after: input.fullnessAfter,
      source: 'manual',
    },
    t(tc.locale, `Log ${m.name}’s ${input.mealType}?`, `${m.name} کا کھانا درج کریں؟`),
  );
}

function logHydration(
  ctx: ChatContext,
  input: ToolInput<'log_hydration'>,
  tc: ToolContext,
): ToolResult {
  const m = memberOf(ctx, input.familyMemberId);
  if (!m) return unknownMember();
  return proposal(
    'hydration_logs',
    {
      household_id: ctx.household.id,
      family_member_id: m.id,
      volume_ml: input.volumeMl,
      beverage: input.beverage ?? 'water',
      logged_at: input.loggedAt,
    },
    t(
      tc.locale,
      `Log ${input.volumeMl} ml for ${m.name}?`,
      `${m.name} کے لیے ${input.volumeMl} ملی لیٹر درج کریں؟`,
    ),
  );
}

function logFasting(
  ctx: ChatContext,
  input: ToolInput<'log_fasting'>,
  tc: ToolContext,
): ToolResult {
  const m = memberOf(ctx, input.familyMemberId);
  if (!m) return unknownMember();
  if (ageMonthsOf(ctx, m) < SEVEN_YEARS) {
    return fail(
      'CHILD_RULE',
      'Children under 7 do not fast. Suggest joining the family at suhoor or iftar instead.',
    );
  }
  return proposal(
    'fasting_logs',
    {
      household_id: ctx.household.id,
      family_member_id: m.id,
      fast_date: input.fastDate,
      kind: input.kind,
      completed: input.completed,
      is_practice_fast: input.isPracticeFast ?? (isMinor(ctx, m) ? true : undefined),
    },
    t(tc.locale, `Log ${m.name}’s fast?`, `${m.name} کا روزہ درج کریں؟`),
  );
}

/**
 * Checks a Ramadan setup without writing (the Ramadan planner saves it): no fasting for under-7s,
 * insulin or sulfonylurea users go to a clinician first, and pregnancy or breastfeeding decisions
 * are recorded exactly as the user chose (15 §5).
 */
function planRamadan(
  ctx: ChatContext,
  input: ToolInput<'plan_ramadan'>,
  tc: ToolContext,
): ToolResult {
  const facts = ctx.members.map((m) => ({
    id: m.id,
    name: m.name,
    ageMonths: ageMonthsOf(ctx, m),
    medicationFlags: m.medication_flags,
    gestationalDiabetes: m.pregnancy?.gestational_diabetes ?? false,
    pregnant: !!m.pregnancy || m.special_modules.includes('pregnancy'),
    breastfeeding: m.special_modules.includes('breastfeeding'),
  }));
  const checked = checkRamadanParticipation(facts, input.participation);
  if (checked.unknownIds.length) return unknownMember();
  return {
    ok: true,
    data: {
      participation: checked.participation,
      saved: false,
      instruction: checked.escalate
        ? 'A member on insulin or sulfonylureas wants to fast: call escalate_to_clinician (category diabetes_fasting_risk) and do not plan their fast.'
        : 'Summarise each member’s setup kindly. The user saves it in the Ramadan planner.',
    },
    summary: t(tc.locale, 'Ramadan setup checked', 'رمضان کی تیاری دیکھ لی گئی'),
  };
}

// ---- growth and exposure ladders (S6) ------------------------------------------------------------

/**
 * `get_growth_status` (12 §8.10): the percentiles `growth-compute` stored, alert codes and, for
 * premium, the trend. No weights, heights, kcal or targets are returned for anyone.
 */
async function growthStatus(
  deps: ExecutorDeps,
  input: ToolInput<'get_growth_status'>,
  tc: ToolContext,
): Promise<ToolResult> {
  const { ctx } = deps;
  const m = memberOf(ctx, input.familyMemberId);
  if (!m) return unknownMember();
  if (!isMinor(ctx, m)) {
    return fail(
      'NOT_A_CHILD',
      'Growth charts are for children under 18. For adults, talk about habits and the weight log in the app; do not compute anything.',
    );
  }
  const rows = await deps.store.growthRows(ctx.household.id, m.id, 24);
  const view = growthStatusView(rows, {
    includeTrend: input.includeTrend === true,
    premium: ctx.tier === 'premium',
  });
  const trendLocked = input.includeTrend === true && ctx.tier !== 'premium';
  return {
    ok: true,
    data: {
      ...view,
      ...(trendLocked ? { trendNote: 'The growth trend is a Premium feature.' } : {}),
    },
    summary: view.latest
      ? t(tc.locale, `${m.name}: growth checked`, `${m.name}: بڑھوتری دیکھ لی گئی`)
      : t(tc.locale, `${m.name}: no measurements yet`, `${m.name}: ابھی کوئی پیمائش نہیں`),
  };
}

/**
 * `create_exposure_ladder` (12 §8.12): a proposal card the parent saves in the app; nothing is
 * written here. The card kind is validated against the shared contract and left off when the
 * contract does not list it yet, so the SSE stream always validates.
 */
async function exposureLadder(
  deps: ExecutorDeps,
  input: ToolInput<'create_exposure_ladder'>,
  tc: ToolContext,
): Promise<ToolResult> {
  const { ctx } = deps;
  const m = memberOf(ctx, input.familyMemberId);
  if (!m) return unknownMember();
  if (ctx.role !== 'owner' && ctx.role !== 'caregiver') {
    return fail('FORBIDDEN', 'Only the household owner or a caregiver can set up a food ladder.');
  }
  const pm = ctx.planMembers.find((p) => p.id === m.id);
  if (!pm) return unknownMember();
  const [{ catalog }, sensory] = await Promise.all([
    deps.store.catalog(ctx.household.id),
    m.special_modules.includes('autism')
      ? deps.store.sensoryProfile(ctx.household.id, m.id)
      : Promise.resolve(null),
  ]);
  const severe = ctx.planMembers.flatMap((x) =>
    x.allergies
      .filter((a) => a.severity === 'severe' || a.severity === 'anaphylactic')
      .map((a) => a.allergenCode),
  );
  const result = proposeExposureLadder({
    member: pm,
    targetFood: input.targetFood,
    strategy: input.strategy,
    startStage: input.startStage,
    bridgeFromSafeFood: input.bridgeFromSafeFood ?? null,
    ingredients: catalog.ingredients,
    sensory,
    allowMashbooh: ctx.household.preferences?.allow_mashbooh === true,
    severeAllergenCodes: severe,
  });
  if (!result.ok) return fail(result.code, result.message);
  const p = result.proposal;
  const card = ChatToolCard.safeParse({
    kind: 'exposure_ladder_proposal',
    family_member_id: m.id,
    target_food: p.targetFood,
    target_ingredient_id: p.targetIngredientId,
    strategy: p.strategy,
    steps: p.steps,
  });
  const foods = p.chain.map((c) => c.label);
  return {
    ok: true,
    data: {
      proposed: true,
      saved: false,
      strategy: p.strategy,
      fallback: p.fallback,
      targetFood: p.targetFood,
      chain: foods,
      steps: p.steps.map((s) => ({ step: s.step_no, food: s.food_label, stage: s.stage })),
      notes: p.notes,
      instruction: card.success
        ? 'A proposal card is shown. Nothing is saved until the parent reviews it and taps Save. Describe the steps warmly, with no pressure, bribes or hiding foods.'
        : 'Describe these steps warmly, with no pressure, bribes or hiding foods, and tell the parent they can save the ladder from the child’s Food ladders screen. Nothing was saved.',
    },
    summary: t(
      tc.locale,
      `Food ladder for ${m.name} ready to review`,
      `${m.name} کے لیے غذا کا مرحلہ وار منصوبہ تیار`,
    ),
    ...(card.success ? { card: card.data as Record<string, unknown> } : {}),
  };
}
