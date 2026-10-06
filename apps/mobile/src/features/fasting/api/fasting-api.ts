import type { FastKind } from '@shared';
import { FastingLogInput } from '@shared/domain/tracking';

import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { toDbAppError } from '@/lib/supabase/error-mapping';

import type {
  ExemptionReason,
  FastingDeleteWrite,
  FastingLogView,
  FastingLogWrite,
  MemberSafety,
  SafetyReason,
} from '../utils/fasting-rules';

/**
 * Fasting logs (05 §12.4, 15 §5.8) and the safety facts that gate them (FR-FAST-07). Reads go
 * through `fasting_logs_visible` (05 0022c), which nulls `exemption_reason` unless the viewer is
 * the member or the owner. Writes go through the outbox; the natural key (member, date, kind) makes
 * a replay or an edit an upsert.
 */
function client() {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  return supabase;
}

const LOG_COLUMNS =
  'id, family_member_id, fast_date, kind, started_at, ended_at, completed, exemption_reason, is_practice_fast, notes, hijri_date, qada_for_hijri_year';

interface RawFastingLog {
  id: string;
  family_member_id: string;
  fast_date: string;
  kind: FastKind;
  started_at: string | null;
  ended_at: string | null;
  completed: boolean;
  exemption_reason: ExemptionReason | null;
  is_practice_fast: boolean;
  notes: string | null;
  hijri_date: string | null;
  qada_for_hijri_year: number | null;
}

/** Logs from `since` (the tracker reads about 14 months: this and last Ramadan plus qada). */
export async function fetchFastingLogs(
  householdId: string,
  since: string,
): Promise<FastingLogView[]> {
  const { data, error } = await client()
    .from('fasting_logs_visible')
    .select(LOG_COLUMNS)
    .eq('household_id', householdId)
    .gte('fast_date', since)
    .order('fast_date', { ascending: false })
    .limit(2000);
  if (error) throw toDbAppError(error);
  return ((data ?? []) as unknown as RawFastingLog[]).map((r) => ({
    id: r.id,
    familyMemberId: r.family_member_id,
    fastDate: r.fast_date,
    kind: r.kind,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    completed: r.completed,
    exemptionReason: r.exemption_reason,
    isPracticeFast: r.is_practice_fast,
    notes: r.notes,
    hijriDate: r.hijri_date,
    qadaForHijriYear: r.qada_for_hijri_year,
  }));
}

export async function upsertFastingLog(w: FastingLogWrite): Promise<void> {
  const parsed = FastingLogInput.parse({
    id: w.id,
    fast_date: w.fastDate,
    kind: w.kind,
    started_at: w.startedAt,
    ended_at: w.endedAt,
    completed: w.completed,
    exemption_reason: w.exemptionReason,
    is_practice_fast: w.isPracticeFast,
    notes: w.notes,
  });
  const { error } = await client()
    .from('fasting_logs')
    .upsert(
      {
        id: parsed.id,
        fast_date: parsed.fast_date,
        kind: parsed.kind,
        started_at: parsed.started_at ?? null,
        ended_at: parsed.ended_at ?? null,
        completed: parsed.completed,
        exemption_reason: parsed.exemption_reason ?? null,
        is_practice_fast: parsed.is_practice_fast,
        notes: parsed.notes ?? null,
        household_id: w.householdId,
        family_member_id: w.familyMemberId,
        hijri_date: w.hijriDate,
        qada_for_hijri_year: w.qadaForHijriYear,
      },
      { onConflict: 'family_member_id,fast_date,kind' },
    );
  if (error) throw toDbAppError(error);
}

export async function deleteFastingLog(w: FastingDeleteWrite): Promise<void> {
  const { error } = await client().from('fasting_logs').delete().eq('id', w.id);
  if (error) throw toDbAppError(error);
}

const FLAG_REASONS: Record<string, SafetyReason> = {
  insulin_or_sulfonylurea_fasting: 'insulin_or_sulfonylurea',
  diabetes_fasting_high_risk: 'insulin_or_sulfonylurea',
  pregnancy_complication: 'pregnancy_complication',
  pregnancy_warning_sign: 'pregnancy_complication',
  eating_disorder_signals: 'eating_disorder_signals',
  eating_disorder_signal: 'eating_disorder_signals',
  ed_signals: 'eating_disorder_signals',
};

/** Maps an assessment flag or safety event category to a fasting block reason. */
export function safetyReasonFor(code: string): SafetyReason | null {
  return FLAG_REASONS[code.replace(/^red_flag\./, '')] ?? null;
}

/**
 * Safety facts per member (FR-FAST-07, 15 §5.6 to §5.7): insulin or sulfonylurea (condition flag
 * or medication flag), gestational diabetes, and red flags from the latest assessment or open
 * safety events (pregnancy complication, eating disorder signals). Pregnancy and breastfeeding only
 * add the "decide with your clinician" notice.
 */
export async function fetchFastingSafety(
  householdId: string,
): Promise<Record<string, MemberSafety>> {
  const db = client();
  const [conditions, medications, pregnancy, assessments, events] = await Promise.all([
    db
      .from('medical_conditions')
      .select('family_member_id, on_insulin_or_sulfonylurea')
      .eq('household_id', householdId)
      .is('deleted_at', null)
      .eq('on_insulin_or_sulfonylurea', true),
    db
      .from('medications')
      .select('family_member_id, food_interaction_flags')
      .eq('household_id', householdId)
      .is('deleted_at', null),
    db
      .from('pregnancy_profiles')
      .select('family_member_id, gestational_diabetes')
      .eq('household_id', householdId)
      .is('deleted_at', null),
    db
      .from('ai_assessments')
      .select('family_member_id, risk_flags, created_at')
      .eq('household_id', householdId)
      .not('family_member_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(100),
    db
      .from('safety_events')
      .select('family_member_id, category')
      .eq('household_id', householdId)
      .is('resolved_at', null),
  ]);
  for (const r of [conditions, medications, pregnancy, assessments, events])
    if (r.error) throw toDbAppError(r.error);

  const out: Record<string, MemberSafety> = {};
  const get = (id: string) => (out[id] ??= { reasons: [], pregnant: false, breastfeeding: false });
  const add = (id: string | null, reason: SafetyReason | null) => {
    if (!id || !reason) return;
    const s = get(id);
    if (!s.reasons.includes(reason)) s.reasons.push(reason);
  };

  for (const c of conditions.data ?? []) add(c.family_member_id, 'insulin_or_sulfonylurea');
  for (const m of medications.data ?? [])
    if ((m.food_interaction_flags ?? []).some((f) => f === 'insulin' || f === 'sulfonylurea'))
      add(m.family_member_id, 'insulin_or_sulfonylurea');
  for (const p of pregnancy.data ?? []) {
    get(p.family_member_id).pregnant = true;
    if (p.gestational_diabetes) add(p.family_member_id, 'gestational_diabetes');
  }
  const seen = new Set<string>();
  for (const a of assessments.data ?? []) {
    if (!a.family_member_id || seen.has(a.family_member_id)) continue;
    seen.add(a.family_member_id); // latest assessment per member only
    for (const f of a.risk_flags ?? []) add(a.family_member_id, safetyReasonFor(f));
  }
  for (const e of events.data ?? []) add(e.family_member_id, safetyReasonFor(e.category));
  return out;
}
