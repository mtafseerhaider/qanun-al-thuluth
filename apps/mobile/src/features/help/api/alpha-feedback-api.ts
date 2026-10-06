import { Platform } from 'react-native';

import { env } from '@/lib/env';
import { registerOutboxHandler, useOutboxStore } from '@/lib/offline/outbox';
import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { toDbAppError } from '@/lib/supabase/error-mapping';

/**
 * Alpha feedback (24 S3-17, table `alpha_feedback` since Sprint 4). A report is queued in the
 * encrypted outbox under kind `alpha.feedback` and inserted with the outbox entry id as the row id,
 * so a replay never files it twice. Reports queued by Sprint 3 builds (before the table existed)
 * are sent once the handler is registered at startup.
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

const PLATFORMS = new Set(['ios', 'android', 'web']);

export async function insertAlphaFeedback(id: string, p: AlphaFeedbackPayload): Promise<void> {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  const { error } = await supabase.from('alpha_feedback').upsert(
    {
      id,
      household_id: p.householdId,
      category: p.category,
      message: p.message.trim().slice(0, FEEDBACK_MAX_LENGTH),
      screen: p.screen ? p.screen.slice(0, 120) : null,
      app_version: (p.appVersion || '0.0.0').slice(0, 40),
      platform: PLATFORMS.has(p.platform) ? p.platform : null,
      locale: p.locale ? p.locale.slice(0, 16) : null,
      client_created_at: p.createdAt,
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) throw toDbAppError(error);
}

/** Registers the feedback outbox handler (called once from the app layer). */
export function registerAlphaFeedbackOutboxHandler(): void {
  registerOutboxHandler<AlphaFeedbackPayload>(ALPHA_FEEDBACK_KIND, {
    run: (payload, ctx) => insertAlphaFeedback(ctx.idempotencyKey, payload),
  });
}
