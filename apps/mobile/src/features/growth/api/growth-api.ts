import { GrowthComputeResponse, type GrowthReference } from '@shared/contracts';

import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { invokeEdge } from '@/lib/supabase/edge';
import { toDbAppError } from '@/lib/supabase/error-mapping';

import {
  parseDashboard,
  type GrowthDashboardView,
  type LmsIndicator,
  type LmsRow,
} from '../utils/growth-rules';

/**
 * Growth tracking (05 §12.6 to §12.7, §21.2; 06 §4.8). Reads go through `growth_dashboard`, which
 * applies the tier (free: latest row only, premium: full history; safety flags on every tier).
 * The client writes only the raw columns; `growth-compute` fills z-scores, percentiles and flags.
 */
function client() {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  return supabase;
}

export interface GrowthWrite {
  /** Row id and idempotency key. */
  id: string;
  householdId: string;
  familyMemberId: string;
  measuredOn: string;
  heightCm: number | null;
  weightKg: number | null;
  headCm: number | null;
  position: 'recumbent' | 'standing' | null;
}

export async function fetchGrowthDashboard(memberId: string): Promise<GrowthDashboardView | null> {
  const { data, error } = await client().rpc('growth_dashboard', { p_member: memberId });
  if (error) throw toDbAppError(error);
  return parseDashboard(data);
}

/** LMS rows for one reference, indicator and sex (catalog RLS; cached for a long time). */
export async function fetchLmsRows(
  reference: GrowthReference,
  indicator: LmsIndicator,
  sex: 'female' | 'male',
): Promise<LmsRow[]> {
  const { data, error } = await client()
    .from('growth_reference_lms')
    .select('age_months, l, m, s')
    .eq('reference', reference)
    .eq('indicator', indicator)
    .eq('sex', sex)
    .order('age_months', { ascending: true })
    .limit(2000);
  if (error) throw toDbAppError(error);
  return (data ?? []).map((r) => ({
    ageMonths: Number(r.age_months),
    l: Number(r.l),
    m: Number(r.m),
    s: Number(r.s),
  }));
}

/**
 * Inserts the measurement with the client id. A replay of the same id, or a second entry for the
 * same member and day (unique key), updates the raw values of that day instead; editing raw values
 * clears the computed ones server-side, and `growth-compute` runs again.
 */
export async function saveMeasurement(w: GrowthWrite): Promise<string> {
  const values = {
    measured_on: w.measuredOn,
    height_cm: w.heightCm,
    weight_kg: w.weightKg,
    head_circumference_cm: w.headCm,
    measurement_position: w.position,
  };
  const { error } = await client()
    .from('growth_tracking')
    .insert({
      id: w.id,
      household_id: w.householdId,
      family_member_id: w.familyMemberId,
      ...values,
    });
  if (!error) return w.id;
  const mapped = toDbAppError(error);
  if (mapped.code !== 'CONFLICT') throw mapped;
  const { data, error: updateError } = await client()
    .from('growth_tracking')
    .update(values)
    .eq('family_member_id', w.familyMemberId)
    .eq('measured_on', w.measuredOn)
    .select('id')
    .maybeSingle();
  if (updateError) throw toDbAppError(updateError);
  return (data as { id: string } | null)?.id ?? w.id;
}

export function computeGrowth(growthTrackingId: string, idempotencyKey: string) {
  return invokeEdge(
    'growth-compute',
    { growth_tracking_id: growthTrackingId },
    GrowthComputeResponse,
    {
      headers: { 'Idempotency-Key': idempotencyKey },
    },
  );
}

export async function deleteMeasurement(id: string): Promise<void> {
  const { error } = await client().from('growth_tracking').delete().eq('id', id);
  if (error) throw toDbAppError(error);
}
