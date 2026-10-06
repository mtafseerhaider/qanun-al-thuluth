import type { AiUsageInsert, FallbackDeps } from '@thuluth/ai-core';
import {
  RamadanGenerateAccepted,
  RamadanGenerateRequest,
} from '@thuluth/shared/contracts/ramadan-generate.ts';
import type { ConsentKind } from '@thuluth/shared/domain/consent.ts';

import { requireUser } from '../_shared/auth.ts';
import type { ClaimsVerifier } from '../_shared/auth.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { sha256Hex } from '../_shared/crypto.ts';
import {
  assertHouseholdWritable,
  consumeTierQuota,
  requirePremium,
  resolveEntitlement,
} from '../_shared/entitlements.ts';
import type { EntitlementStore } from '../_shared/entitlements.ts';
import { HttpError } from '../_shared/errors.ts';
import { jsonHandler } from '../_shared/http.ts';
import {
  daysBetween,
  isMinorRecord,
  localDate,
  runGeneration,
  safetyEventFor,
} from '../_shared/plan/pipeline.ts';
import type { GenerationMeta } from '../_shared/plan/pipeline.ts';
import { ramadanMealTypes } from '../_shared/plan/ramadan.ts';
import type { RamadanMeta } from '../_shared/plan/ramadan.ts';
import type { PlanStore } from '../_shared/plan/store.ts';
import { resolveParticipation } from './participation.ts';
import type { MemberSafety } from './participation.ts';
import { buildSchedule, calcParams, computedSource, ramadanDates, slotTimes } from './schedule.ts';
import type { PrayerTimesSource } from './schedule.ts';
import type { RamadanStore } from './store.ts';

export const SCOPE = 'ramadan-generate';
export const POLL_AFTER_MS = 3000;

export interface RamadanGenerateDeps {
  verify: ClaimsVerifier;
  store: PlanStore;
  ramadan: RamadanStore;
  entitlements: EntitlementStore;
  fallback: FallbackDeps;
  writeUsage: (row: AiUsageInsert) => Promise<void>;
  /** Starts the plan worker after the 202 (index.ts: `EdgeRuntime.waitUntil`). */
  kick: (run: () => Promise<unknown>) => void;
  /** Prayer times; the local calculator unless an Aladhan source is configured (off by default). */
  prayerSource?: PrayerTimesSource;
  now?: () => Date;
}

/**
 * 06 §4.9 `ramadan-generate` (S5-10, FR-RAM-02 to -04). Premium. Computes the Ramadan dates
 * (calendar plus local moon-sighting correction), the daily prayer-time schedule, per-member
 * participation with the safety rules, writes `ramadan_plans`, and creates the linked
 * `meal_plans` row (`kind = 'ramadan'`) that the shared plan worker fills asynchronously
 * (suhoor, iftar, post-Taraweeh snack, day meals for those not fasting).
 */
export function createRamadanGenerateHandler(deps: RamadanGenerateDeps) {
  const now = deps.now ?? (() => new Date());
  const pipeline = { store: deps.store, fallback: deps.fallback, writeUsage: deps.writeUsage, now };
  const source = deps.prayerSource ?? computedSource;

  return jsonHandler(RamadanGenerateRequest, async ({ req, input, requestId }) => {
    const user = await requireUser(req, deps.verify);
    const key = req.headers.get('idempotency-key')?.trim() ?? '';
    if (key.length < 8 || key.length > 128) {
      throw new HttpError('VALIDATION_FAILED', 'Idempotency-Key header is required.', {
        header: 'Idempotency-Key',
      });
    }
    const household = await deps.store.household(input.household_id);
    if (!household) throw new HttpError('NOT_FOUND', 'Household not found.');
    const role = await deps.store.membership(input.household_id, user.userId);
    if (!role) throw new HttpError('NOT_FOUND', 'Household not found.');
    if (role !== 'owner' && role !== 'caregiver') {
      throw new HttpError(
        'FORBIDDEN',
        'Only the household owner or a caregiver can create a Ramadan plan.',
      );
    }
    // Premium (06 §4.9, 17 §9): household scope, shared from the owner (FR-HH-06).
    const ent = await resolveEntitlement(deps.entitlements, {
      userId: user.userId,
      householdId: input.household_id,
      scope: 'household',
    });
    requirePremium(
      ent,
      'ramadan.plan',
      'The full family Ramadan plan needs Premium. Suhoor and iftar tips stay free.',
    );
    await assertHouseholdWritable(deps.entitlements, input.household_id, ent, 'ramadan.plan');
    for (const flag of ['plan.generate.enabled', 'ramadan.generate.enabled']) {
      if (!(await deps.store.featureEnabled(flag))) {
        throw new HttpError('FEATURE_DISABLED', 'Ramadan planning is paused right now.', { flag });
      }
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
      throw new HttpError('IDEMPOTENCY_IN_PROGRESS', 'This Ramadan plan is still being set up.', {
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
      const timezone = household!.timezone;
      const today = localDate(now(), timezone);
      const offset = await deps.ramadan.hijriOffset(input.household_id);
      const dates = ramadanDates(input.hijri_year, offset, {
        start_date: input.start_date,
        end_date: input.end_date,
      });
      if (dates.end_date < today) {
        throw new HttpError('VALIDATION_FAILED', `Ramadan ${input.hijri_year} has already ended.`, {
          field: 'hijri_year',
          rule: 'ramadan_past',
        });
      }
      if (daysBetween(today, dates.start_date) > 120) {
        throw new HttpError(
          'VALIDATION_FAILED',
          'A Ramadan plan can be made up to 4 months ahead.',
          { field: 'hijri_year', rule: 'too_far_ahead', start_date: dates.start_date },
        );
      }

      const members = await deps.store.members(input.household_id);
      const required: ConsentKind[] = ['ai_processing', 'health_data'];
      if (members.some((m) => isMinorRecord(m, today))) required.push('child_data');
      const granted = new Set(await deps.store.activeConsents(user.userId, input.household_id));
      const missingConsents = required.filter((k) => !granted.has(k));
      if (missingConsents.length) {
        throw new HttpError(
          'CONSENT_REQUIRED',
          'Please review and accept the consents needed for a Ramadan plan.',
          { consents: missingConsents },
        );
      }

      const locale = await resolveLocale(req, user.userId);
      const [safetyRows, assessments] = await Promise.all([
        deps.ramadan.memberSafety(input.household_id),
        deps.store.latestAssessments(input.household_id),
      ]);
      const safety = new Map<string, MemberSafety>();
      for (const m of members) {
        const s = safetyRows.get(m.id);
        safety.set(m.id, {
          gestational_diabetes: s?.gestational_diabetes ?? false,
          on_insulin_or_sulfonylurea: s?.on_insulin_or_sulfonylurea ?? false,
          risk_flags: assessments.find((a) => a.family_member_id === m.id)?.risk_flags ?? [],
        });
      }
      const participation = resolveParticipation({
        members,
        participants: input.participants,
        safety,
        startDate: dates.start_date,
        locale,
      });

      const budget = await deps.store.budgetProfile(input.household_id, input.budget_profile_id);
      if (input.budget_profile_id && !budget) {
        throw new HttpError('NOT_FOUND', 'Budget profile not found.', {
          field: 'budget_profile_id',
        });
      }

      const params = calcParams({
        location: input.location,
        calculation: input.calculation,
        tradition: await deps.ramadan.tradition(user.userId),
        timeZone: timezone,
      });
      const schedule = buildSchedule(dates, params, input.suhoor_time_strategy, source);

      const quota = await consumeTierQuota(deps.store, SCOPE, user.userId, ent.tier);

      // The meal plan covers what is left of Ramadan (a plan made mid-month starts today).
      const planStart = dates.start_date < today ? today : dates.start_date;
      const weekCount = Math.ceil((daysBetween(planStart, dates.end_date) + 1) / 7);
      const ramadanMeta: RamadanMeta = {
        hijri_year: input.hijri_year,
        end_date: dates.end_date,
        times: slotTimes(schedule),
        members: participation.members,
      };
      const meta: GenerationMeta = {
        job: 'generate',
        user_id: user.userId,
        request_id: requestId,
        locale,
        tier: 'premium',
        ai_enabled: await deps.store.featureEnabled('ai.plan.enabled'),
        mode: 'full',
        template_key: null,
        replaced_plan_id: null,
        family_member_ids: null,
        assessment_ids: null,
        meal_types: ramadanMealTypes(participation.members),
        preferences: { sunnah_foods_emphasis: true, repeat_tolerance: 'medium' },
        ramadan: ramadanMeta,
      };
      const plan = await deps.store.insertPlan({
        household_id: input.household_id,
        kind: 'ramadan',
        status: 'generating',
        start_date: planStart,
        end_date: dates.end_date,
        week_count: weekCount,
        version: 1,
        budget_profile_id: budget?.id ?? null,
        created_by_user_id: user.userId,
        title: `Ramadan ${input.hijri_year}`,
        generation_progress: {
          phase: 'queued',
          completed_weeks: 0,
          total_weeks: weekCount,
          attempt: 0,
        },
        generation_meta: meta as unknown as Record<string, unknown>,
      });

      const ramadanPlanId = await deps.ramadan.upsertRamadanPlan({
        household_id: input.household_id,
        hijri_year: input.hijri_year,
        start_date: dates.start_date,
        end_date: dates.end_date,
        meal_plan_id: plan.id,
        suhoor_time_strategy: input.suhoor_time_strategy,
        child_participation: participation.stored,
        pregnancy_adjustments: participation.pregnancy,
        city_prayer_times_source: source.name,
        prayer_times: schedule,
        calc_params: {
          ...params,
          imsakOffsetMin: params.suhoor_buffer_min,
          computed_start: dates.computed_start,
          computed_end: dates.computed_end,
          corrected: dates.corrected,
          hijri_offset_days: offset,
        },
      });
      await deps.store.enqueue(plan.id, 0);

      if (participation.escalations.length) {
        await deps.store.insertSafetyEvents(
          participation.escalations.map((e) =>
            safetyEventFor(e, input.household_id, user.userId, `ramadan:${ramadanPlanId}`),
          ),
        );
      }
      await deps.store.audit({
        actor: user.userId,
        householdId: input.household_id,
        action: 'insert',
        entity: 'ramadan_plans',
        entityId: ramadanPlanId,
        diff: {
          hijri_year: input.hijri_year,
          start_date: dates.start_date,
          end_date: dates.end_date,
          meal_plan_id: plan.id,
          corrected: dates.corrected,
          escalations: participation.escalations.length,
        },
      });

      const body = RamadanGenerateAccepted.parse({
        status: 'accepted',
        ramadan_plan_id: ramadanPlanId,
        meal_plan_id: plan.id,
        plan_status: 'generating',
        dates: { start_date: dates.start_date, end_date: dates.end_date },
        prayer_times_source: source.name,
        member_escalations: participation.escalations,
        poll_after_ms: POLL_AFTER_MS,
        realtime: { schema: 'public', table: 'meal_plans', filter: `id=eq.${plan.id}` },
      });
      return { body, headers: { ...corsHeaders, ...quota } };
    }
  });

  async function resolveLocale(req: Request, userId: string): Promise<'en' | 'ur'> {
    const header = req.headers.get('accept-language')?.slice(0, 2);
    const value = header === 'ur' || header === 'en' ? header : await deps.store.userLocale(userId);
    return value === 'ur' ? 'ur' : 'en';
  }
}
