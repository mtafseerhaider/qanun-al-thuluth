import { assert, assertEquals, assertExists, assertThrows } from 'jsr:@std/assert@1';
import type { CatalogMeal } from '@thuluth/ai-core';
import { RamadanGenerateAccepted } from '@thuluth/shared/contracts/ramadan-generate.ts';
import { shiftIsoDate, toHijri } from '@thuluth/shared/prayer/index.ts';

import { meal as fixtureMeal } from '../../../packages/ai-core/test/planning-fixtures.ts';
import { HttpError } from '../../functions/_shared/errors.ts';
import { applyRamadan, eatsAt, ramadanMealTypes } from '../../functions/_shared/plan/ramadan.ts';
import type { RamadanMeta } from '../../functions/_shared/plan/ramadan.ts';
import { createRamadanGenerateHandler } from '../../functions/ramadan-generate/handler.ts';
import { band, resolveParticipation } from '../../functions/ramadan-generate/participation.ts';
import {
  buildSchedule,
  calcParams,
  firstOfMonth,
  ramadanDates,
} from '../../functions/ramadan-generate/schedule.ts';
import type { RamadanPlanUpsert, RamadanStore } from '../../functions/ramadan-generate/store.ts';
import {
  FAMILY,
  fakeDeps,
  HH,
  HINA,
  IBRAHIM,
  kicker,
  MARYAM,
  memoryStore,
  OWNER,
  selection,
  text,
  USMAN,
  VIEWER,
} from './plan-fixtures.ts';
import type { MemoryOptions } from './plan-fixtures.ts';

/** 20 January 2027: Ramadan 1448 begins about three weeks later. */
const NOW = new Date('2027-01-20T08:00:00Z');

const uuid = (n: number) => `00000000-0000-4000-9100-${n.toString(16).padStart(12, '0')}`;
/** Suhoor and iftar meals (the engine fixture catalog has none); one suhoor is not Ramadan-curated. */
const RAMADAN_MEALS: CatalogMeal[] = [
  fixtureMeal(
    uuid(1),
    'Oats dalia with dates and banana',
    'suhoor',
    ['i-oats', 'i-milk', 'i-dates', 'i-banana'],
    {
      ramadanSuitable: true,
    },
  ),
  fixtureMeal(
    uuid(2),
    'Roti with omelette and yogurt',
    'suhoor',
    ['i-atta', 'i-egg', 'i-yogurt', 'i-cucumber'],
    {
      ramadanSuitable: true,
    },
  ),
  fixtureMeal(
    uuid(3),
    'Rice and daal with cucumber',
    'suhoor',
    ['i-rice', 'i-masoor', 'i-cucumber'],
    {
      ramadanSuitable: true,
    },
  ),
  fixtureMeal(uuid(4), 'Plain paratha and tea', 'suhoor', ['i-atta', 'i-milk', 'i-tomato'], {
    ramadanSuitable: false,
  }),
  fixtureMeal(
    uuid(5),
    'Dates, yakhni shorba, chicken salan with roti',
    'iftar',
    ['i-dates', 'i-chicken', 'i-atta', 'i-lauki'],
    {
      ramadanSuitable: true,
    },
  ),
  fixtureMeal(
    uuid(6),
    'Dates, fruit chaat, daal chawal',
    'iftar',
    ['i-dates', 'i-apple', 'i-masoor', 'i-rice'],
    {
      ramadanSuitable: true,
    },
  ),
  fixtureMeal(
    uuid(7),
    'Dates, chana chaat, palak murgh with rice',
    'iftar',
    ['i-dates', 'i-chana', 'i-spinach', 'i-chicken', 'i-rice'],
    {
      ramadanSuitable: true,
    },
  ),
];

function ramadanStore(
  opts: {
    safety?: Record<string, { gd?: boolean; insulin?: boolean }>;
    tradition?: 'shared' | 'shia';
    offset?: number;
  } = {},
) {
  const saved: Array<RamadanPlanUpsert & { id: string }> = [];
  const store: RamadanStore = {
    hijriOffset: async () => opts.offset ?? 0,
    tradition: async () => opts.tradition ?? 'shared',
    memberSafety: async () =>
      new Map(
        Object.entries(opts.safety ?? {}).map(([id, s]) => [
          id,
          { gestational_diabetes: s.gd ?? false, on_insulin_or_sulfonylurea: s.insulin ?? false },
        ]),
      ),
    upsertRamadanPlan: async (row) => {
      const prev = saved.find(
        (r) => r.household_id === row.household_id && r.hijri_year === row.hijri_year,
      );
      if (prev) {
        Object.assign(prev, row);
        return prev.id;
      }
      const id = crypto.randomUUID();
      saved.push({ ...row, id });
      return id;
    },
  };
  return { store, saved };
}

function setup(opts: MemoryOptions & Parameters<typeof ramadanStore>[0] = {}) {
  const mem = memoryStore(opts);
  for (const m of RAMADAN_MEALS) (mem.catalog.meals as Map<string, CatalogMeal>).set(m.id, m);
  const ai = fakeDeps((req, model) =>
    model === 'model-plan.generate'
      ? text(
          selection(req, (_s, refs) => refs[0] ?? 'c1', 'A gentle Ramadan rhythm for the family.'),
        )
      : undefined,
  );
  const bg = kicker();
  const rs = ramadanStore(opts);
  const handler = createRamadanGenerateHandler({
    verify: async (jwt) =>
      jwt === 'owner' ? { sub: OWNER } : jwt === 'viewer' ? { sub: VIEWER } : null,
    store: mem.store,
    ramadan: rs.store,
    entitlements: mem.entitlements,
    fallback: ai.fallback,
    writeUsage: ai.writeUsage,
    kick: bg.kick,
    now: () => NOW,
  });
  return { handler, bg, rs, ...mem, ...ai };
}

const USMAN_HINA_IBRAHIM = [
  { family_member_id: USMAN, intention: 'fasting' },
  { family_member_id: HINA, intention: 'fasting' },
  {
    family_member_id: IBRAHIM,
    intention: 'practice_fast',
    practice_fast: { days_per_week: 2, until: 'asr' },
  },
];

let keyN = 0;
function post(
  body: Record<string, unknown> = {},
  opts: { jwt?: string; key?: string | null } = {},
): Request {
  const headers: Record<string, string> = {
    authorization: `Bearer ${opts.jwt ?? 'owner'}`,
    'content-type': 'application/json',
  };
  if (opts.key !== null)
    headers['idempotency-key'] = opts.key ?? `ramadan-key-${String(++keyN).padStart(4, '0')}`;
  return new Request('http://localhost/functions/v1/ramadan-generate', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      household_id: HH,
      hijri_year: 1448,
      location: { city: 'Lahore', country_code: 'PK' },
      participants: USMAN_HINA_IBRAHIM,
      ...body,
    }),
  });
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// ---- end to end -----------------------------------------------------------------------------------

Deno.test(
  'Usman family 1448: 202, ramadan_plans row, worker writes the Ramadan meal plan',
  async () => {
    const { handler, bg, state, rs, catalog } = setup();
    const res = await handler(post());
    assertEquals(res.status, 202);
    const body = RamadanGenerateAccepted.parse(await res.json());
    assertEquals(body.prayer_times_source, 'computed_fallback');
    assertEquals(body.member_escalations, []);
    assertEquals(res.headers.get('x-quota-limit'), '5');

    // Dates: 1 Ramadan .. last day of Ramadan in the calendar, 29 or 30 days.
    const h = toHijri(body.dates.start_date);
    assertEquals([h.year, h.month, h.day], [1448, 9, 1]);
    assertEquals(toHijri(shiftIsoDate(body.dates.end_date, 1)).month, 10);

    const saved = rs.saved[0];
    assertExists(saved);
    assertEquals(saved.meal_plan_id, body.meal_plan_id);
    assertEquals(saved.city_prayer_times_source, 'computed_fallback');
    assertEquals(saved.suhoor_time_strategy, 'just_before_fajr');
    assert(saved.prayer_times.length >= 29 && saved.prayer_times.length <= 30);
    assertEquals(saved.calc_params.method, 'karachi');
    assertEquals(saved.calc_params.asr, 'hanafi');
    // Participation: Maryam (4) normal meals; Ibrahim weekend practice fasts until Asr.
    const cp = saved.child_participation as Record<
      string,
      { mode: string; days?: string[]; until?: string; guidance?: string[] }
    >;
    assertEquals(cp[MARYAM]?.mode, 'none');
    assertEquals(cp[IBRAHIM], {
      mode: 'practice_fast',
      days: ['sat', 'sun'],
      until: 'asr',
      guidance: [
        'ramadan.guidance.child_stop_rules',
        'ramadan.guidance.suhoor_required',
        'ramadan.guidance.school_and_heat',
      ],
    });
    // Hina breastfeeding: the family's choice is recorded with guidance, clinician not assumed.
    const pa = saved.pregnancy_adjustments as Record<string, Record<string, unknown>>;
    assertEquals(pa[HINA]?.decision, 'fasting');
    assertEquals(pa[HINA]?.status, 'breastfeeding');
    assertEquals(pa[HINA]?.clinicianConfirmed, false);
    assertEquals(pa[HINA]?.fluid_extra_ml, 700);

    const plan = state.plans.get(body.meal_plan_id);
    assertExists(plan);
    assertEquals(plan.kind, 'ramadan');
    assertEquals(plan.status, 'generating');
    assertEquals(plan.end_date, body.dates.end_date);
    assertEquals(state.enqueued, [body.meal_plan_id]);

    await bg.drain();
    const done = state.plans.get(body.meal_plan_id)!;
    assertEquals(done.status, 'draft');
    assertEquals((done.weekly_themes as Array<{ key: string }>)[0]?.key, 'ramadan_rhythm');
    const meals = state.meals.get(done.id) ?? [];
    assert(meals.length > 0);
    const schedule = new Map(
      (
        saved.prayer_times as Array<{
          date: string;
          fajr: string;
          suhoor: string;
          iftar: string;
          taraweeh_snack: string;
        }>
      ).map((d) => [d.date, d]),
    );
    for (const m of meals) {
      assert(m.plan_date <= body.dates.end_date, 'no slot after Ramadan');
      const day = schedule.get(m.plan_date)!;
      const who = new Set(m.servings.map((s) => s.family_member_id));
      const weekday = new Date(`${m.plan_date}T00:00:00Z`).getUTCDay();
      const ibrahimFasts = weekday === 6 || weekday === 0;
      if (m.meal_type === 'suhoor') {
        assertEquals(m.scheduled_time, day.suhoor);
        assert(minutes(day.suhoor) < minutes(day.fajr));
        assert(who.has(USMAN) && who.has(HINA) && !who.has(MARYAM));
        assertEquals(who.has(IBRAHIM), ibrahimFasts);
        assertEquals(catalog.meals.get(m.meal_id)?.ramadanSuitable, true);
      } else if (m.meal_type === 'iftar') {
        assertEquals(m.scheduled_time, day.iftar);
        assertEquals(who.size, 4);
      } else if (m.meal_type === 'snack') {
        assertEquals(m.scheduled_time, day.taraweeh_snack);
      } else {
        assert(m.meal_type === 'breakfast' || m.meal_type === 'lunch');
        assert(!who.has(USMAN) && !who.has(HINA), 'fasting adults get no day meals');
        assert(who.has(MARYAM));
        assertEquals(who.has(IBRAHIM), !ibrahimFasts);
      }
    }
    assert(!meals.some((m) => m.meal_type === 'dinner'));
    assert(state.audits.includes('insert:ramadan_plans'));
  },
);

Deno.test('premium gate: free households get PREMIUM_REQUIRED; viewers are refused', async () => {
  const free = setup({ premium: false });
  const res = await free.handler(post());
  assertEquals(res.status, 402);
  const err = (await res.json()).error;
  assertEquals(err.code, 'PREMIUM_REQUIRED');
  assertEquals(err.details.feature, 'ramadan.plan');
  assertEquals(free.rs.saved.length, 0);

  // A forged personal flag does not help: household scope follows the owner (AC-SUB6).
  free.state.userPremium = true;
  assertEquals((await free.handler(post())).status, 402);

  const { handler } = setup();
  const viewer = await handler(post({}, { jwt: 'viewer' }));
  assertEquals(viewer.status, 403);
  await viewer.body?.cancel();
});

Deno.test('idempotency: key required; same key replays; rate limit 1 per minute', async () => {
  const { handler, rs } = setup();
  const missing = await handler(post({}, { key: null }));
  assertEquals(missing.status, 400);
  await missing.body?.cancel();
  const first = await handler(post({}, { key: 'ramadan-fixed-key' }));
  const firstBody = await first.json();
  const again = await handler(post({}, { key: 'ramadan-fixed-key' }));
  assertEquals(again.headers.get('idempotent-replayed'), 'true');
  assertEquals(await again.json(), firstBody);
  assertEquals(rs.saved.length, 1);
  const burst = await handler(post());
  assertEquals(burst.status, 429);
  assertEquals((await burst.json()).error.code, 'RATE_LIMITED');
});

Deno.test(
  'safety: no fasting under 7, practice only before puberty, practice for children only',
  async () => {
    const { handler } = setup();
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ family_member_id: MARYAM, intention: 'fasting' }, 'no_fasting_under_7'],
      [
        {
          family_member_id: MARYAM,
          intention: 'practice_fast',
          practice_fast: { days_per_week: 1, until: 'dhuhr' },
        },
        'no_fasting_under_7',
      ],
      [{ family_member_id: IBRAHIM, intention: 'fasting' }, 'practice_fast_only_before_puberty'],
      [
        {
          family_member_id: USMAN,
          intention: 'practice_fast',
          practice_fast: { days_per_week: 2, until: 'asr' },
        },
        'practice_fast_children_only',
      ],
    ];
    for (const [p, rule] of cases) {
      const res = await handler(post({ participants: [p] }));
      assertEquals(res.status, 400);
      const err = (await res.json()).error;
      assertEquals(err.code, 'VALIDATION_FAILED');
      assertEquals(err.details.rule, rule);
    }
  },
);

Deno.test(
  'insulin: escalation for that member, plan still made with non-fasting meals',
  async () => {
    const { handler, bg, state, rs } = setup({
      members: FAMILY.map((m) => (m.id === USMAN ? { ...m, medication_flags: ['insulin'] } : m)),
    });
    const res = await handler(post());
    assertEquals(res.status, 202);
    const body = RamadanGenerateAccepted.parse(await res.json());
    assertEquals(body.member_escalations.length, 1);
    const e = body.member_escalations[0]!;
    assertEquals(e.reason, 'insulin_or_sulfonylurea_fasting');
    assertEquals(e.family_member_id, USMAN);
    assertEquals(e.recommend, 'see_gp');
    assertEquals(state.safety.length, 1);
    assertEquals(state.safety[0]?.category, 'diabetes_fasting_risk');
    const cp = rs.saved[0]?.child_participation as Record<string, Record<string, unknown>>;
    assertEquals(cp[USMAN]?.mode, 'not_fasting');
    assertEquals(cp[USMAN]?.requested, 'fasting');
    assertEquals(cp[USMAN]?.escalated, true);
    await bg.drain();
    const meals = state.meals.get(body.meal_plan_id) ?? [];
    assert(
      meals
        .filter((m) => m.meal_type === 'suhoor')
        .every((m) => !m.servings.some((s) => s.family_member_id === USMAN)),
    );
    assert(
      meals.some(
        (m) => m.meal_type === 'lunch' && m.servings.some((s) => s.family_member_id === USMAN),
      ),
    );
  },
);

Deno.test(
  'pregnancy with gestational diabetes escalates; condition flag from medical_conditions too',
  () => {
    const members = FAMILY.map((m) =>
      m.id === HINA ? { ...m, special_modules: ['pregnancy'] as never[] } : m,
    );
    const r = resolveParticipation({
      members,
      participants: [
        { family_member_id: HINA, intention: 'fasting' },
        { family_member_id: USMAN, intention: 'fasting' },
      ],
      safety: new Map([
        [HINA, { gestational_diabetes: true, on_insulin_or_sulfonylurea: false, risk_flags: [] }],
        [USMAN, { gestational_diabetes: false, on_insulin_or_sulfonylurea: true, risk_flags: [] }],
      ]),
      startDate: '2027-02-08',
      locale: 'ur',
    });
    assertEquals(r.escalations.map((e) => e.family_member_id).sort(), [USMAN, HINA].sort());
    assertEquals(r.members[HINA]?.mode, 'not_fasting');
    assertEquals(r.pregnancy[HINA]?.decision, 'not_fasting');
    assertEquals(r.pregnancy[HINA]?.status, 'pregnancy');
    assert(
      r.escalations.every((e) => /[؀-ۿ]/.test(e.message)),
      'Urdu escalation copy',
    );
  },
);

Deno.test(
  'a fasting-stop red flag (dehydration) escalates; not-fasting and exempt are recorded',
  () => {
    const r = resolveParticipation({
      members: FAMILY,
      participants: [
        { family_member_id: USMAN, intention: 'fasting' },
        { family_member_id: HINA, intention: 'exempt', exemption_reason: 'breastfeeding' },
      ],
      safety: new Map([
        [
          USMAN,
          {
            gestational_diabetes: false,
            on_insulin_or_sulfonylurea: false,
            risk_flags: ['red_flag.dehydration_signs'],
          },
        ],
      ]),
      startDate: '2027-02-08',
      locale: 'en',
    });
    assertEquals(r.escalations[0]?.reason, 'dehydration_signs');
    assertEquals(r.members[HINA]?.mode, 'exempt');
    // The exemption reason itself is never stored on the household plan (15 §5.1).
    assertEquals(JSON.stringify(r.stored[HINA]).includes('breastfeeding'), false);
    assertEquals(r.pregnancy[HINA]?.decision, 'not_fasting');
    assertEquals(r.members[IBRAHIM]?.mode, 'not_fasting');
    assertEquals(r.members[MARYAM]?.mode, 'none');
  },
);

Deno.test('participants must be household members, listed once', () => {
  const run = (participants: Array<{ family_member_id: string; intention: 'fasting' }>) => () =>
    resolveParticipation({
      members: FAMILY,
      participants,
      safety: new Map(),
      startDate: '2027-02-08',
      locale: 'en',
    });
  assertThrows(run([{ family_member_id: crypto.randomUUID(), intention: 'fasting' }]), HttpError);
  assertThrows(
    run([
      { family_member_id: USMAN, intention: 'fasting' },
      { family_member_id: USMAN, intention: 'fasting' },
    ]),
    HttpError,
  );
});

Deno.test(
  'dates: local moon-sighting correction within 3 days; length 29 or 30; past Ramadan refused',
  async () => {
    const { handler, rs } = setup();
    const computed = firstOfMonth(1448, 9, 0);
    const res = await handler(post({ start_date: shiftIsoDate(computed, 1) }));
    assertEquals(res.status, 202);
    const body = RamadanGenerateAccepted.parse(await res.json());
    assertEquals(body.dates.start_date, shiftIsoDate(computed, 1));
    assertEquals(rs.saved[0]?.calc_params.corrected, true);

    const far = setup();
    const bad = await far.handler(post({ start_date: shiftIsoDate(computed, 5) }));
    assertEquals((await bad.json()).error.details.rule, 'start_near_calendar');
    const past = await far.handler(post({ hijri_year: 1447 }));
    assertEquals((await past.json()).error.details.rule, 'ramadan_past');
    assertThrows(
      () => ramadanDates(1448, 0, { start_date: computed, end_date: shiftIsoDate(computed, 31) }),
      HttpError,
    );
    // The household offset moves the calendar start by a day.
    assertEquals(firstOfMonth(1448, 9, 1), shiftIsoDate(computed, 1));
  },
);

Deno.test("prayer times: Lahore schedule, Ja'fari iftar after sunset, unknown places", () => {
  const params = calcParams({
    location: { city: 'Lahore', country_code: 'PK' },
    calculation: { suhoor_buffer_min: 10 },
    tradition: 'shared',
    timeZone: 'Asia/Karachi',
  });
  const [day] = buildSchedule(
    { start_date: '2027-02-08', end_date: '2027-03-09' },
    params,
    'just_before_fajr',
  );
  assertExists(day);
  assert(minutes(day.fajr) > 5 * 60 && minutes(day.fajr) < 6 * 60, `fajr ${day.fajr}`);
  assert(
    minutes(day.maghrib) > 17 * 60 + 30 && minutes(day.maghrib) < 18 * 60 + 15,
    `maghrib ${day.maghrib}`,
  );
  assertEquals(minutes(day.fajr) - minutes(day.suhoor), 40);
  assertEquals(minutes(day.fajr) - minutes(day.imsak), 10);
  assertEquals(day.iftar, day.maghrib);

  const shia = calcParams({
    location: { city: 'Lahore', country_code: 'PK' },
    calculation: { suhoor_buffer_min: 10 },
    tradition: 'shia',
    timeZone: 'Asia/Karachi',
  });
  assertEquals(shia.method, 'jafari');
  assertEquals(shia.iftar_at, 'maghrib');
  const [jd] = buildSchedule(
    { start_date: '2027-02-08', end_date: '2027-02-08' },
    shia,
    'after_tahajjud',
  );
  assert(minutes(jd!.iftar) > minutes(day.iftar), "Ja'fari Maghrib is after sunset");
  assertEquals(minutes(jd!.fajr) - minutes(jd!.suhoor), 90);

  const fallback = calcParams({
    location: { city: 'Okara', country_code: 'PK' },
    calculation: { suhoor_buffer_min: 10 },
    tradition: 'shared',
    timeZone: 'Asia/Karachi',
  });
  assertEquals(fallback.location_fallback, true);
  assertThrows(
    () =>
      calcParams({
        location: { city: 'Nowhere', country_code: 'ZZ' },
        calculation: { suhoor_buffer_min: 10 },
        tradition: 'shared',
        timeZone: 'UTC',
      }),
    HttpError,
    'prayer times',
  );
  assertThrows(
    () =>
      calcParams({
        location: { city: 'Lahore', country_code: 'PK' },
        calculation: { method: 15, suhoor_buffer_min: 10 },
        tradition: 'shared',
        timeZone: 'Asia/Karachi',
      }),
    HttpError,
  );
});

Deno.test('unknown city and country is 503 PRAYER_TIMES_UNAVAILABLE end to end', async () => {
  const { handler, rs } = setup();
  const res = await handler(post({ location: { city: 'Nowhere', country_code: 'ZZ' } }));
  assertEquals(res.status, 503);
  assertEquals((await res.json()).error.code, 'PRAYER_TIMES_UNAVAILABLE');
  assertEquals(rs.saved.length, 0);
});

Deno.test('applyRamadan: trims, schedules, and serves by participation', () => {
  const meta: RamadanMeta = {
    hijri_year: 1448,
    end_date: '2027-02-09',
    times: { '2027-02-08': { suhoor: '04:45', lunch: '13:00' } },
    members: {
      a: { mode: 'fasting' },
      c: { mode: 'practice_fast', days: [1], until: 'dhuhr' }, // Mondays
      k: { mode: 'none' },
    },
  };
  const servings = [
    { family_member_id: 'a' },
    { family_member_id: 'c' },
    { family_member_id: 'k' },
  ];
  const rows = [
    { plan_date: '2027-02-08', meal_type: 'suhoor' as const, scheduled_time: null, servings },
    { plan_date: '2027-02-08', meal_type: 'lunch' as const, scheduled_time: null, servings },
    { plan_date: '2027-02-08', meal_type: 'breakfast' as const, scheduled_time: null, servings },
    { plan_date: '2027-02-10', meal_type: 'iftar' as const, scheduled_time: null, servings },
  ];
  const out = applyRamadan(rows, meta);
  assertEquals(out.length, 3);
  assertEquals(
    out[0]?.servings.map((s) => s.family_member_id),
    ['a', 'c'],
  ); // Monday practice
  assertEquals(out[0]?.scheduled_time, '04:45');
  assertEquals(
    out[1]?.servings.map((s) => s.family_member_id),
    ['c', 'k'],
  ); // until Dhuhr eats lunch
  assertEquals(
    out[2]?.servings.map((s) => s.family_member_id),
    ['k'],
  );
  assertEquals(eatsAt(undefined, '2027-02-08', 'suhoor'), false);
  assertEquals(ramadanMealTypes({ a: { mode: 'fasting' } }), ['suhoor', 'snack', 'iftar']);
  assertEquals(
    band(
      {
        id: 'x',
        date_of_birth: null,
        life_stage: 'toddler',
        special_modules: [],
        medication_flags: [],
      },
      '2027-02-08',
    ),
    'under_7',
  );
});
