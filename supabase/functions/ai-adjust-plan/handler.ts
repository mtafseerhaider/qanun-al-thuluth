import { PLAN_ADJUST_PROMPT_KEY, PLAN_ADJUST_PROMPT_VERSION } from '@thuluth/ai-core';
import type { AiUsageInsert, FallbackDeps, RequestMetadata } from '@thuluth/ai-core';
import {
  AiAdjustPlanRequest,
  AiAdjustPlanResponse,
} from '@thuluth/shared/contracts/ai-adjust-plan.ts';
import type { ConsentKind } from '@thuluth/shared/domain/consent.ts';

import { requireUser } from '../_shared/auth.ts';
import type { ClaimsVerifier } from '../_shared/auth.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { sha256Hex } from '../_shared/crypto.ts';
import { HttpError } from '../_shared/errors.ts';
import { budgetDelta } from '../_shared/grocery/budget-delta.ts';
import type { GroceryCatalogStore } from '../_shared/grocery/store.ts';
import { jsonHandler } from '../_shared/http.ts';
import {
  computeAdjustment,
  daysBetween,
  isMinorRecord,
  localDate,
  persistAdjustment,
  runGeneration,
  screenAdjustRequest,
  toPlanMember,
} from '../_shared/plan/pipeline.ts';
import type { GenerationMeta } from '../_shared/plan/pipeline.ts';
import type { PlanStore } from '../_shared/plan/store.ts';

export const SCOPE = 'ai-adjust-plan';
/** 06 §2.7: premium only, 20/day, 3/min. */
export const DAILY_LIMIT = 20;
export const BURST_PER_MINUTE = 3;
/** 06 §4.4: sync when the affected range is 7 days or less. */
export const SYNC_MAX_DAYS = 7;

export interface AdjustPlanDeps {
  verify: ClaimsVerifier;
  store: PlanStore;
  fallback: FallbackDeps;
  writeUsage: (row: AiUsageInsert) => Promise<void>;
  kick: (run: () => Promise<unknown>) => void;
  /** Price book for `budget_delta_minor` (S4); without it the delta is 0. */
  grocery?: GroceryCatalogStore;
  now?: () => Date;
}

const ADJUSTABLE = new Set(['draft', 'active']);

/**
 * 06 §4.4. Premium only. A natural-language change becomes a new plan version (`version + 1`,
 * `parent_plan_id`, status `draft`); the parent keeps its history and is archived only when the new
 * version is activated. Child-restriction requests stop with SAFETY_ESCALATION before any model call.
 */
export function createAdjustPlanHandler(deps: AdjustPlanDeps) {
  const now = deps.now ?? (() => new Date());
  const pipeline = { store: deps.store, fallback: deps.fallback, writeUsage: deps.writeUsage, now };

  return jsonHandler(AiAdjustPlanRequest, async ({ req, input, requestId }) => {
    const user = await requireUser(req, deps.verify);
    const key = req.headers.get('idempotency-key')?.trim() ?? '';
    if (key.length < 8 || key.length > 128) {
      throw new HttpError('VALIDATION_FAILED', 'Idempotency-Key header is required.', {
        header: 'Idempotency-Key',
      });
    }
    const parent = await deps.store.plan(input.meal_plan_id);
    if (!parent) throw new HttpError('NOT_FOUND', 'Meal plan not found.');
    const role = await deps.store.membership(parent.household_id, user.userId);
    if (!role) throw new HttpError('NOT_FOUND', 'Meal plan not found.');
    if (role !== 'owner' && role !== 'caregiver') {
      throw new HttpError(
        'FORBIDDEN',
        'Only the household owner or a caregiver can change a plan.',
      );
    }
    if (!(await deps.store.householdPremium(parent.household_id))) {
      throw new HttpError('PREMIUM_REQUIRED', 'Changing a plan in your own words needs Premium.', {
        feature: 'plan.adjust',
      });
    }
    if (!(await deps.store.featureEnabled('ai.plan.enabled'))) {
      throw new HttpError('FEATURE_DISABLED', 'Plan changes are paused right now.', {
        flag: 'ai.plan.enabled',
      });
    }
    const household = await deps.store.household(parent.household_id);
    if (!household) throw new HttpError('NOT_FOUND', 'Household not found.');
    const plan = parent;
    const { timezone, currency, region_id: regionId } = household;

    const begin = await deps.store.idempotencyBegin(
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
      throw new HttpError('IDEMPOTENCY_IN_PROGRESS', 'This change is still being made.', {
        retry_after_seconds: 3,
      });
    }

    try {
      const out = await adjust();
      await deps.store.idempotencyComplete(begin.id, out.status, out.body);
      if (out.run) deps.kick(out.run);
      return Response.json(out.body, { status: out.status, headers: out.headers });
    } catch (err) {
      await deps.store.idempotencyFail(begin.id).catch(() => {});
      throw err;
    }

    async function adjust() {
      if (!ADJUSTABLE.has(plan.status) || plan.kind === 'ramadan') {
        throw new HttpError(
          'PLAN_NOT_ADJUSTABLE',
          'This plan cannot be changed. Create a new plan instead.',
          {
            status: plan.status,
            kind: plan.kind,
          },
        );
      }
      const { scope } = input;
      if (scope.from_date < plan.start_date || scope.to_date > plan.end_date) {
        throw new HttpError('VALIDATION_FAILED', 'The dates must be inside the plan.', {
          field: 'scope',
          min: plan.start_date,
          max: plan.end_date,
        });
      }
      const today = localDate(now(), timezone);
      const records = await deps.store.members(plan.household_id);
      if (scope.family_member_ids?.length) {
        const ids = new Set(records.map((r) => r.id));
        const missing = scope.family_member_ids.filter((id) => !ids.has(id));
        if (missing.length) {
          throw new HttpError('NOT_FOUND', 'Some family members are not in this household.', {
            family_member_ids: missing,
          });
        }
      }
      const required: ConsentKind[] = ['ai_processing', 'health_data'];
      if (records.some((m) => isMinorRecord(m, today))) required.push('child_data');
      const granted = new Set(await deps.store.activeConsents(user.userId, plan.household_id));
      const missingConsents = required.filter((k) => !granted.has(k));
      if (missingConsents.length) {
        throw new HttpError(
          'CONSENT_REQUIRED',
          'Please review and accept the consents needed for AI plan changes.',
          {
            consents: missingConsents,
          },
        );
      }

      const burst = await deps.store.consumeRateLimit(
        `${SCOPE}:${user.userId}:min`,
        BURST_PER_MINUTE,
        60,
      );
      if (!burst.allowed) {
        throw new HttpError(
          'RATE_LIMITED',
          'Please wait a moment before changing the plan again.',
          {
            reset_at: burst.reset_at,
          },
        );
      }
      const daily = await deps.store.consumeRateLimit(
        `${SCOPE}:${user.userId}:day`,
        DAILY_LIMIT,
        86_400,
      );
      if (!daily.allowed) {
        throw new HttpError('QUOTA_EXCEEDED', 'You have changed plans the most times for today.', {
          limit: DAILY_LIMIT,
          reset_at: daily.reset_at,
        });
      }
      const headers = {
        ...corsHeaders,
        'ratelimit-limit': String(BURST_PER_MINUTE),
        'ratelimit-remaining': String(burst.remaining),
        'x-quota-limit': String(DAILY_LIMIT),
        'x-quota-remaining': String(daily.remaining),
      };

      const header = req.headers.get('accept-language')?.slice(0, 2);
      const locale =
        (header === 'ur' || header === 'en' ? header : await deps.store.userLocale(user.userId)) ===
        'ur'
          ? 'ur'
          : 'en';
      const metadata: RequestMetadata = {
        requestId,
        userId: user.userId,
        householdId: plan.household_id,
        promptKey: PLAN_ADJUST_PROMPT_KEY,
        promptVersion: PLAN_ADJUST_PROMPT_VERSION,
        tier: 'premium',
      };

      // Safety first (06 §4.4, 15 §8): child restriction or a red flag stops here.
      await screenAdjustRequest(pipeline, {
        text: input.change_request,
        members: records.map((r) => toPlanMember(r, undefined, today, false)),
        scopeMemberIds: scope.family_member_ids ?? null,
        locale,
        householdId: plan.household_id,
        userId: user.userId,
        metadata,
      });

      const days = daysBetween(scope.from_date, scope.to_date) + 1;
      const parentMeta = plan.generation_meta as unknown as Partial<GenerationMeta>;
      const meta: GenerationMeta = {
        job: 'adjust',
        user_id: user.userId,
        request_id: requestId,
        locale,
        tier: 'premium',
        ai_enabled: true,
        family_member_ids: parentMeta.family_member_ids ?? null,
        preferences: parentMeta.preferences ?? {},
        change_request: input.change_request,
        scope,
      };
      const newPlan = (status: 'queued' | 'generating') =>
        deps.store.insertPlan({
          household_id: plan.household_id,
          kind: plan.kind,
          status: 'generating',
          start_date: plan.start_date,
          end_date: plan.end_date,
          week_count: plan.week_count,
          version: plan.version + 1,
          parent_plan_id: plan.id,
          budget_profile_id: plan.budget_profile_id,
          created_by_user_id: user.userId,
          title: plan.title,
          generation_progress: {
            phase: status,
            completed_weeks: 0,
            total_weeks: plan.week_count,
            attempt: 0,
          },
          generation_meta: { ...meta, source: input.source } as unknown as Record<string, unknown>,
        });

      if (!input.dry_run && days > SYNC_MAX_DAYS) {
        const child = await newPlan('queued');
        await deps.store.enqueue(child.id, 0);
        const body = AiAdjustPlanResponse.parse({
          status: 'accepted',
          meal_plan_id: child.id,
          plan_status: 'generating',
          poll_after_ms: 2000,
          realtime: { schema: 'public', table: 'meal_plans', filter: `id=eq.${child.id}` },
        });
        return { status: 202, body, headers, run: () => runGeneration(pipeline, child.id) };
      }

      const result = await computeAdjustment(pipeline, {
        parent: plan,
        changeRequest: input.change_request,
        scope,
        locale,
        metadata,
      });
      let mealPlanId: string | null = null;
      if (!input.dry_run) {
        const child = await newPlan('generating');
        await persistAdjustment(pipeline, child, result, user.userId);
        mealPlanId = child.id;
      }
      const budgetDeltaMinor = deps.grocery
        ? await budgetDelta(deps.grocery, {
            household: { id: plan.household_id, region_id: regionId, currency },
            today: localDate(now(), timezone),
            from: scope.from_date,
            to: scope.to_date,
            parentMeals: await deps.store.planMeals(plan.id),
            payloads: result.payloads,
          }).catch((err) => {
            console.warn(
              JSON.stringify({ level: 'warn', msg: 'budget_delta_failed', error: String(err) }),
            );
            return 0;
          })
        : 0;
      const body = AiAdjustPlanResponse.parse({
        status: 'completed',
        meal_plan_id: mealPlanId,
        parent_plan_id: plan.id,
        version: plan.version + 1,
        diff: result.diff,
        rationale: result.rationale,
        // Live price book (14 §12.4): new version's meals in scope minus the parent's.
        budget_delta_minor: budgetDeltaMinor,
        currency: currency,
      });
      return { status: 200, body, headers, run: null };
    }
  });
}
