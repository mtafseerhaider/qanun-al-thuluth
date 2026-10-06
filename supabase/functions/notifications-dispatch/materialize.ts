import {
  cityCoordinates,
  defaultMethodFor,
  formatLocalTime,
  localDate,
  parseHhmm,
  prayerTimes,
  shiftIsoDate,
  voluntaryFastsOn,
  zonedTimeToInstant,
} from '@thuluth/shared/prayer/index.ts';
import type {
  PrayerTimes,
  Tradition,
  VoluntaryFastSettings,
} from '@thuluth/shared/prayer/index.ts';

import { notificationRow, routeFor } from '../_shared/notifications/templates.ts';
import type {
  NotificationRow,
  TemplateKey,
  TemplateVars,
} from '../_shared/notifications/templates.ts';

/**
 * Materializes due reminders (06 §4.15) from a snapshot of the database, as a pure function.
 * Each candidate carries a `dedupe_key` unique per user, so running every minute with a
 * look-ahead window inserts each reminder once (`notifications_dedupe_key`).
 */

export type Role = 'owner' | 'caregiver' | 'viewer' | 'coach';
export type LifeStage = 'infant' | 'toddler' | 'child' | 'teen' | 'adult' | 'older_adult';

export interface SnapshotHousehold {
  id: string;
  timezone: string;
  city: string | null;
  country_code: string;
  hijri_offset_days: number;
  /** 17 §10.3: set 11 months after premium lapsed; the owner gets one notice. */
  ai_memory_notice_at?: string | null;
}
export interface SnapshotMembership {
  household_id: string;
  user_id: string;
  role: Role;
}
export interface SnapshotUser {
  id: string;
  locale: string;
  timezone: string;
  tradition_preference: Tradition;
}
export interface SnapshotPreference {
  user_id: string;
  kind: string;
  enabled: boolean;
  quiet_hours: Record<string, unknown>;
  settings: Record<string, unknown>;
}
export interface SnapshotFamilyMember {
  id: string;
  household_id: string;
  date_of_birth: string | null;
  life_stage: LifeStage;
  linked_user_id: string | null;
}
export interface SnapshotHydrationTarget {
  household_id: string;
  family_member_id: string;
  schedule: unknown;
}
export interface SnapshotMeal {
  id: string;
  household_id: string;
  meal_plan_id: string;
  meal_type: string;
  plan_date: string;
  scheduled_time: string | null;
}
export interface SnapshotPlan {
  id: string;
  household_id: string;
  start_date: string;
  end_date: string;
}
export interface SnapshotFast {
  household_id: string;
  family_member_id: string;
  fast_date: string;
  kind: string;
  exemption_reason: string | null;
}

/** A live `ramadan_plans` row overlapping the window (S5-12, 15 §5.2). */
export interface SnapshotRamadanPlan {
  household_id: string;
  start_date: string;
  end_date: string;
  /** `[{ date, fajr, maghrib, iftar, ... }]` local `HH:mm` (ramadan-generate `DaySchedule`). */
  prayer_times: unknown;
  /** `{ <member_id>: { mode, days?: ['sat', ...] } }` (ramadan-generate `StoredParticipation`). */
  child_participation: unknown;
}

export interface Snapshot {
  households: SnapshotHousehold[];
  memberships: SnapshotMembership[];
  users: SnapshotUser[];
  preferences: SnapshotPreference[];
  family: SnapshotFamilyMember[];
  hydration: SnapshotHydrationTarget[];
  /** `daily_meals` of active plans around the window. */
  meals: SnapshotMeal[];
  /** Active plans. */
  plans: SnapshotPlan[];
  fasts: SnapshotFast[];
  /** Ramadan plans; while one covers a date, its schedule drives suhoor and iftar reminders. */
  ramadan?: SnapshotRamadanPlan[];
}

/** 06 §4.15 defaults: these kinds are off until the user opts in. */
export const DEFAULT_OFF = new Set([
  'meal_reminder',
  'meal_log_prompt',
  'journal_prompt',
  'fasting_sunnah_reminder',
  'marketing',
]);

/** Look-ahead and grace for materialization. */
export const LOOKAHEAD_MIN = 15;
export const GRACE_MIN = 2;
/** Fasting reminders never target children under 7 (15 §5, AC-H6). */
export const MIN_FASTING_AGE_YEARS = 7;
const DEFAULT_PRE_MEAL_OFFSET_MIN = 25;
const DEFAULT_SUHOOR_MIN_BEFORE_FAJR = 60;
const DEFAULT_IFTAR_MIN_BEFORE_MAGHRIB = 10;
const DEFAULT_DAILY_PLAN_TIME = '07:00';
const DEFAULT_SUNNAH_EVENING_TIME = '21:00';
/** Logged fasts of these kinds run dawn to sunset; intermittent fasting does not. */
const DAWN_TO_SUNSET = new Set([
  'ramadan',
  'sunnah_monday_thursday',
  'ayyam_al_bid',
  'arafah',
  'ashura',
  'qada',
  'nafl',
]);

export interface Preferences {
  get(userId: string, kind: string): SnapshotPreference | undefined;
  enabled(userId: string, kind: string): boolean;
  settings(userId: string, kind: string): Record<string, unknown>;
}

export function preferenceIndex(prefs: readonly SnapshotPreference[]): Preferences {
  const map = new Map(prefs.map((p) => [`${p.user_id}:${p.kind}`, p]));
  return {
    get: (u, k) => map.get(`${u}:${k}`),
    enabled: (u, k) => map.get(`${u}:${k}`)?.enabled ?? !DEFAULT_OFF.has(k),
    settings: (u, k) => map.get(`${u}:${k}`)?.settings ?? {},
  };
}

const num = (v: unknown, fallback: number, min: number, max: number): number =>
  typeof v === 'number' && Number.isFinite(v)
    ? Math.min(max, Math.max(min, Math.round(v)))
    : fallback;

const hhmm = (v: unknown, fallback: string): string =>
  parseHhmm(v) === null ? fallback : (v as string);

/** Whole years of age on `date`; null when unknown. */
export function ageYears(dob: string | null, date: string): number | null {
  if (!dob) return null;
  const [y1, m1, d1] = dob.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = date.split('-').map(Number) as [number, number, number];
  return y2 - y1 - (m2 < m1 || (m2 === m1 && d2 < d1) ? 1 : 0);
}

/** Under 7, or unknown age at a young life stage: never targeted by fasting reminders. */
export function tooYoungToFast(
  member: Pick<SnapshotFamilyMember, 'date_of_birth' | 'life_stage'>,
  date: string,
): boolean {
  const age = ageYears(member.date_of_birth, date);
  if (age !== null) return age < MIN_FASTING_AGE_YEARS;
  return (
    member.life_stage === 'infant' ||
    member.life_stage === 'toddler' ||
    member.life_stage === 'child'
  );
}

/** Pre-meal water windows (`HH:mm` starts) from `hydration_targets.schedule` (15 §6.3). */
export function preMealWindows(schedule: unknown): Array<{ start: string; label: string }> {
  const list = Array.isArray(schedule)
    ? schedule
    : schedule &&
        typeof schedule === 'object' &&
        Array.isArray((schedule as { windows?: unknown }).windows)
      ? (schedule as { windows: unknown[] }).windows
      : [];
  const out: Array<{ start: string; label: string }> = [];
  for (const w of list) {
    if (!w || typeof w !== 'object') continue;
    const r = w as Record<string, unknown>;
    const label = String(r.kind ?? r.window ?? '');
    const isPreMeal = label === 'pre_meal' || label.startsWith('pre_');
    if (!isPreMeal || parseHhmm(r.start) === null) continue;
    out.push({
      start: r.start as string,
      label: typeof r.mealType === 'string' ? `pre_${r.mealType}` : label,
    });
  }
  return out;
}

interface Ctx {
  snapshot: Snapshot;
  prefs: Preferences;
  from: number;
  to: number;
  users: Map<string, SnapshotUser>;
  out: NotificationRow[];
  prayerCache: Map<string, PrayerTimes | null>;
}

function inWindow(ctx: Ctx, at: Date): boolean {
  const t = at.getTime();
  return t >= ctx.from && t <= ctx.to;
}

function push(
  ctx: Ctx,
  key: TemplateKey,
  userId: string,
  householdId: string,
  at: Date,
  dedupe: string,
  vars: TemplateVars = {},
  route = routeFor(key),
  data: Record<string, unknown> = {},
) {
  const user = ctx.users.get(userId);
  if (!user) return;
  ctx.out.push(
    notificationRow({
      key,
      user_id: userId,
      household_id: householdId,
      locale: user.locale,
      scheduled_for: at,
      dedupe_key: dedupe,
      vars,
      route,
      data,
    }),
  );
}

/** Owners and caregivers, who look after members without an account of their own. */
function carers(ctx: Ctx, householdId: string): string[] {
  return ctx.snapshot.memberships
    .filter((m) => m.household_id === householdId && (m.role === 'owner' || m.role === 'caregiver'))
    .map((m) => m.user_id);
}

/** Who is reminded about a family member: the member's own account, else the carers. */
function recipientsFor(ctx: Ctx, member: SnapshotFamilyMember): string[] {
  const linked = member.linked_user_id;
  if (
    linked &&
    ctx.snapshot.memberships.some(
      (m) => m.household_id === member.household_id && m.user_id === linked,
    )
  ) {
    return [linked];
  }
  return carers(ctx, member.household_id);
}

function prayersFor(
  ctx: Ctx,
  h: SnapshotHousehold,
  date: string,
  tradition: Tradition,
): PrayerTimes | null {
  const key = `${h.id}:${date}:${tradition}`;
  if (ctx.prayerCache.has(key)) return ctx.prayerCache.get(key)!;
  let times: PrayerTimes | null = null;
  const coords = cityCoordinates(h.city, h.country_code);
  if (coords) {
    try {
      times = prayerTimes(date, coords, defaultMethodFor(h.country_code, tradition));
    } catch {
      times = null; // polar day or night: no fasting reminders
    }
  }
  ctx.prayerCache.set(key, times);
  return times;
}

/** Local dates of the household that the window touches. */
function datesInWindow(ctx: Ctx, tz: string): string[] {
  const a = localDate(new Date(ctx.from), tz);
  const b = localDate(new Date(ctx.to), tz);
  return a === b ? [a] : [a, b];
}

const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

function ramadanPlanOn(
  ctx: Ctx,
  householdId: string,
  date: string,
): SnapshotRamadanPlan | undefined {
  return (ctx.snapshot.ramadan ?? []).find(
    (r) => r.household_id === householdId && r.start_date <= date && r.end_date >= date,
  );
}

/** Whether a Ramadan plan has the member fasting (fully or a practice day) on `date`. */
function ramadanFastOn(plan: SnapshotRamadanPlan, memberId: string, date: string): boolean {
  const all = plan.child_participation;
  if (!all || typeof all !== 'object') return false;
  const p = (all as Record<string, unknown>)[memberId];
  if (!p || typeof p !== 'object') return false;
  const { mode, days } = p as { mode?: unknown; days?: unknown };
  if (mode === 'fasting') return true;
  if (mode !== 'practice_fast' || !Array.isArray(days)) return false;
  const weekday = WEEKDAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()];
  return days.includes(weekday);
}

/** The plan's stored Fajr and iftar for a date as instants, or null when absent or malformed. */
function ramadanTimesOn(
  plan: SnapshotRamadanPlan,
  date: string,
  timeZone: string,
): { fajr: Date; maghrib: Date } | null {
  if (!Array.isArray(plan.prayer_times)) return null;
  const day = plan.prayer_times.find(
    (d): d is Record<string, unknown> =>
      !!d && typeof d === 'object' && (d as { date?: unknown }).date === date,
  );
  if (!day) return null;
  const fajr = day.fajr;
  const iftar = parseHhmm(day.iftar) !== null ? day.iftar : day.maghrib;
  if (parseHhmm(fajr) === null || parseHhmm(iftar) === null) return null;
  return {
    fajr: zonedTimeToInstant(date, fajr as string, timeZone),
    maghrib: zonedTimeToInstant(date, iftar as string, timeZone),
  };
}

function fastingOn(ctx: Ctx, memberId: string, date: string): boolean {
  const member = ctx.snapshot.family.find((m) => m.id === memberId);
  const plan = member ? ramadanPlanOn(ctx, member.household_id, date) : undefined;
  if (plan && ramadanFastOn(plan, memberId, date)) return true;
  return ctx.snapshot.fasts.some(
    (f) =>
      f.family_member_id === memberId &&
      f.fast_date === date &&
      !f.exemption_reason &&
      DAWN_TO_SUNSET.has(f.kind),
  );
}

function activePlanOn(ctx: Ctx, householdId: string, date: string): SnapshotPlan | undefined {
  return ctx.snapshot.plans.find(
    (p) => p.household_id === householdId && p.start_date <= date && p.end_date >= date,
  );
}

function hydration(ctx: Ctx, h: SnapshotHousehold) {
  const members = ctx.snapshot.family.filter((m) => m.household_id === h.id);
  for (const date of datesInWindow(ctx, h.timezone)) {
    // user -> instant -> window label
    const perUser = new Map<string, Map<number, string>>();
    const add = (userId: string, at: Date, label: string) => {
      const m = perUser.get(userId) ?? new Map<number, string>();
      if (!m.has(at.getTime())) m.set(at.getTime(), label);
      perUser.set(userId, m);
    };
    for (const member of members) {
      const target = ctx.snapshot.hydration.find((t) => t.family_member_id === member.id);
      if (!target) continue;
      const recipients = recipientsFor(ctx, member);
      // On a logged fast, water reminders only between iftar and suhoor (FR-HYD-06).
      const times = fastingOn(ctx, member.id, date)
        ? prayersFor(ctx, h, date, 'shared')
        : undefined;
      const allowed = (at: Date) =>
        times === undefined ||
        (times !== null &&
          (at.getTime() < times.fajr.getTime() || at.getTime() >= times.maghrib.getTime()));
      const scheduled = preMealWindows(target.schedule);
      if (scheduled.length) {
        for (const w of scheduled) {
          const at = zonedTimeToInstant(date, w.start, h.timezone);
          if (allowed(at)) for (const userId of recipients) add(userId, at, w.label);
        }
        continue;
      }
      // No pre-meal windows stored yet: 20 to 30 minutes before the plan's lunch and dinner (FR-HYD-02).
      const plan = activePlanOn(ctx, h.id, date);
      const mains = ctx.snapshot.meals.filter(
        (m) =>
          plan !== undefined &&
          m.meal_plan_id === plan.id &&
          m.plan_date === date &&
          (m.meal_type === 'lunch' || m.meal_type === 'dinner') &&
          parseHhmm(m.scheduled_time) !== null,
      );
      for (const userId of recipients) {
        const offset = num(
          ctx.prefs.settings(userId, 'hydration_reminder').offset_min,
          DEFAULT_PRE_MEAL_OFFSET_MIN,
          20,
          30,
        );
        for (const m of mains) {
          const at = new Date(
            zonedTimeToInstant(date, m.scheduled_time!, h.timezone).getTime() - offset * 60_000,
          );
          if (allowed(at)) add(userId, at, `pre_${m.meal_type}`);
        }
      }
    }
    for (const [userId, instants] of perUser) {
      if (!ctx.prefs.enabled(userId, 'hydration_reminder')) continue;
      for (const [t, label] of instants) {
        const at = new Date(t);
        if (!inWindow(ctx, at)) continue;
        push(
          ctx,
          'hydration_reminder',
          userId,
          h.id,
          at,
          `hydration:${h.id}:${at.toISOString()}`,
          {},
          routeFor('hydration_reminder'),
          {
            window: label,
          },
        );
      }
    }
  }
}

function meals(ctx: Ctx, h: SnapshotHousehold) {
  for (const date of datesInWindow(ctx, h.timezone)) {
    const plan = activePlanOn(ctx, h.id, date);
    if (!plan) continue;
    const seen = new Map<string, SnapshotMeal>();
    for (const m of ctx.snapshot.meals) {
      if (
        m.meal_plan_id !== plan.id ||
        m.plan_date !== date ||
        parseHhmm(m.scheduled_time) === null
      )
        continue;
      const key = `${m.meal_type}@${m.scheduled_time}`;
      if (!seen.has(key)) seen.set(key, m);
    }
    for (const userId of carers(ctx, h.id)) {
      if (!ctx.prefs.enabled(userId, 'meal_reminder')) continue;
      const offset = num(
        ctx.prefs.settings(userId, 'meal_reminder').offset_min,
        DEFAULT_PRE_MEAL_OFFSET_MIN,
        5,
        120,
      );
      for (const m of seen.values()) {
        const mealAt = zonedTimeToInstant(date, m.scheduled_time!, h.timezone);
        const at = new Date(mealAt.getTime() - offset * 60_000);
        if (!inWindow(ctx, at)) continue;
        push(
          ctx,
          'meal_reminder',
          userId,
          h.id,
          at,
          `meal:${h.id}:${date}:${m.meal_type}:${m.scheduled_time}`,
          { meal: m.meal_type, minutes: offset },
          routeFor('meal_reminder', { daily_meal_id: m.id }),
          { daily_meal_id: m.id, meal_plan_id: plan.id },
        );
      }
    }
  }
}

function dailyPlan(ctx: Ctx, h: SnapshotHousehold) {
  for (const date of datesInWindow(ctx, h.timezone)) {
    const plan = activePlanOn(ctx, h.id, date);
    if (!plan) continue;
    for (const m of ctx.snapshot.memberships) {
      if (
        m.household_id !== h.id ||
        m.role === 'coach' ||
        !ctx.prefs.enabled(m.user_id, 'daily_plan')
      )
        continue;
      const time = hhmm(ctx.prefs.settings(m.user_id, 'daily_plan').time, DEFAULT_DAILY_PLAN_TIME);
      const at = zonedTimeToInstant(date, time, h.timezone);
      if (!inWindow(ctx, at)) continue;
      push(
        ctx,
        'daily_plan',
        m.user_id,
        h.id,
        at,
        `daily_plan:${h.id}:${date}`,
        {},
        routeFor('daily_plan'),
        {
          meal_plan_id: plan.id,
        },
      );
    }
  }
}

function fasting(ctx: Ctx, h: SnapshotHousehold) {
  const dates = new Set(datesInWindow(ctx, h.timezone));
  // A suhoor reminder for tomorrow can fall inside tonight's window.
  for (const d of [...dates]) dates.add(shiftIsoDate(d, 1));
  for (const date of dates) {
    const fasters = ctx.snapshot.family.filter(
      (m) => m.household_id === h.id && fastingOn(ctx, m.id, date) && !tooYoungToFast(m, date),
    );
    const recipients = new Set(fasters.flatMap((m) => recipientsFor(ctx, m)));
    // S5-12: an active Ramadan plan's own schedule (its method, location and iftar choice) wins
    // over the default calculation; voluntary fasts keep the fasting_logs path.
    const plan = ramadanPlanOn(ctx, h.id, date);
    const planTimes = plan ? ramadanTimesOn(plan, date, h.timezone) : null;
    for (const userId of recipients) {
      const user = ctx.users.get(userId);
      if (!user) continue;
      const times = planTimes ?? prayersFor(ctx, h, date, user.tradition_preference);
      if (!times) continue;
      if (ctx.prefs.enabled(userId, 'suhoor_reminder')) {
        const before = num(
          ctx.prefs.settings(userId, 'suhoor_reminder').minutes_before_fajr,
          DEFAULT_SUHOOR_MIN_BEFORE_FAJR,
          10,
          180,
        );
        const at = new Date(times.fajr.getTime() - before * 60_000);
        if (inWindow(ctx, at)) {
          push(
            ctx,
            'suhoor_reminder',
            userId,
            h.id,
            at,
            `suhoor:${h.id}:${date}`,
            {
              time: formatLocalTime(times.fajr, h.timezone),
            },
            routeFor('suhoor_reminder'),
            {
              fast_date: date,
              ends_at: times.fajr.toISOString(),
              ...(planTimes ? { source: 'ramadan_plan' } : {}),
            },
          );
        }
      }
      if (ctx.prefs.enabled(userId, 'iftar_reminder')) {
        const before = num(
          ctx.prefs.settings(userId, 'iftar_reminder').minutes_before_maghrib,
          DEFAULT_IFTAR_MIN_BEFORE_MAGHRIB,
          0,
          60,
        );
        const at = new Date(times.maghrib.getTime() - before * 60_000);
        if (inWindow(ctx, at)) {
          push(
            ctx,
            'iftar_reminder',
            userId,
            h.id,
            at,
            `iftar:${h.id}:${date}`,
            {
              time: formatLocalTime(times.maghrib, h.timezone),
            },
            routeFor('iftar_reminder'),
            {
              fast_date: date,
              iftar_at: times.maghrib.toISOString(),
              ...(planTimes ? { source: 'ramadan_plan' } : {}),
            },
          );
        }
      }
    }
  }
}

/** Voluntary fast reminders (FR-FAST-04, S4-15): opt-in, evening before and suhoor of the day. */
function voluntary(ctx: Ctx) {
  const homes = new Map(ctx.snapshot.households.map((h) => [h.id, h]));
  const rank: Record<Role, number> = { owner: 0, caregiver: 1, viewer: 2, coach: 3 };
  const memberships = [...ctx.snapshot.memberships].sort((a, b) => rank[a.role] - rank[b.role]);
  const done = new Set<string>();
  for (const m of memberships) {
    if (done.has(m.user_id) || m.role === 'coach') continue;
    const h = homes.get(m.household_id);
    const user = ctx.users.get(m.user_id);
    if (!h || !user) continue;
    done.add(m.user_id);
    if (!ctx.prefs.enabled(user.id, 'fasting_sunnah_reminder')) continue;
    const self = ctx.snapshot.family.find(
      (f) => f.linked_user_id === user.id && f.household_id === h.id,
    );
    const raw = ctx.prefs.settings(user.id, 'fasting_sunnah_reminder');
    const settings: VoluntaryFastSettings = {
      monday_thursday: raw.monday_thursday !== false,
      ayyam_al_bid: raw.ayyam_al_bid !== false,
      arafah: raw.arafah !== false,
      ashura: raw.ashura !== false,
      ashura_companion: raw.ashura_companion === '11' ? '11' : '9',
    };
    const evening = hhmm(raw.evening_time, DEFAULT_SUNNAH_EVENING_TIME);
    const suhoorBefore = num(
      raw.suhoor_minutes_before_fajr,
      DEFAULT_SUHOOR_MIN_BEFORE_FAJR,
      10,
      180,
    );
    const opts = {
      tradition: user.tradition_preference,
      hijriOffsetDays: h.hijri_offset_days,
      settings,
    };
    const dates = new Set(datesInWindow(ctx, h.timezone));
    for (const d of [...dates]) dates.add(shiftIsoDate(d, 1));
    for (const day of dates) {
      // The fast is on `day`: evening reminder on the day before, suhoor reminder on the day.
      if (self && tooYoungToFast(self, day)) continue;
      const fast = voluntaryFastsOn(day, opts)[0];
      if (!fast) continue;
      const eve = zonedTimeToInstant(shiftIsoDate(day, -1), evening, h.timezone);
      if (inWindow(ctx, eve)) {
        push(
          ctx,
          'fasting_sunnah_reminder.evening',
          user.id,
          h.id,
          eve,
          `sunnah_evening:${day}`,
          {
            fast: fast.label_key,
          },
          routeFor('fasting_sunnah_reminder.evening'),
          { fast_date: day, fast_kind: fast.kind, variant: 'evening' },
        );
      }
      if (raw.suhoor === false) continue;
      const times = prayersFor(ctx, h, day, user.tradition_preference);
      if (!times) continue;
      const at = new Date(times.fajr.getTime() - suhoorBefore * 60_000);
      if (inWindow(ctx, at)) {
        push(
          ctx,
          'fasting_sunnah_reminder.suhoor',
          user.id,
          h.id,
          at,
          `sunnah_suhoor:${day}`,
          {
            fast: fast.label_key,
            time: formatLocalTime(times.fajr, h.timezone),
          },
          routeFor('fasting_sunnah_reminder.suhoor'),
          { fast_date: day, fast_kind: fast.kind, variant: 'suhoor' },
        );
      }
    }
  }
}

/**
 * All reminders due in `[now - GRACE_MIN, now + LOOKAHEAD_MIN]`, one per user and dedupe key.
 * When a user already gets a `suhoor_reminder` for a day (a logged fast), the voluntary suhoor
 * reminder for the same day is dropped.
 */
/** Notices older than this are not sent late (the memories are deleted 30 days after the notice). */
export const AI_MEMORY_NOTICE_MAX_LATE_DAYS = 7;

/**
 * 17 §10.3: one notice to each household owner when `ai_memory_notice_at` is reached. Not gated by
 * preferences or quiet-hour windows beyond the normal send path: it tells the owner data will be
 * deleted. The dedupe key makes it once per household and notice.
 */
function aiMemoryNotice(ctx: Ctx, h: SnapshotHousehold, now: Date) {
  if (!h.ai_memory_notice_at) return;
  const at = Date.parse(h.ai_memory_notice_at);
  if (!Number.isFinite(at) || at > ctx.to) return;
  if (now.getTime() - at > AI_MEMORY_NOTICE_MAX_LATE_DAYS * 86_400_000) return;
  const owners = ctx.snapshot.memberships.filter(
    (m) => m.household_id === h.id && m.role === 'owner',
  );
  for (const o of owners) {
    push(
      ctx,
      'billing_issue.ai_memory',
      o.user_id,
      h.id,
      new Date(Math.max(at, ctx.from)),
      `ai_memory_notice:${h.id}:${h.ai_memory_notice_at.slice(0, 10)}`,
    );
  }
}

export function materialize(
  snapshot: Snapshot,
  now: Date,
  window: { graceMin?: number; lookaheadMin?: number } = {},
): NotificationRow[] {
  const ctx: Ctx = {
    snapshot,
    prefs: preferenceIndex(snapshot.preferences),
    from: now.getTime() - (window.graceMin ?? GRACE_MIN) * 60_000,
    to: now.getTime() + (window.lookaheadMin ?? LOOKAHEAD_MIN) * 60_000,
    users: new Map(snapshot.users.map((u) => [u.id, u])),
    out: [],
    prayerCache: new Map(),
  };
  for (const h of snapshot.households) {
    aiMemoryNotice(ctx, h, now);
    hydration(ctx, h);
    meals(ctx, h);
    dailyPlan(ctx, h);
    fasting(ctx, h);
  }
  voluntary(ctx);

  const suhoorDays = new Set(
    ctx.out
      .filter((r) => r.kind === 'suhoor_reminder')
      .map((r) => `${r.user_id}:${r.data.fast_date}`),
  );
  const seen = new Set<string>();
  return ctx.out.filter((r) => {
    if (r.data.variant === 'suhoor' && suhoorDays.has(`${r.user_id}:${r.data.fast_date}`))
      return false;
    const k = `${r.user_id}:${r.dedupe_key}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
