import type { EntitlementStore } from '../../functions/_shared/entitlements.ts';
import { FakeProvider, RouteResolver } from '@thuluth/ai-core';
import type {
  AIError,
  AiModelRouteRow,
  AiUsageInsert,
  Catalog,
  CatalogMeal,
  ChatRequest,
  ChatResponse,
} from '@thuluth/ai-core';
import type { ConsentKind } from '@thuluth/shared/domain/consent.ts';
import type { HouseholdRole } from '@thuluth/shared';

import { INGREDIENTS, MEALS } from '../../../packages/ai-core/test/planning-fixtures.ts';
import { fromPostgrestError } from '../../functions/_shared/errors.ts';
import type { NotificationRow } from '../../functions/_shared/notifications/templates.ts';
import type {
  AssessmentFacts,
  FeedingContext,
  MealPlanRow,
  MemberRecord,
  PlanHouseholdRow,
  PlanStore,
  PlanWeekPayload,
  SafetyEventInsert,
  StoredDailyMeal,
} from '../../functions/_shared/plan/store.ts';

/**
 * In-memory `PlanStore` and a UUID version of the ai-core engine fixture catalog (the Usman family,
 * 01 §3.2), shared by the ai-generate-plan and ai-adjust-plan tests.
 */

export const HH = '00000000-0000-4000-b000-000000000001';
export const OWNER = '00000000-0000-4000-a000-000000000001';
export const VIEWER = '00000000-0000-4000-a000-000000000002';
export const USMAN = '00000000-0000-4000-c000-000000000001';
export const HINA = '00000000-0000-4000-c000-000000000002';
export const IBRAHIM = '00000000-0000-4000-c000-000000000003';
export const MARYAM = '00000000-0000-4000-c000-000000000004';
/** 2026-10-06 is a Tuesday; plans start on Monday 2026-10-12. */
export const NOW = new Date('2026-10-06T08:00:00Z');
export const START = '2026-10-12';
export const SECRET = 'test-internal-secret-0123456789';

const uuidFor = (n: number, group = '9000') =>
  `00000000-0000-4000-${group}-${n.toString(16).padStart(12, '0')}`;

/** Fixture meal ids (`d-karahi`) → UUIDs, alternatives remapped. */
export const MEAL_ID = new Map(MEALS.map((m, i) => [m.id, uuidFor(i + 1)]));
export const mealId = (fixtureId: string): string => MEAL_ID.get(fixtureId) ?? fixtureId;

export function uuidCatalog(): Catalog {
  const meals: CatalogMeal[] = MEALS.map((m) => ({
    ...m,
    id: mealId(m.id),
    portions: m.portions.map((p, i) => ({ ...p, id: uuidFor(i + 1, mealId(m.id).slice(-4)) })),
    alternatives: m.alternatives.map((a) => ({ ...a, mealId: mealId(a.mealId) })),
  }));
  return {
    meals: new Map(meals.map((m) => [m.id, m])),
    ingredients: new Map(INGREDIENTS.map((i) => [i.id, i])),
  };
}

const record = (over: Partial<MemberRecord> & Pick<MemberRecord, 'id' | 'name'>): MemberRecord => ({
  date_of_birth: '1988-06-01',
  life_stage: 'adult',
  special_modules: [],
  allergies: [],
  unresolved_allergy_ids: [],
  medication_flags: [],
  goals: [],
  conditions: [],
  dislikes: [],
  likes: [],
  safe_foods: [],
  ...over,
});

export const FAMILY: MemberRecord[] = [
  record({ id: USMAN, name: 'Usman', goals: ['weight_loss'] }),
  record({
    id: HINA,
    name: 'Hina',
    date_of_birth: '1992-03-15',
    special_modules: ['breastfeeding'],
  }),
  record({
    id: IBRAHIM,
    name: 'Ibrahim',
    date_of_birth: '2018-08-20',
    life_stage: 'child',
    special_modules: ['picky_eater'],
    safe_foods: [
      { id: 'sf-roti', ingredient_id: 'i-atta', label: 'Roti', strength: 3 },
      { id: 'sf-banana', ingredient_id: 'i-banana', label: 'Banana', strength: 2 },
    ],
  }),
  record({
    id: MARYAM,
    name: 'Maryam',
    date_of_birth: '2022-06-10',
    life_stage: 'child',
    special_modules: ['autism'],
    safe_foods: [{ id: 'sf-rice', ingredient_id: 'i-rice', label: 'Plain rice', strength: 3 }],
  }),
];

export interface MemoryOptions {
  premium?: boolean;
  members?: MemberRecord[];
  consents?: ConsentKind[];
  flags?: Record<string, boolean>;
  assessments?: AssessmentFacts[];
  openSafety?: Array<string | null>;
  plans?: MealPlanRow[];
  meals?: Map<string, StoredDailyMeal[]>;
  /** `food_exposures`, active ladders and sensory profiles per member (S6 exposure pair). */
  feeding?: FeedingContext[];
}

export function memoryStore(opts: MemoryOptions = {}) {
  const roles = new Map<string, HouseholdRole>([
    [OWNER, 'owner'],
    [VIEWER, 'viewer'],
  ]);
  const catalog = uuidCatalog();
  const household: PlanHouseholdRow = {
    id: HH,
    owner_user_id: OWNER,
    country_code: 'PK',
    timezone: 'Asia/Karachi',
    currency: 'PKR',
    region_id: null,
    preferences: { weekday_cook_limit_min: 60 },
  };
  const state = {
    premium: opts.premium ?? true,
    members: opts.members ?? FAMILY,
    consents: opts.consents ?? (['ai_processing', 'health_data', 'child_data'] as ConsentKind[]),
    flags: opts.flags ?? {},
    plans: new Map((opts.plans ?? []).map((p) => [p.id, p])),
    meals: opts.meals ?? new Map<string, StoredDailyMeal[]>(),
    safety: [] as SafetyEventInsert[],
    audits: [] as string[],
    enqueued: [] as string[],
    /** Delivery count per queued plan id (pgmq `read_ct`); default 1. */
    readCt: new Map<string, number>(),
    acked: [] as number[],
    notifications: [] as NotificationRow[],
    counters: new Map<string, number>(),
    idem: new Map<
      string,
      { id: string; hash: string; status?: number; body?: unknown; done: boolean }
    >(),
    weeks: [] as Array<{ planId: string; week: PlanWeekPayload }>,
    /** The caller's personal premium (17 §8); household scope follows `premium` (the owner). */
    userPremium: false,
    /** `household_is_read_only` (17 §10.3): a free owner's extra household. */
    readOnly: false,
    /** `since` of the last `feedingContext` read. */
    feedingSince: null as string | null,
  };
  let n = 0;
  const entitlements: EntitlementStore = {
    userPremium: async () => state.userPremium,
    householdPremium: async () => state.premium,
    householdReadOnly: async () => state.readOnly,
  };
  const store: PlanStore = {
    household: async (id) => (id === HH ? household : null),
    membership: async (_h, u) => roles.get(u) ?? null,
    userLocale: async () => 'en',
    householdPremium: async () => state.premium,
    activeConsents: async () => state.consents,
    featureEnabled: async (key) => state.flags[key] ?? true,
    consumeRateLimit: async (key, limit) => {
      const c = (state.counters.get(key) ?? 0) + 1;
      state.counters.set(key, c);
      return {
        allowed: c <= limit,
        remaining: Math.max(0, limit - c),
        reset_at: '2026-10-06T08:01:00Z',
      };
    },
    idempotencyBegin: async (_scope, user, key, hash) => {
      const k = `${user}:${key}`;
      const row = state.idem.get(k);
      if (!row) {
        const id = crypto.randomUUID();
        state.idem.set(k, { id, hash, done: false });
        return { state: 'new', id };
      }
      if (row.hash !== hash) return { state: 'mismatch' };
      if (!row.done) return { state: 'in_progress' };
      return { state: 'replay', status: row.status ?? 200, body: row.body };
    },
    idempotencyComplete: async (id, status, body) => {
      for (const row of state.idem.values())
        if (row.id === id) Object.assign(row, { status, body, done: true });
    },
    idempotencyFail: async (id) => {
      for (const [k, row] of state.idem) if (row.id === id) state.idem.delete(k);
    },
    members: async (_h, ids) =>
      ids?.length ? state.members.filter((m) => ids.includes(m.id)) : state.members,
    latestAssessments: async () => opts.assessments ?? [],
    openSafetyEventMembers: async () => opts.openSafety ?? [],
    budgetProfile: async () => null,
    catalog: async () => ({ catalog, includeInReview: false }),
    seasonal: async () => new Map(),
    feedingContext: async (_h, ids, since) => {
      state.feedingSince = since;
      return (opts.feeding ?? []).filter((f) => ids.includes(f.family_member_id));
    },
    verifiedRecommendations: async () => [
      {
        id: '00000000-0000-4000-d000-000000000001',
        code: 'thirds_rule',
        applies_to: {},
        contraindications: {},
      },
    ],
    planHistory: async () =>
      [...state.plans.values()]
        .reverse()
        .map((p) => ({ id: p.id, status: p.status, kind: p.kind })),
    insertPlan: async (row) => {
      if (row.parent_plan_id) {
        const sibling = [...state.plans.values()].find(
          (p) => p.parent_plan_id === row.parent_plan_id && p.status !== 'failed',
        );
        if (sibling) throw fromPostgrestError({ code: '23505', message: 'meals_plans_one_child' });
      }
      const plan: MealPlanRow = {
        rationale: null,
        parent_plan_id: null,
        budget_profile_id: null,
        title: null,
        deleted_at: null,
        ...row,
        id: uuidFor(++n, 'f000'),
      } as MealPlanRow;
      state.plans.set(plan.id, plan);
      return plan;
    },
    plan: async (id) => state.plans.get(id) ?? null,
    claimPlan: async (id, attempt) => {
      const p = state.plans.get(id);
      if (!p || p.status !== 'generating' || p.generation_progress.phase !== 'queued') return false;
      p.generation_progress = { ...p.generation_progress, phase: 'safety_check', attempt };
      return true;
    },
    updatePlan: async (id, patch) => {
      const p = state.plans.get(id);
      if (p) Object.assign(p, patch);
    },
    archiveActive: async (_h, kind) => {
      const ids: string[] = [];
      for (const p of state.plans.values())
        if (p.status === 'active' && p.kind === kind) {
          p.status = 'archived';
          ids.push(p.id);
        }
      return ids;
    },
    restoreReplaced: async (_h, planId) => {
      const busy = [...state.plans.values()].some(
        (p) => p.status === 'active' || p.status === 'generating',
      );
      const p = state.plans.get(planId);
      if (busy || !p || p.status !== 'archived') return false;
      p.status = 'active';
      return true;
    },
    enqueue: async (id) => {
      state.enqueued.push(id);
      return null;
    },
    dequeue: async () => {
      const id = state.enqueued.shift();
      return id
        ? [{ msg_id: 1, read_ct: state.readCt.get(id) ?? 1, message: { meal_plan_id: id } }]
        : [];
    },
    ack: async (msgId) => {
      state.acked.push(msgId);
    },
    stuckPlans: async (olderThan, limit) =>
      [...state.plans.values()]
        // Rows without updated_at count as fresh (tests set it to simulate a stall).
        .filter(
          (p) =>
            p.status === 'generating' && p.updated_at !== undefined && p.updated_at < olderThan,
        )
        .slice(0, limit),
    notify: async (row) => {
      if (
        !state.notifications.some(
          (r) => r.user_id === row.user_id && r.dedupe_key === row.dedupe_key,
        )
      ) {
        state.notifications.push(row);
      }
    },
    writePlanWeek: async (planId, week) => {
      const p = state.plans.get(planId);
      if (!p || p.status !== 'generating') throw new Error('CONFLICT');
      state.weeks.push({ planId, week });
      const list = state.meals.get(planId) ?? [];
      for (const d of week.days) {
        for (const m of d.meals) {
          list.push({
            id: crypto.randomUUID(),
            plan_date: d.plan_date,
            meal_type: m.meal_type,
            slot: m.slot,
            meal_id: m.meal_id,
            title: catalog.meals.get(m.meal_id)?.title ?? '',
            notes: m.notes,
            scheduled_time: m.scheduled_time,
            batch_multiplier: m.batch_multiplier,
            is_lunchbox: m.is_lunchbox,
            servings: m.servings,
          });
        }
      }
      state.meals.set(planId, list);
      return list.length;
    },
    planMeals: async (planId) => state.meals.get(planId) ?? [],
    insertSafetyEvents: async (rows) => {
      state.safety.push(...rows);
    },
    audit: async (e) => {
      state.audits.push(`${e.action}:${e.entity}`);
    },
  };
  return { store, state, catalog, entitlements };
}

export const ROUTES: AiModelRouteRow[] = (
  ['plan.generate', 'plan.adjust', 'classify.safety'] as const
).map((route_key) => ({
  route_key,
  provider: 'anthropic',
  model: route_key === 'classify.safety' ? 'claude-haiku-4-5' : `model-${route_key}`,
  params: {},
  priority: 1,
  enabled: true,
}));

export const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });

export const userText = (req: ChatRequest): string => {
  const part = req.messages[0]?.content[0];
  return part?.type === 'text' ? part.text : '';
};

/** Picks `pick(slot, candidateRefs)` for every slot line in a `plan.select` prompt. */
export function selection(
  req: ChatRequest,
  pick: (slot: string, refs: string[]) => string,
  rationale: string,
) {
  const body = userText(req);
  const lines = body
    .slice(body.indexOf('<candidates>') + 12, body.indexOf('</candidates>'))
    .trim()
    .split('\n');
  const choices = lines.filter(Boolean).map((line) => {
    const slot = line.split(' ')[0] ?? '';
    const refs = [...line.matchAll(/(?:: |; )(c\d+) /g)].map((m) => m[1] ?? '');
    return { slot, pick: pick(slot, refs) };
  });
  return JSON.stringify({ choices, rationale });
}

export type PlanScript = (
  req: ChatRequest,
  model: string,
) => Partial<ChatResponse> | AIError | undefined;

export function fakeDeps(script: PlanScript) {
  const usage: AiUsageInsert[] = [];
  const provider = new FakeProvider({
    id: 'anthropic',
    script: (req, model) => {
      const out = script(req, model);
      if (out !== undefined) return out;
      if (model === 'claude-haiku-4-5') {
        // classify.input and classify.output reviews default to safe.
        const sys = req.system[0]?.type === 'text' ? req.system[0].text : '';
        return text(
          sys.includes('"pass"')
            ? JSON.stringify({ pass: true, categories: [] })
            : JSON.stringify({ safety: 'ok', categories: [] }),
        );
      }
      return text('{}');
    },
  });
  return {
    usage,
    provider,
    fallback: {
      resolver: new RouteResolver(async (key) => ROUTES.filter((r) => r.route_key === key)),
      providers: { anthropic: provider },
      sleep: async () => {},
    },
    writeUsage: async (row: AiUsageInsert) => {
      usage.push(row);
    },
  };
}

/** A queued background run collector: tests await the worker explicitly. */
export function kicker() {
  const runs: Array<() => Promise<unknown>> = [];
  return {
    kick: (run: () => Promise<unknown>) => {
      runs.push(run);
    },
    drain: async () => {
      while (runs.length) await runs.shift()?.();
    },
    get pending() {
      return runs.length;
    },
  };
}
