import { z } from 'zod';

import {
  EXPORT_PDF_MVP_KINDS,
  ExportPdfAccepted,
  ExportPdfReady,
  ExportStatus,
  type ExportPdfRequest,
} from '@shared/contracts';

import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { getEdge, invokeEdge } from '@/lib/supabase/edge';
import { toDbAppError } from '@/lib/supabase/error-mapping';

function client() {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  return supabase;
}

export interface ExportRow {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  error: string | null;
}

/** Exports of this household that the user can read (requester and household editors, RLS). */
export async function fetchExports(householdId: string): Promise<ExportRow[]> {
  const { data, error } = await client()
    .from('exports')
    .select('id, kind, status, created_at, expires_at, error')
    .eq('household_id', householdId)
    .in('kind', [...EXPORT_PDF_MVP_KINDS])
    .order('created_at', { ascending: false })
    .limit(30);
  if (error) throw toDbAppError(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    error: r.error,
  }));
}

export const ExportResult = z.union([ExportPdfReady, ExportPdfAccepted]);
export type ExportResult = z.infer<typeof ExportResult>;

/** `POST export-pdf` (sync 200 with a 24 h signed URL, or 202 to poll). */
export function requestExport(
  body: ExportPdfRequest,
  idempotencyKey: string,
): Promise<ExportResult> {
  return invokeEdge('export-pdf', body, ExportResult, {
    headers: { 'Idempotency-Key': idempotencyKey },
  });
}
const ExportPoll = z.union([
  ExportPdfReady,
  z.object({ export_id: z.string(), export_status: ExportStatus }).passthrough(),
  ExportPdfAccepted,
]);
export type ExportPoll = z.infer<typeof ExportPoll>;

/** `GET export-pdf?export_id=`: status while processing, or a fresh signed URL once ready. */
export function pollExport(exportId: string): Promise<ExportPoll> {
  return getEdge('export-pdf', { export_id: exportId }, ExportPoll);
}
