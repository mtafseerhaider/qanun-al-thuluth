import {
  RamadanGenerateAccepted,
  RamadanGenerateRequest,
  type RamadanGenerateRequest as RamadanGenerateRequestT,
} from '@shared/contracts';

import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { invokeEdge } from '@/lib/supabase/edge';
import { toDbAppError } from '@/lib/supabase/error-mapping';

/**
 * Ramadan plans (05 §12.5, 06 §4.9): one row per household and Hijri year, read through PostgREST;
 * generation runs in `ramadan-generate` (premium, server enforced) and writes the linked meal plan.
 */
function client() {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  return supabase;
}

export interface CachedPrayerDay {
  date: string;
  fajr: string;
  maghrib: string;
}

export interface RamadanPlanView {
  id: string;
  householdId: string;
  hijriYear: number;
  startDate: string;
  endDate: string;
  mealPlanId: string | null;
  suhoorStrategy: string;
  /** Cached times from the server (Aladhan or the fallback); the app computes when absent. */
  prayerTimes: CachedPrayerDay[];
}

const PLAN_COLUMNS =
  'id, household_id, hijri_year, start_date, end_date, meal_plan_id, suhoor_time_strategy, prayer_times';

interface RawPlan {
  id: string;
  household_id: string;
  hijri_year: number;
  start_date: string;
  end_date: string;
  meal_plan_id: string | null;
  suhoor_time_strategy: string;
  prayer_times: unknown;
}

export function parsePrayerTimes(json: unknown): CachedPrayerDay[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((d: unknown) => {
    if (!d || typeof d !== 'object') return [];
    const r = d as Record<string, unknown>;
    return typeof r.date === 'string' && typeof r.fajr === 'string' && typeof r.maghrib === 'string'
      ? [{ date: r.date, fajr: r.fajr, maghrib: r.maghrib }]
      : [];
  });
}

export function toPlanView(r: RawPlan): RamadanPlanView {
  return {
    id: r.id,
    householdId: r.household_id,
    hijriYear: r.hijri_year,
    startDate: r.start_date,
    endDate: r.end_date,
    mealPlanId: r.meal_plan_id,
    suhoorStrategy: r.suhoor_time_strategy,
    prayerTimes: parsePrayerTimes(r.prayer_times),
  };
}

export async function fetchRamadanPlan(
  householdId: string,
  hijriYear: number,
): Promise<RamadanPlanView | null> {
  const { data, error } = await client()
    .from('ramadan_plans')
    .select(PLAN_COLUMNS)
    .eq('household_id', householdId)
    .eq('hijri_year', hijriYear)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw toDbAppError(error);
  return data ? toPlanView(data as RawPlan) : null;
}

export async function generateRamadanPlan(
  input: RamadanGenerateRequestT,
  idempotencyKey: string,
): Promise<RamadanGenerateAccepted> {
  const body = RamadanGenerateRequest.parse(input);
  return invokeEdge('ramadan-generate', body, RamadanGenerateAccepted, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}
