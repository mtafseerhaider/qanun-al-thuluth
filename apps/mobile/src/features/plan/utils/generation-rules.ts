import type { PlanStatus } from '@shared';
import type { GenerationProgress } from '@shared/contracts';

/**
 * First-plan generation display rules (02 §5.4, §7.4.2, 24 S3-07). Pure, unit-tested.
 */

/** UI stages of `PlanGenerationStepper`, mapped from `generation_progress.phase`. */
export const GENERATION_STAGES = [
  'reading',
  'targets',
  'choosing',
  'adapting',
  'checking',
  'saving',
] as const;
export type GenerationStage = (typeof GENERATION_STAGES)[number];

export interface StageView {
  stage: GenerationStage;
  /** 0..100 for the calm progress bar. */
  percent: number;
}

export function stageFor(progress: GenerationProgress | null | undefined): StageView {
  switch (progress?.phase) {
    case 'safety_check':
      return { stage: 'targets', percent: 25 };
    case 'generating':
      // Multi-week plans report finished weeks; once any week is written the portions are adapted.
      return progress.completed_weeks > 0
        ? { stage: 'adapting', percent: 75 }
        : { stage: 'choosing', percent: 55 };
    case 'validating':
      return { stage: 'checking', percent: 90 };
    case 'writing':
    case 'done':
      return { stage: 'saving', percent: 100 };
    case 'queued':
    case 'failed':
    case undefined:
    default:
      return { stage: 'reading', percent: 10 };
  }
}

export type GenerationOutcome = 'generating' | 'ready' | 'failed';

/** `draft` (first plan, then activated) and `active` both mean the plan exists. */
export function outcomeFor(status: PlanStatus | null | undefined): GenerationOutcome {
  if (status === 'draft' || status === 'active' || status === 'completed') return 'ready';
  if (status === 'failed' || status === 'archived') return 'failed';
  return 'generating';
}

/** 02 §7.4.2: after 120 s the copy switches to "Taking longer than usual". */
export const GENERATION_TIMEOUT_MS = 120_000;
/** Fallback polling interval when the server gives none (02 §7.4.2: every 3 s). */
export const DEFAULT_POLL_MS = 3_000;

/**
 * Polling interval for the plan status query. Realtime pushes row changes; polling is the fallback
 * (`poll_after_ms` from the 202 response) and runs slowly as a safety net while Realtime is up.
 * No polling once the outcome is final.
 */
export function pollIntervalFor(input: {
  status: PlanStatus | null | undefined;
  realtime: 'connecting' | 'subscribed' | 'error' | 'closed';
  pollAfterMs: number | null | undefined;
}): number | false {
  if (outcomeFor(input.status) !== 'generating') return false;
  const base = input.pollAfterMs && input.pollAfterMs > 0 ? input.pollAfterMs : DEFAULT_POLL_MS;
  return input.realtime === 'subscribed' ? Math.max(base * 5, 10_000) : base;
}

/** The error code to show for a failed plan (async failures live in `generation_progress`). */
export function failureCode(progress: GenerationProgress | null | undefined): string {
  return progress?.error_code ?? 'INTERNAL';
}
