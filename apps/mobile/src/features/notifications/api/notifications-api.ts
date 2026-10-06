import type { Json } from '@shared/db/database.types';

import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { toDbAppError } from '@/lib/supabase/error-mapping';

import type { InboxRow } from '../utils/notification-routing';

/**
 * Inbox and preferences (05 §13.2 to §13.3, 06 §4.15). RLS: a user reads only their own
 * notifications and may set only `read_at`; preferences are theirs to read and write.
 */
function client() {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  return supabase;
}

export async function fetchInbox(now: Date = new Date()): Promise<InboxRow[]> {
  const { data, error } = await client()
    .from('notifications')
    .select('id, kind, title, body, data, status, channel, scheduled_for, read_at')
    .lte('scheduled_for', now.toISOString())
    .order('scheduled_for', { ascending: false })
    .limit(100);
  if (error) throw toDbAppError(error);
  return (data ?? []).map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    body: r.body,
    data: r.data,
    status: r.status,
    channel: r.channel,
    scheduledFor: r.scheduled_for,
    readAt: r.read_at,
  }));
}

export interface ReadWrite {
  ids: string[];
  at: string;
}

/** Idempotent: only rows still unread get `read_at`. */
export async function markRead(w: ReadWrite): Promise<void> {
  if (w.ids.length === 0) return;
  const { error } = await client()
    .from('notifications')
    .update({ read_at: w.at })
    .in('id', w.ids)
    .is('read_at', null);
  if (error) throw toDbAppError(error);
}

export interface PreferenceRow {
  kind: string;
  enabled: boolean;
  quietHours: { start?: string; end?: string; tz?: string };
  settings: Record<string, unknown>;
}

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

export async function fetchPreferences(): Promise<PreferenceRow[]> {
  const { data, error } = await client()
    .from('notification_preferences')
    .select('kind, enabled, quiet_hours, settings');
  if (error) throw toDbAppError(error);
  return (data ?? []).map((r) => {
    const q = asObject(r.quiet_hours);
    return {
      kind: r.kind,
      enabled: r.enabled,
      quietHours: {
        ...(typeof q.start === 'string' ? { start: q.start } : {}),
        ...(typeof q.end === 'string' ? { end: q.end } : {}),
        ...(typeof q.tz === 'string' ? { tz: q.tz } : {}),
      },
      settings: asObject(r.settings),
    };
  });
}

/** Upserts one kind's toggle (rows exist from signup; the upsert covers older accounts). */
export async function savePreference(
  userId: string,
  kind: string,
  enabled: boolean,
  quietHours: PreferenceRow['quietHours'],
): Promise<void> {
  const { error } = await client()
    .from('notification_preferences')
    .upsert(
      { user_id: userId, kind, enabled, quiet_hours: quietHours as NonNullable<Json> },
      { onConflict: 'user_id,kind' },
    );
  if (error) throw toDbAppError(error);
}

/** Quiet hours are one setting for the user, stored on every kind's row (05 §13.3). */
export async function saveQuietHours(
  userId: string,
  quietHours: PreferenceRow['quietHours'],
): Promise<void> {
  const { error } = await client()
    .from('notification_preferences')
    .update({ quiet_hours: quietHours as NonNullable<Json> })
    .eq('user_id', userId);
  if (error) throw toDbAppError(error);
}
