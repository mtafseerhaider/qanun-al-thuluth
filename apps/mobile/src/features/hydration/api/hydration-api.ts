import { HydrationLogInput } from '@shared/domain/tracking';

import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { toDbAppError } from '@/lib/supabase/error-mapping';

import {
  parseSchedule,
  type Beverage,
  type DrinkTiming,
  type HydrationDeleteWrite,
  type HydrationLogView,
  type HydrationLogWrite,
  type HydrationWindowView,
} from '../utils/hydration-rules';

/**
 * Hydration targets and logs (05 §12.2 to §12.3, 15 §6). Targets are computed server-side
 * (`set_hydration_target`); the client reads them, and writes logs through the outbox with the
 * client id as row id, so a replay never doubles a drink.
 */
function client() {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  return supabase;
}

export interface HydrationTargetView {
  familyMemberId: string;
  dailyMl: number;
  windows: HydrationWindowView[];
  basis: Record<string, unknown>;
}

export async function fetchHydrationTargets(householdId: string): Promise<HydrationTargetView[]> {
  const { data, error } = await client()
    .from('hydration_targets')
    .select('family_member_id, daily_ml, schedule, basis')
    .eq('household_id', householdId)
    .is('deleted_at', null);
  if (error) throw toDbAppError(error);
  return (
    (data ?? []) as unknown as Array<{
      family_member_id: string;
      daily_ml: number;
      schedule: unknown;
      basis: unknown;
    }>
  ).map((r) => ({
    familyMemberId: r.family_member_id,
    dailyMl: Number(r.daily_ml),
    windows: parseSchedule(r.schedule),
    basis:
      r.basis && typeof r.basis === 'object' && !Array.isArray(r.basis)
        ? (r.basis as Record<string, unknown>)
        : {},
  }));
}

/** Logs since an instant (the tracker reads the last 8 days and groups by household-local day). */
export async function fetchHydrationLogs(
  householdId: string,
  sinceIso: string,
): Promise<HydrationLogView[]> {
  const { data, error } = await client()
    .from('hydration_logs')
    .select('id, family_member_id, logged_at, volume_ml, beverage, timing')
    .eq('household_id', householdId)
    .gte('logged_at', sinceIso)
    .order('logged_at', { ascending: false })
    .limit(1000);
  if (error) throw toDbAppError(error);
  return (
    (data ?? []) as unknown as Array<{
      id: string;
      family_member_id: string;
      logged_at: string;
      volume_ml: number;
      beverage: Beverage;
      timing: DrinkTiming;
    }>
  ).map((r) => ({
    id: r.id,
    familyMemberId: r.family_member_id,
    loggedAt: r.logged_at,
    volumeMl: Number(r.volume_ml),
    beverage: r.beverage,
    timing: r.timing,
  }));
}

/** Insert by client id; a replay of a row that already landed is ignored (idempotent). */
export async function insertHydrationLog(w: HydrationLogWrite): Promise<void> {
  const parsed = HydrationLogInput.parse({
    id: w.id,
    logged_at: w.loggedAt,
    volume_ml: w.volumeMl,
    beverage: w.beverage,
    timing: w.timing,
  });
  const { error } = await client()
    .from('hydration_logs')
    .upsert(
      { ...parsed, household_id: w.householdId, family_member_id: w.familyMemberId },
      { onConflict: 'id', ignoreDuplicates: true },
    );
  if (error) throw toDbAppError(error);
}

/** Hard delete (05 §12: log tables are hard-deletable by editors); deleting twice is a no-op. */
export async function deleteHydrationLog(w: HydrationDeleteWrite): Promise<void> {
  const { error } = await client().from('hydration_logs').delete().eq('id', w.id);
  if (error) throw toDbAppError(error);
}
