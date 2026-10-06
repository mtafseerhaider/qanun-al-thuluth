import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { toDbAppError } from '@/lib/supabase/error-mapping';

export const REPORT_REASONS = [
  'wrong_citation',
  'wrong_translation',
  'wrong_grade',
  'tradition_label',
  'offensive',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export interface ReportTarget {
  islamicSourceId?: string | undefined;
  scientificEvidenceId?: string | undefined;
  recommendationId?: string | undefined;
}

/** Exactly one target column is set (DB check); recommendation wins, then source, then study. */
export function reportTargetColumns(t: ReportTarget): {
  islamic_source_id: string | null;
  scientific_evidence_id: string | null;
  recommendation_id: string | null;
  kind: 'islamic' | 'scientific' | 'recommendation';
} | null {
  if (t.recommendationId)
    return {
      recommendation_id: t.recommendationId,
      islamic_source_id: null,
      scientific_evidence_id: null,
      kind: 'recommendation',
    };
  if (t.islamicSourceId)
    return {
      islamic_source_id: t.islamicSourceId,
      recommendation_id: null,
      scientific_evidence_id: null,
      kind: 'islamic',
    };
  if (t.scientificEvidenceId)
    return {
      scientific_evidence_id: t.scientificEvidenceId,
      recommendation_id: null,
      islamic_source_id: null,
      kind: 'scientific',
    };
  return null;
}

/**
 * Inserts a report through RLS (users insert and read their own). A second open report for the same
 * target hits a unique index (23505 → CONFLICT), which the sheet shows as "already reported".
 */
export async function submitSourceReport(
  target: ReportTarget,
  reason: ReportReason,
  note: string | null,
): Promise<void> {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  const cols = reportTargetColumns(target);
  if (!cols) throw new AppError('VALIDATION_FAILED', 'No report target.');
  const { kind: _kind, ...columns } = cols;
  const { error } = await supabase.from('source_reports').insert({
    ...columns,
    reason,
    note: note ? note.trim().slice(0, 1000) : null,
  });
  if (error) throw toDbAppError(error);
}
