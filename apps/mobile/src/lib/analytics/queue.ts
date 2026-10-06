import type { KeyValueStore } from '@/lib/storage/mmkv';

import { EventSchemas, type EventName, type EventProps } from './events';

/** One queued event. Context fields not yet columns (event_id, session_id, locale) travel in props. */
export interface QueuedEvent {
  event_id: string;
  event: EventName;
  props: Record<string, unknown>;
  occurred_at: string;
  session_id: string;
  household_id: string | null;
  locale: string;
}

/** Row shape for `analytics_events` in the Sprint 0 schema (05 §13, before migration 0024). */
export interface AnalyticsRow {
  user_id: string;
  household_id: string | null;
  event: string;
  props: Record<string, unknown>;
  occurred_at: string;
  app_version: string;
  platform: 'ios' | 'android' | 'web';
}

export interface AnalyticsTransport {
  /** Inserts rows; throws on failure so the batch stays queued. */
  send(rows: AnalyticsRow[]): Promise<void>;
}

export interface AnalyticsContext {
  userId: string | null;
  householdId: string | null;
  locale: string;
  appVersion: string;
  platform: AnalyticsRow['platform'];
}

export interface AnalyticsClientOptions {
  storage: KeyValueStore;
  transport: AnalyticsTransport;
  getContext: () => AnalyticsContext | Promise<AnalyticsContext>;
  uuid: () => string;
  now?: () => number;
  sessionId?: string;
  batchSize?: number;
  maxBatch?: number;
  maxQueue?: number;
  maxAgeMs?: number;
  isEnabled?: () => boolean;
  onInvalid?: (event: string, issues: string[]) => void;
}

export const STORAGE_KEY = 'analytics.queue';
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

export type FlushResult = {
  sent: number;
  remaining: number;
  skipped?: 'empty' | 'in_flight' | 'no_user';
};

/**
 * Batched analytics client (18 §10): queues in memory and MMKV, auto-flushes at `batchSize`
 * (default 20), keeps at most `maxQueue` (500, oldest dropped) and drops events older than 7 days,
 * which the insert policy would reject anyway.
 */
export function createAnalyticsClient(opts: AnalyticsClientOptions) {
  const now = opts.now ?? Date.now;
  const batchSize = opts.batchSize ?? 20;
  const maxBatch = opts.maxBatch ?? 50;
  const maxQueue = opts.maxQueue ?? 500;
  const maxAgeMs = opts.maxAgeMs ?? SEVEN_DAYS;
  const sessionId = opts.sessionId ?? opts.uuid();

  let queue: QueuedEvent[] = load();
  let inFlight: Promise<FlushResult> | null = null;

  function load(): QueuedEvent[] {
    try {
      const raw = opts.storage.getString(STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as QueuedEvent[]) : [];
    } catch {
      return [];
    }
  }

  function persist() {
    if (queue.length === 0) opts.storage.remove(STORAGE_KEY);
    else opts.storage.set(STORAGE_KEY, JSON.stringify(queue));
  }

  function pruneExpired() {
    const cutoff = now() - maxAgeMs;
    queue = queue.filter((e) => Date.parse(e.occurred_at) >= cutoff);
  }

  function track<E extends EventName>(
    event: E,
    props: EventProps<E>,
    extra: { householdId?: string | null; locale?: string } = {},
  ): boolean {
    if (opts.isEnabled && !opts.isEnabled()) return false;
    const parsed = EventSchemas[event].safeParse(props);
    if (!parsed.success) {
      opts.onInvalid?.(
        event,
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      );
      return false;
    }
    queue.push({
      event_id: opts.uuid(),
      event,
      props: parsed.data as Record<string, unknown>,
      occurred_at: new Date(now()).toISOString(),
      session_id: sessionId,
      household_id: extra.householdId ?? null,
      locale: extra.locale ?? '',
    });
    if (queue.length > maxQueue) queue = queue.slice(queue.length - maxQueue);
    persist();
    if (queue.length >= batchSize) void flush();
    return true;
  }

  async function doFlush(): Promise<FlushResult> {
    pruneExpired();
    persist();
    if (queue.length === 0) return { sent: 0, remaining: 0, skipped: 'empty' };
    const ctx = await opts.getContext();
    // The insert policy requires user_id = auth.uid(); keep events queued until signed in.
    if (!ctx.userId) return { sent: 0, remaining: queue.length, skipped: 'no_user' };
    let sent = 0;
    while (queue.length > 0) {
      const batch = queue.slice(0, maxBatch);
      const rows: AnalyticsRow[] = batch.map((e) => ({
        user_id: ctx.userId as string,
        household_id: e.household_id ?? ctx.householdId,
        event: e.event,
        props: {
          ...e.props,
          event_id: e.event_id,
          session_id: e.session_id,
          locale: e.locale || ctx.locale,
        },
        occurred_at: e.occurred_at,
        app_version: ctx.appVersion,
        platform: ctx.platform,
      }));
      await opts.transport.send(rows);
      const sentIds = new Set(batch.map((e) => e.event_id));
      queue = queue.filter((e) => !sentIds.has(e.event_id));
      persist();
      sent += batch.length;
    }
    return { sent, remaining: queue.length };
  }

  /** Sends everything queued. Concurrent calls share one in-flight flush. Rejects if the transport fails. */
  function flush(): Promise<FlushResult> {
    if (inFlight) return inFlight;
    inFlight = doFlush().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  return {
    track,
    flush,
    sessionId,
    size: () => queue.length,
    peek: (): readonly QueuedEvent[] => queue,
    clear: () => {
      queue = [];
      persist();
    },
  };
}

export type AnalyticsClient = ReturnType<typeof createAnalyticsClient>;
