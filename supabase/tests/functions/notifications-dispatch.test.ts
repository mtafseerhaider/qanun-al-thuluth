import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';

import { oneSignalSender } from '../../functions/_shared/integrations/onesignal.ts';
import {
  FORBIDDEN_TERMS,
  TEMPLATES,
  notificationRow,
  render,
  routeFor,
} from '../../functions/_shared/notifications/templates.ts';
import type { TemplateKey } from '../../functions/_shared/notifications/templates.ts';
import {
  createNotificationsDispatchHandler,
  inQuietHours,
  quietHoursFor,
} from '../../functions/notifications-dispatch/handler.ts';
import {
  ageYears,
  materialize,
  preMealWindows,
  tooYoungToFast,
} from '../../functions/notifications-dispatch/materialize.ts';
import type { Snapshot } from '../../functions/notifications-dispatch/materialize.ts';
import {
  baseSnapshot,
  CAREGIVER,
  CHILD5,
  FATHER,
  fakePush,
  HH,
  memoryNotifications,
  OWNER,
  PLAN,
  pref,
  TEEN,
  VIEWER,
} from './notification-fixtures.ts';

const SECRET = 'cron-secret-for-tests';

function setup(
  snapshot: Snapshot = baseSnapshot(),
  opts: { lease?: boolean | null; push?: ReturnType<typeof fakePush> } = {},
) {
  const mem = memoryNotifications(snapshot, { lease: opts.lease });
  const push = opts.push ?? fakePush();
  let now = new Date('2026-10-06T07:20:00Z');
  const handler = createNotificationsDispatchHandler({
    secrets: () => [SECRET],
    store: mem.store,
    push: push.push,
    now: () => now,
    holderId: () => 'holder-1',
  });
  const run = async (
    at: string,
    body: Record<string, unknown> = {},
    secret: string | null = SECRET,
  ) => {
    now = new Date(at);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (secret !== null) headers['x-internal-secret'] = secret;
    const res = await handler(
      new Request('http://localhost/notifications-dispatch', {
        method: 'POST',
        headers,
        body: JSON.stringify({ triggered_at: at, ...body }),
      }),
    );
    return { status: res.status, body: await res.json() };
  };
  return { ...mem, push, run };
}

const keysFor = (
  rows: { user_id: string; kind: string; scheduled_for: string }[],
  user: string,
  kind: string,
) =>
  rows
    .filter((r) => r.user_id === user && r.kind === kind)
    .map((r) => r.scheduled_for)
    .sort();

// ---------------------------------------------------------------------------------------------
// Templates: lock-screen safety (FR-NOT-06) and deep links (FR-NOT-04)

Deno.test(
  'templates: no sensitive health terms, within column limits, every key has a route',
  () => {
    const vars = { meal: 'lunch', minutes: 25, time: '04:39', fast: 'fast.ayyam_al_bid' };
    for (const key of Object.keys(TEMPLATES) as TemplateKey[]) {
      const copy = render(key, vars);
      for (const text of [copy.headings.en, copy.contents.en]) {
        const lower = text.toLowerCase();
        for (const term of FORBIDDEN_TERMS)
          assert(!lower.includes(term), `${key}: "${text}" contains "${term}"`);
        assert(!/\{\w+\}/.test(text), `${key}: unfilled placeholder in "${text}"`);
      }
      for (const t of [copy.headings.en, copy.headings.ur]) assert(t.length <= 120);
      for (const b of [copy.contents.en, copy.contents.ur]) assert(b.length <= 500);
      assert(routeFor(key).startsWith('thuluth://'), key);
    }
    assertEquals(render('meal_reminder', vars).headings.en, 'Lunch in 25 minutes');
    assertEquals(render('meal_reminder', vars).headings.ur, '25 منٹ میں دوپہر کا کھانا');
    assertEquals(routeFor('meal_reminder', { daily_meal_id: 'dm-1' }), 'thuluth://meal/dm-1');
    assertEquals(routeFor('plan_ready', { meal_plan_id: 'p-1' }), 'thuluth://plan/p-1');
    let threw = false;
    try {
      render('suhoor_reminder', {});
    } catch {
      threw = true;
    }
    assert(threw, 'a missing variable is an error, never a raw placeholder on a lock screen');
  },
);

Deno.test('templates: notificationRow stores the recipient locale and both languages', () => {
  const row = notificationRow({
    key: 'hydration_reminder',
    user_id: CAREGIVER,
    household_id: HH,
    locale: 'ur-PK',
    scheduled_for: new Date('2026-10-06T07:30:00Z'),
    dedupe_key: 'k',
    route: 'thuluth://hydration',
  });
  assertEquals(row.title, 'پانی کا وقت');
  assertEquals(row.kind, 'hydration_reminder');
  assertEquals(row.data.route, 'thuluth://hydration');
  assertEquals((row.data.headings as { en: string }).en, 'Time for a glass of water');
});

// ---------------------------------------------------------------------------------------------
// Pure helpers

Deno.test('helpers: ages, under-7 rule, schedule parsing, quiet hours', () => {
  assertEquals(ageYears('2019-10-07', '2026-10-06'), 6);
  assertEquals(ageYears('2019-10-06', '2026-10-06'), 7);
  assertEquals(ageYears(null, '2026-10-06'), null);
  assert(tooYoungToFast({ date_of_birth: '2021-03-01', life_stage: 'child' }, '2026-10-06'));
  assert(!tooYoungToFast({ date_of_birth: '2019-10-06', life_stage: 'child' }, '2026-10-06'));
  assert(
    tooYoungToFast({ date_of_birth: null, life_stage: 'child' }, '2026-10-06'),
    'unknown age child: conservative',
  );
  assert(!tooYoungToFast({ date_of_birth: null, life_stage: 'teen' }, '2026-10-06'));

  assertEquals(
    preMealWindows([
      { window: 'pre_lunch', start: '12:30' },
      { kind: 'on_waking', start: '06:00' },
    ]),
    [{ start: '12:30', label: 'pre_lunch' }],
  );
  assertEquals(
    preMealWindows({ windows: [{ kind: 'pre_meal', start: '19:30', mealType: 'dinner' }] }),
    [{ start: '19:30', label: 'pre_dinner' }],
  );
  assertEquals(preMealWindows({ nonsense: true }), []);
  assertEquals(preMealWindows([{ kind: 'pre_meal', start: '25:00' }]), []);

  const night = { start: 22 * 60, end: 6 * 60 + 30 };
  assert(inQuietHours(night, 23 * 60));
  assert(inQuietHours(night, 5 * 60));
  assert(!inQuietHours(night, 12 * 60));
  assert(inQuietHours({ start: 12 * 60, end: 14 * 60 }, 12 * 60 + 30));
  const prefs = [pref(OWNER, 'daily_plan', true, {}, { start: '22:00', end: '06:30' })];
  assertEquals(
    quietHoursFor(prefs, OWNER, 'hydration_reminder')?.start,
    22 * 60,
    'falls back to any row of the user',
  );
  assertEquals(quietHoursFor(prefs, CAREGIVER, 'hydration_reminder'), null);
});

// ---------------------------------------------------------------------------------------------
// Hydration (FR-HYD-02, FR-HYD-06)

Deno.test(
  'hydration: pre-meal windows per carer, merged across members; fallback 25 min before lunch',
  () => {
    const rows = materialize(baseSnapshot(), new Date('2026-10-06T07:20:00Z'));
    const hyd = rows.filter((r) => r.kind === 'hydration_reminder');
    // Owner: father 12:30 (own account) + child 12:30 (merged) + teen fallback 12:35.
    assertEquals(keysFor(hyd, OWNER, 'hydration_reminder'), [
      '2026-10-06T07:30:00.000Z',
      '2026-10-06T07:35:00.000Z',
    ]);
    // Caregiver: child 12:30 and teen 12:35; not the father, who has his own account.
    assertEquals(keysFor(hyd, CAREGIVER, 'hydration_reminder'), [
      '2026-10-06T07:30:00.000Z',
      '2026-10-06T07:35:00.000Z',
    ]);
    assertEquals(keysFor(hyd, VIEWER, 'hydration_reminder'), []);
    for (const r of hyd) assertEquals(r.data.route, 'thuluth://hydration');
    assertEquals(hyd.find((r) => r.user_id === CAREGIVER)?.title, 'پانی کا وقت');
    // Meal reminders are off by default; daily plan is not in this window.
    assertEquals(
      rows.filter((r) => r.kind !== 'hydration_reminder'),
      [],
    );
  },
);

Deno.test('hydration: disabled kind and custom offset', () => {
  const snap = baseSnapshot();
  snap.preferences = [
    pref(CAREGIVER, 'hydration_reminder', false),
    pref(OWNER, 'hydration_reminder', true, { offset_min: 20 }),
  ];
  const rows = materialize(snap, new Date('2026-10-06T07:20:00Z'), { lookaheadMin: 30 });
  assertEquals(keysFor(rows, CAREGIVER, 'hydration_reminder'), []);
  // Teen fallback: 13:00 minus 20 = 12:40.
  assertEquals(keysFor(rows, OWNER, 'hydration_reminder'), [
    '2026-10-06T07:30:00.000Z',
    '2026-10-06T07:40:00.000Z',
  ]);
});

Deno.test('hydration: on a logged fast, only between iftar and suhoor (FR-HYD-06)', () => {
  const snap = baseSnapshot();
  snap.hydration = [snap.hydration[0]!];
  snap.fasts = [
    {
      household_id: HH,
      family_member_id: FATHER,
      fast_date: '2026-10-06',
      kind: 'nafl',
      exemption_reason: null,
    },
  ];
  const midday = materialize(snap, new Date('2026-10-06T07:20:00Z'));
  assertEquals(
    midday.filter((r) => r.kind === 'hydration_reminder'),
    [],
    '12:30 is during the fast',
  );
  const evening = materialize(snap, new Date('2026-10-06T14:20:00Z'));
  assertEquals(
    keysFor(evening, OWNER, 'hydration_reminder'),
    ['2026-10-06T14:30:00.000Z'],
    '19:30 is after iftar',
  );
  // An exempted day is not a fast.
  snap.fasts[0]!.exemption_reason = 'travel';
  assertEquals(
    keysFor(materialize(snap, new Date('2026-10-06T07:20:00Z')), OWNER, 'hydration_reminder')
      .length,
    1,
  );
});

// ---------------------------------------------------------------------------------------------
// Meals and daily plan

Deno.test(
  'meal reminders: opt-in, one per meal time, deep link to the meal; daily plan at 07:00',
  () => {
    const snap = baseSnapshot();
    snap.preferences = [pref(OWNER, 'meal_reminder', true, { offset_min: 25 })];
    const rows = materialize(snap, new Date('2026-10-06T07:30:00Z'));
    const meals = rows.filter((r) => r.kind === 'meal_reminder');
    assertEquals(meals.length, 1, 'two lunch rows at 13:00 give one reminder');
    assertEquals(meals[0]!.user_id, OWNER);
    assertEquals(meals[0]!.scheduled_for, '2026-10-06T07:35:00.000Z');
    assertEquals(meals[0]!.title, 'Lunch in 25 minutes');
    assertEquals(meals[0]!.data.route, 'thuluth://meal/dm-lunch');

    const morning = materialize(snap, new Date('2026-10-06T01:55:00Z'));
    const daily = morning.filter((r) => r.kind === 'daily_plan');
    assertEquals(daily.map((r) => r.user_id).sort(), [OWNER, CAREGIVER, VIEWER].sort());
    assertEquals(daily[0]!.scheduled_for, '2026-10-06T02:00:00.000Z');
    assertEquals(daily[0]!.data.meal_plan_id, PLAN);

    snap.plans = [];
    assertEquals(
      materialize(snap, new Date('2026-10-06T01:55:00Z')).filter((r) => r.kind === 'daily_plan'),
      [],
    );
  },
);

// ---------------------------------------------------------------------------------------------
// Fasting: suhoor and iftar via the prayer module; never for children under 7

Deno.test(
  'fasting: suhoor and iftar reminders from Lahore prayer times; under-7 fasts ignored',
  () => {
    const snap = baseSnapshot();
    snap.hydration = [];
    snap.fasts = [
      {
        household_id: HH,
        family_member_id: FATHER,
        fast_date: '2026-10-07',
        kind: 'sunnah_monday_thursday',
        exemption_reason: null,
      },
      {
        household_id: HH,
        family_member_id: CHILD5,
        fast_date: '2026-10-07',
        kind: 'nafl',
        exemption_reason: null,
      },
    ];
    // Fajr 2026-10-07 in Lahore (Karachi method) is 04:39 PKT = 23:39Z; suhoor reminder 60 min before.
    const night = materialize(snap, new Date('2026-10-06T22:30:00Z'));
    const suhoor = night.filter((r) => r.kind === 'suhoor_reminder');
    assertEquals(
      suhoor.map((r) => [r.user_id, r.scheduled_for]),
      [[OWNER, '2026-10-06T22:39:00.000Z']],
    );
    assertEquals(suhoor[0]!.body, 'Suhoor ends at 04:39.');
    assertEquals(suhoor[0]!.data.route, 'thuluth://ramadan');
    // Maghrib 2026-10-07 is 17:40 PKT = 12:40Z; iftar reminder 10 minutes before.
    const afternoon = materialize(snap, new Date('2026-10-07T12:25:00Z'));
    assertEquals(
      afternoon.filter((r) => r.kind === 'iftar_reminder').map((r) => [r.user_id, r.scheduled_for]),
      [[OWNER, '2026-10-07T12:30:00.000Z']],
    );
    assertEquals(afternoon.find((r) => r.kind === 'iftar_reminder')!.body, 'Iftar is at 17:40.');

    // The 12-year-old's practice fast reaches both carers; the 5-year-old's never does.
    snap.fasts.push({
      household_id: HH,
      family_member_id: TEEN,
      fast_date: '2026-10-07',
      kind: 'nafl',
      exemption_reason: null,
    });
    const withTeen = materialize(snap, new Date('2026-10-06T22:30:00Z')).filter(
      (r) => r.kind === 'suhoor_reminder',
    );
    assertEquals(withTeen.map((r) => r.user_id).sort(), [OWNER, CAREGIVER].sort());
    snap.fasts = snap.fasts.filter((f) => f.family_member_id === CHILD5);
    assertEquals(
      materialize(snap, new Date('2026-10-06T22:30:00Z')).filter(
        (r) => r.kind === 'suhoor_reminder',
      ),
      [],
    );
  },
);

Deno.test('fasting: no reminders without coordinates or for intermittent fasting', () => {
  const snap = baseSnapshot();
  snap.hydration = [];
  snap.fasts = [
    {
      household_id: HH,
      family_member_id: FATHER,
      fast_date: '2026-10-07',
      kind: 'intermittent',
      exemption_reason: null,
    },
  ];
  assertEquals(materialize(snap, new Date('2026-10-06T22:30:00Z')), []);
  snap.fasts[0]!.kind = 'qada';
  snap.households[0]!.city = 'Atlantis';
  snap.households[0]!.country_code = 'XX';
  assertEquals(materialize(snap, new Date('2026-10-06T22:30:00Z')), []);
});

// ---------------------------------------------------------------------------------------------
// Voluntary fasts (S4-15, FR-FAST-04)

Deno.test('voluntary fasts: opt-in only; evening before at 21:00 and suhoor of the day', () => {
  const snap = baseSnapshot();
  snap.hydration = [];
  // 2026-10-08 is a Thursday (Hijri 27 Rabi al-Akhir 1448).
  assertEquals(materialize(snap, new Date('2026-10-07T15:55:00Z')), [], 'off by default');
  snap.preferences = [pref(OWNER, 'fasting_sunnah_reminder', true)];
  const eve = materialize(snap, new Date('2026-10-07T15:55:00Z'));
  assertEquals(
    eve.map((r) => [r.user_id, r.kind, r.scheduled_for]),
    [[OWNER, 'fasting_sunnah_reminder', '2026-10-07T16:00:00.000Z']],
  );
  assertEquals(eve[0]!.title, 'Thursday fast tomorrow');
  assertEquals(eve[0]!.data.fast_kind, 'sunnah_monday_thursday');
  assertEquals(eve[0]!.data.route, 'thuluth://fasting');
  // Suhoor: Fajr 2026-10-08 is 04:40 PKT = 23:40Z on the 7th; 60 minutes before.
  const pre = materialize(snap, new Date('2026-10-07T22:35:00Z'));
  assertEquals(
    pre.map((r) => [r.kind, r.scheduled_for, r.data.variant]),
    [['fasting_sunnah_reminder', '2026-10-07T22:40:00.000Z', 'suhoor']],
  );
  assertEquals(pre[0]!.title, 'Suhoor for Thursday fast');

  // Monday/Thursday switched off; custom evening time.
  snap.preferences = [pref(OWNER, 'fasting_sunnah_reminder', true, { monday_thursday: false })];
  assertEquals(materialize(snap, new Date('2026-10-07T15:55:00Z')), []);
  snap.preferences = [
    pref(OWNER, 'fasting_sunnah_reminder', true, { evening_time: '20:00', suhoor: false }),
  ];
  assertEquals(materialize(snap, new Date('2026-10-07T14:55:00Z')).length, 1);
  assertEquals(materialize(snap, new Date('2026-10-07T22:35:00Z')), [], 'suhoor variant off');
});

Deno.test(
  'voluntary fasts: Shia tradition, under-7 linked member, and no duplicate with a logged fast',
  () => {
    const snap = baseSnapshot();
    snap.hydration = [];
    snap.preferences = [pref(OWNER, 'fasting_sunnah_reminder', true)];
    snap.users[0]!.tradition_preference = 'shia';
    assertEquals(
      materialize(snap, new Date('2026-10-07T15:55:00Z')),
      [],
      'Monday/Thursday not suggested for Shia',
    );
    snap.users[0]!.tradition_preference = 'sunni';

    // A child's own account (contrived): never reminded under 7.
    snap.family[0]!.date_of_birth = '2020-01-01';
    assertEquals(materialize(snap, new Date('2026-10-07T15:55:00Z')), []);
    snap.family[0]!.date_of_birth = '1988-04-02';

    // Fast already logged for Thursday: the suhoor_reminder wins, no second voluntary suhoor push.
    snap.fasts = [
      {
        household_id: HH,
        family_member_id: FATHER,
        fast_date: '2026-10-08',
        kind: 'sunnah_monday_thursday',
        exemption_reason: null,
      },
    ];
    const rows = materialize(snap, new Date('2026-10-07T22:35:00Z'));
    assertEquals(
      rows.map((r) => r.kind),
      ['suhoor_reminder'],
    );
  },
);

Deno.test('voluntary fasts: Ayyam al-Bid with the household Hijri offset', () => {
  const snap = baseSnapshot();
  snap.hydration = [];
  snap.preferences = [pref(OWNER, 'fasting_sunnah_reminder', true, { monday_thursday: false })];
  // 2026-09-24 is 13 Rabi al-Akhir 1448 (Umm al-Qura): evening reminder on the 23rd.
  const rows = materialize(snap, new Date('2026-09-23T15:55:00Z'));
  assertEquals(
    rows.map((r) => [r.title, r.data.fast_date]),
    [['Ayyam al-Bid fast tomorrow', '2026-09-24']],
  );
  // Offset +1 (the local month began a day after Umm al-Qura's, common in Pakistan): the 13th is a day later.
  snap.households[0]!.hijri_offset_days = 1;
  assertEquals(materialize(snap, new Date('2026-09-23T15:55:00Z')), []);
  assertEquals(
    materialize(snap, new Date('2026-09-24T15:55:00Z')).map((r) => r.data.fast_date),
    ['2026-09-25'],
  );
});

// ---------------------------------------------------------------------------------------------
// The handler: lease, materialize, send

Deno.test('dispatch: x-internal-secret required', async () => {
  const t = setup();
  assertEquals((await t.run('2026-10-06T07:20:00Z', {}, null)).status, 401);
  assertEquals((await t.run('2026-10-06T07:20:00Z', {}, 'wrong')).status, 401);
  assertEquals(t.state.rows.length, 0);
});

Deno.test(
  'dispatch: skipped while another run holds the lease; runs when the lease RPC is missing',
  async () => {
    const held = setup(baseSnapshot(), { lease: false });
    const res = await held.run('2026-10-06T07:20:00Z');
    assertEquals(res.body.skipped, true);
    assertEquals(held.state.rows.length, 0);

    const missing = setup(baseSnapshot(), { lease: null });
    const ok = await missing.run('2026-10-06T07:20:00Z');
    assertEquals(ok.body.skipped, false);
    assertEquals(ok.body.materialized, 4);
    assertEquals(missing.state.released, [], 'nothing to release');
  },
);

Deno.test(
  'dispatch: materializes once, sends when due, releases the lease (demo: 25 min before lunch)',
  async () => {
    const t = setup();
    const first = await t.run('2026-10-06T07:20:00Z');
    assertEquals(first.status, 200);
    assertEquals(first.body.materialized, 4);
    assertEquals(first.body.sent, 0);
    assertEquals(t.state.released, ['notifications-dispatch:holder-1']);

    const again = await t.run('2026-10-06T07:21:00Z');
    assertEquals(again.body.materialized, 0, 'dedupe keys make materialization idempotent');

    const at1230 = await t.run('2026-10-06T07:30:00Z');
    assertEquals(at1230.body.sent, 2);
    const at1235 = await t.run('2026-10-06T07:35:00Z');
    assertEquals(at1235.body.sent, 2);
    const msg = t.push.sent.find((m) => m.user_id === OWNER)!;
    assertEquals(msg.route, 'thuluth://hydration');
    assertEquals(msg.headings.en, 'Time for a glass of water');
    assertEquals(msg.headings.ur, 'پانی کا وقت');
    assertEquals(msg.ttl_seconds, 1800);
    const sentRow = t.state.rows.find((r) => r.id === msg.notification_id)!;
    assertEquals(sentRow.status, 'sent');
    assertEquals(sentRow.onesignal_id, `os-${sentRow.id}`);
    assertEquals(sentRow.attempts, 1);
    assertEquals(sentRow.sent_at, '2026-10-06T07:30:00.000Z');
  },
);

Deno.test('dispatch: quiet hours suppress reminders but never suhoor', async () => {
  const snap = baseSnapshot();
  snap.preferences = [
    pref(
      CAREGIVER,
      'hydration_reminder',
      true,
      {},
      { start: '12:00', end: '14:00', tz: 'Asia/Karachi' },
    ),
  ];
  const t = setup(snap);
  await t.run('2026-10-06T07:20:00Z');
  const res = await t.run('2026-10-06T07:30:00Z');
  assertEquals(res.body.sent, 1);
  assertEquals(res.body.suppressed_quiet_hours, 1);
  const cancelled = t.state.rows.find((r) => r.user_id === CAREGIVER && r.status === 'cancelled')!;
  assertEquals((cancelled.data.dispatch as { reason: string }).reason, 'quiet_hours');

  const night = baseSnapshot();
  night.hydration = [];
  night.preferences = [pref(OWNER, 'daily_plan', true, {}, { start: '22:00', end: '06:30' })];
  night.fasts = [
    {
      household_id: HH,
      family_member_id: FATHER,
      fast_date: '2026-10-07',
      kind: 'nafl',
      exemption_reason: null,
    },
  ];
  const n = setup(night);
  await n.run('2026-10-06T22:30:00Z');
  const sent = await n.run('2026-10-06T22:39:00Z');
  assertEquals(sent.body.sent, 1, 'suhoor ignores quiet hours (FR-NOT-02)');
  assertEquals(n.push.sent[0]!.kind, 'suhoor_reminder');
  assertEquals(n.push.sent[0]!.time_sensitive, true);
});

Deno.test('dispatch: daily cap of 6 excludes suhoor, iftar and plan_ready', async () => {
  const snap = baseSnapshot();
  const t = setup(snap);
  for (let i = 0; i < 6; i++) {
    t.add({
      user_id: OWNER,
      kind: 'daily_plan',
      scheduled_for: '2026-10-06T02:00:00Z',
      status: 'sent',
      sent_at: `2026-10-06T0${i}:00:00.000Z`,
    });
  }
  // Sent yesterday (local): does not count.
  t.add({
    user_id: CAREGIVER,
    kind: 'daily_plan',
    scheduled_for: '2026-10-05T02:00:00Z',
    status: 'sent',
    sent_at: '2026-10-05T18:00:00.000Z',
  });
  t.add({
    user_id: OWNER,
    kind: 'plan_ready',
    scheduled_for: '2026-10-06T07:29:00Z',
    data: { route: `thuluth://plan/${PLAN}` },
  });
  await t.run('2026-10-06T07:20:00Z');
  const res = await t.run('2026-10-06T07:30:00Z');
  assertEquals(res.body.suppressed_cap, 1, "owner's hydration reminder is over the cap");
  assertEquals(res.body.sent, 2, "plan_ready for the owner and the caregiver's reminder");
  assertEquals(t.push.sent.map((m) => m.kind).sort(), ['hydration_reminder', 'plan_ready']);
  assertEquals(t.push.sent.find((m) => m.kind === 'plan_ready')!.route, `thuluth://plan/${PLAN}`);
});

Deno.test(
  'dispatch: stale rows cancelled; kinds disabled after materialization are not sent',
  async () => {
    const snap = baseSnapshot();
    const t = setup(snap);
    t.add({ user_id: OWNER, kind: 'daily_plan', scheduled_for: '2026-10-06T02:00:00Z' });
    const first = await t.run('2026-10-06T07:20:00Z');
    assertEquals(first.body.stale, 1, '5 hours late');
    assertEquals((t.state.rows[0]!.data.dispatch as { reason: string }).reason, 'stale');
    snap.preferences = [pref(CAREGIVER, 'hydration_reminder', false)];
    const res = await t.run('2026-10-06T07:30:00Z');
    assertEquals(res.body.suppressed_disabled, 1);
    assertEquals(res.body.sent, 1);
  },
);

Deno.test('dispatch: OneSignal not configured records not sent and keeps going', async () => {
  const t = setup();
  const mem = memoryNotifications(baseSnapshot());
  const handler = createNotificationsDispatchHandler({
    secrets: () => [SECRET],
    store: mem.store,
    push: oneSignalSender(undefined, undefined),
    now: () => new Date('2026-10-06T07:30:00Z'),
  });
  const res = await handler(
    new Request('http://localhost/notifications-dispatch', {
      method: 'POST',
      headers: { 'x-internal-secret': SECRET, 'content-type': 'application/json' },
      body: JSON.stringify({ triggered_at: '2026-10-06T07:30:00Z' }),
    }),
  );
  const body = await res.json();
  assertEquals(res.status, 200);
  assertEquals(body.materialized, 4);
  assertEquals(body.not_sent, 2);
  assertEquals(body.sent, 0);
  const failed = mem.state.rows.filter((r) => r.status === 'failed');
  assertEquals(failed.length, 2);
  assertEquals((failed[0]!.data.dispatch as { reason: string }).reason, 'not_configured');
  assertEquals(t.state.rows.length, 0);
});

Deno.test('dispatch: push errors retry up to 3 attempts, then fail', async () => {
  const t = setup(baseSnapshot(), { push: fakePush(() => 'throw') });
  await t.run('2026-10-06T07:20:00Z');
  const r1 = await t.run('2026-10-06T07:30:00Z');
  assertEquals(r1.body.failed, 0);
  assertEquals(t.state.rows.filter((r) => r.attempts === 1 && r.status === 'pending').length, 2);
  await t.run('2026-10-06T07:31:00Z');
  const r3 = await t.run('2026-10-06T07:32:00Z');
  assertEquals(r3.body.failed, 2);
  assertEquals(t.state.rows.filter((r) => r.status === 'failed').length, 2);
});

Deno.test('dispatch: no subscribed device is recorded as not sent', async () => {
  const t = setup(baseSnapshot(), { push: fakePush(() => 'none') });
  await t.run('2026-10-06T07:20:00Z');
  const res = await t.run('2026-10-06T07:30:00Z');
  assertEquals(res.body.not_sent, 2);
  assertEquals(
    (t.state.rows.find((r) => r.status === 'failed')!.data.dispatch as { reason: string }).reason,
    'no_subscribers',
  );
});

Deno.test('dispatch: dry_run writes nothing and takes no lease', async () => {
  const t = setup();
  t.add({ user_id: OWNER, kind: 'daily_plan', scheduled_for: '2026-10-06T07:19:00Z' });
  const res = await t.run('2026-10-06T07:20:00Z', { dry_run: true });
  assertEquals(res.body.materialized, 4);
  assertEquals(res.body.sent, 1);
  assertEquals(t.state.rows.length, 1);
  assertEquals(t.state.rows[0]!.status, 'pending');
  assertEquals(t.state.updates, 0);
  assertEquals(t.state.leases, []);
  assertEquals(t.push.sent, []);
});

Deno.test('dispatch: rejects a malformed body', async () => {
  const t = setup();
  assertEquals((await t.run('2026-10-06T07:20:00Z', { dry_run: 'yes' })).status, 400);
});

// ---------------------------------------------------------------------------------------------
// OneSignal client

Deno.test('oneSignalSender: request shape, no subscribers, retryable errors', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let reply = () => new Response(JSON.stringify({ id: 'os-1' }), { status: 200 });
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return reply();
  }) as unknown as typeof fetch;
  const send = oneSignalSender('test-key', 'app-1', fetchImpl);
  const message = {
    notification_id: 'n-1',
    user_id: OWNER,
    kind: 'suhoor_reminder',
    headings: { en: 'Suhoor time', ur: 'سحری کا وقت' },
    contents: { en: 'Suhoor ends at 04:39.', ur: 'سحری 04:39 پر ختم ہوگی۔' },
    route: 'thuluth://ramadan',
    ttl_seconds: 3600,
    time_sensitive: true,
  };
  assertEquals(await send(message), { sent: true, id: 'os-1' });
  assertEquals(calls[0]!.url, 'https://api.onesignal.com/notifications?c=push');
  assertEquals((calls[0]!.init.headers as Record<string, string>).authorization, 'Key test-key');
  const body = JSON.parse(String(calls[0]!.init.body));
  assertEquals(body.include_aliases, { external_id: [OWNER] });
  assertEquals(body.idempotency_key, 'n-1');
  assertEquals(body.data, {
    kind: 'suhoor_reminder',
    route: 'thuluth://ramadan',
    notification_id: 'n-1',
  });
  assertEquals(body.ios_interruption_level, 'time_sensitive');

  reply = () =>
    new Response(JSON.stringify({ id: '', errors: ['All included players are not subscribed'] }), {
      status: 200,
    });
  assertEquals(await send(message), { sent: false, reason: 'no_subscribers' });
  reply = () => new Response('bad', { status: 400 });
  assertEquals(await send(message), { sent: false, reason: 'http_400' });
  reply = () => new Response('down', { status: 503 });
  await assertRejects(() => send(message));
  assertEquals(await oneSignalSender(undefined, 'app')(message), {
    sent: false,
    reason: 'not_configured',
  });
});

// ---------------------------------------------------------------------------------------------
// S5-12: an active Ramadan plan drives suhoor and iftar reminders

function ramadanSnapshot(): Snapshot {
  const snap = baseSnapshot();
  snap.hydration = [];
  snap.fasts = [];
  snap.ramadan = [
    {
      household_id: HH,
      start_date: '2026-10-06',
      end_date: '2026-11-04',
      // The plan's own schedule (e.g. a corrected method): Fajr 04:50, iftar 17:45 on Wednesday.
      prayer_times: [
        { date: '2026-10-07', fajr: '04:50', maghrib: '17:44', iftar: '17:45' },
        { date: '2026-10-08', fajr: '04:51', maghrib: '17:43', iftar: '17:44' },
      ],
      child_participation: {
        [FATHER]: { mode: 'fasting', guidance: [] },
        [TEEN]: { mode: 'practice_fast', days: ['thu'], until: 'asr', guidance: [] },
        [CHILD5]: { mode: 'none', guidance: [] },
      },
    },
  ];
  return snap;
}

Deno.test('ramadan plan: suhoor and iftar from the plan schedule without any fasting log', () => {
  const snap = ramadanSnapshot();
  // Suhoor reminder 60 minutes before the plan's Fajr 04:50 PKT (= 23:50Z) on 2026-10-07.
  const night = materialize(snap, new Date('2026-10-06T22:45:00Z'));
  const suhoor = night.filter((r) => r.kind === 'suhoor_reminder');
  assertEquals(
    suhoor.map((r) => [r.user_id, r.scheduled_for]),
    [[OWNER, '2026-10-06T22:50:00.000Z']],
  );
  assertEquals(suhoor[0]!.body, 'Suhoor ends at 04:50.');
  assertEquals(suhoor[0]!.data.source, 'ramadan_plan');
  assertEquals(suhoor[0]!.dedupe_key, `suhoor:${HH}:2026-10-07`);
  // Iftar 17:45 PKT = 12:45Z, reminder 10 minutes before.
  const iftar = materialize(snap, new Date('2026-10-07T12:30:00Z')).filter(
    (r) => r.kind === 'iftar_reminder',
  );
  assertEquals(
    iftar.map((r) => [r.user_id, r.scheduled_for]),
    [[OWNER, '2026-10-07T12:35:00.000Z']],
  );
  assertEquals(iftar[0]!.body, 'Iftar is at 17:45.');
});

Deno.test('ramadan plan: practice days reach the carers; under-7 and other days never do', () => {
  const snap = ramadanSnapshot();
  // Thursday 2026-10-08: the 12-year-old's practice day, Fajr 04:51 = 23:51Z on the 7th.
  const thursday = materialize(snap, new Date('2026-10-07T22:45:00Z')).filter(
    (r) => r.kind === 'suhoor_reminder',
  );
  assertEquals(thursday.map((r) => r.user_id).sort(), [OWNER, CAREGIVER].sort());
  // Wednesday: only the father fasts, so the caregiver gets nothing.
  const wednesday = materialize(snap, new Date('2026-10-06T22:45:00Z')).filter(
    (r) => r.kind === 'suhoor_reminder',
  );
  assertEquals(
    wednesday.map((r) => r.user_id),
    [OWNER],
  );
  // Even a malformed plan that marks the 5-year-old as fasting never targets them.
  snap.ramadan![0]!.child_participation = { [CHILD5]: { mode: 'fasting' } };
  assertEquals(
    materialize(snap, new Date('2026-10-06T22:45:00Z')).filter((r) => r.kind === 'suhoor_reminder'),
    [],
  );
});

Deno.test(
  'ramadan plan: dates without a stored schedule fall back to computed times; voluntary logs still work outside',
  () => {
    const snap = ramadanSnapshot();
    snap.ramadan![0]!.prayer_times = [];
    const night = materialize(snap, new Date('2026-10-06T22:30:00Z')).filter(
      (r) => r.kind === 'suhoor_reminder',
    );
    // Computed Karachi-method Fajr 04:39 as in the fasting_logs test.
    assertEquals(
      night.map((r) => r.scheduled_for),
      ['2026-10-06T22:39:00.000Z'],
    );
    assertEquals(night[0]!.data.source, undefined);

    // Outside the plan's dates the fasting_logs path is unchanged.
    const later = baseSnapshot();
    later.hydration = [];
    later.ramadan = [
      { ...ramadanSnapshot().ramadan![0]!, start_date: '2026-11-01', end_date: '2026-11-29' },
    ];
    later.fasts = [
      {
        household_id: HH,
        family_member_id: FATHER,
        fast_date: '2026-10-07',
        kind: 'sunnah_monday_thursday',
        exemption_reason: null,
      },
    ];
    const voluntary = materialize(later, new Date('2026-10-06T22:30:00Z')).filter(
      (r) => r.kind === 'suhoor_reminder',
    );
    assertEquals(
      voluntary.map((r) => r.scheduled_for),
      ['2026-10-06T22:39:00.000Z'],
    );
  },
);

Deno.test('ramadan plan: hydration nudges only between iftar and suhoor on fasting days', () => {
  const snap = ramadanSnapshot();
  snap.hydration = baseSnapshot().hydration.filter((h) => h.family_member_id === FATHER);
  // 12:30 PKT pre-lunch window on a fasting day: suppressed.
  assertEquals(
    materialize(snap, new Date('2026-10-07T07:25:00Z')).filter(
      (r) => r.kind === 'hydration_reminder',
    ),
    [],
  );
  snap.ramadan = [];
  assertEquals(
    materialize(snap, new Date('2026-10-07T07:25:00Z')).filter(
      (r) => r.kind === 'hydration_reminder',
    ).length,
    1,
    'the same window is sent on a non-fasting day',
  );
});

Deno.test('billing_issue template: lock-screen safe, settings route', () => {
  const row = notificationRow({
    key: 'billing_issue',
    user_id: OWNER,
    household_id: null,
    locale: 'ur',
    scheduled_for: new Date('2026-10-07T00:00:00Z'),
    dedupe_key: 'billing_issue:evt',
    route: routeFor('billing_issue'),
  });
  assertEquals(row.kind, 'billing_issue');
  assertEquals(row.data.route, 'thuluth://settings/subscription');
  assert(row.title.length > 0);
});
