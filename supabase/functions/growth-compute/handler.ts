import {
  adjustedHeightCm,
  ageInDays,
  ageMonthsFromDays,
  childBmi,
  escalationFor,
  evaluateGrowthRules,
  growthDirection,
  indicatorsFor,
  isImplausibleZ,
  isRestrictedIndicator,
  lmsAt,
  lmsZ,
  selectGrowthReference,
  zToPercentile,
} from '@thuluth/ai-core';
import type {
  GrowthIndicatorKey,
  GrowthPoint,
  GrowthReferenceKey,
  GrowthRuleHit,
  LmsRow,
} from '@thuluth/ai-core';
import {
  GROWTH_MAX_AGE_MONTHS,
  GrowthComputeRequest,
  GrowthComputeResponse,
} from '@thuluth/shared/contracts/growth-compute.ts';
import type { GrowthAlert, GrowthAlertCode } from '@thuluth/shared/contracts/growth-compute.ts';

import { requireUser } from '../_shared/auth.ts';
import type { ClaimsVerifier } from '../_shared/auth.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { consumeTierQuota, resolveEntitlement } from '../_shared/entitlements.ts';
import type { EntitlementStore } from '../_shared/entitlements.ts';
import { HttpError } from '../_shared/errors.ts';
import { jsonHandler } from '../_shared/http.ts';
import { notificationRow, routeFor } from '../_shared/notifications/templates.ts';
import { ALERT_COPY } from './copy.ts';
import type { GrowthComputed, GrowthRow, GrowthStore } from './store.ts';

export const SCOPE = 'growth-compute';

export interface GrowthComputeDeps {
  verify: ClaimsVerifier;
  store: GrowthStore;
  entitlements: EntitlementStore;
  now?: () => Date;
}

type Locale = 'en' | 'ur';

/** `ai_assessments.risk_flags` codes the planner pauses on (ai-core planning/safety.ts STOP_ALL). */
const PLANNER_FLAG: Record<string, string> = {
  faltering_growth: 'red_flag.faltering_growth',
  rapid_child_weight_loss: 'red_flag.child_rapid_weight_loss',
};

const clampZ = (z: number) => Math.max(-9.99, Math.min(9.99, Math.round(z * 100) / 100));

/** A stored `flags` value for a rule hit: red flags carry the `red_flag.` prefix (05 §12.7). */
const flagOf = (h: GrowthRuleHit) => (h.stopsPlanning ? `red_flag.${h.code}` : h.code);

/**
 * 06 §4.8 `growth-compute` (S6-03, FR-GRW-02, FR-GRW-04). Computes WHO (or opted-in CDC) LMS
 * z-scores and percentiles for a child's measurement, applies the 15 §2.8 alert rules, stores the
 * computed columns, and on a red flag pauses growth plans (a `red_flag.*` periodic assessment plus
 * an open `safety_events` row, which the planner honours until a caregiver resolves it) and
 * notifies the owners and caregivers. Safety alerts reach every tier; the trend is premium.
 * Never returns kcal, weight targets or goals (00 §10.3).
 */
export function createGrowthComputeHandler(deps: GrowthComputeDeps) {
  const now = deps.now ?? (() => new Date());
  const store = deps.store;

  return jsonHandler(GrowthComputeRequest, async ({ req, input }) => {
    const user = await requireUser(req, deps.verify);
    const at = now();

    // Resolve the measurement (offline path: an inserted row; online path: raw values).
    let existing: GrowthRow | null = null;
    let raw: {
      household_id: string;
      family_member_id: string;
      measured_on: string;
      height_cm: number | null;
      weight_kg: number | null;
      head_circumference_cm: number | null;
      measurement_position: 'recumbent' | 'standing' | null;
    };
    if ('growth_tracking_id' in input) {
      existing = await store.row(input.growth_tracking_id);
      if (!existing) throw new HttpError('NOT_FOUND', 'Measurement not found.');
      raw = existing;
      if (existing.height_cm == null || existing.weight_kg == null)
        throw new HttpError('VALIDATION_FAILED', 'Height and weight are both needed.', {
          rule: 'height_and_weight_required',
        });
    } else {
      raw = {
        household_id: input.household_id,
        family_member_id: input.family_member_id,
        measured_on: input.measured_on,
        height_cm: input.height_cm,
        weight_kg: input.weight_kg,
        head_circumference_cm: input.head_circumference_cm ?? null,
        measurement_position: input.measurement_position ?? null,
      };
    }

    const role = await store.membership(raw.household_id, user.userId);
    if (!role) throw new HttpError('NOT_FOUND', 'Measurement not found.');
    if (role !== 'owner' && role !== 'caregiver')
      throw new HttpError('FORBIDDEN', 'Only the owner or a caregiver can record measurements.');
    if (!(await store.featureEnabled('growth.compute.enabled')))
      throw new HttpError('FEATURE_DISABLED', 'Growth tracking is paused right now.', {
        flag: 'growth.compute.enabled',
      });

    const member = await store.member(raw.family_member_id);
    if (!member || member.household_id !== raw.household_id)
      throw new HttpError('NOT_FOUND', 'Family member not found.');
    if (!member.date_of_birth)
      throw new HttpError('VALIDATION_FAILED', 'Add a date of birth to track growth.', {
        field: 'date_of_birth',
        rule: 'date_of_birth_required',
      });
    if (member.sex_at_birth !== 'female' && member.sex_at_birth !== 'male')
      throw new HttpError(
        'VALIDATION_FAILED',
        'Growth charts are different for girls and boys, so we need the sex at birth to compare.',
        { field: 'sex_at_birth', rule: 'sex_required_for_reference' },
      );
    const today = at.toISOString().slice(0, 10);
    if (raw.measured_on > today)
      throw new HttpError('VALIDATION_FAILED', 'The measurement date is in the future.', {
        field: 'measured_on',
        rule: 'measured_on_future',
      });
    const ageDays = ageInDays(member.date_of_birth, raw.measured_on);
    if (ageDays < 0)
      throw new HttpError(
        'VALIDATION_FAILED',
        'The measurement date is before the date of birth.',
        {
          field: 'measured_on',
          rule: 'measured_before_birth',
        },
      );
    const ageMonths = ageMonthsFromDays(ageDays);
    const preferCdc = await store.prefersCdc(raw.household_id);
    if (ageMonths > GROWTH_MAX_AGE_MONTHS && !preferCdc)
      throw new HttpError(
        'GROWTH_REFERENCE_OUT_OF_RANGE',
        'Growth charts cover children up to 19 years. Use weight tracking for adults.',
        { age_months: Math.round(ageMonths * 10) / 10, max_age_months: GROWTH_MAX_AGE_MONTHS },
      );

    // Rate limit on every tier (60/day, 10/min); premium only adds the trend.
    const ent = await resolveEntitlement(deps.entitlements, {
      userId: user.userId,
      householdId: raw.household_id,
      scope: 'household',
    });
    const quota = await consumeTierQuota(store, SCOPE, user.userId, ent.tier);

    // Reference and LMS.
    let reference = selectGrowthReference(ageDays, { preferCdc });
    if (!reference)
      throw new HttpError('GROWTH_REFERENCE_OUT_OF_RANGE', 'No growth reference covers this age.', {
        age_months: Math.round(ageMonths * 10) / 10,
      });
    let lms = await loadLms(reference, member.sex_at_birth, ageMonths);
    if (reference === 'cdc_2000' && !lms.size) {
      // CDC 2000 is opt-in and not seeded yet (S6-02 TODO): fall back to WHO.
      reference = selectGrowthReference(ageDays);
      if (!reference)
        throw new HttpError(
          'GROWTH_REFERENCE_OUT_OF_RANGE',
          'No growth reference covers this age.',
        );
      lms = await loadLms(reference, member.sex_at_birth, ageMonths);
    }

    const height =
      raw.height_cm == null
        ? null
        : adjustedHeightCm(raw.height_cm, ageDays, raw.measurement_position);
    const bmi = raw.weight_kg != null && height != null ? childBmi(raw.weight_kg, height) : null;
    const values: Record<GrowthIndicatorKey, number | null> = {
      wfa: raw.weight_kg,
      lhfa: height,
      bmifa: bmi,
      hcfa: ageMonths <= 60 ? raw.head_circumference_cm : null,
    };
    const z: Record<GrowthIndicatorKey, number | null> = {
      wfa: null,
      lhfa: null,
      bmifa: null,
      hcfa: null,
    };
    let implausible = false;
    for (const ind of indicatorsFor(reference, ageMonths)) {
      const x = values[ind];
      const rows = lms.get(ind);
      if (x == null || !rows?.length) continue;
      const at = lmsAt(rows, { ageDays, ageMonths });
      if (!at) continue;
      const v = lmsZ(x, at, isRestrictedIndicator(ind));
      if (isImplausibleZ(ind, v)) implausible = true;
      z[ind] = clampZ(v);
    }
    if (z.lhfa == null && z.wfa == null && z.bmifa == null)
      throw new HttpError(
        'GROWTH_REFERENCE_OUT_OF_RANGE',
        'Growth reference data is not available for this age yet.',
        { reference },
      );

    // History and alert rules.
    const history = await store.history(member.id, existing?.id ?? null);
    const pastPoints: GrowthPoint[] = history
      .filter((h) => h.measured_on !== raw.measured_on)
      .map((h) => ({
        measuredOn: h.measured_on,
        ageDays: ageInDays(member.date_of_birth!, h.measured_on),
        weightKg: h.weight_kg,
        heightCm: h.height_cm,
        z: { wfa: h.weight_for_age_z, lhfa: h.height_for_age_z, bmifa: h.bmi_for_age_z },
        implausible: h.flags.includes('implausible_measurement'),
      }));
    const hits = evaluateGrowthRules(
      {
        measuredOn: raw.measured_on,
        ageDays,
        weightKg: raw.weight_kg,
        heightCm: height,
        z,
        implausible,
      },
      pastPoints,
    );

    const locale = await resolveLocale(req, user.userId);
    const alerts: GrowthAlert[] = hits
      // Non-safety information (high BMI-for-age tips) is premium (15 §2.11); safety never is.
      .filter((h) => ent.premium || h.code !== 'bmi_for_age_above_p97')
      .map((h) => toAlert(h, member.id, locale));
    const planPaused = alerts.some((a) => a.stops_planning);

    const flags = [...new Set(hits.map(flagOf))];
    const pct = (v: number | null) => (v == null ? null : zToPercentile(v));
    const computed: GrowthComputed = {
      age_months: Math.round(ageMonths * 100) / 100,
      reference,
      height_for_age_z: z.lhfa,
      weight_for_age_z: z.wfa,
      bmi_for_age_z: z.bmifa,
      head_circumference_for_age_z: z.hcfa,
      height_for_age_percentile: pct(z.lhfa),
      weight_for_age_percentile: pct(z.wfa),
      bmi_for_age_percentile: pct(z.bmifa),
      head_circumference_for_age_percentile: pct(z.hcfa),
      flags,
      computed_at: at.toISOString(),
    };

    // Persist (natural idempotency: same row, same result).
    let rowId: string;
    let previousFlags: string[] = [];
    if (existing) {
      previousFlags = existing.flags;
      await store.saveComputed(existing.id, computed);
      rowId = existing.id;
    } else {
      const sameDay = await store.rowByDate(member.id, raw.measured_on);
      previousFlags = sameDay?.flags ?? [];
      rowId = await store.saveMeasurement(
        sameDay?.id ?? null,
        {
          household_id: raw.household_id,
          family_member_id: member.id,
          measured_on: raw.measured_on,
          height_cm: raw.height_cm!,
          weight_kg: raw.weight_kg!,
          head_circumference_cm: raw.head_circumference_cm,
          measurement_position: raw.measurement_position,
          entered_by: user.userId,
        },
        computed,
      );
    }

    // Side effects only for flags this row did not already carry (a recompute is silent).
    const fresh = hits.filter((h) => !previousFlags.includes(flagOf(h)));
    await sideEffects(fresh, {
      householdId: raw.household_id,
      memberId: member.id,
      userId: user.userId,
      rowId,
      at,
    });
    await store.audit({
      actor: user.userId,
      householdId: raw.household_id,
      action: existing ? 'update' : 'insert',
      entity: 'growth_tracking',
      entityId: rowId,
      // keys only for health data (05 §16): no values in the audit diff
      diff: { computed: true, reference, flags, plan_paused: planPaused },
    });

    const trend = ent.premium ? buildTrend(history, raw.measured_on, computed) : null;
    const body = GrowthComputeResponse.parse({
      growth_tracking_id: rowId,
      reference,
      age_months: computed.age_months,
      bmi: bmi ?? 0,
      z: {
        height_for_age: z.lhfa,
        weight_for_age: z.wfa,
        bmi_for_age: z.bmifa,
        head_circumference_for_age: z.hcfa,
      },
      percentile: {
        height_for_age: computed.height_for_age_percentile,
        weight_for_age: computed.weight_for_age_percentile,
        bmi_for_age: computed.bmi_for_age_percentile,
        head_circumference_for_age: computed.head_circumference_for_age_percentile,
      },
      alerts,
      plan_paused: planPaused,
      trend,
    });
    return Response.json(body, { headers: { ...corsHeaders, ...quota } });
  });

  async function loadLms(
    reference: GrowthReferenceKey,
    sex: 'female' | 'male',
    ageMonths: number,
  ): Promise<Map<GrowthIndicatorKey, LmsRow[]>> {
    return await store.lms(
      reference,
      sex,
      indicatorsFor(reference, ageMonths),
      Math.max(0, ageMonths - 1.5),
      ageMonths + 1.5,
    );
  }

  function toAlert(h: GrowthRuleHit, memberId: string, locale: Locale): GrowthAlert {
    const escalation = h.escalation
      ? escalationFor(
          [
            {
              code: h.code,
              hard: true,
              severity: 'see_clinician',
              stops: h.stopsPlanning ? 'all' : 'none',
              reason: h.escalation,
              recommend: 'see_pediatrician',
              evidence: {},
            },
          ],
          memberId,
          locale,
        )
      : null;
    return {
      code: h.code as GrowthAlertCode,
      severity: h.severity,
      message: ALERT_COPY[h.code][locale],
      escalation,
      stops_planning: h.stopsPlanning,
    };
  }

  async function sideEffects(
    hits: GrowthRuleHit[],
    ctx: { householdId: string; memberId: string; userId: string; rowId: string; at: Date },
  ): Promise<void> {
    const red = hits.filter((h) => h.stopsPlanning);
    if (red.length) {
      // Red-flag plan pause: the planner stops for this household while a safety event is open
      // and the member's latest assessment carries a stop-all red flag (ai-core planningStops).
      const prior = await store.latestAssessment(ctx.memberId);
      const plannerFlags = red.map(
        (h) => PLANNER_FLAG[h.escalation ?? ''] ?? 'red_flag.faltering_growth',
      );
      const carry = {
        energy_targets: prior?.energy_targets ?? {},
        macro_targets: prior?.macro_targets ?? {},
        hydration_targets: prior?.hydration_targets ?? {},
        risk_flags: [...new Set([...(prior?.risk_flags ?? []), ...plannerFlags])],
      };
      await store.insertAssessment({
        household_id: ctx.householdId,
        family_member_id: ctx.memberId,
        created_by_user_id: ctx.userId,
        summary: `Growth measurement red flags: ${red.map((h) => h.code).join(', ')}`,
        carry,
      });
      await store.insertSafetyEvents(
        red.map((h) => ({
          household_id: ctx.householdId,
          family_member_id: ctx.memberId,
          user_id: ctx.userId,
          source: 'growth' as const,
          category:
            h.escalation === 'rapid_child_weight_loss' ? 'child_weight_loss' : 'faltering_growth',
          urgency: 'soon' as const,
          evidence: `growth:${ctx.rowId}:${h.code}`,
        })),
      );
    }
    // growth_alert (always on, every tier) for anything a clinician should see.
    const clinical = hits.filter((h) => h.severity === 'see_clinician');
    if (!clinical.length) return;
    const recipients = await store.caregivers(ctx.householdId);
    await store.notify(
      recipients.map((r) =>
        notificationRow({
          key: 'growth_alert',
          user_id: r.user_id,
          household_id: ctx.householdId,
          locale: r.locale,
          scheduled_for: ctx.at,
          dedupe_key: `growth_alert:${ctx.rowId}`,
          route: routeFor('growth_alert', { family_member_id: ctx.memberId }),
          data: { family_member_id: ctx.memberId, growth_tracking_id: ctx.rowId },
        }),
      ),
    );
  }

  async function resolveLocale(req: Request, userId: string): Promise<Locale> {
    const header = req.headers.get('accept-language')?.slice(0, 2);
    const value = header === 'ur' || header === 'en' ? header : await store.userLocale(userId);
    return value === 'ur' ? 'ur' : 'en';
  }
}

/** Premium trend (06 §4.8): plausible computed measurements, oldest first, plus direction. */
function buildTrend(history: GrowthRow[], measuredOn: string, current: GrowthComputed) {
  const series = history
    .filter(
      (h) =>
        h.computed_at &&
        h.measured_on !== measuredOn &&
        !h.flags.includes('implausible_measurement'),
    )
    .map((h) => ({
      measured_on: h.measured_on,
      weight_for_age_percentile: h.weight_for_age_percentile,
      height_for_age_percentile: h.height_for_age_percentile,
      z: h.weight_for_age_z ?? h.height_for_age_z,
    }));
  if (!current.flags.includes('implausible_measurement'))
    series.push({
      measured_on: measuredOn,
      weight_for_age_percentile: current.weight_for_age_percentile,
      height_for_age_percentile: current.height_for_age_percentile,
      z: current.weight_for_age_z ?? current.height_for_age_z,
    });
  series.sort((a, b) => (a.measured_on < b.measured_on ? -1 : 1));
  return {
    series: series.map(({ z: _z, ...p }) => p),
    direction: growthDirection(series.map((p) => p.z).filter((v): v is number => v != null)),
  };
}
