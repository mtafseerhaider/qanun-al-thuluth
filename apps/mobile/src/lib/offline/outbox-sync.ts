import { onlineManager } from '@tanstack/react-query';
import { AppState } from 'react-native';

import { flushOutbox, hasOutboxHandler, useOutboxStore, whenOutboxHydrated } from './outbox';

/**
 * Replay triggers for the outbox (24 S3-15): reconnect (React Query's onlineManager, wired to
 * NetInfo), app foreground, a new entry, and a timer for the earliest backoff. Returns a stop
 * function. Started once from the app layer after the handlers are registered.
 */
export function startOutboxSync(
  deps: {
    isOnline?: () => boolean;
    subscribeOnline?: (cb: (online: boolean) => void) => () => void;
    now?: () => number;
  } = {},
): () => void {
  const isOnline = deps.isOnline ?? (() => onlineManager.isOnline());
  const subscribeOnline = deps.subscribeOnline ?? ((cb) => onlineManager.subscribe(cb));
  const now = deps.now ?? Date.now;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    // Only entries waiting on a backoff: due ones were just tried (or are blocked behind one that
    // is waiting), and kinds without a handler (stub queues) wait for a later trigger.
    const t = now();
    const due = useOutboxStore
      .getState()
      .entries.filter((e) => hasOutboxHandler(e.kind) && e.nextAttemptAt > t)
      .map((e) => e.nextAttemptAt);
    if (stopped || due.length === 0) return;
    const wait = Math.max(1_000, Math.min(...due) - now());
    timer = setTimeout(() => void flush(), wait);
  };

  const flush = async () => {
    if (stopped) return;
    await whenOutboxHydrated();
    if (isOnline()) await flushOutbox({ isOnline, now });
    schedule();
  };

  const unsubOnline = subscribeOnline((online) => {
    if (online) void flush();
  });
  const appState = AppState.addEventListener('change', (s) => {
    if (s === 'active') void flush();
  });
  let known = new Set(useOutboxStore.getState().entries.map((e) => e.id));
  const unsubStore = useOutboxStore.subscribe((s) => {
    const added = s.entries.some((e) => !known.has(e.id));
    known = new Set(s.entries.map((e) => e.id));
    if (added) void flush();
  });

  void flush();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    unsubOnline();
    appState.remove();
    unsubStore();
  };
}
