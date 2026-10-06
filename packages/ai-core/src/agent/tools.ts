import { z } from 'zod';

import type { ToolDefinition } from '../types.ts';
import { toolInputSchema } from './json-schema.ts';

/**
 * The `ai-chat` tool catalog (12 §8, authoritative). Input schemas are Zod; the provider schema is
 * generated from them. Every tool returns `{ ok: true, data }` or `{ ok: false, error }`.
 *
 * Write tools never write in chat (06 §4.1): they return a proposal card that the user confirms in
 * the app, which then calls PostgREST or the owning Edge Function. The only server-side write is
 * `escalate_to_clinician` (a `safety_events` row), which 12 §10.3 exempts from confirmation.
 */

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const MealTypeZ = z.enum(['suhoor', 'breakfast', 'lunch', 'snack', 'dinner', 'iftar']);

export const TOOL_INPUTS = {
  get_household_snapshot: z.object({
    include: z
      .array(
        z.enum([
          'members',
          'active_plan',
          'budget',
          'recent_logs',
          'growth',
          'exposures',
          'calendar',
        ]),
      )
      .optional(),
    familyMemberIds: z.array(uuid).optional(),
  }),
  calculate_energy_needs: z.object({
    familyMemberId: uuid,
    overrides: z
      .object({
        weightKg: z.number().min(2).max(300).optional(),
        heightCm: z.number().min(40).max(230).optional(),
        activityLevel: z
          .enum(['sedentary', 'light', 'moderate', 'active', 'very_active'])
          .optional(),
        pregnancyTrimester: z.number().int().min(1).max(3).optional(),
        lactationInfantAgeMonths: z.number().int().min(0).max(24).optional(),
      })
      .optional(),
    include: z.array(z.enum(['energy', 'macros', 'micronutrients'])).optional(),
  }),
  search_meals: z.object({
    query: z.string().max(200).optional(),
    mealTypes: z.array(MealTypeZ).optional(),
    forFamilyMemberIds: z.array(uuid).min(1),
    filters: z
      .object({
        kidFriendly: z.boolean().optional(),
        autismFriendly: z.boolean().optional(),
        ramadanSuitable: z.boolean().optional(),
        maxCostTier: z.number().int().min(1).max(3).optional(),
        maxTotalMinutes: z.number().int().min(5).max(240).optional(),
        includeIngredients: z.array(z.string()).max(5).optional(),
        excludeIngredients: z.array(z.string()).max(10).optional(),
        sunnahFoods: z.boolean().optional(),
      })
      .optional(),
    limit: z.number().int().min(1).max(10).optional(),
  }),
  generate_meal_plan: z.object({
    startDate: isoDate,
    weekCount: z.number().int().min(1).max(4),
    kind: z.enum(['standard', 'growth', 'weight_management', 'custom']),
    familyMemberIds: z.array(uuid).min(1),
    mealSlots: z.array(z.enum(['breakfast', 'lunch', 'snack', 'dinner'])).min(1),
    userConfirmed: z.boolean(),
  }),
  adjust_meal_plan: z.object({
    mealPlanId: uuid,
    changeRequest: z.string().min(3).max(1000),
    scope: z
      .object({
        fromDate: isoDate.optional(),
        toDate: isoDate.optional(),
        mealTypes: z.array(MealTypeZ).optional(),
        familyMemberIds: z.array(uuid).optional(),
      })
      .optional(),
    userConfirmed: z.boolean(),
  }),
  build_grocery_list: z.object({
    mealPlanId: uuid,
    period: z.enum(['weekly', 'monthly', 'adhoc']),
    startsOn: isoDate,
    endsOn: isoDate,
  }),
  estimate_cost: z.object({
    target: z.union([
      z.object({ kind: z.literal('meal_plan'), mealPlanId: uuid }),
      z.object({ kind: z.literal('grocery_list'), groceryListId: uuid }),
      z.object({
        kind: z.literal('meal'),
        mealId: uuid,
        servings: z.number().int().min(1).max(30).optional(),
      }),
    ]),
  }),
  compute_hydration_target: z.object({
    familyMemberId: uuid,
    date: isoDate.optional(),
    fasting: z.boolean().optional(),
    save: z.boolean().optional(),
  }),
  search_islamic_sources: z.object({
    query: z.string().min(2).max(300),
    kinds: z.array(z.enum(['quran', 'hadith', 'imam_narration', 'scholarly'])).optional(),
    traditionOverride: z.enum(['sunni', 'shia']).optional(),
    limit: z.number().int().min(1).max(8).optional(),
  }),
  get_growth_status: z.object({
    familyMemberId: uuid,
    includeTrend: z.boolean().optional(),
  }),
  log_meal: z.object({
    familyMemberId: uuid,
    eatenAt: z.string().datetime({ offset: true }),
    mealType: MealTypeZ,
    description: z.string().min(2).max(500),
    status: z.enum(['eaten', 'partly_eaten', 'skipped', 'swapped']).optional(),
    fullnessBefore: z.number().int().min(0).max(10).nullable().optional(),
    fullnessAfter: z.number().int().min(0).max(10).nullable().optional(),
  }),
  create_exposure_ladder: z.object({
    familyMemberId: uuid,
    targetFood: z.string().min(2).max(100),
    strategy: z.enum(['exposure_ladder', 'food_chaining']),
  }),
  plan_ramadan: z.object({
    hijriYear: z.number().int().min(1447).max(1500),
    city: z.string().max(100).optional(),
    participation: z
      .array(
        z.object({
          familyMemberId: uuid,
          intent: z.enum([
            'fasting',
            'not_fasting',
            'practice_partial',
            'undecided',
            'clinician_decision_pending',
          ]),
          exemptionReason: z
            .enum([
              'age',
              'pregnancy',
              'breastfeeding',
              'illness',
              'travel',
              'menstruation',
              'other',
            ])
            .nullable()
            .optional(),
        }),
      )
      .min(1),
    suhoorStrategy: z.enum(['late_light', 'late_full', 'early_full']).optional(),
    userConfirmed: z.boolean(),
  }),
  analyze_meal_photo: z.object({
    attachmentId: z.string(),
    familyMemberId: uuid.nullable().optional(),
    userDescription: z.string().max(300).optional(),
  }),
  escalate_to_clinician: z.object({
    familyMemberId: uuid.nullable().optional(),
    category: z.enum([
      'eating_disorder',
      'child_weight_loss',
      'faltering_growth',
      'dehydration',
      'pregnancy_complication',
      'severe_allergy',
      'diabetes_fasting_risk',
      'self_harm',
      'other_medical',
    ]),
    urgency: z.enum(['emergency_now', 'same_day', 'soon', 'routine']),
    evidence: z.string().max(500),
    recommendedClinician: z.enum([
      'emergency_services',
      'gp',
      'paediatrician',
      'obstetrician_midwife',
      'dietitian',
      'endocrinologist',
      'mental_health',
      'allergist',
    ]),
  }),
  // Additions beyond 12 §8 (S5-03 "log water", "log fast"). They are exposed only when the
  // `ChatToolName` contract lists them, so SSE events always validate.
  log_hydration: z.object({
    familyMemberId: uuid,
    volumeMl: z.number().int().min(10).max(3000),
    beverage: z.enum(['water', 'milk', 'laban', 'juice', 'tea', 'other']).optional(),
    loggedAt: z.string().datetime({ offset: true }).optional(),
  }),
  log_fasting: z.object({
    familyMemberId: uuid,
    fastDate: isoDate,
    kind: z.enum([
      'ramadan',
      'sunnah_monday_thursday',
      'ayyam_al_bid',
      'arafah',
      'ashura',
      'qada',
      'nafl',
    ]),
    completed: z.boolean(),
    isPracticeFast: z.boolean().optional(),
  }),
} as const;

export type AgentToolName = keyof typeof TOOL_INPUTS;
export type ToolInput<N extends AgentToolName> = z.infer<(typeof TOOL_INPUTS)[N]>;

interface ToolMeta {
  description: string;
  tier: 'free' | 'premium';
  sideEffects: 'none' | 'writes';
  timeoutMs: number;
  /** Status line shown while the tool runs (SSE `tool.call.display`). `{name}` = member name. */
  label: { en: string; ur: string };
}

const META: Record<AgentToolName, ToolMeta> = {
  get_household_snapshot: {
    description:
      'Fetch the current household profile: members with ages, allergies, conditions, goals, modules, active plan summary and budget. The snapshot is already in context; call this only to expand collapsed members or after the user says they changed their profile.',
    tier: 'free',
    sideEffects: 'none',
    timeoutMs: 3000,
    label: { en: 'Checking the family profile...', ur: 'گھر والوں کی معلومات دیکھ رہا ہوں...' },
  },
  calculate_energy_needs: {
    description:
      'Compute energy and macronutrient targets for one family member using Mifflin-St Jeor (adults) or IOM EER (children), with pregnancy and lactation increments. Always use this tool for any energy or nutrient number; never estimate yourself. For members under 18 no number is returned and none may be shown.',
    tier: 'free',
    sideEffects: 'none',
    timeoutMs: 1000,
    label: { en: 'Working out {name}’s needs...', ur: '{name} کی ضروریات کا حساب...' },
  },
  search_meals: {
    description:
      'Search the curated meal catalog. Results are already filtered for halal status and for the allergens of the listed members, so every returned meal is safe to suggest for them. Use this before suggesting any specific meal or swap; never suggest a meal that was not returned.',
    tier: 'free',
    sideEffects: 'none',
    timeoutMs: 3000,
    label: {
      en: 'Finding meals that suit everyone...',
      ur: 'سب کے لیے موزوں کھانے ڈھونڈ رہا ہوں...',
    },
  },
  generate_meal_plan: {
    description:
      'Not available in chat yet: plans are created from the Plan tab. Do not call; tell the user to open the Plan tab.',
    tier: 'free',
    sideEffects: 'writes',
    timeoutMs: 5000,
    label: { en: 'Checking plan options...', ur: 'پلان کے اختیارات دیکھ رہا ہوں...' },
  },
  adjust_meal_plan: {
    description:
      'Propose a change to the active plan (remove a disliked food, swap a day, adapt for a member). This returns a confirmation card; nothing changes until the user taps Confirm in the app. Set userConfirmed only after the user agreed in the conversation.',
    tier: 'premium',
    sideEffects: 'writes',
    timeoutMs: 3000,
    label: { en: 'Preparing a plan change...', ur: 'پلان میں تبدیلی تیار کر رہا ہوں...' },
  },
  build_grocery_list: {
    description:
      'Not available in chat yet: grocery lists are built from the Grocery tab. Do not call; tell the user where to find it.',
    tier: 'free',
    sideEffects: 'writes',
    timeoutMs: 3000,
    label: { en: 'Checking the grocery list...', ur: 'سودا سلف کی فہرست دیکھ رہا ہوں...' },
  },
  estimate_cost: {
    description:
      "Estimate the cost of a meal plan or a grocery list from the household's regional price book (the latest saved grocery list). Use for any cost question; never quote prices yourself.",
    tier: 'free',
    sideEffects: 'none',
    timeoutMs: 5000,
    label: { en: 'Estimating the cost...', ur: 'خرچ کا اندازہ لگا رہا ہوں...' },
  },
  compute_hydration_target: {
    description:
      'Compute a daily fluid target and a timing schedule (water before meals, sips during, more after) for a family member, adjusted for age, pregnancy, breastfeeding, climate, activity and fasting. Use for any fluid amount.',
    tier: 'free',
    sideEffects: 'none',
    timeoutMs: 1000,
    label: { en: 'Working out {name}’s water...', ur: '{name} کے پانی کا حساب...' },
  },
  search_islamic_sources: {
    description:
      "Search verified Qur'an verses, hadith and narrations of the Imams (A.S.) about food, drink, fasting and eating etiquette, filtered to the user's tradition. Each result has a 'code'. You may cite only results returned by this tool in this turn, using the token [[src:CODE]] (and [[rec:CODE]] for a returned recommendation). If nothing relevant is returned, say so and do not cite.",
    tier: 'free',
    sideEffects: 'none',
    timeoutMs: 3000,
    label: { en: 'Looking up verified sources...', ur: 'تصدیق شدہ حوالے دیکھ رہا ہوں...' },
  },
  get_growth_status: {
    description: 'Not available yet (growth charts arrive in a later release). Do not call.',
    tier: 'free',
    sideEffects: 'none',
    timeoutMs: 3000,
    label: { en: 'Checking growth...', ur: 'بڑھوتری دیکھ رہا ہوں...' },
  },
  log_meal: {
    description:
      'Propose logging a meal a family member ate. Returns a confirmation card; the meal is saved only when the user confirms it in the app. Call only when the user clearly asks to log it.',
    tier: 'free',
    sideEffects: 'writes',
    timeoutMs: 3000,
    label: { en: 'Preparing the meal log...', ur: 'کھانے کا اندراج تیار کر رہا ہوں...' },
  },
  create_exposure_ladder: {
    description: 'Not available in chat yet. Do not call.',
    tier: 'premium',
    sideEffects: 'writes',
    timeoutMs: 3000,
    label: { en: 'Preparing a food ladder...', ur: 'نئی غذا کا مرحلہ وار منصوبہ...' },
  },
  plan_ramadan: {
    description:
      'Check a family Ramadan setup: participation per member (no fasting for under 7; optional gentle practice fasts for 7 to puberty; pregnancy, breastfeeding and medical decisions belong to the user with their clinician and scholar, and are recorded as chosen). Returns safety notes and opens the Ramadan planner; it never plans a fast for an under-7 or for a member on insulin or sulfonylureas.',
    tier: 'free',
    sideEffects: 'writes',
    timeoutMs: 3000,
    label: { en: 'Checking the Ramadan setup...', ur: 'رمضان کی تیاری دیکھ رہا ہوں...' },
  },
  analyze_meal_photo: {
    description: 'Not available in chat yet: use Log meal → Photo. Do not call.',
    tier: 'premium',
    sideEffects: 'none',
    timeoutMs: 3000,
    label: { en: 'Looking at the photo...', ur: 'تصویر دیکھ رہا ہوں...' },
  },
  escalate_to_clinician: {
    description:
      'Record a safety escalation and show the user a clear recommendation to contact a clinician (or emergency services for emergencies). Call whenever a red flag is present: eating disorder signals, rapid child weight loss, faltering growth, dehydration signs, pregnancy complications, severe allergic reaction, diabetes on insulin or sulfonylureas with fasting, self-harm. After calling, stop planning for the affected member in this turn.',
    tier: 'free',
    sideEffects: 'writes',
    timeoutMs: 2000,
    label: { en: 'Getting safety guidance...', ur: 'حفاظتی رہنمائی...' },
  },
  log_hydration: {
    description:
      'Propose logging a drink for a family member. Returns a confirmation card; nothing is saved until the user confirms in the app. Call only when the user clearly asks to log it.',
    tier: 'free',
    sideEffects: 'writes',
    timeoutMs: 2000,
    label: { en: 'Preparing the water log...', ur: 'پانی کا اندراج تیار کر رہا ہوں...' },
  },
  log_fasting: {
    description:
      'Propose logging a fast for a family member. Returns a confirmation card; nothing is saved until the user confirms in the app. Never for children under 7.',
    tier: 'free',
    sideEffects: 'writes',
    timeoutMs: 2000,
    label: { en: 'Preparing the fast log...', ur: 'روزے کا اندراج تیار کر رہا ہوں...' },
  },
};

/** Tools with no backing data yet; their handler returns a polite NOT_AVAILABLE result. */
export const NOT_AVAILABLE_TOOLS: ReadonlySet<AgentToolName> = new Set([
  'generate_meal_plan',
  'build_grocery_list',
  'get_growth_status',
  'create_exposure_ladder',
  'analyze_meal_photo',
]);

export const ALL_AGENT_TOOLS = Object.keys(TOOL_INPUTS) as AgentToolName[];

export function toolDefinition(name: AgentToolName): ToolDefinition {
  const m = META[name];
  return {
    name,
    description: m.description,
    inputSchema: toolInputSchema(TOOL_INPUTS[name]),
    inputZod: TOOL_INPUTS[name] as z.ZodType<unknown>,
    outputZod: z.unknown(),
    tier: m.tier,
    sideEffects: m.sideEffects,
    timeoutMs: m.timeoutMs,
  };
}

export function toolMeta(name: AgentToolName): ToolMeta {
  return META[name];
}

/**
 * Tools exposed to the model (12 §10.2): free users do not see premium tools; tools without
 * backing data are not offered at all (they still answer politely if called); `allowed` limits the
 * set to names the SSE contract accepts.
 */
export function toolsForTier(
  tier: 'free' | 'premium',
  allowed: (name: string) => boolean = () => true,
): ToolDefinition[] {
  return ALL_AGENT_TOOLS.filter(
    (n) =>
      allowed(n) && !NOT_AVAILABLE_TOOLS.has(n) && (tier === 'premium' || META[n].tier === 'free'),
  ).map(toolDefinition);
}

export function isAgentTool(name: string): name is AgentToolName {
  return Object.prototype.hasOwnProperty.call(TOOL_INPUTS, name);
}

export type ToolResult =
  | { ok: true; data: unknown; summary?: string; card?: Record<string, unknown> }
  | { ok: false; error: { code: string; message: string } };

export function notAvailable(name: AgentToolName, locale: 'en' | 'ur'): ToolResult {
  return {
    ok: false,
    error: {
      code: 'NOT_AVAILABLE',
      message:
        locale === 'ur'
          ? 'یہ سہولت ابھی چیٹ میں دستیاب نہیں۔ صارف کو ایپ کا متعلقہ حصہ کھولنے کا کہیں۔'
          : `${name} is not available in chat yet. Kindly point the user to the matching screen in the app instead.`,
    },
  };
}
