import type { PlanMealType } from '@thuluth/ai-core';

/**
 * Ramadan plans through the shared plan pipeline (S5-10, 15 §5.2-5.5). `ramadan-generate` stores
 * a `RamadanMeta` in `meal_plans.generation_meta.ramadan`; the worker plans every slot for every
 * served member with the normal engine, then this module fits the result to the fasting schedule:
 * prayer-time based `scheduled_time` per day and servings only for who eats at that time.
 */

export type ParticipationMode = 'fasting' | 'practice_fast' | 'not_fasting' | 'exempt' | 'none';
export type PracticeUntil = 'dhuhr' | 'asr' | 'maghrib';

export interface MemberParticipation {
  mode: ParticipationMode;
  /** Practice fasts: weekdays 0 (Sunday) .. 6 (Saturday). */
  days?: number[];
  until?: PracticeUntil;
}

export interface RamadanMeta {
  hijri_year: number;
  /** Last day of Ramadan (household local date); slots after it are dropped. */
  end_date: string;
  /** Local `HH:mm` per date and meal type (suhoor, iftar, snack after Taraweeh, day meals). */
  times: Record<string, Partial<Record<PlanMealType, string>>>;
  members: Record<string, MemberParticipation>;
}

/** Meal types of a Ramadan plan: day meals only when someone eats in the day. */
export function ramadanMealTypes(members: Record<string, MemberParticipation>): PlanMealType[] {
  const dayEaters = Object.values(members).some((m) => m.mode !== 'fasting');
  return dayEaters
    ? ['suhoor', 'breakfast', 'lunch', 'snack', 'iftar']
    : ['suhoor', 'snack', 'iftar'];
}

const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

/** Whether the member fasts (fully or as practice) on a date. */
export function fastsOn(p: MemberParticipation | undefined, date: string): boolean {
  if (!p) return false;
  if (p.mode === 'fasting') return true;
  if (p.mode === 'practice_fast') return (p.days ?? []).includes(weekday(date));
  return false;
}

/** Who is served at a slot on a date (15 §5.2 schedule). */
export function eatsAt(
  p: MemberParticipation | undefined,
  date: string,
  mealType: string,
): boolean {
  const fasting = fastsOn(p, date);
  switch (mealType) {
    case 'suhoor':
      return fasting;
    case 'breakfast':
      return !fasting;
    case 'lunch':
      // A practice fast until Dhuhr ends at lunch; until Asr or Maghrib skips it.
      return !fasting || (p?.mode === 'practice_fast' && p.until === 'dhuhr');
    default:
      return true; // iftar and the post-Taraweeh snack are for the whole family
  }
}

interface RowLike {
  plan_date: string;
  meal_type: PlanMealType;
  scheduled_time: string | null;
  servings: Array<{ family_member_id: string }>;
}

/** Trims to the Ramadan end, applies the prayer-time schedule and the participation rules. */
export function applyRamadan<R extends RowLike>(rows: readonly R[], meta: RamadanMeta): R[] {
  const out: R[] = [];
  for (const r of rows) {
    if (r.plan_date > meta.end_date) continue;
    const servings = r.servings.filter((s) =>
      eatsAt(meta.members[s.family_member_id], r.plan_date, r.meal_type),
    );
    if (!servings.length) continue;
    out.push({
      ...r,
      servings,
      scheduled_time: meta.times[r.plan_date]?.[r.meal_type] ?? r.scheduled_time,
    });
  }
  return out;
}

/** 15 §5.10 weekly themes; week 5 (the last days) keeps the last-ten theme. */
export const RAMADAN_THEMES = [
  'ramadan_rhythm',
  'ramadan_thuluth_iftar',
  'ramadan_hydration',
  'ramadan_last_ten',
] as const;

export function ramadanThemes(weekCount: number): Array<{ week: number; key: string }> {
  return Array.from({ length: weekCount }, (_, i) => ({
    week: i + 1,
    key: RAMADAN_THEMES[Math.min(i, RAMADAN_THEMES.length - 1)]!,
  }));
}
