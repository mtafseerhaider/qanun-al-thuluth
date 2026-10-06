import { budgetTierFor, chooseTemplate, planEndDate } from '@thuluth/ai-core';
import type { AiUsageInsert, FallbackDeps } from '@thuluth/ai-core';
import {
  AiGeneratePlanAccepted,
  AiGeneratePlanRequest,
  PlanWorkerRequest,
} from '@thuluth/shared/contracts/ai-generate-plan.ts';
import type { ConsentKind } from '@thuluth/shared/domain/consent.ts';

import { requireInternal, requireUser } from '../_shared/auth.ts';
import type { ClaimsVerifier, InternalSecrets } from '../_shared/auth.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { sha256Hex } from '../_shared/crypto.ts';
import { HttpError } from '../_shared/errors.ts';
import { jsonHandler } from '../_shared/http.ts';
import {
  addDays,
  daysBetween,
  isMinorRecord,
  localDate,
  runGeneration,
} from '../_shared/plan/pipeline.ts';
import type { GenerationMeta, GenerationMode } from '../_shared/plan/pipeline.ts';
import type { PlanStore } from '../_shared/plan/store.ts';

export const SCOPE = 'ai-generate-plan';
/** 06 §2.7: 3/day free, 10/day premium, 1/min. */
export const DAILY_LIMIT = { free: 3, premium: 10 } as const;
export const BURST_PER_MINUTE = 1;
export const POLL_AFTER_MS = 2000;

export interface GeneratePlanDeps {
  verify: ClaimsVerifier;
  secrets: InternalSecrets;
  store: PlanStore;
  fallback: FallbackDeps;
  writeUsage: (row: AiUsageInsert) => Promise<void>;
  /**
   * Starts the worker for a plan after the 202 is sent (index.ts: `EdgeRuntime.waitUntil`). The
   * queue message stays as the retry path for the sweeper cron (S4).
   */
  kick: (run: () => Promise<unknown>) => void;
  now?: () => Date;
}

const CONSENT_MESSAGE = 'Please review and accept the consents needed for an AI meal plan.';

/**
 * 06 §4.3. The public route validates, applies the tier rules, creates the `generating` plan and
 * enqueues it; `/worker` (x-internal-secret) runs the pipeline. Free households get one week of
 * template personalisation, except the first plan, which uses full generation (Q-02).
 */
export function createGeneratePlanHandler(deps: GeneratePlanDeps) {
  const now = deps.now ?? (() => new Date());
  const pipeline = { store: deps.store, fallback: deps.fallback, writeUsage: deps.writeUsage, now };

  const publicRoute = jsonHandler(AiGeneratePlanRequest, async ({ req, input, requestId }) => {
    const user = await requireUser(req, deps.verify);
    const key = req.headers.get('idempotency-key')?.trim() ?? '';
    if (key.length < 8 || key.length > 128) {
      throw new HttpError('VALIDATION_FAILED', 'Idempotency-Key header is required.', {
        header: 'Idempotency-Key',
      });
    }
    const household = await deps.store.household(input.household_id);
    if (!household) throw new HttpError('NOT_FOUND', 'Household not found.');
    const timezone = household.timezone;
    const role = await deps.store.membership(input.household_id, user.userId);
    if (!role) throw new HttpError('NOT_FOUND', 'Household not found.');
    if (role !== 'owner' && role !== 'caregiver') {
      throw new HttpError(
        'FORBIDDEN',
        'Only the household owner or a caregiver can create a plan.',
      );
    }
    if (!(await deps.store.featureEnabled('plan.generate.enabled'))) {
      throw new HttpError('FEATURE_DISABLED', 'Plan generation is paused right now.', {
        flag: 'plan.generate.enabled',
      });
    }

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
      throw new HttpError('IDEMPOTENCY_IN_PROGRESS', 'This plan request is still being set up.', {
        retry_after_seconds: 2,
      });
    }

    try {
      const out = await accept();
      await deps.store.idempotencyComplete(begin.id, 202, out.body);
      deps.kick(() => runGeneration(pipeline, out.body.meal_plan_id));
      return Response.json(out.body, { status: 202, headers: out.headers });
    } catch (err) {
      await deps.store.idempotencyFail(begin.id).catch(() => {});
      throw err;
    }

    async function accept() {
      const today = localDate(now(), timezone);
      const ahead = daysBetween(today, input.start_date);
      if (ahead < 0 || ahead > 14) {
        throw new HttpError(
          'VALIDATION_FAILED',
          'The plan must start between today and 14 days from now.',
          {
            field: 'start_date',
            min: today,
            max: addDays(today, 14),
          },
        );
      }
      const members = await deps.store.members(input.household_id, input.family_member_ids);
      if (input.family_member_ids) {
        const found = new Set(members.map((m) => m.id));
        const missing = input.family_member_ids.filter((id) => !found.has(id));
        if (missing.length) {
          throw new HttpError('NOT_FOUND', 'Some family members are not in this household.', {
            family_member_ids: missing,
          });
        }
      }
      if (!members.some((m) => m.life_stage !== 'infant')) {
        throw new HttpError(
          'VALIDATION_FAILED',
          'Add a family member who eats family meals first.',
        );
      }

      // Consents (06 §4.3): ai_processing and health_data; child_data when a member is under 18.
      const required: ConsentKind[] = ['ai_processing', 'health_data'];
      if (members.some((m) => isMinorRecord(m, today))) required.push('child_data');
      const granted = new Set(await deps.store.activeConsents(user.userId, input.household_id));
      const missingConsents = required.filter((k) => !granted.has(k));
      if (missingConsents.length) {
        throw new HttpError('CONSENT_REQUIRED', CONSENT_MESSAGE, { consents: missingConsents });
      }

      // Tier rules (06 §4.3, 17): household features follow the owner's entitlement.
      const premium = await deps.store.householdPremium(input.household_id);
      const tier = premium ? 'premium' : 'free';
      if (!premium && input.week_count > 1) {
        throw new HttpError('PREMIUM_REQUIRED', 'Plans longer than one week need Premium.', {
          feature: 'plan.multi_week',
        });
      }
      if (!premium && input.kind !== 'standard') {
        throw new HttpError('PREMIUM_REQUIRED', 'This plan type needs Premium.', {
          feature: 'plan.kind',
          kind: input.kind,
        });
      }

      // Mode: premium full; free template_personalize, except a first plan (Q-02). A free
      // household whose last attempt failed retries with a template.
      const history = await deps.store.planHistory(input.household_id);
      const succeeded = history.some((p) => p.status !== 'failed' && p.status !== 'generating');
      const lastFailed = history[0]?.status === 'failed';
      const mode: GenerationMode =
        premium || (!succeeded && !lastFailed) ? 'full' : 'template_personalize';

      const busy = history.filter((p) => p.status === 'generating' || p.status === 'active');
      if (!premium) {
        if (busy.some((p) => p.status === 'generating')) {
          throw new HttpError('PLAN_ALREADY_ACTIVE', 'A plan is already being created.', {
            resource: 'meal_plans',
            limit: 1,
            current: busy.length,
          });
        }
        if (busy.length && !input.replace_active) {
          throw new HttpError(
            'PLAN_ALREADY_ACTIVE',
            'The free plan allows one active meal plan. Upgrade or replace the current plan.',
            { resource: 'meal_plans', limit: 1, current: busy.length },
          );
        }
      }

      const budget = await deps.store.budgetProfile(input.household_id, input.budget_profile_id);
      if (input.budget_profile_id && !budget) {
        throw new HttpError('NOT_FOUND', 'Budget profile not found.', {
          field: 'budget_profile_id',
        });
      }

      const burst = await deps.store.consumeRateLimit(
        `${SCOPE}:${user.userId}:min`,
        BURST_PER_MINUTE,
        60,
      );
      if (!burst.allowed) {
        throw new HttpError('RATE_LIMITED', 'Please wait a minute before creating another plan.', {
          reset_at: burst.reset_at,
        });
      }
      const daily = await deps.store.consumeRateLimit(
        `${SCOPE}:${user.userId}:day`,
        DAILY_LIMIT[tier],
        86_400,
      );
      if (!daily.allowed) {
        throw new HttpError('QUOTA_EXCEEDED', 'You have created the most plans for today.', {
          limit: DAILY_LIMIT[tier],
          reset_at: daily.reset_at,
        });
      }

      // replace_active: the entitlement trigger counts the active plan, so it is archived first.
      // Its id is kept so a failed replacement restores it (worker failure path and below).
      const replaced =
        !premium && busy.length
          ? await deps.store.archiveActive(input.household_id, 'standard')
          : [];

      const served = members.filter((m) => m.life_stage !== 'infant').length;
      const template =
        mode === 'template_personalize'
          ? chooseTemplate(
              budget ? budgetTierFor(budget.monthly_amount_minor, budget.currency, served) : null,
              history.length,
            )
          : null;
      const locale = await resolveLocale(req, user.userId);
      const aiEnabled = await deps.store.featureEnabled('ai.plan.enabled');
      const meta: GenerationMeta = {
        job: 'generate',
        user_id: user.userId,
        request_id: requestId,
        locale,
        tier,
        ai_enabled: aiEnabled,
        mode,
        template_key: template?.key ?? null,
        replaced_plan_id: replaced[0] ?? null,
        family_member_ids: input.family_member_ids ?? null,
        assessment_ids: input.assessment_ids ?? null,
        meal_types: input.meal_types,
        preferences: input.preferences,
      };
      const plan = await deps.store
        .insertPlan({
          household_id: input.household_id,
          kind: input.kind,
          status: 'generating',
          start_date: input.start_date,
          end_date: planEndDate(input.start_date, input.week_count),
          week_count: input.week_count,
          version: 1,
          budget_profile_id: budget?.id ?? null,
          created_by_user_id: user.userId,
          title: template?.title ?? null,
          generation_progress: {
            phase: 'queued',
            completed_weeks: 0,
            total_weeks: input.week_count,
            attempt: 0,
          },
          generation_meta: meta as unknown as Record<string, unknown>,
        })
        .catch(async (err: unknown) => {
          // The replacement never started: put the archived plan back before reporting the error.
          if (replaced[0])
            await deps.store.restoreReplaced(input.household_id, replaced[0]).catch(() => false);
          throw err;
        });
      await deps.store.enqueue(plan.id, 0);
      await deps.store.audit({
        actor: user.userId,
        householdId: input.household_id,
        action: 'insert',
        entity: 'meal_plans',
        entityId: plan.id,
        diff: { status: 'generating', mode, week_count: input.week_count, kind: input.kind },
      });

      const body = AiGeneratePlanAccepted.parse({
        status: 'accepted',
        meal_plan_id: plan.id,
        plan_status: 'generating',
        version: plan.version,
        mode,
        poll_after_ms: POLL_AFTER_MS,
        realtime: { schema: 'public', table: 'meal_plans', filter: `id=eq.${plan.id}` },
      });
      return {
        body,
        headers: {
          ...corsHeaders,
          'ratelimit-limit': String(BURST_PER_MINUTE),
          'ratelimit-remaining': String(burst.remaining),
          'x-quota-limit': String(DAILY_LIMIT[tier]),
          'x-quota-remaining': String(daily.remaining),
        },
      };
    }
  });

  async function resolveLocale(req: Request, userId: string): Promise<'en' | 'ur'> {
    const header = req.headers.get('accept-language')?.slice(0, 2);
    const value = header === 'ur' || header === 'en' ? header : await deps.store.userLocale(userId);
    return value === 'ur' ? 'ur' : 'en';
  }

  /** Internal worker: one plan by id, or the next queue message (06 §4.3). */
  const workerRoute = jsonHandler(PlanWorkerRequest, async ({ req, input }) => {
    requireInternal(req, deps.secrets);
    if (input.meal_plan_id) {
      const processed = await runGeneration(pipeline, input.meal_plan_id);
      return { processed: processed ? 1 : 0, rescheduled: false };
    }
    const [msg] = await deps.store.dequeue(300, 1);
    if (!msg) return { processed: 0, rescheduled: false };
    const id = msg.message.meal_plan_id;
    const processed = id ? await runGeneration(pipeline, id) : false;
    await deps.store.ack(msg.msg_id);
    return { processed: processed ? 1 : 0, rescheduled: false };
  });

  return (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname.replace(/\/+$/, '');
    return path.endsWith('/worker') ? workerRoute(req) : publicRoute(req);
  };
}
