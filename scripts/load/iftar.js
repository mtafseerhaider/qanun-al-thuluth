// scripts/load/iftar.js
//
// k6 load test: the Ramadan iftar spike (19 §14 Ramadan readiness, 21 §13 load row, 22 §9). At maghrib the
// `iftar_reminder` push (notifications-dispatch, every minute) lands on every fasting household in a city at
// once, and a large share of them open the app within a minute or two: Today screen (profile, flags, household,
// members, active plan, today's meals, hydration and fasting trackers, inbox, budget, tip of the day), then
// a date-break water log, "fast completed" and the reminder marked read.
//
// This script replays exactly those PostgREST calls (apps/mobile/src/features/*/api) as signed-in test users,
// with an arrival rate that ramps from a normal evening baseline to SPIKE_MULTIPLIER x baseline (19 §14: 10x
// normal peak) and decays again. It never calls AI functions or anything that costs money, and it holds no
// secret: the base URL, the PUBLIC anon / publishable key and a file of test-user access tokens come from the
// environment. Run it against staging only (docs/ops/load-testing.md).
//
//   k6 run -e API_BASE_URL=https://api.staging.thuluth.app -e SUPABASE_ANON_KEY=<publishable key> \
//          -e TOKENS_FILE=./loadtest-tokens.json scripts/load/iftar.js
//
// TOKENS_FILE: JSON array of { "access_token": "...", "household_id": "<uuid>" } for staging load-test users
// (household_id optional: resolved in setup). Never commit it; tokens expire after jwt_expiry (1 h).
//
// Env (defaults in brackets):
//   API_BASE_URL, SUPABASE_ANON_KEY, TOKENS_FILE   required
//   BASE_RATE [2]          app opens per second before iftar (normal evening load)
//   SPIKE_MULTIPLIER [10]  peak = BASE_RATE x this
//   WARMUP [2m] SPIKE_RAMP [1m] SPIKE_HOLD [5m] DECAY [10m]   stage durations
//   PRE_VUS [50] MAX_VUS [600]                                 VU pool for the arrival-rate executor
//   WRITES [1]             0 = read-only run (no hydration, fasting, read-receipt or analytics writes)
//   P_HYDRATION [0.5] P_FAST_DONE [0.4] P_MARK_READ [0.6]      share of opens that write
//   TZ_OFFSET_MINUTES [300]  household-local "today" (Pakistan +05:00)
//   P95_READ_MS [500] P95_TODAY_MS [1500] MAX_ERROR_RATE [0.01] thresholds (21 §13)
//   PRODUCTION_HOSTS []    extra production hosts to refuse (comma-separated, e.g. the prod <ref>.supabase.co)
//   ALLOW_PRODUCTION [0]   the script refuses api.thuluth.app and PRODUCTION_HOSTS unless set to 1

import http from 'k6/http';
import encoding from 'k6/encoding';
import { check, fail, sleep } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter, Rate, Trend } from 'k6/metrics';

const env = (k, d) => (__ENV[k] === undefined || __ENV[k] === '' ? d : __ENV[k]);
const num = (k, d) => {
  const v = Number(env(k, d));
  if (!Number.isFinite(v)) fail(`${k} must be a number`);
  return v;
};

const BASE = String(env('API_BASE_URL', '')).replace(/\/$/, '');
const ANON_KEY = env('SUPABASE_ANON_KEY', '');
const TOKENS_FILE = env('TOKENS_FILE', '');
const BASE_RATE = num('BASE_RATE', 2);
const PEAK_RATE = Math.max(1, Math.round(BASE_RATE * num('SPIKE_MULTIPLIER', 10)));
const WRITES = env('WRITES', '1') !== '0';
const P_HYDRATION = num('P_HYDRATION', 0.5);
const P_FAST_DONE = num('P_FAST_DONE', 0.4);
const P_MARK_READ = num('P_MARK_READ', 0.6);
const TZ_OFFSET_MIN = num('TZ_OFFSET_MINUTES', 300);

if (!BASE || !ANON_KEY || !TOKENS_FILE) {
  fail(
    'API_BASE_URL, SUPABASE_ANON_KEY and TOKENS_FILE are required (see the header of scripts/load/iftar.js)',
  );
}
// Production hosts: the custom domain plus any extra host (for example the prod <ref>.supabase.co) in PRODUCTION_HOSTS.
const HOST = BASE.replace(/^https?:\/\//, '')
  .split(/[/:]/)[0]
  .toLowerCase();
const PROD_HOSTS = ['api.thuluth.app', 'thuluth.app'].concat(
  String(env('PRODUCTION_HOSTS', ''))
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
);
if (PROD_HOSTS.includes(HOST) && env('ALLOW_PRODUCTION', '0') !== '1') {
  fail(
    `refusing to load-test ${HOST}: production. Use staging, or set ALLOW_PRODUCTION=1 with the PO's approval`,
  );
}

const users = new SharedArray('users', () => {
  const rows = JSON.parse(open(TOKENS_FILE));
  if (!Array.isArray(rows) || rows.length === 0)
    throw new Error('TOKENS_FILE must be a non-empty JSON array');
  return rows.map((r) => ({ token: r.access_token, householdId: r.household_id || null }));
});

export const options = {
  scenarios: {
    iftar: {
      executor: 'ramping-arrival-rate',
      startRate: BASE_RATE,
      timeUnit: '1s',
      preAllocatedVUs: num('PRE_VUS', 50),
      maxVUs: num('MAX_VUS', 600),
      stages: [
        { target: BASE_RATE, duration: env('WARMUP', '2m') },
        { target: PEAK_RATE, duration: env('SPIKE_RAMP', '1m') },
        { target: PEAK_RATE, duration: env('SPIKE_HOLD', '5m') },
        { target: BASE_RATE, duration: env('DECAY', '10m') },
      ],
    },
  },
  thresholds: {
    http_req_failed: [`rate<${num('MAX_ERROR_RATE', 0.01)}`],
    'http_req_duration{kind:read}': [`p(95)<${num('P95_READ_MS', 500)}`],
    'http_req_duration{kind:write}': [`p(95)<${num('P95_READ_MS', 500) * 2}`],
    today_ready_ms: [`p(95)<${num('P95_TODAY_MS', 1500)}`],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  userAgent: 'thuluth-k6-iftar/1',
};

const todayReady = new Trend('today_ready_ms', true);
const opens = new Counter('app_opens');
const writeFailed = new Rate('write_failed');

function headers(token, extra) {
  return Object.assign(
    {
      apikey: ANON_KEY,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-platform': 'android',
      'x-app-version': 'loadtest',
    },
    extra || {},
  );
}

const rest = (path) => `${BASE}/rest/v1/${path}`;

function get(token, name, path) {
  return ['GET', rest(path), null, { headers: headers(token), tags: { name, kind: 'read' } }];
}

function userIdOf(token) {
  try {
    const payload = token.split('.')[1];
    return JSON.parse(encoding.b64decode(payload, 'rawurl', 's')).sub;
  } catch (_e) {
    return null;
  }
}

/** Household-local date, `days` from today (YYYY-MM-DD). */
function localDate(days) {
  const d = new Date(Date.now() + TZ_OFFSET_MIN * 60000 + (days || 0) * 86400000);
  return d.toISOString().slice(0, 10);
}

const ok2xx = (r) => r && r.status >= 200 && r.status < 300;

export function setup() {
  // Resolve missing household ids once (household_members is readable by the member).
  const out = [];
  for (const u of users) {
    let hid = u.householdId;
    if (!hid) {
      const uid = userIdOf(u.token);
      const r = http.get(
        rest(`household_members?select=household_id&user_id=eq.${uid}&deleted_at=is.null&limit=1`),
        {
          headers: headers(u.token),
          tags: { name: 'setup:household', kind: 'setup' },
        },
      );
      hid = ok2xx(r) && r.json().length ? r.json()[0].household_id : null;
    }
    if (hid) out.push({ token: u.token, householdId: hid });
  }
  if (!out.length)
    fail('no usable test user: check TOKENS_FILE tokens (expired?) and household membership');
  console.log(
    `iftar: ${out.length} users, ${BASE_RATE}/s -> ${PEAK_RATE}/s, writes ${WRITES ? 'on' : 'off'}`,
  );
  return { users: out };
}

export default function (data) {
  const u = data.users[(__VU * 7919 + __ITER) % data.users.length];
  const t = u.token;
  const hid = u.householdId;
  const uid = userIdOf(t);
  const today = localDate(0);
  const started = Date.now();
  opens.add(1);

  // 1. Resume after the push: profile, flags, household, members (app shell).
  const shell = http.batch([
    get(
      t,
      'shell:users',
      `users?select=id,display_name,email,locale,country_code,timezone,tradition_preference,units,onboarding_completed_at,age_attested_at&id=eq.${uid}`,
    ),
    [
      'POST',
      rest('rpc/evaluate_feature_flags'),
      '{}',
      { headers: headers(t), tags: { name: 'shell:flags', kind: 'read' } },
    ],
    get(
      t,
      'shell:household',
      `households?select=id,name,country_code,city,timezone,currency,family_size,owner_user_id&id=eq.${hid}`,
    ),
    get(
      t,
      'shell:members',
      `family_members?select=id,household_id,linked_user_id,name,date_of_birth,life_stage,sort_order,special_modules&household_id=eq.${hid}&deleted_at=is.null&order=sort_order`,
    ),
  ]);
  check(shell, { 'shell 2xx': (rs) => rs.every(ok2xx) });

  // 2. Today screen queries (dashboard-screen.tsx and today-trackers.tsx), in parallel like React Query.
  const monthStart = `${today.slice(0, 8)}01`;
  const todayRs = http.batch([
    get(
      t,
      'today:active_plan',
      `meal_plans?select=id,household_id,kind,status,title,start_date,end_date,week_count,version,generation_progress&household_id=eq.${hid}&status=eq.active&deleted_at=is.null&order=start_date.desc&limit=1`,
    ),
    get(
      t,
      'today:plans',
      `meal_plans?select=id,status,start_date,end_date,version&household_id=eq.${hid}&deleted_at=is.null&order=start_date.desc,version.desc&limit=30`,
    ),
    get(
      t,
      'today:inbox',
      `notifications?select=id,kind,title,body,data,status,channel,scheduled_for,read_at&scheduled_for=lte.${new Date().toISOString()}&order=scheduled_for.desc&limit=100`,
    ),
    get(
      t,
      'today:hydration_targets',
      `hydration_targets?select=family_member_id,daily_ml,schedule,basis&household_id=eq.${hid}&deleted_at=is.null`,
    ),
    get(
      t,
      'today:hydration_logs',
      `hydration_logs?select=id,family_member_id,logged_at,volume_ml,beverage,timing&household_id=eq.${hid}&logged_at=gte.${localDate(-8)}T00:00:00Z&order=logged_at.desc&limit=1000`,
    ),
    get(
      t,
      'today:fasting_logs',
      `fasting_logs_visible?select=id,family_member_id,fast_date,kind,completed&household_id=eq.${hid}&fast_date=gte.${localDate(-60)}`,
    ),
    get(
      t,
      'today:budget',
      `budget_entries?select=id,amount_minor,currency,category_id,spent_on&household_id=eq.${hid}&spent_on=gte.${monthStart}&spent_on=lte.${today}&order=spent_on.desc&limit=500`,
    ),
    get(
      t,
      'today:tips',
      'recommendations?select=id&review_status=eq.verified&order=code.asc&limit=60',
    ),
  ]);
  check(todayRs, { 'today 2xx': (rs) => rs.every(ok2xx) });

  // 3. Today's meals of the active plan (needs the plan id).
  const plan = ok2xx(todayRs[0]) ? todayRs[0].json()[0] : null;
  if (plan) {
    const meals = http.get(
      rest(
        `daily_meals?select=id,meal_plan_id,plan_date,meal_type,slot,scheduled_time,meal:meals!daily_meals_meal_id_fkey(id,title,title_i18n,meal_type,components),servings:daily_meal_servings(id,family_member_id,status,acceptance,portion:portions(household_measure,grams,life_stage))&household_id=eq.${hid}&meal_plan_id=eq.${plan.id}&plan_date=eq.${today}&order=scheduled_time.asc,slot.asc`,
      ),
      { headers: headers(t), tags: { name: 'today:daily_meals', kind: 'read' } },
    );
    check(meals, { 'daily_meals 2xx': ok2xx });
  }
  todayReady.add(Date.now() - started);

  if (!WRITES) {
    sleep(1 + Math.random() * 2);
    return;
  }

  sleep(1 + Math.random() * 3); // read the screen, then act
  const members = ok2xx(shell[3]) ? shell[3].json() : [];
  const adults = members.filter((m) => m.life_stage === 'adult' || m.life_stage === 'older_adult');
  const me = adults.find((m) => m.linked_user_id === uid) || adults[0];

  // 4. Break the fast with water (hydration tracker quick-add, timing pre_meal).
  if (me && Math.random() < P_HYDRATION) {
    const r = http.post(
      rest('hydration_logs'),
      JSON.stringify({
        household_id: hid,
        family_member_id: me.id,
        logged_at: new Date().toISOString(),
        volume_ml: 250,
        beverage: 'water',
        timing: 'pre_meal',
      }),
      {
        headers: headers(t, { prefer: 'return=minimal' }),
        tags: { name: 'write:hydration', kind: 'write' },
      },
    );
    writeFailed.add(!ok2xx(r));
    check(r, { 'hydration 201': ok2xx });
  }

  // 5. Mark today's Ramadan fast completed (same upsert key as the app's outbox).
  if (me && Math.random() < P_FAST_DONE) {
    const r = http.post(
      rest('fasting_logs?on_conflict=family_member_id,fast_date,kind'),
      JSON.stringify({
        household_id: hid,
        family_member_id: me.id,
        fast_date: today,
        kind: 'ramadan',
        completed: true,
        is_practice_fast: false,
      }),
      {
        headers: headers(t, { prefer: 'resolution=merge-duplicates,return=minimal' }),
        tags: { name: 'write:fast_done', kind: 'write' },
      },
    );
    writeFailed.add(!ok2xx(r));
    check(r, { 'fast upsert 2xx': ok2xx });
  }

  // 6. The iftar reminder is read (inbox read receipt) and the open is tracked.
  const inbox = ok2xx(todayRs[2]) ? todayRs[2].json() : [];
  const unread = inbox
    .filter((n) => !n.read_at)
    .slice(0, 5)
    .map((n) => n.id);
  if (unread.length && Math.random() < P_MARK_READ) {
    const r = http.patch(
      rest(`notifications?id=in.(${unread.join(',')})&read_at=is.null`),
      JSON.stringify({ read_at: new Date().toISOString() }),
      {
        headers: headers(t, { prefer: 'return=minimal' }),
        tags: { name: 'write:mark_read', kind: 'write' },
      },
    );
    writeFailed.add(!ok2xx(r));
    check(r, { 'mark read 2xx': ok2xx });
  }
  const tr = http.post(
    rest('rpc/track_events'),
    JSON.stringify({
      p_events: [
        { event: 'app_opened', household_id: hid, props: { cold_start: false } },
        { event: 'screen_viewed', household_id: hid, props: { screen: 'Today' } },
      ],
    }),
    { headers: headers(t), tags: { name: 'write:track_events', kind: 'write' } },
  );
  check(tr, { 'track_events 2xx': ok2xx });
  sleep(1);
}
