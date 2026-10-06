import { Platform } from 'react-native';

import { env } from '@/lib/env';
import { useOutboxStore } from '@/lib/offline/outbox';

/**
 * Alpha feedback (24 S3-17). STUB: there is no feedback table yet (DB lane, Sprint 3), so a report is
 * queued in the encrypted outbox under kind `alpha.feedback` with no handler registered. It stays on
 * the device (and survives restarts) until a handler that inserts into the future table is
 * registered; the outbox then sends it with its idempotency key. Nothing leaves the device today.
 */
export const ALPHA_FEEDBACK_KIND = 'alpha.feedback';
export const ALPHA_FEEDBACK_SCOPE = 'feedback';

export type FeedbackCategory = 'bug' | 'idea' | 'content' | 'other';
export const FEEDBACK_CATEGORIES: readonly FeedbackCategory[] = ['bug', 'idea', 'content', 'other'];
export const FEEDBACK_MAX_LENGTH = 2000;

export interface AlphaFeedbackPayload {
  category: FeedbackCategory;
  message: string;
  screen: string | null;
  householdId: string | null;
  appVersion: string;
  platform: string;
  locale: string;
  createdAt: string;
}

export function buildFeedback(
  input: Pick<AlphaFeedbackPayload, 'category' | 'message' | 'screen' | 'householdId' | 'locale'>,
  now: Date = new Date(),
): AlphaFeedbackPayload {
  return {
    ...input,
    message: input.message.trim().slice(0, FEEDBACK_MAX_LENGTH),
    appVersion: env.APP_VERSION,
    platform: Platform.OS,
    createdAt: now.toISOString(),
  };
}

/** Queues the report; returns the idempotency key (the outbox entry id). */
export function submitAlphaFeedback(payload: AlphaFeedbackPayload): string {
  return useOutboxStore.getState().enqueue({
    kind: ALPHA_FEEDBACK_KIND,
    scope: ALPHA_FEEDBACK_SCOPE,
    dedupeKey: null,
    payload,
  }).id;
}
