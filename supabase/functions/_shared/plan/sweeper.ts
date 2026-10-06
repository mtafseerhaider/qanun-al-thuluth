import { failPlan, progress, runGeneration } from './pipeline.ts';
import type { PipelineDeps } from './pipeline.ts';
import type { MealPlanRow, QueueMessage } from './store.ts';

/**
 * Crash recovery for plan generation (04 §5.3, `plan-generation-sweeper` cron every minute, which
 * calls the worker route with no `meal_plan_id`).
 *
 * - A queue message read more than 3 times fails its plan with AI_UNAVAILABLE (04 §5.3 step 5).
 * - A redelivered message whose plan is mid-phase (the worker died after claiming it) re-opens the
 *   claim once the plan row has been quiet for the visibility timeout, so the run can resume.
 * - Plans `generating` for 15 minutes with no progress (04 §16 alert) are re-queued up to 3
 *   attempts, then failed. Failing restores a plan archived by `replace_active` (failPlan).
 */

export const VISIBILITY_SECONDS = 300;
export const MAX_READS = 3;
export const MAX_ATTEMPTS = 3;
export const STUCK_AFTER_MIN = 15;
export const SWEEP_LIMIT = 10;
const UNAVAILABLE_REASON = 'Plan generation did not finish. Please try again.';

const quietSince = (plan: MealPlanRow, now: Date, seconds: number): boolean =>
  !plan.updated_at || now.getTime() - Date.parse(plan.updated_at) >= seconds * 1000;

/** Re-opens the claim on a plan whose worker died, keeping its attempt count. */
async function reopen(deps: PipelineDeps, plan: MealPlanRow, now: Date): Promise<void> {
  await deps.store.updatePlan(plan.id, {
    generation_progress: progress('queued', plan, { requeued_at: now.toISOString() }),
  });
}

export interface SweepResult {
  requeued: number;
  failed: number;
}

export async function sweepStuckPlans(deps: PipelineDeps): Promise<SweepResult> {
  const now = deps.now();
  const olderThan = new Date(now.getTime() - STUCK_AFTER_MIN * 60_000).toISOString();
  const stuck = await deps.store.stuckPlans(olderThan, SWEEP_LIMIT);
  const result: SweepResult = { requeued: 0, failed: 0 };
  let ranInline = false;
  for (const plan of stuck) {
    const attempt = Number(plan.generation_progress.attempt ?? 0);
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'plan_generation_stuck',
        meal_plan_id: plan.id,
        phase: plan.generation_progress.phase ?? null,
        attempt,
        updated_at: plan.updated_at ?? null,
      }),
    );
    if (attempt >= MAX_ATTEMPTS) {
      await failPlan(deps, plan, 'AI_UNAVAILABLE', UNAVAILABLE_REASON);
      result.failed += 1;
      continue;
    }
    await reopen(deps, plan, now);
    result.requeued += 1;
    const msgId = await deps.store.enqueue(plan.id, attempt);
    // Without pgmq (local cluster) run one inline, as the public route does.
    if (msgId === null && !ranInline) {
      ranInline = true;
      await runGeneration(deps, plan.id);
    }
  }
  return result;
}

export type MessageOutcome = 'processed' | 'skipped' | 'failed' | 'deferred';

/**
 * Handles one queue message. `deferred` means the message is left un-acked because another
 * worker still appears to be running the plan; it becomes visible again after the timeout.
 */
export async function handleQueueMessage(
  deps: PipelineDeps,
  msg: QueueMessage,
): Promise<MessageOutcome> {
  const id = msg.message.meal_plan_id;
  if (!id) {
    await deps.store.ack(msg.msg_id);
    return 'skipped';
  }
  const plan = await deps.store.plan(id);
  if (!plan || plan.status !== 'generating') {
    await deps.store.ack(msg.msg_id);
    return 'skipped';
  }
  if (msg.read_ct > MAX_READS) {
    await failPlan(deps, plan, 'AI_UNAVAILABLE', UNAVAILABLE_REASON, undefined, {
      read_ct: msg.read_ct,
    });
    await deps.store.ack(msg.msg_id);
    return 'failed';
  }
  if (plan.generation_progress.phase !== 'queued') {
    if (!quietSince(plan, deps.now(), VISIBILITY_SECONDS)) return 'deferred';
    await reopen(deps, plan, deps.now());
  }
  const processed = await runGeneration(deps, id);
  await deps.store.ack(msg.msg_id);
  return processed ? 'processed' : 'skipped';
}
