import {
  CALCULATORS_VERSION,
  REASSESS_INTERVAL_DAYS,
  reassessmentDue,
  snapshotFromAssessment,
  targetsDiff,
} from '@thuluth/ai-core';
import type { InputSnapshot, TargetSnapshot, TargetsDiff } from '@thuluth/ai-core';
import { z } from 'zod';

import {
  computeMember,
  inputSnapshot,
  localDate,
  templateSummary,
} from '../ai-intake-assess/assess.ts';
import type { ComputedMember, Locale } from '../ai-intake-assess/assess.ts';
import { requireInternal } from '../_shared/auth.ts';
import type { InternalSecrets } from '../_shared/auth.ts';
import { jsonHandler } from '../_shared/http.ts';
import type {
  LatestAssessment,
  PeriodicAssessmentInsert,
  ReassessSafetyEventInsert,
  ReassessStore,
} from './store.ts';

/**
 * `ai-reassess` (S6-15, FR-AI-11): internal cron, daily. Every member whose latest intake or
 * periodic assessment is at least 28 days old is recomputed with the same deterministic
 * calculators as `ai-intake-assess` (no model call), and a `periodic` assessment row is written
 * with a "targets updated" diff in `input_snapshot.targets_diff` for the app to show.
 *
 * Children: no energy, macro or weight number is ever stored or diffed for a member under 18; their
 * diff can only hold the fluid target. Red flags are never dropped by a reassessment: the previous
 * flags carry forward (a new intake, which re-asks the screening, is what clears them).
 */

export const LEASE_NAME = 'ai-reassess';
export const LEASE_TTL_SECONDS = 300;
export const PROMPT_VERSION = 'reassess@1';
export const MODEL_ROUTE = 'deterministic';

/** Request (cron sends `{}`). Contract to move to `@thuluth/shared/contracts` (lead). */
export const AiReassessRequest = z
  .object({
    household_ids: z.array(z.string().uuid()).max(100).optional(),
    /** Members per run; the rest are picked up by the next daily run. */
    limit: z.number().int().min(1).max(1000).default(200),
    /** Reassess the listed households now even when not due (support tooling). */
    force: z.boolean().default(false),
    dry_run: z.boolean().default(false),
  })
  .refine((r) => !r.force || (r.household_ids?.length ?? 0) > 0, {
    message: 'force needs household_ids',
    path: ['force'],
  });

export const MemberReassessment = z.object({
  household_id: z.string().uuid(),
  family_member_id: z.string().uuid(),
  assessment_id: z.string().uuid().nullable(),
  minor: z.boolean(),
  targets_diff: z.object({
    changed: z.boolean(),
    minor: z.boolean(),
    items: z.array(
      z.object({
        target: z.enum(['energy_kcal', 'protein_g', 'carbs_g', 'fat_g', 'fiber_g', 'hydration_ml']),
        from: z.number().nullable(),
        to: z.number().nullable(),
        unit: z.enum(['kcal', 'g', 'ml']),
      }),
    ),
    reasons: z.array(z.string()),
  }),
});

export const AiReassessResponse = z.object({
  skipped: z.boolean(),
  due: z.number().int(),
  reassessed: z.number().int(),
  changed: z.number().int(),
  failed: z.number().int(),
  members: z.array(MemberReassessment),
});
export type AiReassessResponse = z.infer<typeof AiReassessResponse>;

export interface ReassessDeps {
  secrets: InternalSecrets;
  store: ReassessStore;
  now?: () => Date;
  uuid?: () => string;
}

const CATEGORY: Record<string, string> = {
  eating_disorder_signals: 'eating_disorder',
  rapid_child_weight_loss: 'child_weight_loss',
  faltering_growth: 'faltering_growth',
  dehydration_signs: 'dehydration',
  pregnancy_complication: 'pregnancy_complication',
  severe_allergy_reaction: 'severe_allergy',
  insulin_or_sulfonylurea_fasting: 'diabetes_fasting_risk',
  other_clinical: 'other_medical',
};

/** Flags that describe the run, not the member: recomputed every time, never carried. */
const TRANSIENT_FLAG = /^(summary_replaced_by_template|missing_)/;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

export function inputsOf(s: Record<string, unknown>): InputSnapshot {
  return {
    ageMonths: num(s.age_months),
    lifeStage: typeof s.life_stage === 'string' ? s.life_stage : null,
    weightKg: num(s.weight_kg),
    heightCm: num(s.height_cm),
    activityLevel: typeof s.activity_level === 'string' ? s.activity_level : null,
    goals: strs(s.goals),
    modules: strs(s.special_modules),
    climate: typeof s.climate === 'string' ? s.climate : null,
  };
}

export function snapshotOf(c: ComputedMember): TargetSnapshot {
  const adult = !c.minor && !!c.energy?.displayToUser;
  return {
    minor: c.minor,
    energyKcal: adult ? (c.energy?.targetKcal ?? null) : null,
    proteinG: adult ? (c.macros?.proteinG ?? null) : null,
    carbsG: adult ? (c.macros?.carbsG ?? null) : null,
    fatG: adult ? (c.macros?.fatG ?? null) : null,
    fiberG: adult ? (c.macros?.fiberG ?? null) : null,
    hydrationMl: c.hydration.dailyMl > 0 ? c.hydration.dailyMl : null,
  };
}

/** `energy_targets` for a periodic row. Under 18: method only, no number at all (00 §10.3). */
export function energyTargetsFor(c: ComputedMember): Record<string, unknown> {
  const e = c.energy;
  if (!e || c.minor || !e.displayToUser) {
    return { display: false, method: e?.method ?? null, engine_version: CALCULATORS_VERSION };
  }
  return {
    kcal_per_day: e.targetKcal,
    method: `mifflin_st_jeor_x_${e.pal}`,
    pal: e.pal,
    bmr_kcal: e.bmrKcal,
    tdee_kcal: e.maintenanceKcal,
    goal_adjustment_kcal: e.goalAdjustmentKcal,
    increments: e.increments,
    safe_target_weight_kg: e.safeTargetWeightKg,
    display: true,
    engine_version: e.engineVersion,
    warnings: e.warnings,
  };
}

export function macroTargetsFor(c: ComputedMember): Record<string, unknown> {
  if (c.minor || !c.macros || !c.energy?.displayToUser) return {};
  return {
    protein_g: c.macros.proteinG,
    carbs_g: c.macros.carbsG,
    fat_g: c.macros.fatG,
    fiber_g: c.macros.fiberG,
    protein_pct: c.macros.split.proteinPct,
    carbs_pct: c.macros.split.carbsPct,
    fat_pct: c.macros.split.fatPct,
    free_sugar_max_g: c.macros.freeSugarMaxG,
    sat_fat_max_g: c.macros.satFatMaxG,
  };
}

/** Body measures of a child stay with the growth module; the snapshot keeps them out. */
function snapshotJson(c: ComputedMember, diff: TargetsDiff, prev: LatestAssessment) {
  const base = inputSnapshot(c, 'periodic');
  if (c.minor) {
    delete base.height_cm;
    delete base.weight_kg;
  }
  return {
    ...base,
    previous_assessment_id: prev.id,
    previous_assessed_at: prev.created_at,
    targets_diff: diff,
  };
}

export function createReassessHandler(deps: ReassessDeps) {
  const now = deps.now ?? (() => new Date());
  const uuid = deps.uuid ?? (() => crypto.randomUUID());

  return jsonHandler(AiReassessRequest, async ({ req, input, requestId }) => {
    requireInternal(req, deps.secrets);
    const at = now();
    const holder = uuid();
    const lease = input.dry_run
      ? null
      : await deps.store.acquireLease(LEASE_NAME, holder, LEASE_TTL_SECONDS);
    if (lease === false) {
      return AiReassessResponse.parse({
        skipped: true,
        due: 0,
        reassessed: 0,
        changed: 0,
        failed: 0,
        members: [],
      });
    }
    try {
      // The database picks the due members (oldest first, capped); a forced run takes every member.
      const before = input.force
        ? at
        : new Date(at.getTime() - REASSESS_INTERVAL_DAYS * 86_400_000);
      const latest = await deps.store.dueAssessments({
        before,
        limit: input.limit,
        householdIds: input.household_ids,
      });
      const due = latest
        .filter((a) => input.force || reassessmentDue(a.created_at, at))
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
        .slice(0, input.limit);
      const byHousehold = new Map<string, LatestAssessment[]>();
      for (const a of due)
        byHousehold.set(a.household_id, [...(byHousehold.get(a.household_id) ?? []), a]);

      const recommendations = due.length ? await deps.store.verifiedRecommendations() : [];
      const out: z.infer<typeof MemberReassessment>[] = [];
      let failed = 0;

      for (const [householdId, prevs] of byHousehold) {
        try {
          const household = await deps.store.household(householdId);
          if (!household) continue;
          const locale: Locale = (await deps.store.ownerLocale(householdId))?.startsWith('ur')
            ? 'ur'
            : 'en';
          const members = await deps.store.members(
            householdId,
            prevs.map((p) => p.family_member_id),
          );
          const today = localDate(at, household.timezone);
          const rows: PeriodicAssessmentInsert[] = [];
          const safety: ReassessSafetyEventInsert[] = [];
          const hydration: Array<{ c: ComputedMember }> = [];
          for (const prev of prevs) {
            const m = members.find((x) => x.id === prev.family_member_id);
            if (!m) continue;
            const c = computeMember(m, {
              today,
              climateZone: household.climate_zone,
              locale,
              screening: undefined,
              recommendations,
            });
            const prevMinor =
              typeof prev.input_snapshot.age_months === 'number'
                ? prev.input_snapshot.age_months < 216
                : c.minor;
            const diff = targetsDiff(
              snapshotFromAssessment({ ...prev, minor: prevMinor }),
              snapshotOf(c),
              { prev: inputsOf(prev.input_snapshot), next: inputsOf(inputSnapshot(c, 'periodic')) },
            );
            const carried = prev.risk_flags.filter((f) => !TRANSIENT_FLAG.test(f));
            const riskFlags = [...new Set([...carried, ...c.riskFlags])];
            const id = input.dry_run ? null : uuid();
            if (id) {
              rows.push({
                id,
                household_id: householdId,
                family_member_id: m.id,
                kind: 'periodic',
                summary: templateSummary(c, locale),
                energy_targets: energyTargetsFor(c),
                macro_targets: macroTargetsFor(c),
                hydration_targets: {
                  daily_ml: c.hydration.dailyMl,
                  basis: c.hydration.basis,
                  note: c.hydration.note,
                },
                risk_flags: riskFlags,
                input_snapshot: snapshotJson(c, diff, prev),
                model_route: MODEL_ROUTE,
                model: null,
                prompt_version: PROMPT_VERSION,
                created_by_user_id: null,
              });
              // A hard red flag that is new since the last assessment opens a safety event.
              const fresh = c.flags.filter(
                (f) => f.hard && !prev.risk_flags.some((p) => p.includes(f.code)),
              );
              for (const f of fresh) {
                safety.push({
                  household_id: householdId,
                  family_member_id: m.id,
                  user_id: null,
                  source: 'intake',
                  category: CATEGORY[f.reason ?? 'other_clinical'] ?? 'other_medical',
                  urgency: f.severity === 'urgent' ? 'same_day' : 'soon',
                  evidence: `periodic:${f.code}`,
                });
              }
              if (diff.items.some((i) => i.target === 'hydration_ml')) hydration.push({ c });
            }
            out.push({
              household_id: householdId,
              family_member_id: m.id,
              assessment_id: id,
              minor: c.minor,
              targets_diff: diff,
            });
          }
          if (input.dry_run) continue;
          await deps.store.insertAssessments(rows);
          await deps.store.insertSafetyEvents(safety);
          for (const { c } of hydration) {
            // hydration_targets.daily_ml is 300..6000: infants under 12 months keep no stored target.
            if (c.hydration.dailyMl < 300) continue;
            await deps.store.setHydrationTarget({
              householdId,
              familyMemberId: c.member.id,
              dailyMl: c.hydration.dailyMl,
              schedule: c.schedule,
              basis: {
                ...c.hydration.basis,
                age_years: c.ageMonths === null ? null : Math.floor(c.ageMonths / 12),
                climate_zone: household.climate_zone,
                fasting: false,
                source: 'periodic',
              },
            });
          }
          await deps.store.audit({
            householdId,
            entityId: null,
            diff: {
              kind: 'periodic',
              members: rows.length,
              changed: out.filter((o) => o.household_id === householdId && o.targets_diff.changed)
                .length,
            },
          });
        } catch (err) {
          failed += prevs.length;
          console.error(
            JSON.stringify({
              level: 'error',
              scope: 'ai-reassess',
              request_id: requestId,
              household_id: householdId,
              error: String(err),
            }),
          );
        }
      }

      const changed = out.filter((o) => o.targets_diff.changed).length;
      console.log(
        JSON.stringify({
          level: 'info',
          scope: 'ai-reassess',
          request_id: requestId,
          interval_days: REASSESS_INTERVAL_DAYS,
          due: due.length,
          reassessed: out.length,
          changed,
          failed,
        }),
      );
      return AiReassessResponse.parse({
        skipped: false,
        due: due.length,
        reassessed: out.length,
        changed,
        failed,
        members: out,
      });
    } finally {
      if (lease === true) await deps.store.releaseLease(LEASE_NAME, holder).catch(() => undefined);
    }
  });
}
