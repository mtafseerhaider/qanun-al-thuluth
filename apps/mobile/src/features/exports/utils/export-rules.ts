import type { ExportPdfMvpKind } from '@shared/contracts';

import { isAppError } from '@/lib/supabase/app-error';

/**
 * Export flow rules (FR-EXP-01 to -04, 18 Part A). Pure, unit-tested. The PDF renderer may be off
 * (`FEATURE_DISABLED`, reason `renderer_not_configured`): that is a friendly "not available yet"
 * state, never an error toast.
 */
export type ExportProblem =
  | 'not_available'
  | 'premium'
  | 'unsupported'
  | 'expired'
  | 'failed'
  | 'offline'
  | 'busy'
  | 'generic';

export function exportProblem(error: unknown): ExportProblem {
  if (!isAppError(error)) return 'generic';
  const details = (error.details ?? {}) as Record<string, unknown>;
  switch (error.code) {
    case 'FEATURE_DISABLED':
      return 'not_available';
    case 'PREMIUM_REQUIRED':
      return 'premium';
    case 'EXPORT_KIND_UNSUPPORTED':
      return 'unsupported';
    case 'NETWORK_ERROR':
      return 'offline';
    case 'IDEMPOTENCY_IN_PROGRESS':
    case 'RATE_LIMITED':
      return 'busy';
    case 'CONFLICT':
      return details.export_status === 'expired' ? 'expired' : 'failed';
    case 'UPSTREAM_UNAVAILABLE':
    case 'INTERNAL':
      return 'failed';
    default:
      return 'generic';
  }
}

export type ExportRowStatus = 'processing' | 'ready' | 'failed' | 'expired';

/** Status shown for a row: a ready export past `expires_at` is expired even before the sweep. */
export function displayStatus(status: string, expiresAt: string, now: number): ExportRowStatus {
  if (status === 'ready' && Date.parse(expiresAt) <= now) return 'expired';
  if (status === 'ready' || status === 'failed' || status === 'expired') return status;
  return 'processing';
}

/** File name for the share sheet, e.g. `thuluth-meal-plan-2026-10-06.pdf`. */
export function exportBaseName(kind: ExportPdfMvpKind, date: string): string {
  return `thuluth-${kind.replace(/_/g, '-')}-${date}`;
}

/** Growth reports carry a child's health data: an explicit confirmation is required (18 §4.4). */
export function needsChildDataConfirm(kind: ExportPdfMvpKind): boolean {
  return kind === 'growth_report';
}

/** Back-off for polling a 202: server hint first, then 2 s, capped at 5 s; give up after 90 s. */
export function pollDelays(firstMs: number, totalMs = 90_000): number[] {
  const out: number[] = [];
  let elapsed = 0;
  let next = Math.max(500, Math.min(firstMs, 5000));
  while (elapsed + next <= totalMs) {
    out.push(next);
    elapsed += next;
    next = Math.min(5000, Math.max(2000, Math.round(next * 1.5)));
  }
  return out;
}
