import {
  adjustedRequest,
  adjustSafetyEscalation,
  adjustUserText,
  AIError,
  budgetTierFor,
  buildCandidateSets,
  buildSlots,
  chatMetered,
  CHILD_GROWTH_FIRST,
  classifyInput,
  classifyOutputWithModel,
  diffReason,
  editIssues,
  escalationFor,
  evaluateChoices,
  extractJson,
  fallbackChoices,
  guestMultiplier,
  hardViolations,
  isMinor,
  isServed,
  mealIngredients,
  PLAN_ADJUST_PROMPT_KEY,
  PLAN_ADJUST_PROMPT_VERSION,
  PLAN_ADJUST_SYSTEM,
  PLAN_SELECT_PROMPT_KEY,
  PLAN_SELECT_PROMPT_VERSION,
  PLAN_SELECT_SYSTEM,
  PlanAdjustEdits,
  PlanningError,
  planningStops,
  PlanSelection,
  PLAN_TEMPLATES,
  rationaleProblems,
  repairText,
  resolveSelection,
  selectionUserText,
  solveDeterministic,
  templateChoices,
  templateRationale,
  textOf,
} from '@thuluth/ai-core';
import type {
  AiUsageInsert,
  CandidateSetWithPool,
  Catalog,
  ChatMessage,
  EscalationOut,
  EscalationReason,
  Evaluated,
  FallbackDeps,
  Locale,
  PlanMealType,
  PlanMember,
  PlannedMeal,
  PlanRequest,
  RequestMetadata,
  RouteKey,
  Slot,
  Violation,
  WeeklyTemplate,
} from '@thuluth/ai-core';
import type { PlanDiffItem } from '@thuluth/shared/contracts/ai-adjust-plan.ts';
import type { ErrorCode } from '@thuluth/shared/contracts/errors.ts';
import type { LifeStage } from '@thuluth/shared';

import { matchRecommendations } from '../../ai-intake-assess/assess.ts';
import { HttpError } from '../errors.ts';
import { notificationRow, routeFor } from '../notifications/templates.ts';
import type {
  AssessmentFacts,
  BudgetProfileRow,
  MealPlanRow,
  MemberRecord,
  PlanHouseholdRow,
  PlanStore,
  PlanWeekPayload,
  SafetyEventInsert,
  StoredDailyMeal,
} from './store.ts';

/**
 * The plan pipeline shared by `ai-generate-plan` (public route and worker) and `ai-adjust-plan`
 * (12 §11-12, 14 §8): context loading, the safety stop, candidate sets from the engine, model
 * composition over candidate refs with one repair, deterministic fallback, validation and writes.
 * The model only ever picks candidate refs; every meal, portion and number comes from the catalog.
 */

export interface PipelineDeps {
  store: PlanStore;
  fallback: FallbackDeps;
  writeUsage: (row: AiUsageInsert) => Promise<void>;
  now: () => Date;
}

export type GenerationMode = 'full' | 'template_personalize';

/** What the public route stores in `meal_plans.generation_meta` for the worker. */
export interface GenerationMeta {
  job: 'generate' | 'adjust';
  user_id: string;
  request_id: string;
  locale: Locale;
  tier: 'free' | 'premium';
  /** False when the `ai.plan.enabled` kill switch is off: engine and templates only. */
  ai_enabled: boolean;
  mode?: GenerationMode;
  template_key?: string | null;
  /** Plan archived by a free-tier `replace_active`; restored if this generation fails. */
  replaced_plan_id?: string | null;
  family_member_ids?: string[] | null;
  assessment_ids?: string[] | null;
  meal_types?: PlanMealType[];
  preferences?: {
    max_prep_min_weekday?: number | undefined;
    repeat_tolerance?: 'low' | 'medium' | 'high';
    sunnah_foods_emphasis?: boolean;
    batch_cooking?: boolean;
    cuisines?: string[] | undefined;
  };
  /** Adjust jobs. */
  change_request?: string;
  scope?: AdjustScope;
}

export interface AdjustScope {
  from_date: string;
  to_date: string;
  family_member_ids?: string[] | undefined;
  meal_types?: PlanMealType[] | undefined;
}

/** 14 §8.9 default times; the app lets families move them. */
export const DEFAULT_TIMES: Record<PlanMealType, string> = {
  suhoor: '04:30',
  breakfast: '07:15',
  lunch: '13:30',
  snack: '16:30',
  dinner: '19:45',
  iftar: '18:15',
};

const STAGE_MONTHS: Record<LifeStage, number> = {
  infant: 6,
  toddler: 24,
  child: 96,
  teen: 192,
  adult: 360,
  older_adult: 840,
};

const MODEL_DEADLINE_MS = { 'plan.generate': 120_000, 'plan.adjust': 60_000 } as const;

export function localDate(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

export function ageMonthsOn(dob: string | null, today: string, stage: LifeStage): number {
  if (!dob) return STAGE_MONTHS[stage];
  const [y1, m1, d1] = dob.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = today.split('-').map(Number) as [number, number, number];
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0));
}

export const isMinorRecord = (r: MemberRecord, today: string): boolean =>
  ageMonthsOn(r.date_of_birth, today, r.life_stage) < 216;

export function toPlanMember(
  r: MemberRecord,
  a: AssessmentFacts | undefined,
  today: string,
  stopWeightGoals: boolean,
): PlanMember {
  const ageMonths = ageMonthsOn(r.date_of_birth, today, r.life_stage);
  return {
    id: r.id,
    name: r.name,
    ageMonths,
    lifeStage: r.life_stage,
    allergies: r.allergies.map((x) => ({
      allergenCode: x.allergen_code,
      severity: x.severity,
      kind: x.kind,
    })),
    dislikes: r.dislikes.map((d) => ({
      ingredientId: d.ingredient_id,
      label: d.label,
      reason: d.reason,
    })),
    likes: r.likes.map((l) => ({
      ingredientId: l.ingredient_id,
      label: l.label,
      strength: l.strength,
    })),
    safeFoods: r.safe_foods.map((s) => ({
      id: s.id,
      ingredientId: s.ingredient_id,
      label: s.label,
      strength: s.strength,
    })),
    modules: r.special_modules,
    medicationFlags: r.medication_flags,
    goals: stopWeightGoals
      ? r.goals.filter((g) => g !== 'weight_loss' && g !== 'weight_gain')
      : r.goals,
    energyTargetKcal: ageMonths >= 216 ? (a?.target_kcal ?? null) : null,
  };
}

// ---- context -------------------------------------------------------------------------------------

export interface PlanContext {
  household: PlanHouseholdRow;
  records: MemberRecord[];
  members: PlanMember[];
  assessments: AssessmentFacts[];
  catalog: Catalog;
  budget: BudgetProfileRow | null;
  req: PlanRequest;
  today: string;
  /** First safety stop found (S1 in 12 §11): plan generation must not continue. */
  escalation: EscalationOut | null;
  /**
   * Household members with an allergy whose allergen code did not resolve. Planning fails closed
   * for the whole household (cross-contact cannot be checked either).
   */
  unresolvedAllergies: Array<{ family_member_id: string; name: string }>;
}

/** Fail closed on allergies that cannot be matched to ingredients (coordinator S3 fix 1). */
export function assertAllergiesResolved(ctx: Pick<PlanContext, 'unresolvedAllergies'>): void {
  if (!ctx.unresolvedAllergies.length) return;
  const names = ctx.unresolvedAllergies.map((m) => m.name).join(', ');
  throw new HttpError(
    'AI_OUTPUT_INVALID',
    `An allergy for ${names} could not be checked against the food catalog. Please review it in the family profile, then try again.`,
    {
      reason: 'unresolved_allergy',
      family_member_ids: ctx.unresolvedAllergies.map((m) => m.family_member_id),
      members: ctx.unresolvedAllergies,
    },
  );
}

export async function loadPlanContext(
  deps: PipelineDeps,
  args: {
    householdId: string;
    memberIds?: readonly string[] | null | undefined;
    assessmentIds?: readonly string[] | null | undefined;
    budgetProfileId?: string | null | undefined;
    startDate: string;
    weekCount: number;
    mealTypes: readonly PlanMealType[];
    kind: PlanRequest['kind'];
    preferences?: GenerationMeta['preferences'];
    locale: Locale;
    seed: number;
  },
): Promise<PlanContext> {
  const { store } = deps;
  const household = await store.household(args.householdId);
  if (!household) throw new HttpError('NOT_FOUND', 'Household not found.');
  const today = localDate(deps.now(), household.timezone);
  const all = await store.members(args.householdId);
  const records = args.memberIds?.length ? all.filter((m) => args.memberIds?.includes(m.id)) : all;
  const [assessments, open, budget, loaded, seasonal] = await Promise.all([
    store.latestAssessments(args.householdId, args.assessmentIds ?? undefined),
    store.openSafetyEventMembers(args.householdId),
    store.budgetProfile(args.householdId, args.budgetProfileId ?? undefined),
    store.catalog(args.householdId),
    store.seasonal(household.region_id, Number(args.startDate.slice(5, 7))),
  ]);
  const openSet = new Set(open);
  const byMember = new Map(assessments.map((a) => [a.family_member_id, a]));

  let escalation: EscalationOut | null = null;
  const members = records.map((r) => {
    const a = byMember.get(r.id);
    const stops = planningStops(a?.risk_flags ?? [], {
      memberId: r.id,
      minor: isMinorRecord(r, today),
      locale: args.locale,
      acknowledged: !openSet.has(r.id),
    });
    escalation ??= stops.escalation;
    return toPlanMember(r, a, today, stops.stopWeightGoals);
  });

  const prefs = household.preferences ?? {};
  const num = (v: unknown, d: number) => (typeof v === 'number' && v > 0 ? v : d);
  const served = members.filter(isServed).length;
  const severe = all.flatMap((r) =>
    r.allergies
      .filter((x) => x.severity === 'severe' || x.severity === 'anaphylactic')
      .map((x) => x.allergen_code),
  );
  const req: PlanRequest = {
    startDate: args.startDate,
    weekCount: args.weekCount,
    mealTypes: args.mealTypes,
    kind: args.kind,
    members,
    household: {
      id: household.id,
      allowMashbooh: prefs.allow_mashbooh === true,
      weekdayCookLimitMin: num(prefs.weekday_cook_limit_min, 45),
      weekendCookLimitMin: num(prefs.weekend_cook_limit_min, 180),
      budgetTier: budget
        ? budgetTierFor(budget.monthly_amount_minor, budget.currency, Math.max(1, served))
        : null,
      budgetStrictness: budget?.strictness ?? null,
      seasonal,
      includeInReview: loaded.includeInReview,
      severeAllergenCodes: [...new Set(severe)],
    },
    maxPrepMinWeekday: args.preferences?.max_prep_min_weekday,
    repeatTolerance: args.preferences?.repeat_tolerance ?? 'medium',
    sunnahEmphasis: args.preferences?.sunnah_foods_emphasis ?? true,
    seed: args.seed,
  };
  return {
    household,
    records,
    members,
    assessments,
    catalog: loaded.catalog,
    budget,
    req,
    today,
    escalation,
    unresolvedAllergies: all
      .filter((r) => r.unresolved_allergy_ids.length > 0)
      .map((r) => ({ family_member_id: r.id, name: r.name })),
  };
}

/** Deterministic seed from the plan id (reproducible regeneration). */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (const ch of id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

// ---- model composition ---------------------------------------------------------------------------

interface Composed extends Evaluated {
  fallbackSlots: string[];
  rationale: string | null;
  model: string | null;
  modelIssues: string[];
}

/**
 * One week (or one batch of swap slots): `plan.select` on the given route, one repair round with the
 * validator's findings, then the deterministic fallback for anything still failing.
 */
async function composeWeek(
  deps: PipelineDeps,
  ctx: { req: PlanRequest; catalog: Catalog; locale: Locale; metadata: RequestMetadata | null },
  weekSets: CandidateSetWithPool[],
  opts: { route: RouteKey; modelSets: CandidateSetWithPool[]; fixed: Map<string, string> },
): Promise<Composed> {
  const { req, catalog } = ctx;
  let rationale: string | null = null;
  let model: string | null = null;
  const modelIssues: string[] = [];
  let choices: Map<string, string> | null = null;
  const needsModel = ctx.metadata && opts.modelSets.some((s) => s.candidates.length > 1);

  if (needsModel && ctx.metadata) {
    const metadata = ctx.metadata;
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: selectionUserText({ sets: opts.modelSets, catalog, req, locale: ctx.locale }),
          },
        ],
      },
    ];
    const call = () =>
      chatMetered(
        opts.route,
        (route) => ({
          system: [{ type: 'text', text: PLAN_SELECT_SYSTEM, cache: true }],
          messages,
          maxOutputTokens: Math.min(route.params.maxOutputTokens ?? 4000, 8000),
          temperature: route.params.temperature ?? 0.3,
        }),
        metadata,
        { overallDeadlineMs: MODEL_DEADLINE_MS[opts.route as 'plan.generate'] ?? 60_000 },
        { fallback: deps.fallback, writeUsage: deps.writeUsage },
      );
    try {
      let result = await call();
      for (let round = 0; round <= 1; round++) {
        const text = textOf(result.response.content);
        let issues: string[] = [];
        let violations: Violation[] = [];
        try {
          const parsed = PlanSelection.parse(extractJson(text));
          const resolved = resolveSelection(opts.modelSets, parsed);
          const merged = new Map([...opts.fixed, ...resolved.choices]);
          issues = resolved.issues;
          violations = hardViolations(evaluateChoices(req, catalog, weekSets, merged).violations);
          choices = merged;
          rationale = parsed.rationale;
          model = result.route.model;
        } catch (err) {
          issues = [
            `invalid JSON: ${err instanceof Error ? err.message.slice(0, 200) : 'parse error'}`,
          ];
        }
        if (!issues.length && !violations.length) break;
        modelIssues.push(...issues, ...violations.map((v) => `${v.slotRef ?? 'plan'}:${v.code}`));
        if (round === 1) break;
        messages.push(
          { role: 'assistant', content: [{ type: 'text', text }] },
          { role: 'user', content: [{ type: 'text', text: repairText(issues, violations) }] },
        );
        result = await call();
      }
    } catch (err) {
      // Provider failures fall back to the engine (12 §11 S7); anything else is a bug.
      if (!(err instanceof AIError)) throw err;
      modelIssues.push(`model_unavailable:${err.code}`);
    }
  }

  const start = choices ?? new Map(solveDeterministic(weekSets, req, catalog, opts.fixed));
  const first = evaluateChoices(req, catalog, weekSets, start);
  if (!hardViolations(first.violations).length) {
    return { ...first, fallbackSlots: [], rationale, model, modelIssues };
  }
  // Keep the template's surviving slots fixed through the fallback where possible.
  const fb = fallbackChoices(req, catalog, weekSets, first);
  return { ...fb, rationale, model, modelIssues };
}

// ---- writes --------------------------------------------------------------------------------------

function servingsJson(pm: PlannedMeal) {
  return pm.servings.map((s) => ({
    family_member_id: s.memberId,
    portion_id: s.portionId,
    adaptation: s.adaptation,
    adapted_meal_id: s.adaptation === 'none' ? null : s.adaptedMealId,
  }));
}

/** `write_plan_week` payloads from planned meals (and copied rows), grouped by week and date. */
export function weekPayloads(
  startDate: string,
  rows: Array<{
    plan_date: string;
    meal_type: PlanMealType;
    slot: number;
    meal_id: string;
    scheduled_time: string | null;
    notes: string | null;
    batch_multiplier: number;
    is_lunchbox: boolean;
    servings: PlanWeekPayload['days'][number]['meals'][number]['servings'];
  }>,
  recommendations: PlanWeekPayload['recommendations'] = [],
): PlanWeekPayload[] {
  const weeks = new Map<number, Map<string, PlanWeekPayload['days'][number]>>();
  for (const r of rows) {
    const week = Math.floor(daysBetween(startDate, r.plan_date) / 7) + 1;
    const days = weeks.get(week) ?? new Map();
    weeks.set(week, days);
    const day = days.get(r.plan_date) ?? { plan_date: r.plan_date, meals: [] };
    days.set(r.plan_date, day);
    day.meals.push({
      meal_type: r.meal_type,
      slot: r.slot,
      meal_id: r.meal_id,
      scheduled_time: r.scheduled_time,
      notes: r.notes,
      batch_multiplier: r.batch_multiplier,
      source_daily_meal_id: null,
      is_lunchbox: r.is_lunchbox,
      servings: r.servings,
    });
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([week, days], i) => ({
      week,
      days: [...days.values()].sort((a, b) => a.plan_date.localeCompare(b.plan_date)),
      recommendations: i === 0 ? recommendations : [],
    }));
}

export function plannedRows(meals: readonly PlannedMeal[]) {
  return meals.map((pm) => ({
    plan_date: pm.slot.date,
    meal_type: pm.slot.mealType,
    slot: 1,
    meal_id: pm.mealId,
    scheduled_time: DEFAULT_TIMES[pm.slot.mealType],
    notes: pm.notes,
    batch_multiplier: 1,
    is_lunchbox: false,
    servings: servingsJson(pm),
  }));
}

async function planRecommendations(
  deps: PipelineDeps,
  ctx: PlanContext,
): Promise<PlanWeekPayload['recommendations']> {
  const recs = await deps.store.verifiedRecommendations();
  const out: PlanWeekPayload['recommendations'] = [];
  const seen = new Set<string>();
  for (const m of ctx.members.filter(isServed)) {
    const r = ctx.records.find((x) => x.id === m.id);
    for (const id of matchRecommendations(
      recs,
      {
        lifeStage: m.lifeStage,
        ageMonths: m.ageMonths,
        modules: [...m.modules],
        goals: [...m.goals],
        conditions: r?.conditions ?? [],
      },
      3,
    )) {
      const key = `${id}:${m.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ recommendation_id: id, family_member_id: m.id });
    }
  }
  return out;
}

/** Guards a model rationale (12 §13.4-13.9); returns the reviewed template when it fails. */
async function guardedRationale(
  deps: PipelineDeps,
  draft: string | null,
  ctx: { members: readonly PlanMember[]; locale: Locale; metadata: RequestMetadata | null },
  template: boolean,
): Promise<{ text: string; replaced: boolean }> {
  const hasMinor = ctx.members.some(isMinor);
  const fallback = templateRationale(ctx.locale, { hasMinor, template });
  if (!draft) return { text: fallback, replaced: false };
  if (rationaleProblems(draft, hasMinor).length) return { text: fallback, replaced: true };
  if (ctx.metadata) {
    const review = await classifyOutputWithModel(draft, {
      fallback: deps.fallback,
      writeUsage: deps.writeUsage,
      metadata: ctx.metadata,
    });
    if (review && !review.pass) return { text: fallback, replaced: true };
  }
  return { text: draft.trim(), replaced: false };
}

export const progress = (
  phase: string,
  plan: MealPlanRow,
  extra: Record<string, unknown> = {},
): Record<string, unknown> => ({
  ...plan.generation_progress,
  phase,
  total_weeks: plan.week_count,
  completed_weeks: Number(plan.generation_progress.completed_weeks ?? 0),
  attempt: Number(plan.generation_progress.attempt ?? 0),
  ...extra,
});

/**
 * `plan_ready` / `plan_failed` for the user who asked (04 §5.3 step 4, 06 §4.15). The dispatcher
 * sends it; copy is lock-screen safe (no reason, no member). Never fails the job.
 */
export async function notifyPlanOutcome(
  deps: PipelineDeps,
  plan: MealPlanRow,
  outcome: 'plan_ready' | 'plan_failed',
): Promise<void> {
  const userId = (plan.generation_meta.user_id as string | undefined) ?? plan.created_by_user_id;
  if (!userId) return;
  try {
    await deps.store.notify(
      notificationRow({
        key: outcome,
        user_id: userId,
        household_id: plan.household_id,
        locale: plan.generation_meta.locale as string | undefined,
        scheduled_for: deps.now(),
        dedupe_key: `${outcome}:${plan.id}`,
        route: routeFor(outcome, { meal_plan_id: plan.id }),
        data: { meal_plan_id: plan.id },
      }),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'plan_notification_failed',
        meal_plan_id: plan.id,
        error: String(err),
      }),
    );
  }
}

/** The failure path (06 §4.3): status failed, a reason, and the error code for the client. */
export async function failPlan(
  deps: PipelineDeps,
  plan: MealPlanRow,
  code: ErrorCode,
  reason: string,
  escalation?: EscalationOut,
  detail?: Record<string, unknown>,
): Promise<void> {
  await deps.store.updatePlan(plan.id, {
    status: 'failed',
    failure_reason: reason.slice(0, 500),
    generation_progress: progress('failed', plan, {
      error_code: code,
      ...(escalation ? { escalation } : {}),
      ...(detail && Object.keys(detail).length ? { detail } : {}),
    }),
  });
  // A failed free-tier replacement must not leave the household without its plan.
  const replaced = plan.generation_meta.replaced_plan_id;
  if (typeof replaced === 'string') {
    const restored = await deps.store
      .restoreReplaced(plan.household_id, replaced)
      .catch(() => false);
    if (restored) {
      await deps.store
        .audit({
          actor: (plan.generation_meta.user_id as string | undefined) ?? null,
          householdId: plan.household_id,
          action: 'update',
          entity: 'meal_plans',
          entityId: replaced,
          diff: { status: 'active', restored_after_failed: plan.id },
        })
        .catch(() => {});
    }
  }
  await deps.store
    .audit({
      actor: (plan.generation_meta.user_id as string | undefined) ?? null,
      householdId: plan.household_id,
      action: 'update',
      entity: 'meal_plans',
      entityId: plan.id,
      diff: { status: 'failed', error_code: code, reason: reason.slice(0, 200) },
    })
    .catch(() => {});
  await notifyPlanOutcome(deps, plan, 'plan_failed');
}

const SAFETY_CATEGORY: Record<EscalationReason, string> = {
  eating_disorder_signals: 'eating_disorder',
  rapid_child_weight_loss: 'child_weight_loss',
  faltering_growth: 'faltering_growth',
  dehydration_signs: 'dehydration',
  pregnancy_complication: 'pregnancy_complication',
  severe_allergy_reaction: 'severe_allergy',
  insulin_or_sulfonylurea_fasting: 'diabetes_fasting_risk',
  other_clinical: 'other_medical',
};

export function safetyEventFor(
  e: EscalationOut,
  householdId: string,
  userId: string,
  evidence: string,
): SafetyEventInsert {
  return {
    household_id: householdId,
    family_member_id: e.family_member_id,
    user_id: userId,
    source: 'plan_generation',
    category: SAFETY_CATEGORY[e.reason] ?? 'other_medical',
    urgency:
      e.recommend === 'emergency'
        ? 'emergency_now'
        : e.recommend === 'urgent_care'
          ? 'same_day'
          : 'soon',
    evidence: evidence.slice(0, 500),
  };
}

// ---- generation job ------------------------------------------------------------------------------

/** Error details safe to show in `generation_progress.detail` (no escalation duplicate). */
function detailOf(err: HttpError): Record<string, unknown> {
  const { escalation: _escalation, ...rest } = err.details;
  return rest;
}

export function templateFor(meta: GenerationMeta): WeeklyTemplate | undefined {
  return PLAN_TEMPLATES.find((t) => t.key === meta.template_key);
}

/**
 * The worker body for one generation job: status `generating` → `draft` (or `failed`), with
 * `generation_progress` updated per phase. Returns false when the plan was not claimable.
 */
export async function runGeneration(deps: PipelineDeps, planId: string): Promise<boolean> {
  const { store } = deps;
  const found = await store.plan(planId);
  if (!found || found.status !== 'generating') return false;
  const meta = found.generation_meta as unknown as GenerationMeta;
  const attempt = Number(found.generation_progress.attempt ?? 0) + 1;
  if (!(await store.claimPlan(planId, attempt))) return false;
  const plan: MealPlanRow = {
    ...found,
    generation_progress: { ...found.generation_progress, phase: 'safety_check', attempt },
  };
  try {
    if (meta.job === 'adjust') await runAdjustJob(deps, plan, meta);
    else await generate(deps, plan, meta);
    await notifyPlanOutcome(deps, plan, 'plan_ready');
  } catch (err) {
    const code: ErrorCode = err instanceof HttpError ? err.code : 'INTERNAL';
    if (!(err instanceof HttpError)) {
      console.error(JSON.stringify({ level: 'error', meal_plan_id: planId, error: String(err) }));
    }
    await failPlan(
      deps,
      plan,
      code,
      err instanceof HttpError ? err.message : 'Unexpected error while generating the plan.',
      err instanceof HttpError ? (err.details.escalation as EscalationOut | undefined) : undefined,
      err instanceof HttpError ? detailOf(err) : undefined,
    );
  }
  return true;
}

async function generate(deps: PipelineDeps, plan: MealPlanRow, meta: GenerationMeta) {
  const { store } = deps;
  const kind = plan.kind === 'ramadan' ? 'standard' : plan.kind;
  const ctx = await loadPlanContext(deps, {
    householdId: plan.household_id,
    memberIds: meta.family_member_ids,
    assessmentIds: meta.assessment_ids,
    budgetProfileId: plan.budget_profile_id,
    startDate: plan.start_date,
    weekCount: plan.week_count,
    mealTypes: meta.meal_types ?? ['breakfast', 'lunch', 'snack', 'dinner'],
    kind,
    preferences: meta.preferences,
    locale: meta.locale,
    seed: seedOf(plan.id),
  });

  assertAllergiesResolved(ctx);
  // S1 safety stop (12 §11): an unresolved hard red flag blocks generation.
  if (ctx.escalation) {
    await store.insertSafetyEvents([
      safetyEventFor(ctx.escalation, plan.household_id, meta.user_id, `plan:${plan.id}`),
    ]);
    throw new HttpError('SAFETY_ESCALATION', ctx.escalation.message, {
      escalation: ctx.escalation,
    });
  }

  await store.updatePlan(plan.id, { generation_progress: progress('generating', plan) });
  let sets: CandidateSetWithPool[];
  try {
    sets = buildCandidateSets(ctx.req, ctx.catalog);
  } catch (err) {
    if (err instanceof PlanningError) {
      throw new HttpError('AI_OUTPUT_INVALID', `No safe plan could be built: ${err.message}`, {
        reason: err.code,
        slot: err.slotRef,
      });
    }
    throw err;
  }

  const metadata: RequestMetadata | null = meta.ai_enabled
    ? {
        requestId: meta.request_id,
        userId: meta.user_id,
        householdId: plan.household_id,
        promptKey: PLAN_SELECT_PROMPT_KEY,
        promptVersion: PLAN_SELECT_PROMPT_VERSION,
        tier: meta.tier,
      }
    : null;
  const template = meta.mode === 'template_personalize' ? templateFor(meta) : undefined;
  const route: RouteKey = meta.mode === 'template_personalize' ? 'plan.adjust' : 'plan.generate';

  const weeks: Composed[] = [];
  const fallbackSlots: string[] = [];
  const issues: string[] = [];
  for (let week = 1; week <= plan.week_count; week++) {
    const weekSets = sets.filter((s) => s.slot.week === week);
    let fixed = new Map<string, string>();
    let modelSets = weekSets;
    if (template) {
      const t = templateChoices(template, weekSets, ctx.catalog);
      fixed = t.fixed;
      modelSets = weekSets.filter((s) => t.swapSlots.includes(s.slot.ref));
    }
    const composed = await composeWeek(
      deps,
      { req: ctx.req, catalog: ctx.catalog, locale: meta.locale, metadata },
      weekSets,
      { route, modelSets, fixed },
    );
    const hard = hardViolations(composed.violations);
    if (hard.length) {
      throw new HttpError('AI_OUTPUT_INVALID', 'No plan passed the safety checks.', {
        violations: hard.slice(0, 10).map((v) => `${v.slotRef ?? 'plan'}:${v.code}`),
      });
    }
    weeks.push(composed);
    fallbackSlots.push(...composed.fallbackSlots);
    issues.push(...composed.modelIssues);
  }

  await store.updatePlan(plan.id, {
    generation_progress: progress('validating', plan, { completed_weeks: 0 }),
  });
  const rationale = await guardedRationale(
    deps,
    weeks.find((w) => w.rationale)?.rationale ?? null,
    { members: ctx.members, locale: meta.locale, metadata },
    !!template,
  );

  const recommendations = await planRecommendations(deps, ctx);
  const payloads = weekPayloads(
    plan.start_date,
    weeks.flatMap((w) => plannedRows(w.draft.meals)),
    recommendations,
  );
  for (const p of payloads) await store.writePlanWeek(plan.id, p);

  const warnings = weeks.flatMap((w) => w.violations.filter((v) => !v.hard));
  await store.updatePlan(plan.id, {
    status: 'draft',
    rationale: rationale.text,
    weekly_themes: template
      ? Array.from({ length: plan.week_count }, (_, i) => ({
          week: i + 1,
          template_key: template.key,
          title: template.title,
        }))
      : [],
    generation_progress: progress('done', plan, { completed_weeks: plan.week_count }),
    generation_meta: {
      ...plan.generation_meta,
      engine: {
        model: weeks.find((w) => w.model)?.model ?? null,
        fallback_slots: fallbackSlots.length,
        model_issues: issues.slice(0, 20),
        warnings: [...new Set(warnings.map((w) => w.code))],
        skipped_members: weeks[0]?.draft.skippedMembers ?? [],
        rationale_replaced: rationale.replaced,
      },
    } as unknown as Record<string, unknown>,
  });
  await store.audit({
    actor: meta.user_id,
    householdId: plan.household_id,
    action: 'update',
    entity: 'meal_plans',
    entityId: plan.id,
    diff: {
      status: 'draft',
      mode: meta.mode,
      weeks: plan.week_count,
      fallback_slots: fallbackSlots.length,
    },
  });
}

// ---- adjustment ----------------------------------------------------------------------------------

export interface AdjustResult {
  diff: PlanDiffItem[];
  rationale: string;
  payloads: PlanWeekPayload[];
}

/** The child-rule escalation for a model-detected restriction on a minor (06 §4.4). */
function childEscalation(members: readonly PlanMember[], locale: Locale, memberId: string | null) {
  const minors = members.filter(isMinor);
  return {
    reason: 'other_clinical' as const,
    family_member_id: memberId ?? (minors.length === 1 ? (minors[0]?.id ?? null) : null),
    message: CHILD_GROWTH_FIRST[locale],
    recommend: 'see_pediatrician' as const,
  };
}

/**
 * Safety screen for a change request: rules first (adjustSafetyEscalation), then `classify.safety`.
 * Throws SAFETY_ESCALATION (422) after recording a `safety_events` row.
 */
export async function screenAdjustRequest(
  deps: PipelineDeps,
  args: {
    text: string;
    members: readonly PlanMember[];
    scopeMemberIds: readonly string[] | null;
    locale: Locale;
    householdId: string;
    userId: string;
    metadata: RequestMetadata | null;
  },
): Promise<void> {
  let escalation = adjustSafetyEscalation(
    args.text,
    args.members,
    args.scopeMemberIds,
    args.locale,
  );
  if (!escalation && args.metadata) {
    const c = await classifyInput(args.text, {
      fallback: deps.fallback,
      writeUsage: deps.writeUsage,
      metadata: args.metadata,
    });
    if (c.child_weight_request && args.members.some(isMinor)) {
      escalation = childEscalation(args.members, args.locale, null);
    } else if (c.safety === 'red_flag' || c.safety === 'emergency') {
      escalation = escalationFor(
        [
          {
            code: 'other_clinical',
            hard: true,
            severity: c.safety === 'emergency' ? 'urgent' : 'see_clinician',
            stops: 'all',
            reason: 'other_clinical',
            recommend: c.safety === 'emergency' ? 'emergency' : 'see_gp',
            evidence: {},
          },
        ],
        null,
        args.locale,
      );
    }
  }
  if (!escalation) return;
  await deps.store.insertSafetyEvents([
    safetyEventFor(escalation, args.householdId, args.userId, 'plan_adjust_request'),
  ]);
  throw new HttpError('SAFETY_ESCALATION', escalation.message, { escalation });
}

/** Maps the stored plan onto engine slots (slot 1 rows only; extra snacks are copied as-is). */
function currentChoices(slots: readonly Slot[], rows: readonly StoredDailyMeal[]) {
  const byKey = new Map(slots.map((s) => [`${s.date}:${s.mealType}`, s]));
  const choices = new Map<string, string>();
  const rowBySlot = new Map<string, StoredDailyMeal>();
  for (const r of rows) {
    if (r.slot !== 1) continue;
    const s = byKey.get(`${r.plan_date}:${r.meal_type}`);
    if (!s) continue;
    choices.set(s.ref, r.meal_id);
    rowBySlot.set(s.ref, r);
  }
  return { choices, rowBySlot };
}

const ADJUST_FALLBACK_RATIONALE: Record<Locale, string> = {
  en: 'Your plan was updated as you asked. Every swapped meal passed the same safety checks as the original plan.',
  ur: 'آپ کی درخواست کے مطابق منصوبہ بدل دیا گیا ہے۔ ہر نیا کھانا اسی طرح کی حفاظتی جانچ سے گزرا ہے۔',
};

/**
 * Computes an adjustment of `parent` without writing: model edits (refs only) → engine re-selection
 * of the affected slots → validation → diff and the full copy of the new version.
 */
export async function computeAdjustment(
  deps: PipelineDeps,
  args: {
    parent: MealPlanRow;
    changeRequest: string;
    scope: AdjustScope;
    locale: Locale;
    metadata: RequestMetadata;
  },
): Promise<AdjustResult & { ctx: PlanContext }> {
  const { parent, scope, locale } = args;
  const stored = await deps.store.planMeals(parent.id);
  const mealTypes = [...new Set(stored.filter((r) => r.slot === 1).map((r) => r.meal_type))];
  const parentMeta = parent.generation_meta as unknown as Partial<GenerationMeta>;
  const kind = parent.kind === 'ramadan' ? 'standard' : parent.kind;
  const ctx = await loadPlanContext(deps, {
    householdId: parent.household_id,
    memberIds: parentMeta.family_member_ids,
    budgetProfileId: parent.budget_profile_id,
    startDate: parent.start_date,
    weekCount: parent.week_count,
    mealTypes: mealTypes.length ? mealTypes : ['breakfast', 'lunch', 'snack', 'dinner'],
    kind,
    preferences: parentMeta.preferences,
    locale,
    seed: seedOf(parent.id),
  });
  assertAllergiesResolved(ctx);
  const slots = buildSlots(ctx.req);
  const { choices: current, rowBySlot } = currentChoices(slots, stored);
  const inScope = slots.filter(
    (s) =>
      current.has(s.ref) &&
      s.date >= scope.from_date &&
      s.date <= scope.to_date &&
      s.date >= ctx.today &&
      (!scope.meal_types?.length || scope.meal_types.includes(s.mealType)),
  );
  if (!inScope.length) {
    throw new HttpError(
      'VALIDATION_FAILED',
      'There are no upcoming meals in that range to change.',
      {
        field: 'scope',
      },
    );
  }
  const scopeRefs = new Set(inScope.map((s) => s.ref));

  // Current meals as planned meals (for the prompt).
  const currentPlanned: PlannedMeal[] = inScope.map((s) => ({
    slot: s,
    mealId: current.get(s.ref) ?? '',
    notes: null,
    servings: [],
  }));
  const { text, refs } = adjustUserText({
    changeRequest: args.changeRequest,
    current: currentPlanned,
    scopeRefs,
    catalog: ctx.catalog,
    members: ctx.members,
    locale,
  });
  const messages: ChatMessage[] = [{ role: 'user', content: [{ type: 'text', text }] }];
  const call = () =>
    chatMetered(
      'plan.adjust',
      (route) => ({
        system: [{ type: 'text', text: PLAN_ADJUST_SYSTEM, cache: true }],
        messages,
        maxOutputTokens: Math.min(route.params.maxOutputTokens ?? 2000, 4000),
        temperature: route.params.temperature ?? 0.2,
      }),
      {
        ...args.metadata,
        promptKey: PLAN_ADJUST_PROMPT_KEY,
        promptVersion: PLAN_ADJUST_PROMPT_VERSION,
      },
      { overallDeadlineMs: MODEL_DEADLINE_MS['plan.adjust'] },
      { fallback: deps.fallback, writeUsage: deps.writeUsage },
    );

  let edits: PlanAdjustEdits | null = null;
  try {
    let result = await call();
    for (let round = 0; round <= 1; round++) {
      const out = textOf(result.response.content);
      let problems: string[];
      try {
        const parsed = PlanAdjustEdits.parse(extractJson(out));
        problems = editIssues(parsed, refs);
        if (!problems.length) {
          edits = parsed;
          break;
        }
      } catch (err) {
        problems = [
          `invalid JSON: ${err instanceof Error ? err.message.slice(0, 200) : 'parse error'}`,
        ];
      }
      if (round === 1) break;
      messages.push(
        { role: 'assistant', content: [{ type: 'text', text: out }] },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `That was not valid:\n${problems.join('\n')}\nReturn the corrected JSON only. Keep all valid fields unchanged.`,
            },
          ],
        },
      );
      result = await call();
    }
  } catch (err) {
    if (err instanceof AIError) {
      throw new HttpError(
        err.code === 'TIMEOUT' ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE',
        'The assistant is unavailable right now. Please try again.',
      );
    }
    throw err;
  }
  if (!edits) {
    throw new HttpError(
      'AI_OUTPUT_INVALID',
      'The change could not be understood. Please rephrase it.',
    );
  }
  if (edits.needs_clarification) {
    throw new HttpError('VALIDATION_FAILED', 'Please tell us a little more about the change.', {
      needs_clarification: true,
      questions: edits.questions,
    });
  }
  // Second line of the child rule: the model named a minor to restrict.
  const restrictedMinor = edits.restrict_members
    .map((r) => refs.members.get(r))
    .find((m): m is PlanMember => !!m && isMinor(m));
  if (restrictedMinor) {
    const escalation = childEscalation(ctx.members, locale, restrictedMinor.id);
    await deps.store.insertSafetyEvents([
      safetyEventFor(escalation, parent.household_id, args.metadata.userId, 'plan_adjust_request'),
    ]);
    throw new HttpError('SAFETY_ESCALATION', escalation.message, { escalation });
  }
  const adultRestriction = edits.restrict_members.length > 0;

  const req = adjustedRequest(ctx.req, edits, refs);
  const adjReq: PlanRequest = adultRestriction ? { ...req, lighterCarbs: true } : req;
  const avoided = new Set(adjReq.avoidIngredientIds ?? []);
  const contains = (mealId: string | undefined) => {
    const meal = mealId ? ctx.catalog.meals.get(mealId) : undefined;
    return !meal || mealIngredients(meal, ctx.catalog).some((i) => avoided.has(i.id));
  };
  const named = new Set(edits.slots.filter((r) => scopeRefs.has(r)));
  const broad =
    edits.change_all ||
    (!named.size &&
      (edits.cheaper ||
        edits.lighter_carbs_for_adults ||
        adultRestriction ||
        edits.max_prep_min !== null));
  const affected = new Set(
    inScope
      .filter((s) => broad || named.has(s.ref) || contains(current.get(s.ref)))
      .map((s) => s.ref),
  );

  let sets: CandidateSetWithPool[];
  try {
    sets = buildCandidateSets(adjReq, ctx.catalog, inScope);
  } catch (err) {
    if (err instanceof PlanningError) {
      throw new HttpError(
        'VALIDATION_FAILED',
        'No safe meal fits that change for every slot. Try a smaller change.',
        {
          reason: err.code,
        },
      );
    }
    throw err;
  }
  // Unaffected slots keep their meal when it is still feasible under the new constraints.
  const fixed = new Map<string, string>();
  for (const s of sets) {
    const meal = current.get(s.slot.ref);
    if (!affected.has(s.slot.ref) && meal && s.pool.includes(meal)) fixed.set(s.slot.ref, meal);
    else affected.add(s.slot.ref);
  }
  // Prefer a different meal in changed slots (the request asked for a change).
  const changeSets = sets.map((s) =>
    affected.has(s.slot.ref)
      ? {
          ...s,
          pool: [
            ...s.pool.filter((id) => id !== current.get(s.slot.ref)),
            ...s.pool.filter((id) => id === current.get(s.slot.ref)),
          ],
        }
      : s,
  );
  let evaluated = evaluateChoices(
    adjReq,
    ctx.catalog,
    changeSets,
    solveDeterministic(changeSets, adjReq, ctx.catalog, fixed),
  );
  if (hardViolations(evaluated.violations).length) {
    evaluated = fallbackChoices(adjReq, ctx.catalog, changeSets, evaluated);
  }
  if (hardViolations(evaluated.violations).length) {
    throw new HttpError('AI_OUTPUT_INVALID', 'No adjusted plan passed the safety checks.', {
      violations: hardViolations(evaluated.violations)
        .slice(0, 10)
        .map((v) => `${v.slotRef ?? 'plan'}:${v.code}`),
    });
  }

  const guests = new Map(edits.guests.map((g) => [g.slot, g.extra_people]));
  const served = ctx.members.filter(isServed).length;
  const diff: PlanDiffItem[] = [];
  const planned = new Map(evaluated.draft.meals.map((pm) => [pm.slot.ref, pm]));
  const rows: Parameters<typeof weekPayloads>[1] = [];
  const touched = new Set<string>();
  for (const s of inScope) {
    const pm = planned.get(s.ref);
    const before = rowBySlot.get(s.ref);
    if (!pm || !before) continue;
    const extra = guests.get(s.ref);
    const changed = pm.mealId !== before.meal_id;
    if (!changed && !extra) continue;
    touched.add(before.id);
    const row = changed
      ? {
          ...plannedRows([pm])[0]!,
          scheduled_time: before.scheduled_time ?? DEFAULT_TIMES[s.mealType],
        }
      : {
          plan_date: before.plan_date,
          meal_type: before.meal_type,
          slot: before.slot,
          meal_id: before.meal_id,
          scheduled_time: before.scheduled_time,
          notes: before.notes,
          batch_multiplier: before.batch_multiplier,
          is_lunchbox: before.is_lunchbox,
          servings: before.servings,
        };
    if (extra) row.batch_multiplier = guestMultiplier(served, extra);
    rows.push(row);
    const afterTitle = ctx.catalog.meals.get(pm.mealId)?.title ?? '';
    diff.push({
      plan_date: s.date,
      meal_type: s.mealType,
      family_member_id: null,
      before: { meal_id: before.meal_id, title: before.title },
      after: { meal_id: pm.mealId, title: changed ? afterTitle : before.title },
      reason: changed
        ? diffReason(edits, contains(before.meal_id) && avoided.size > 0)
        : 'Cooks more for guests',
    });
  }
  // Every other row is copied unchanged (history stays on the parent version).
  for (const r of stored) {
    if (touched.has(r.id)) continue;
    rows.push({
      plan_date: r.plan_date,
      meal_type: r.meal_type,
      slot: r.slot,
      meal_id: r.meal_id,
      scheduled_time: r.scheduled_time,
      notes: r.notes,
      batch_multiplier: r.batch_multiplier,
      is_lunchbox: r.is_lunchbox,
      servings: r.servings,
    });
  }
  const summary = edits.summary;
  const hasMinor = ctx.members.some(isMinor);
  const rationale = rationaleProblems(summary, hasMinor).length
    ? ADJUST_FALLBACK_RATIONALE[locale]
    : summary;
  diff.sort(
    (a, b) => a.plan_date.localeCompare(b.plan_date) || a.meal_type.localeCompare(b.meal_type),
  );
  return { diff, rationale, payloads: weekPayloads(parent.start_date, rows), ctx };
}

/** Writes a computed adjustment into a `generating` plan row and moves it to `draft`. */
export async function persistAdjustment(
  deps: PipelineDeps,
  plan: MealPlanRow,
  result: AdjustResult,
  actor: string,
): Promise<void> {
  for (const p of result.payloads) await deps.store.writePlanWeek(plan.id, p);
  await deps.store.updatePlan(plan.id, {
    status: 'draft',
    rationale: result.rationale,
    generation_progress: progress('done', plan, { completed_weeks: plan.week_count }),
  });
  await deps.store.audit({
    actor,
    householdId: plan.household_id,
    action: 'insert',
    entity: 'meal_plans',
    entityId: plan.id,
    diff: {
      parent_plan_id: plan.parent_plan_id,
      version: plan.version,
      changes: result.diff.length,
    },
  });
}

async function runAdjustJob(deps: PipelineDeps, plan: MealPlanRow, meta: GenerationMeta) {
  if (!plan.parent_plan_id || !meta.change_request || !meta.scope) {
    throw new HttpError('VALIDATION_FAILED', 'The adjustment job is incomplete.');
  }
  const parent = await deps.store.plan(plan.parent_plan_id);
  if (!parent)
    throw new HttpError('PLAN_NOT_ADJUSTABLE', 'The original plan is no longer available.');
  await deps.store.updatePlan(plan.id, { generation_progress: progress('generating', plan) });
  const result = await computeAdjustment(deps, {
    parent,
    changeRequest: meta.change_request,
    scope: meta.scope,
    locale: meta.locale,
    metadata: {
      requestId: meta.request_id,
      userId: meta.user_id,
      householdId: plan.household_id,
      promptKey: PLAN_ADJUST_PROMPT_KEY,
      promptVersion: PLAN_ADJUST_PROMPT_VERSION,
      tier: meta.tier,
    },
  });
  await persistAdjustment(deps, plan, result, meta.user_id);
}
