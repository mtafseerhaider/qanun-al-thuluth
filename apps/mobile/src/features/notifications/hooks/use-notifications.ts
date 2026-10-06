import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { track } from '@/lib/analytics/track';
import { isSupabaseConfigured } from '@/lib/env';
import { registerOutboxHandler, useOutboxStore, type OutboxEntry } from '@/lib/offline/outbox';
import { qk } from '@/lib/query/query-keys';
import { useSessionStore } from '@/stores/use-session-store';

import {
  fetchInbox,
  fetchPreferences,
  markRead,
  savePreference,
  saveQuietHours,
  type PreferenceRow,
  type ReadWrite,
} from '../api/notifications-api';
import {
  inboxDelivery,
  targetForNotification,
  type InboxDelivery,
  type InboxRow,
} from '../utils/notification-routing';
import { openNotificationTarget } from '../utils/open-notification';

export const NOTIFICATION_READ_KIND = 'notification.read';
const READ_SCOPE = 'me';

/** Registers the inbox outbox handler (read receipts work offline). */
export function registerNotificationOutboxHandlers(qc: QueryClient): void {
  registerOutboxHandler<ReadWrite>(NOTIFICATION_READ_KIND, {
    run: (w) => markRead(w),
    onSuccess: () => void qc.invalidateQueries({ queryKey: qk.notifications() }),
  });
}

export interface InboxItem extends InboxRow {
  delivery: InboxDelivery;
  read: boolean;
}

const selectEntries = (s: { entries: OutboxEntry[] }) => s.entries;

/** Pure: visible rows with queued read receipts applied. */
export function inboxItems(
  rows: readonly InboxRow[],
  outbox: readonly OutboxEntry[],
  now: Date = new Date(),
): InboxItem[] {
  const readIds = new Set(
    outbox
      .filter((e) => e.kind === NOTIFICATION_READ_KIND)
      .flatMap((e) => (e.payload as ReadWrite).ids),
  );
  return rows.flatMap((r) => {
    const delivery = inboxDelivery(r, now);
    if (!delivery) return [];
    return [{ ...r, delivery, read: r.readAt !== null || readIds.has(r.id) }];
  });
}

export function useInbox() {
  const userId = useSessionStore((s) => s.userId);
  const query = useQuery({
    queryKey: qk.notifications(),
    queryFn: () => fetchInbox(),
    enabled: Boolean(userId) && isSupabaseConfigured,
    refetchInterval: 5 * 60_000,
  });
  const outbox = useOutboxStore(selectEntries);
  const items = useMemo(() => inboxItems(query.data ?? [], outbox), [query.data, outbox]);
  const unread = items.filter((i) => !i.read).length;
  return { ...query, items, unread };
}

export function markNotificationsRead(ids: readonly string[], at: Date = new Date()): void {
  if (ids.length === 0) return;
  useOutboxStore.getState().enqueue({
    kind: NOTIFICATION_READ_KIND,
    scope: READ_SCOPE,
    payload: { ids: [...ids], at: at.toISOString() } satisfies ReadWrite,
  });
}

/** Opens a notification from the inbox or a push: marks it read and routes to its screen. */
export function openNotification(
  n: { id?: string | null; kind?: string | null; data?: unknown; read?: boolean },
  channel: 'push' | 'in_app',
): void {
  if (n.id && !n.read) markNotificationsRead([n.id]);
  track('notification_opened', {
    kind: n.kind && /^[a-z_]+$/.test(n.kind) ? n.kind : 'unknown',
    channel,
  });
  openNotificationTarget(targetForNotification(n));
}

export function usePreferences() {
  const userId = useSessionStore((s) => s.userId);
  return useQuery({
    queryKey: qk.notificationPreferences(),
    queryFn: fetchPreferences,
    enabled: Boolean(userId) && isSupabaseConfigured,
  });
}

/** Toggle one kind; optimistic, rolled back on error. Needs a connection. */
export function useSavePreference() {
  const qc = useQueryClient();
  const userId = useSessionStore((s) => s.userId);
  return useMutation({
    mutationKey: ['notifications', 'preference'],
    networkMode: 'online',
    mutationFn: (v: {
      kind: string;
      enabled: boolean;
      quietHours: PreferenceRow['quietHours'];
    }) => {
      if (!userId) throw new Error('Not signed in');
      return savePreference(userId, v.kind, v.enabled, v.quietHours);
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: qk.notificationPreferences() });
      const previous = qc.getQueryData<PreferenceRow[]>(qk.notificationPreferences());
      qc.setQueryData<PreferenceRow[]>(qk.notificationPreferences(), (rows = []) =>
        rows.some((r) => r.kind === v.kind)
          ? rows.map((r) => (r.kind === v.kind ? { ...r, enabled: v.enabled } : r))
          : [...rows, { kind: v.kind, enabled: v.enabled, quietHours: v.quietHours, settings: {} }],
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(qk.notificationPreferences(), ctx.previous);
    },
    onSuccess: () => track('setting_changed', { key: 'notifications' }),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.notificationPreferences() }),
  });
}

export function useSaveQuietHours() {
  const qc = useQueryClient();
  const userId = useSessionStore((s) => s.userId);
  return useMutation({
    mutationKey: ['notifications', 'quiet-hours'],
    networkMode: 'online',
    mutationFn: (q: PreferenceRow['quietHours']) => {
      if (!userId) throw new Error('Not signed in');
      return saveQuietHours(userId, q);
    },
    onSuccess: () => track('setting_changed', { key: 'quiet_hours' }),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.notificationPreferences() }),
  });
}
