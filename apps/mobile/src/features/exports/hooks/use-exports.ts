import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';

import type { ExportPaper, ExportPdfMvpKind, ExportPdfParams } from '@shared/contracts';

import { track } from '@/lib/analytics/track';
import { isSupabaseConfigured } from '@/lib/env';
import { qk } from '@/lib/query/query-keys';
import { downloadAndShare, exportFileName } from '@/lib/share/share-file';
import { AppError, isAppError } from '@/lib/supabase/app-error';

import { fetchExports, pollExport, requestExport, type ExportPoll } from '../api/exports-api';
import { exportBaseName, pollDelays } from '../utils/export-rules';

export function useExports(householdId: string | null) {
  return useQuery({
    queryKey: qk.household(householdId ?? 'none').exports(),
    queryFn: () => fetchExports(householdId as string),
    enabled: Boolean(householdId) && isSupabaseConfigured,
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function readyUrl(p: ExportPoll): string | null {
  return 'url' in p && typeof p.url === 'string' ? p.url : null;
}

/** Polls a 202 until the export is ready (24 h signed URL) or fails. */
export async function waitForExport(exportId: string, firstDelayMs: number): Promise<string> {
  for (const delay of pollDelays(firstDelayMs)) {
    await sleep(delay);
    const p = await pollExport(exportId);
    const url = readyUrl(p);
    if (url) return url;
    const status = 'export_status' in p ? p.export_status : null;
    if (status === 'failed' || status === 'expired')
      throw new AppError('CONFLICT', 'Export did not complete.', {
        details: { export_status: status },
      });
  }
  throw new AppError('IDEMPOTENCY_IN_PROGRESS', 'Export is still being prepared.');
}

export interface CreateExportInput {
  householdId: string;
  kind: ExportPdfMvpKind;
  params: ExportPdfParams;
  locale: 'en' | 'ur';
  paper: ExportPaper;
  today: string;
  dialogTitle: string;
}

/**
 * Creates a PDF and opens the share sheet. One idempotency key per attempt, so a retry after a
 * lost response returns the same export instead of rendering twice.
 */
export function useCreateExport() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: ['exports', 'create'],
    mutationFn: async (v: CreateExportInput) => {
      const key = Crypto.randomUUID();
      track('export_requested', { kind: v.kind, locale: v.locale, paper: v.paper });
      const res = await requestExport(
        { household_id: v.householdId, locale: v.locale, paper: v.paper, params: v.params },
        key,
      );
      const url =
        res.status === 'ready' ? res.url : await waitForExport(res.export_id, res.poll_after_ms);
      await downloadAndShare(url, exportFileName(exportBaseName(v.kind, v.today)), {
        dialogTitle: v.dialogTitle,
      });
      track('export_shared', { kind: v.kind });
      return res.export_id;
    },
    onError: (e) => {
      track('export_failed', { code: isAppError(e) ? e.code : 'UNKNOWN' });
    },
    onSettled: (_r, _e, v) => {
      void qc.invalidateQueries({ queryKey: qk.household(v.householdId).exports() });
    },
  });
}

/** Shares an earlier export again with a freshly signed URL (GET refreshes it). */
export function useShareExport() {
  return useMutation({
    mutationKey: ['exports', 'share'],
    mutationFn: async (v: {
      exportId: string;
      kind: ExportPdfMvpKind;
      date: string;
      dialogTitle: string;
    }) => {
      const p = await pollExport(v.exportId);
      const url = readyUrl(p);
      if (!url)
        throw new AppError('CONFLICT', 'Export is not ready.', {
          details: { export_status: 'export_status' in p ? p.export_status : 'processing' },
        });
      await downloadAndShare(url, exportFileName(exportBaseName(v.kind, v.date)), {
        dialogTitle: v.dialogTitle,
      });
      track('export_shared', { kind: v.kind });
    },
  });
}
