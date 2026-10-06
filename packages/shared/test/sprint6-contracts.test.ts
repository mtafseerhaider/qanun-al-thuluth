import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_DELETION_GRACE_DAYS,
  AccountDeleteExecuteResponse,
  AccountDeleteRequest,
  AccountDeleteResponse,
  AccountExportAccepted,
  AccountExportRequest,
  AnalyticsRollupRequest,
  AnalyticsRollupResponse,
  EXPORT_SIGNED_URL_TTL_SECONDS,
  ExportPdfRequest,
  ExportPdfResponse,
  GrowthAlert,
  GrowthComputeRequest,
  GrowthComputeResponse,
  deletionScheduledFor,
  isWithinDeletionGrace,
} from '../src/contracts/index.ts';
import {
  CoachingTipAgeBand,
  FoodExposureInput,
  acceptanceValue,
  tipMatchesAge,
} from '../src/domain/family-modules.ts';

const ID = '00000000-0000-4000-8000-000000000001';
const ID2 = '00000000-0000-4000-8000-000000000002';

const escalation = {
  reason: 'faltering_growth' as const,
  family_member_id: ID2,
  message: 'Worth checking with your paediatrician soon.',
  recommend: 'see_pediatrician' as const,
};

const baseGrowth = {
  growth_tracking_id: ID,
  reference: 'who_2007',
  age_months: 114.6,
  bmi: 15.8,
  z: { height_for_age: 0.21, weight_for_age: -0.35, bmi_for_age: -0.48 },
  percentile: { height_for_age: 58.3, weight_for_age: 36.3, bmi_for_age: 31.6 },
  alerts: [],
  trend: null,
};

describe('growth-compute', () => {
  it('accepts a stored row id or a new measurement', () => {
    expect(GrowthComputeRequest.safeParse({ growth_tracking_id: ID }).success).toBe(true);
    const m = {
      household_id: ID,
      family_member_id: ID2,
      measured_on: '2026-10-06',
      height_cm: 132.4,
      weight_kg: 27.9,
    };
    expect(GrowthComputeRequest.safeParse(m).success).toBe(true);
    expect(GrowthComputeRequest.safeParse({ ...m, height_cm: 250 }).success).toBe(false);
    expect(GrowthComputeRequest.safeParse({ ...m, measurement_position: 'sitting' }).success).toBe(
      false,
    );
  });

  it('parses the spec example and fills additive defaults', () => {
    const r = GrowthComputeResponse.parse(baseGrowth);
    expect(r.plan_paused).toBe(false);
    expect(r.z.head_circumference_for_age).toBeNull();
  });

  it('rejects kcal or weight targets on a child growth result', () => {
    expect(GrowthComputeResponse.safeParse({ ...baseGrowth, kcal_target: 1400 }).success).toBe(
      false,
    );
    expect(GrowthComputeResponse.safeParse({ ...baseGrowth, target_weight_kg: 25 }).success).toBe(
      false,
    );
  });

  it('pairs z-scores with percentiles and drops WHO weight-for-age after 120 months', () => {
    expect(
      GrowthComputeResponse.safeParse({
        ...baseGrowth,
        percentile: { ...baseGrowth.percentile, bmi_for_age: null },
      }).success,
    ).toBe(false);
    expect(GrowthComputeResponse.safeParse({ ...baseGrowth, age_months: 130 }).success).toBe(false);
    expect(
      GrowthComputeResponse.safeParse({
        ...baseGrowth,
        age_months: 130,
        z: { ...baseGrowth.z, weight_for_age: null },
        percentile: { ...baseGrowth.percentile, weight_for_age: null },
      }).success,
    ).toBe(true);
    expect(GrowthComputeResponse.safeParse({ ...baseGrowth, age_months: 230 }).success).toBe(false);
  });

  it('requires an escalation for a plan-pausing red flag and keeps plan_paused consistent', () => {
    const twoLines = {
      code: 'crossed_two_major_percentiles',
      severity: 'see_clinician',
      message: 'Weight dropped across two lines',
      escalation,
      stops_planning: true,
    };
    expect(GrowthAlert.safeParse({ ...twoLines, escalation: null }).success).toBe(false);
    expect(
      GrowthComputeResponse.safeParse({ ...baseGrowth, alerts: [twoLines], plan_paused: true })
        .success,
    ).toBe(true);
    expect(GrowthComputeResponse.safeParse({ ...baseGrowth, alerts: [twoLines] }).success).toBe(
      false,
    );
  });

  it('never pauses a plan for a high BMI-for-age alert', () => {
    const above97 = {
      code: 'bmi_for_age_above_p97',
      severity: 'info',
      message: 'Family habit tips',
      escalation: null,
    };
    expect(GrowthAlert.parse(above97).stops_planning).toBe(false);
    expect(GrowthAlert.safeParse({ ...above97, escalation, stops_planning: true }).success).toBe(
      false,
    );
  });
});

describe('export-pdf', () => {
  it('applies paper and kind defaults', () => {
    const r = ExportPdfRequest.parse({
      household_id: ID,
      locale: 'ur',
      params: { kind: 'meal_plan', meal_plan_id: ID2, week_index: 0 },
    });
    expect(r.paper).toBe('A4');
    expect(r.params).toMatchObject({ include_recipes: true, include_sources: true });
    const g = ExportPdfRequest.parse({
      household_id: ID,
      locale: 'en',
      paper: 'Letter',
      params: { kind: 'growth_report', family_member_id: ID2 },
    });
    expect(g.params).toMatchObject({ include_notes_for_clinician: true });
  });

  it('rejects unknown locales, papers and kinds, and backwards report ranges', () => {
    const ok = { household_id: ID, locale: 'en', params: { kind: 'family_summary' } };
    expect(ExportPdfRequest.safeParse(ok).success).toBe(true);
    expect(ExportPdfRequest.safeParse({ ...ok, locale: 'ar' }).success).toBe(false);
    expect(ExportPdfRequest.safeParse({ ...ok, paper: 'A3' }).success).toBe(false);
    expect(ExportPdfRequest.safeParse({ ...ok, params: { kind: 'account_data' } }).success).toBe(
      false,
    );
    expect(
      ExportPdfRequest.safeParse({
        ...ok,
        params: {
          kind: 'nutrition_report',
          family_member_id: ID2,
          from: '2026-10-08',
          to: '2026-10-01',
        },
      }).success,
    ).toBe(false);
  });

  it('parses ready and accepted responses; signed URLs live 24 h', () => {
    expect(EXPORT_SIGNED_URL_TTL_SECONDS).toBe(86_400);
    const ready = ExportPdfResponse.parse({
      status: 'ready',
      export_id: ID,
      url: 'https://api.thuluth.app/storage/v1/object/sign/exports/a/b.pdf?token=t',
      expires_at: '2026-10-07T15:04:00Z',
      pages: 6,
    });
    expect(ready.status).toBe('ready');
    const accepted = ExportPdfResponse.parse({
      status: 'accepted',
      poll_after_ms: 2000,
      realtime: { schema: 'public', table: 'exports', filter: `id=eq.${ID}` },
      export_id: ID,
      export_status: 'processing',
    });
    expect(accepted.status).toBe('accepted');
  });
});

describe('account-export', () => {
  it('defaults to all households with PDFs', () => {
    expect(AccountExportRequest.parse({})).toEqual({ include_pdfs: true });
    expect(AccountExportRequest.safeParse({ household_ids: [] }).success).toBe(false);
    expect(
      AccountExportAccepted.safeParse({
        status: 'accepted',
        poll_after_ms: 5000,
        realtime: { schema: 'public', table: 'exports', filter: `id=eq.${ID}` },
        export_id: ID,
        export_status: 'processing',
      }).success,
    ).toBe(true);
  });
});

describe('account-delete', () => {
  it('requires the typed DELETE confirmation', () => {
    expect(AccountDeleteRequest.safeParse({ action: 'request', confirm: 'delete' }).success).toBe(
      false,
    );
    const r = AccountDeleteRequest.parse({
      action: 'request',
      confirm: 'DELETE',
      reason: 'privacy',
    });
    expect(r).toMatchObject({ immediate: false });
    expect(AccountDeleteRequest.parse({ action: 'cancel' }).action).toBe('cancel');
  });

  it('only skips the grace period for an age-gate decline', () => {
    const req = { action: 'request', confirm: 'DELETE', immediate: true };
    expect(AccountDeleteRequest.safeParse({ ...req, reason: 'privacy' }).success).toBe(false);
    expect(AccountDeleteRequest.safeParse({ ...req, reason: 'under_age' }).success).toBe(true);
  });

  it('schedules deletion 30 days out and allows cancel only inside the grace window', () => {
    expect(ACCOUNT_DELETION_GRACE_DAYS).toBe(30);
    const at = new Date('2026-10-06T10:00:00Z');
    const due = deletionScheduledFor(at);
    expect(due.toISOString()).toBe('2026-11-05T10:00:00.000Z');
    expect(deletionScheduledFor(at, true).toISOString()).toBe(at.toISOString());
    expect(isWithinDeletionGrace(due, new Date('2026-11-05T09:59:59Z'))).toBe(true);
    expect(isWithinDeletionGrace(due, new Date('2026-11-05T10:00:00Z'))).toBe(false);
  });

  it('parses both response branches and the executor summary', () => {
    expect(
      AccountDeleteResponse.parse({
        action: 'request',
        scheduled_for: '2026-11-05T10:00:00Z',
        active_subscription_warning: true,
      }).action,
    ).toBe('request');
    expect(AccountDeleteResponse.safeParse({ action: 'cancel', cancelled: false }).success).toBe(
      false,
    );
    expect(AccountDeleteExecuteResponse.safeParse({ deleted_users: -1, failures: 0 }).success).toBe(
      false,
    );
  });
});

describe('analytics-rollup', () => {
  it('defaults to the hourly scope', () => {
    expect(AnalyticsRollupRequest.parse({}).scope).toBe('hourly');
    expect(AnalyticsRollupRequest.safeParse({ scope: 'weekly' }).success).toBe(false);
    expect(
      AnalyticsRollupResponse.parse({
        refreshed: ['mv_ai_cost_daily'],
        partitions_created: [],
        partitions_detached: [],
        alerts_raised: [],
        duration_ms: 812,
      }).refreshed,
    ).toEqual(['mv_ai_cost_daily']);
  });
});

describe('family module domain values', () => {
  it('validates exposure log rows', () => {
    const row = {
      id: ID,
      ingredient_id: ID2,
      exposed_on: '2026-10-06',
      stage: 'touch',
      acceptance: '2_touched',
      context: 'family_meal',
    };
    expect(FoodExposureInput.safeParse(row).success).toBe(true);
    expect(FoodExposureInput.safeParse({ ...row, stage: 'swallow' }).success).toBe(false);
    expect(FoodExposureInput.safeParse({ ...row, context: 'restaurant' }).success).toBe(false);
    expect(acceptanceValue('0_refused')).toBe(0);
    expect(acceptanceValue('5_ate_well')).toBe(5);
  });

  it('bounds coaching tip age bands', () => {
    expect(CoachingTipAgeBand.parse({})).toEqual({ age_min_months: 0, age_max_months: 1200 });
    expect(CoachingTipAgeBand.safeParse({ age_min_months: 60, age_max_months: 24 }).success).toBe(
      false,
    );
    expect(tipMatchesAge({ age_min_months: 24, age_max_months: 216 }, 96)).toBe(true);
    expect(tipMatchesAge({ age_min_months: 60, age_max_months: 216 }, 48)).toBe(false);
  });
});
