import * as Crypto from 'expo-crypto';
import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

import { captureException } from '@/lib/sentry/init';
import { draftsJsonStorage } from '@/lib/storage/drafts-storage';
import { isAppError } from '@/lib/supabase/app-error';
import { resetters } from '@/stores/create-store';

/**
 * Outbox for offline writes (24 S3-15, 09 §4.1, 02 P10). Tracking writes (meal status now; hydration
 * and fasting in Sprint 4) are queued here instead of being sent directly, so a write made offline,
 * or one interrupted by an app kill, is replayed once the device is back online.
 *
 * - Every entry carries an idempotency key (`id`, a client UUID). Insert handlers use it as the row
 *   id with `ignoreDuplicates`, Edge Function handlers send it as `Idempotency-Key` (06 §2.4), and
 *   update handlers are idempotent by value with a last-write-wins guard on the client timestamp.
 * - Entries with the same `dedupeKey` coalesce: a later write to the same row replaces the queued one
 *   (last write wins on the device too), so undo or a changed mind never sends two requests.
 * - Entries run serially per `scope` (the household) in the order they were queued. A transient
 *   failure (offline, 5xx, timeout) stops that scope and retries with backoff; a permanent failure
 *   (403, 400, 404) moves the entry to `failed` so the UI can roll back and tell the user.
 * - The queue lives on the encrypted drafts MMKV instance: payloads can hold children's acceptance
 *   scores, which are health-adjacent data (07 §9.5).
 *
 * Handlers are registered by kind at startup (`registerOutboxHandler`), because functions cannot be
 * persisted; an entry whose handler is not registered yet waits.
 */

export interface OutboxEntry<P = unknown> {
  /** Idempotency key, generated once when the write is made. */
  id: string;
  kind: string;
  /** Serial lane, e.g. `household:<id>`. */
  scope: string;
  /** Entries with the same kind and dedupe key replace each other while queued. */
  dedupeKey: string | null;
  payload: P;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
  lastErrorCode: string | null;
}

export interface FailedOutboxEntry<P = unknown> extends OutboxEntry<P> {
  failedAt: number;
}

export interface OutboxHandler<P = unknown> {
  run(payload: P, ctx: { idempotencyKey: string; attempt: number }): Promise<void>;
  /** Called after a successful replay, e.g. to invalidate queries. */
  onSuccess?(payload: P): void;
}

export interface OutboxState {
  entries: OutboxEntry[];
  failed: FailedOutboxEntry[];
}

export interface OutboxActions {
  enqueue<P>(input: {
    kind: string;
    scope: string;
    payload: P;
    dedupeKey?: string | null;
    id?: string;
    now?: number;
  }): OutboxEntry<P>;
  remove(id: string): void;
  dismissFailed(id?: string): void;
  reset(): void;
}

export const initialOutbox: OutboxState = { entries: [], failed: [] };

/** Entries older than the persisted query cache's max age are dropped (09 §4.4). */
export const OUTBOX_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 5 * 60_000;

/** Codes that will not succeed on replay; everything else (offline, 5xx, timeouts) is retried. */
const PERMANENT_CODES = new Set([
  'FORBIDDEN',
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'CONFLICT',
  'IDEMPOTENCY_KEY_REUSED',
  'PREMIUM_REQUIRED',
  'CHILD_DATA_CONSENT_REQUIRED',
  'NOT_CONFIGURED',
]);

export function isPermanentOutboxError(error: unknown): boolean {
  return isAppError(error) && PERMANENT_CODES.has(error.code);
}

export function backoffMs(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
}

/** Pure: adds an entry, replacing a queued entry with the same kind and dedupe key. */
export function addEntry(entries: readonly OutboxEntry[], entry: OutboxEntry): OutboxEntry[] {
  if (!entry.dedupeKey) return [...entries, entry];
  const rest = entries.filter((e) => !(e.kind === entry.kind && e.dedupeKey === entry.dedupeKey));
  return [...rest, entry];
}

export const OUTBOX_STORE_VERSION = 1;

export function migrateOutbox(persisted: unknown, _version: number): OutboxState {
  const p = persisted as Partial<OutboxState> | undefined;
  return {
    entries: Array.isArray(p?.entries) ? p.entries : [],
    failed: Array.isArray(p?.failed) ? p.failed : [],
  };
}

export const useOutboxStore = create<OutboxState & OutboxActions>()(
  devtools(
    persist(
      (set) => ({
        ...initialOutbox,
        enqueue: ({ kind, scope, payload, dedupeKey = null, id, now = Date.now() }) => {
          const entry: OutboxEntry<typeof payload> = {
            id: id ?? Crypto.randomUUID(),
            kind,
            scope,
            dedupeKey,
            payload,
            createdAt: now,
            attempts: 0,
            nextAttemptAt: now,
            lastErrorCode: null,
          };
          set((s) => ({ entries: addEntry(s.entries, entry as OutboxEntry) }));
          return entry;
        },
        remove: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
        dismissFailed: (id) =>
          set((s) => ({ failed: id ? s.failed.filter((e) => e.id !== id) : [] })),
        reset: () => set(initialOutbox),
      }),
      {
        name: 'store.outbox',
        version: OUTBOX_STORE_VERSION,
        storage: draftsJsonStorage,
        migrate: migrateOutbox,
        partialize: ({ entries, failed }) => ({ entries, failed }),
      },
    ),
    { name: 'outbox', enabled: __DEV__ },
  ),
);

resetters.add(() => useOutboxStore.getState().reset());

const handlers = new Map<string, OutboxHandler<never>>();

export function registerOutboxHandler<P>(kind: string, handler: OutboxHandler<P>): void {
  handlers.set(kind, handler as OutboxHandler<never>);
}

export function hasOutboxHandler(kind: string): boolean {
  return handlers.has(kind);
}

/** Test seam. */
export function clearOutboxHandlers(): void {
  handlers.clear();
}

let flushing: Promise<FlushOutcome> | null = null;

export interface FlushOutcome {
  sent: number;
  failed: number;
  pending: number;
}

export interface FlushOptions {
  now?: () => number;
  isOnline?: () => boolean;
}

/**
 * Replays due entries, one scope lane at a time in queue order. Concurrent calls share one run.
 * Returns how many entries were sent, failed permanently and are still pending.
 */
export function flushOutbox(opts: FlushOptions = {}): Promise<FlushOutcome> {
  if (flushing) return flushing;
  flushing = runFlush(opts).finally(() => {
    flushing = null;
  });
  return flushing;
}

async function runFlush({
  now = Date.now,
  isOnline = () => true,
}: FlushOptions): Promise<FlushOutcome> {
  const outcome = { sent: 0, failed: 0, pending: 0 };
  const store = useOutboxStore;

  // Drop entries that outlived the offline window (09 §4.4).
  const cutoff = now() - OUTBOX_MAX_AGE_MS;
  const stale = store.getState().entries.filter((e) => e.createdAt < cutoff);
  if (stale.length > 0)
    store.setState((s) => ({
      entries: s.entries.filter((e) => e.createdAt >= cutoff),
      failed: [
        ...s.failed,
        ...stale.map((e) => ({ ...e, lastErrorCode: 'EXPIRED', failedAt: now() })),
      ],
    }));

  if (!isOnline()) {
    outcome.pending = store.getState().entries.length;
    return outcome;
  }

  const blocked = new Set<string>();
  // Re-read the queue after each entry: new writes may arrive while we are sending.
  for (;;) {
    const next = store
      .getState()
      .entries.find(
        (e) => !blocked.has(e.scope) && e.nextAttemptAt <= now() && handlers.has(e.kind),
      );
    if (!next) break;
    // An entry that is not due, or has no handler yet, holds back later entries of its scope.
    const earlier = store
      .getState()
      .entries.find(
        (e) =>
          e.scope === next.scope &&
          e.createdAt <= next.createdAt &&
          e.id !== next.id &&
          (e.nextAttemptAt > now() || !handlers.has(e.kind)),
      );
    if (earlier) {
      blocked.add(next.scope);
      continue;
    }
    const handler = handlers.get(next.kind) as OutboxHandler<unknown>;
    try {
      await handler.run(next.payload, { idempotencyKey: next.id, attempt: next.attempts + 1 });
      // A newer write for the same row may have replaced this entry while it was in flight; only
      // remove the exact entry that was sent.
      store.setState((s) => ({ entries: s.entries.filter((e) => e.id !== next.id) }));
      outcome.sent += 1;
      try {
        handler.onSuccess?.(next.payload);
      } catch (e) {
        captureException(e, { tags: { phase: 'outbox-on-success', kind: next.kind } });
      }
    } catch (error) {
      const code = isAppError(error) ? error.code : 'UNKNOWN';
      if (isPermanentOutboxError(error)) {
        store.setState((s) => ({
          entries: s.entries.filter((e) => e.id !== next.id),
          failed: [...s.failed, { ...next, lastErrorCode: code, failedAt: now() }],
        }));
        outcome.failed += 1;
        captureException(error, { tags: { phase: 'outbox', kind: next.kind } });
      } else {
        const attempts = next.attempts + 1;
        store.setState((s) => ({
          entries: s.entries.map((e) =>
            e.id === next.id
              ? { ...e, attempts, nextAttemptAt: now() + backoffMs(attempts), lastErrorCode: code }
              : e,
          ),
        }));
        blocked.add(next.scope);
      }
    }
  }
  outcome.pending = store.getState().entries.length;
  return outcome;
}

/** Waits for the encrypted queue to be read back (so a replay after an app kill sees it). */
export function whenOutboxHydrated(): Promise<void> {
  if (useOutboxStore.persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const unsubscribe = useOutboxStore.persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
  });
}
