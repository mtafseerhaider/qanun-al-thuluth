import { ageInMonths, type LifeStage, type MealType } from '@shared';
import type { BEVERAGES, DRINK_TIMINGS } from '@shared/domain/tracking';

import { addDays, formatTime, localIsoDate, timeToMinutes } from '@/lib/dates/local-date';
import type { OutboxEntry } from '@/lib/offline/outbox';

/**
 * Pure hydration rules (02 §5.8, §7.12.2; 15 §6; FR-HYD-02 to -04, FR-DASH-03). Unit-tested without
 * rendering. Volumes are integers in ml; children's views convert to friendly cups.
 */

export const HYDRATION_LOG_KIND = 'hydration.log';
export const HYDRATION_DELETE_KIND = 'hydration.delete';

export type Beverage = (typeof BEVERAGES)[number];
export type DrinkTiming = (typeof DRINK_TIMINGS)[number];

/** One kid cup (FR-HYD-03 "cup 150 ml"); the kid view never shows ml (FR-HYD-04). */
export const KID_CUP_ML = 150;
/** Glass used by the "everyone drank a glass" shortcut (02 §7.12.3). */
export const GLASS_ML = 250;
/** Quick sizes shown on the tracker (02 §7.12.2: 150, 250, 330, 500 ml). */
export const ADULT_QUICK_SIZES = [150, 250, 330, 500] as const;
/** Kid view: half a cup, one cup, two cups. */
export const KID_QUICK_CUPS = [0.5, 1, 2] as const;

export interface HydrationLogView {
  id: string;
  familyMemberId: string;
  loggedAt: string;
  volumeMl: number;
  beverage: Beverage;
  timing: DrinkTiming;
  /** True while the write waits in the outbox. */
  queued?: boolean;
}

/** Payload of an outbox `hydration.log` entry; `id` is the row id and the idempotency key. */
export interface HydrationLogWrite {
  id: string;
  householdId: string;
  familyMemberId: string;
  loggedAt: string;
  volumeMl: number;
  beverage: Beverage;
  timing: DrinkTiming;
}

export interface HydrationDeleteWrite {
  id: string;
  householdId: string;
}

export interface HydrationWindowView {
  kind: 'on_waking' | 'pre_meal' | 'with_meal' | 'post_meal' | 'between' | 'before_sleep';
  /** 'HH:mm' household-local. */
  start: string;
  end: string;
  targetMl: number | null;
  mealType: MealType | null;
}

const MEAL_TYPES: readonly MealType[] = [
  'suhoor',
  'breakfast',
  'lunch',
  'snack',
  'dinner',
  'iftar',
];
const WINDOW_KINDS: readonly HydrationWindowView['kind'][] = [
  'on_waking',
  'pre_meal',
  'with_meal',
  'post_meal',
  'between',
  'before_sleep',
];

function minutesToHHmm(m: number): string {
  const clamped = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(clamped / 60)).padStart(2, '0')}:${String(clamped % 60).padStart(2, '0')}`;
}

/**
 * Reads `hydration_targets.schedule` in either shape: 15 §6.3 (`{kind, start, end, targetMl,
 * mealType}`) or the 05 §12.2 comment (`{window: 'pre_lunch', start, ml}`). Unknown rows are dropped.
 */
export function parseSchedule(json: unknown): HydrationWindowView[] {
  if (!Array.isArray(json)) return [];
  const out: HydrationWindowView[] = [];
  for (const raw of json) {
    if (!raw || typeof raw !== 'object') continue;
    const o = raw as Record<string, unknown>;
    const start = formatTime(typeof o.start === 'string' ? o.start : null);
    if (!start) continue;
    let kind: HydrationWindowView['kind'] | null = null;
    let mealType: MealType | null = null;
    if (typeof o.kind === 'string' && (WINDOW_KINDS as readonly string[]).includes(o.kind))
      kind = o.kind as HydrationWindowView['kind'];
    const mt = o.mealType ?? o.meal_type;
    if (typeof mt === 'string' && (MEAL_TYPES as readonly string[]).includes(mt))
      mealType = mt as MealType;
    if (!kind && typeof o.window === 'string') {
      const [prefix, ...rest] = o.window.split('_');
      const suffix = rest.join('_');
      kind = prefix === 'pre' ? 'pre_meal' : prefix === 'post' ? 'post_meal' : 'between';
      if (!mealType && (MEAL_TYPES as readonly string[]).includes(suffix))
        mealType = suffix as MealType;
    }
    if (!kind) continue;
    const startMin = timeToMinutes(start) ?? 0;
    const end =
      formatTime(typeof o.end === 'string' ? o.end : null) ?? minutesToHHmm(startMin + 10);
    const ml = o.targetMl ?? o.target_ml ?? o.ml;
    out.push({
      kind,
      start,
      end,
      targetMl: typeof ml === 'number' && ml > 0 ? Math.round(ml) : null,
      mealType,
    });
  }
  return out.sort((a, b) => (timeToMinutes(a.start) ?? 0) - (timeToMinutes(b.start) ?? 0));
}

/**
 * Timing of a drink at `minutes` (household-local minute of the day), from the schedule windows
 * and the day's meal times (02 §5.8): 20 to 30 minutes before a meal is `pre_meal` (with a little
 * slack), during the meal `with_meal`, 30 to 60 minutes after `post_meal`, otherwise `other`.
 */
export function classifyTiming(
  minutes: number,
  windows: readonly HydrationWindowView[],
  mealMinutes: readonly number[] = [],
): DrinkTiming {
  for (const w of windows) {
    const s = timeToMinutes(w.start);
    const e = timeToMinutes(w.end);
    if (s === null || e === null) continue;
    if (minutes >= s - 5 && minutes <= e + 5) {
      if (w.kind === 'pre_meal') return 'pre_meal';
      if (w.kind === 'post_meal') return 'post_meal';
      if (w.kind === 'with_meal') return 'with_meal';
    }
  }
  for (const m of mealMinutes) {
    if (minutes >= m - 35 && minutes < m - 10) return 'pre_meal';
    if (minutes >= m - 10 && minutes < m + 30) return 'with_meal';
    if (minutes >= m + 30 && minutes <= m + 60) return 'post_meal';
  }
  return 'other';
}

/** The next pre-meal window after now ("Water before lunch at 12:40"), or null. */
export function nextPreMealWindow(
  windows: readonly HydrationWindowView[],
  nowMinutes: number,
): HydrationWindowView | null {
  return (
    windows.find((w) => w.kind === 'pre_meal' && (timeToMinutes(w.start) ?? -1) >= nowMinutes) ??
    null
  );
}

/** Pre-meal windows derived from meal times when a member has no stored schedule (FR-HYD-02). */
export function windowsFromMeals(
  meals: ReadonlyArray<{ mealType: MealType; scheduledTime: string | null }>,
): HydrationWindowView[] {
  return meals
    .filter((m) => m.mealType !== 'snack')
    .flatMap((m) => {
      const t = timeToMinutes(m.scheduledTime);
      if (t === null) return [];
      return [
        {
          kind: 'pre_meal' as const,
          start: minutesToHHmm(t - 30),
          end: minutesToHHmm(t - 20),
          targetMl: null,
          mealType: m.mealType,
        },
      ];
    })
    .sort((a, b) => (timeToMinutes(a.start) ?? 0) - (timeToMinutes(b.start) ?? 0));
}

export function volumeBucket(ml: number): 'lt150' | '150_249' | '250_499' | '500_plus' {
  if (ml < 150) return 'lt150';
  if (ml < 250) return '150_249';
  if (ml < 500) return '250_499';
  return '500_plus';
}

/** Kid cup view (FR-HYD-04): toddlers and children see cups, never ml. */
export function usesKidCups(stage: LifeStage | null | undefined): boolean {
  return stage === 'toddler' || stage === 'child';
}

/** Whole and half cups, rounded to the nearest half. */
export function mlToCups(ml: number): number {
  return Math.round((Math.max(0, ml) / KID_CUP_ML) * 2) / 2;
}

/** A child's daily target in whole cups (at least one). */
export function targetCups(targetMl: number): number {
  return Math.max(1, Math.round(targetMl / KID_CUP_ML));
}

export function cupsToMl(cups: number): number {
  return Math.round(cups * KID_CUP_ML);
}

/**
 * Members who get no drinks target or logging (15 §6.2): babies under 6 months get all they need
 * from breast milk or formula.
 */
export function isUnderSixMonths(dateOfBirth: string | null | undefined, today: string): boolean {
  if (!dateOfBirth) return false;
  try {
    return ageInMonths(dateOfBirth, today) < 6;
  } catch {
    return false;
  }
}

/** Household-local date of a log. */
export function logDate(log: Pick<HydrationLogView, 'loggedAt'>, timezone: string | null): string {
  return localIsoDate(timezone, new Date(log.loggedAt));
}

/** ml per member for one household-local day. */
export function totalsByMember(
  logs: readonly HydrationLogView[],
  date: string,
  timezone: string | null,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const l of logs) {
    if (logDate(l, timezone) !== date) continue;
    out.set(l.familyMemberId, (out.get(l.familyMemberId) ?? 0) + l.volumeMl);
  }
  return out;
}

/**
 * Family hydration score (02 §5.8): round(100 × average over members with a target of
 * min(1, today_ml / daily_ml)). Null when no member has a target.
 */
export function familyScore(
  rows: ReadonlyArray<{ targetMl: number; consumedMl: number }>,
): number | null {
  const withTarget = rows.filter((r) => r.targetMl > 0);
  if (withTarget.length === 0) return null;
  const sum = withTarget.reduce((n, r) => n + Math.min(1, r.consumedMl / r.targetMl), 0);
  return Math.round((100 * sum) / withTarget.length);
}

/** Gentle overhydration note (15 §6.4): more than twice the target in a day. */
export function aboveSafeRange(consumedMl: number, targetMl: number): boolean {
  return targetMl > 0 && consumedMl > targetMl * 2;
}

/** Daily totals for the last 7 days ending `today` for one member (oldest first). */
export function lastSevenDays(
  logs: readonly HydrationLogView[],
  memberId: string,
  today: string,
  timezone: string | null,
): Array<{ date: string; ml: number }> {
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
  const sums = new Map(days.map((d) => [d, 0]));
  for (const l of logs) {
    if (l.familyMemberId !== memberId) continue;
    const d = logDate(l, timezone);
    if (sums.has(d)) sums.set(d, (sums.get(d) ?? 0) + l.volumeMl);
  }
  return days.map((date) => ({ date, ml: sums.get(date) ?? 0 }));
}

/**
 * Overlays queued writes on server rows (02 P10): queued logs appear at once (and survive restarts),
 * queued deletes hide their row. A log that has already reached the server is not duplicated.
 */
export function applyPendingHydration(
  logs: readonly HydrationLogView[],
  entries: readonly OutboxEntry[],
): HydrationLogView[] {
  const deleted = new Set<string>();
  const added: HydrationLogView[] = [];
  for (const e of entries) {
    if (e.kind === HYDRATION_DELETE_KIND) deleted.add((e.payload as HydrationDeleteWrite).id);
    if (e.kind === HYDRATION_LOG_KIND) {
      const w = e.payload as HydrationLogWrite;
      added.push({
        id: w.id,
        familyMemberId: w.familyMemberId,
        loggedAt: w.loggedAt,
        volumeMl: w.volumeMl,
        beverage: w.beverage,
        timing: w.timing,
        queued: true,
      });
    }
  }
  const known = new Set(logs.map((l) => l.id));
  return [...logs, ...added.filter((a) => !known.has(a.id))]
    .filter((l) => !deleted.has(l.id))
    .sort((a, b) => b.loggedAt.localeCompare(a.loggedAt));
}
