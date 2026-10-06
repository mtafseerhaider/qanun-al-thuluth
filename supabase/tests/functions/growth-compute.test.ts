import { assert, assertEquals } from 'jsr:@std/assert@1';
import type { HouseholdRole } from '@thuluth/shared';
import type { GrowthIndicatorKey, LmsRow } from '@thuluth/ai-core';
import { GrowthComputeResponse } from '@thuluth/shared/contracts/growth-compute.ts';

import { createGrowthComputeHandler } from '../../functions/growth-compute/handler.ts';
import type {
  AssessmentCarry,
  GrowthMember,
  GrowthRow,
  GrowthSafetyEvent,
  GrowthStore,
} from '../../functions/growth-compute/store.ts';
import type { NotificationRow } from '../../functions/_shared/notifications/templates.ts';

const HH = '00000000-0000-4000-b000-000000000001';
const OTHER_HH = '00000000-0000-4000-b000-000000000002';
const OWNER = '00000000-0000-4000-a000-000000000001';
const CAREGIVER = '00000000-0000-4000-a000-000000000002';
const VIEWER = '00000000-0000-4000-a000-000000000003';
const STRANGER = '00000000-0000-4000-a000-000000000004';
const IBRAHIM = '00000000-0000-4000-c000-000000000001'; // 3 years old
const ADULT = '00000000-0000-4000-c000-000000000002';
const NOSEX = '00000000-0000-4000-c000-000000000003';
const NOW = new Date('2026-10-06T08:00:00Z');

/** Synthetic smooth LMS tables (L = 1) for 0 to 228 months; real WHO values are tested in ai-core. */
function table(m0: number, perMonth: number, s: number): LmsRow[] {
  return Array.from({ length: 229 }, (_, a) => ({ ageMonths: a, l: 1, m: m0 + perMonth * a, s }));
}
const TABLES: Record<GrowthIndicatorKey, LmsRow[]> = {
  wfa: table(3.3, 0.3, 0.12), // 36 months: M 14.1 kg
  lhfa: table(50, 1.25, 0.04), // 36 months: M 95 cm
  bmifa: table(15.6, 0, 0.08),
  hcfa: table(35, 0.4, 0.03),
};

function memory(opts: { premium?: boolean; roles?: Record<string, HouseholdRole> } = {}) {
  const roles: Record<string, HouseholdRole> = opts.roles ?? {
    [OWNER]: 'owner',
    [CAREGIVER]: 'caregiver',
    [VIEWER]: 'viewer',
  };
  const members: Record<string, GrowthMember> = {
    [IBRAHIM]: { id: IBRAHIM, household_id: HH, date_of_birth: '2023-10-01', sex_at_birth: 'male' },
    [ADULT]: { id: ADULT, household_id: HH, date_of_birth: '1990-01-01', sex_at_birth: 'male' },
    [NOSEX]: {
      id: NOSEX,
      household_id: HH,
      date_of_birth: '2022-01-01',
      sex_at_birth: 'unspecified',
    },
  };
  const state = {
    rows: [] as GrowthRow[],
    assessments: [] as Array<{ carry: AssessmentCarry; summary: string }>,
    safety: [] as GrowthSafetyEvent[],
    notifications: [] as NotificationRow[],
    audits: [] as string[],
    counters: new Map<string, number>(),
    priorAssessment: {
      energy_targets: { method: 'eer_iom_2005', display: false },
      macro_targets: {},
      hydration_targets: { daily_ml: 1300 },
      risk_flags: [],
    } as AssessmentCarry,
  };
  let seq = 0;
  const store: GrowthStore = {
    membership: async (h, u) => (h === HH ? (roles[u] ?? null) : null),
    featureEnabled: async () => true,
    consumeRateLimit: async (key, limit) => {
      const c = (state.counters.get(key) ?? 0) + 1;
      state.counters.set(key, c);
      return { allowed: c <= limit, remaining: Math.max(0, limit - c), reset_at: 'x' };
    },
    audit: async (e) => {
      state.audits.push(`${e.action}:${e.entity}`);
    },
    row: async (id) => state.rows.find((r) => r.id === id) ?? null,
    rowByDate: async (m, d) =>
      state.rows.find((r) => r.family_member_id === m && r.measured_on === d) ?? null,
    member: async (id) => members[id] ?? null,
    prefersCdc: async () => false,
    lms: async (reference, _sex, indicators, from, to) => {
      const out = new Map<GrowthIndicatorKey, LmsRow[]>();
      if (reference === 'cdc_2000') return out;
      for (const i of indicators)
        out.set(
          i,
          TABLES[i].filter((r) => r.ageMonths >= from && r.ageMonths <= to),
        );
      return out;
    },
    history: async (m, exclude) =>
      state.rows
        .filter((r) => r.family_member_id === m && r.id !== exclude)
        .sort((a, b) => (a.measured_on < b.measured_on ? -1 : 1)),
    saveMeasurement: async (existingId, raw, c) => {
      const values = {
        household_id: raw.household_id,
        family_member_id: raw.family_member_id,
        measured_on: raw.measured_on,
        height_cm: raw.height_cm,
        weight_kg: raw.weight_kg,
        head_circumference_cm: raw.head_circumference_cm,
        measurement_position: raw.measurement_position,
        height_for_age_z: c.height_for_age_z,
        weight_for_age_z: c.weight_for_age_z,
        bmi_for_age_z: c.bmi_for_age_z,
        head_circumference_for_age_z: c.head_circumference_for_age_z,
        height_for_age_percentile: c.height_for_age_percentile,
        weight_for_age_percentile: c.weight_for_age_percentile,
        flags: c.flags,
        computed_at: c.computed_at,
      };
      const existing = state.rows.find((r) => r.id === existingId);
      if (existing) {
        Object.assign(existing, values);
        return existing.id;
      }
      seq += 1;
      const id = `00000000-0000-4000-d000-${String(seq).padStart(12, '0')}`;
      state.rows.push({ id, ...values });
      return id;
    },
    saveComputed: async (id, c) => {
      const r = state.rows.find((x) => x.id === id)!;
      Object.assign(r, {
        height_for_age_z: c.height_for_age_z,
        weight_for_age_z: c.weight_for_age_z,
        bmi_for_age_z: c.bmi_for_age_z,
        height_for_age_percentile: c.height_for_age_percentile,
        weight_for_age_percentile: c.weight_for_age_percentile,
        flags: c.flags,
        computed_at: c.computed_at,
      });
    },
    latestAssessment: async () => state.assessments.at(-1)?.carry ?? state.priorAssessment,
    insertAssessment: async (r) => {
      state.assessments.push({ carry: r.carry, summary: r.summary });
    },
    insertSafetyEvents: async (rows) => {
      state.safety.push(...rows);
    },
    caregivers: async () => [
      { user_id: OWNER, locale: 'en' },
      { user_id: CAREGIVER, locale: 'ur' },
    ],
    notify: async (rows) => {
      state.notifications.push(...rows);
    },
    userLocale: async () => 'en',
  };
  const handler = createGrowthComputeHandler({
    verify: async (jwt) => ({ sub: jwt }),
    store,
    entitlements: {
      userPremium: async () => false,
      householdPremium: async () => opts.premium ?? false,
      householdReadOnly: async () => false,
    },
    now: () => NOW,
  });
  return { handler, state, store };
}

const call = (handler: (r: Request) => Promise<Response>, body: unknown, user = OWNER) =>
  handler(
    new Request('http://localhost/growth-compute', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${user}` },
      body: JSON.stringify(body),
    }),
  );

const measure = (over: Record<string, unknown> = {}) => ({
  household_id: HH,
  family_member_id: IBRAHIM,
  measured_on: '2026-10-01',
  height_cm: 95,
  weight_kg: 14.1,
  ...over,
});

Deno.test('growth-compute: free tier gets z, percentiles and no trend', async () => {
  const { handler, state } = memory();
  const res = await call(handler, measure());
  assertEquals(res.status, 200);
  const body = GrowthComputeResponse.parse(await res.json());
  assertEquals(body.reference, 'who_2006');
  assertEquals(body.z.height_for_age, 0);
  assertEquals(body.percentile.height_for_age, 50);
  assert(Math.abs(body.z.weight_for_age!) < 0.01);
  assertEquals(body.alerts, []);
  assertEquals(body.plan_paused, false);
  assertEquals(body.trend, null);
  assertEquals(res.headers.get('x-quota-limit'), '60');
  assertEquals(state.rows.length, 1);
  assert(state.rows[0]!.computed_at);
  assertEquals(state.safety.length, 0);
  assertEquals(state.notifications.length, 0);
  const text = JSON.stringify(body);
  for (const banned of ['kcal', 'target', 'goal']) assert(!text.includes(banned));
});

Deno.test('growth-compute: premium gets a trend series and direction', async () => {
  const { handler } = memory({ premium: true });
  await call(handler, measure({ measured_on: '2026-04-01', weight_kg: 12.4, height_cm: 90 }));
  const res = await call(handler, measure());
  const body = GrowthComputeResponse.parse(await res.json());
  assertEquals(body.trend?.series.length, 2);
  assertEquals(body.trend?.series[0]?.measured_on, '2026-04-01');
});

Deno.test(
  'growth-compute: two-line crossing pauses plans, escalates and notifies once',
  async () => {
    const { handler, state } = memory();
    await call(handler, measure({ measured_on: '2026-05-01', weight_kg: 14.6, height_cm: 93 }));
    // Weight-for-age drops from about +0.6 z to about -1.2 z: crosses the 50th and 15th lines.
    const res = await call(handler, measure({ weight_kg: 12.1 }));
    const body = GrowthComputeResponse.parse(await res.json());
    const codes = body.alerts.map((a) => a.code);
    assert(codes.includes('crossed_two_major_percentiles'), codes.join());
    assertEquals(body.plan_paused, true);
    const crossing = body.alerts.find((a) => a.code === 'crossed_two_major_percentiles')!;
    assertEquals(crossing.severity, 'see_clinician');
    assertEquals(crossing.escalation?.reason, 'faltering_growth');
    assertEquals(crossing.escalation?.recommend, 'see_pediatrician');
    // Plan pause: red-flag assessment (keeps the prior targets) and an open safety event.
    assertEquals(state.assessments.length, 1);
    assert(state.assessments[0]!.carry.risk_flags.includes('red_flag.faltering_growth'));
    assertEquals(state.assessments[0]!.carry.hydration_targets, { daily_ml: 1300 });
    assert(state.safety.length >= 1);
    assertEquals(state.safety[0]!.source, 'growth');
    // growth_alert to the owner and the caregiver, lock-screen safe.
    assertEquals(state.notifications.map((n) => n.user_id).sort(), [OWNER, CAREGIVER].sort());
    assertEquals(state.notifications[0]!.kind, 'growth_alert');
    assert(!/growth|weight/i.test(state.notifications[0]!.title));
    // Recomputing the same row returns the same result and repeats no side effects.
    const again = await call(handler, { growth_tracking_id: body.growth_tracking_id });
    const body2 = GrowthComputeResponse.parse(await again.json());
    assertEquals(
      body2.alerts.map((a) => a.code),
      codes,
    );
    assertEquals(state.assessments.length, 1);
    assertEquals(state.notifications.length, 2);
  },
);

Deno.test('growth-compute: rapid weight loss is a red flag on every tier', async () => {
  const { handler, state } = memory();
  await call(handler, measure({ measured_on: '2026-08-01', weight_kg: 14.5, height_cm: 94 }));
  const res = await call(handler, measure({ weight_kg: 13.5 }));
  const body = GrowthComputeResponse.parse(await res.json());
  const loss = body.alerts.find((a) => a.code === 'rapid_weight_loss');
  assert(loss);
  assertEquals(loss.escalation?.reason, 'rapid_child_weight_loss');
  assertEquals(body.plan_paused, true);
  assert(state.assessments[0]!.carry.risk_flags.includes('red_flag.child_rapid_weight_loss'));
});

Deno.test('growth-compute: high BMI-for-age is premium info only and never pauses', async () => {
  const heavy = measure({ weight_kg: 19 });
  const free = memory();
  const freeBody = GrowthComputeResponse.parse(await (await call(free.handler, heavy)).json());
  assert(!freeBody.alerts.some((a) => a.code === 'bmi_for_age_above_p97'));
  const prem = memory({ premium: true });
  const body = GrowthComputeResponse.parse(await (await call(prem.handler, heavy)).json());
  const hi = body.alerts.find((a) => a.code === 'bmi_for_age_above_p97')!;
  assertEquals(hi.severity, 'info');
  assertEquals(hi.stops_planning, false);
  assert(!/lose weight|calorie|kcal|weight-loss/i.test(hi.message));
  assertEquals(prem.state.safety.length, 0);
});

Deno.test('growth-compute: below 3rd percentile weight sees a clinician', async () => {
  const { handler } = memory();
  const body = GrowthComputeResponse.parse(
    await (await call(handler, measure({ weight_kg: 10.9 }))).json(),
  );
  const low = body.alerts.find((a) => a.code === 'weight_for_age_below_p3')!;
  assertEquals(low.stops_planning, true);
  assertEquals(body.plan_paused, true);
});

Deno.test('growth-compute: implausible values are flagged, not alarmed', async () => {
  const { handler, state } = memory();
  const body = GrowthComputeResponse.parse(
    await (await call(handler, measure({ weight_kg: 40 }))).json(),
  );
  assertEquals(
    body.alerts.map((a) => a.code),
    ['implausible_measurement'],
  );
  assertEquals(body.plan_paused, false);
  assertEquals(state.rows[0]!.flags, ['implausible_measurement']);
});

Deno.test('growth-compute: membership, roles and reference range', async () => {
  const { handler } = memory();
  const code = async (r: Promise<Response>) => (await (await r).json()).error?.code;
  assertEquals(await code(call(handler, measure(), VIEWER)), 'FORBIDDEN');
  assertEquals(await code(call(handler, measure(), STRANGER)), 'NOT_FOUND');
  assertEquals(await code(call(handler, measure({ household_id: OTHER_HH }))), 'NOT_FOUND');
  assertEquals(
    await code(call(handler, measure({ family_member_id: ADULT, height_cm: 175, weight_kg: 80 }))),
    'GROWTH_REFERENCE_OUT_OF_RANGE',
  );
  assertEquals(
    await code(call(handler, measure({ family_member_id: NOSEX }))),
    'VALIDATION_FAILED',
  );
  assertEquals(
    await code(call(handler, measure({ measured_on: '2027-01-01' }))),
    'VALIDATION_FAILED',
  );
  assertEquals(
    await code(call(handler, measure({ measured_on: '2023-09-01' }))),
    'VALIDATION_FAILED',
  );
  assertEquals(
    await code(call(handler, { growth_tracking_id: '00000000-0000-4000-d000-00000000ffff' })),
    'NOT_FOUND',
  );
  const unauth = await handler(
    new Request('http://localhost/growth-compute', { method: 'POST', body: '{}' }),
  );
  assertEquals(unauth.status, 400); // body fails validation before auth (house style)
});

Deno.test('growth-compute: burst limit is 10 per minute', async () => {
  const { handler } = memory();
  for (let i = 0; i < 10; i++) {
    const d = `2026-09-${String(10 + i).padStart(2, '0')}`;
    assertEquals((await call(handler, measure({ measured_on: d }))).status, 200);
  }
  const res = await call(handler, measure());
  assertEquals((await res.json()).error.code, 'RATE_LIMITED');
});
