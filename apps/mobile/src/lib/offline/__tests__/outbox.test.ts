import { AppError } from '@/lib/supabase/app-error';

import {
  addEntry,
  backoffMs,
  clearOutboxHandlers,
  flushOutbox,
  isPermanentOutboxError,
  migrateOutbox,
  OUTBOX_MAX_AGE_MS,
  registerOutboxHandler,
  useOutboxStore,
  type OutboxEntry,
} from '../outbox';
import { startOutboxSync } from '../outbox-sync';

jest.mock('expo-crypto', () => ({
  randomUUID: () => (jest.requireActual('crypto') as { randomUUID: () => string }).randomUUID(),
}));

const T0 = 1_760_000_000_000;

function enqueue(
  over: Partial<{
    kind: string;
    scope: string;
    dedupeKey: string | null;
    payload: unknown;
    now: number;
    id: string;
  }> = {},
) {
  return useOutboxStore.getState().enqueue({
    kind: over.kind ?? 'serving.status',
    scope: over.scope ?? 'household:h1',
    dedupeKey: over.dedupeKey ?? null,
    payload: over.payload ?? { v: 1 },
    now: over.now ?? T0,
    ...(over.id ? { id: over.id } : {}),
  });
}

beforeEach(() => {
  useOutboxStore.getState().reset();
  clearOutboxHandlers();
});

describe('outbox queue (24 S3-15)', () => {
  it('gives every entry an idempotency key and coalesces writes to the same row', () => {
    const a = enqueue({ dedupeKey: 'serving-1', payload: { status: 'eaten' } });
    enqueue({ dedupeKey: 'serving-2', payload: { status: 'eaten' } });
    const c = enqueue({ dedupeKey: 'serving-1', payload: { status: 'skipped' } });
    const { entries } = useOutboxStore.getState();
    expect(a.id).toMatch(/[0-9a-f-]{36}/);
    expect(c.id).not.toBe(a.id);
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.dedupeKey === 'serving-1')?.payload).toEqual({
      status: 'skipped',
    });
  });

  it('keeps entries without a dedupe key separate', () => {
    const base = {
      kind: 'k',
      scope: 's',
      payload: 1,
      createdAt: 0,
      attempts: 0,
      nextAttemptAt: 0,
      lastErrorCode: null,
    };
    const e1: OutboxEntry = { ...base, id: '1', dedupeKey: null };
    const e2: OutboxEntry = { ...base, id: '2', dedupeKey: null };
    expect(addEntry([e1], e2)).toHaveLength(2);
  });

  it('sends nothing while offline and keeps the queue', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    registerOutboxHandler('serving.status', { run });
    enqueue({ dedupeKey: 'a' });
    const out = await flushOutbox({ isOnline: () => false, now: () => T0 });
    expect(run).not.toHaveBeenCalled();
    expect(out).toEqual({ sent: 0, failed: 0, pending: 1 });
  });

  it('replays queued writes once on reconnect, in order, with their idempotency keys', async () => {
    const calls: Array<[unknown, string]> = [];
    const onSuccess = jest.fn();
    registerOutboxHandler('serving.status', {
      run: async (p, ctx) => {
        calls.push([p, ctx.idempotencyKey]);
      },
      onSuccess,
    });
    const a = enqueue({ dedupeKey: 'a', payload: 'first', now: T0 });
    const b = enqueue({ dedupeKey: 'b', payload: 'second', now: T0 + 1 });
    let online = false;
    const listeners: Array<(o: boolean) => void> = [];
    const stop = startOutboxSync({
      isOnline: () => online,
      subscribeOnline: (cb) => {
        listeners.push(cb);
        return () => undefined;
      },
      now: () => T0 + 10,
    });
    await new Promise((r) => setImmediate(r));
    expect(calls).toHaveLength(0);

    online = true;
    listeners.forEach((l) => l(true));
    listeners.forEach((l) => l(true)); // a second "online" event must not resend
    await new Promise((r) => setImmediate(r));
    await flushOutbox({ now: () => T0 + 10 });
    stop();

    expect(calls).toEqual([
      ['first', a.id],
      ['second', b.id],
    ]);
    expect(onSuccess).toHaveBeenCalledTimes(2);
    expect(useOutboxStore.getState().entries).toHaveLength(0);
  });

  it('moves permanent failures aside and keeps going', async () => {
    const run = jest
      .fn()
      .mockRejectedValueOnce(new AppError('FORBIDDEN', 'no'))
      .mockResolvedValueOnce(undefined);
    registerOutboxHandler('serving.status', { run });
    enqueue({ dedupeKey: 'a', now: T0 });
    enqueue({ dedupeKey: 'b', now: T0 + 1 });
    const out = await flushOutbox({ now: () => T0 + 5 });
    expect(out).toEqual({ sent: 1, failed: 1, pending: 0 });
    expect(useOutboxStore.getState().failed[0]?.lastErrorCode).toBe('FORBIDDEN');
  });

  it('backs off on transient errors and holds later writes of the same scope', async () => {
    const run = jest.fn().mockRejectedValueOnce(new AppError('NETWORK_ERROR', 'down'));
    const other = jest.fn().mockResolvedValue(undefined);
    registerOutboxHandler('serving.status', { run });
    registerOutboxHandler('other', { run: other });
    enqueue({ dedupeKey: 'a', now: T0 });
    enqueue({ dedupeKey: 'b', now: T0 + 1 });
    enqueue({ kind: 'other', scope: 'household:h2', now: T0 + 2 });

    const out = await flushOutbox({ now: () => T0 + 5 });
    expect(run).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1); // a different scope is not blocked
    expect(out.pending).toBe(2);
    const first = useOutboxStore.getState().entries[0];
    expect(first?.attempts).toBe(1);
    expect(first?.nextAttemptAt).toBe(T0 + 5 + backoffMs(1));

    run.mockResolvedValue(undefined);
    await flushOutbox({ now: () => T0 + 6 }); // not due yet: still held
    expect(run).toHaveBeenCalledTimes(1);
    await flushOutbox({ now: () => T0 + 5 + backoffMs(1) });
    expect(run).toHaveBeenCalledTimes(3);
    expect(useOutboxStore.getState().entries).toHaveLength(0);
  });

  it('holds a scope behind an entry whose kind has no handler yet (stub queues)', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    registerOutboxHandler('serving.status', { run });
    enqueue({ kind: 'alpha.feedback', scope: 'feedback', now: T0 });
    enqueue({ dedupeKey: 'a', now: T0 + 1 });
    const out = await flushOutbox({ now: () => T0 + 2 });
    expect(out).toEqual({ sent: 1, failed: 0, pending: 1 });
    expect(useOutboxStore.getState().entries[0]?.kind).toBe('alpha.feedback');
  });

  it('expires entries older than the offline window', async () => {
    enqueue({ dedupeKey: 'old', now: T0 });
    await flushOutbox({ now: () => T0 + OUTBOX_MAX_AGE_MS + 1, isOnline: () => false });
    expect(useOutboxStore.getState().entries).toHaveLength(0);
    expect(useOutboxStore.getState().failed[0]?.lastErrorCode).toBe('EXPIRED');
  });

  it('classifies errors and caps the backoff', () => {
    expect(isPermanentOutboxError(new AppError('VALIDATION_FAILED', 'x'))).toBe(true);
    expect(isPermanentOutboxError(new AppError('NETWORK_ERROR', 'x'))).toBe(false);
    expect(isPermanentOutboxError(new Error('x'))).toBe(false);
    expect(backoffMs(1)).toBe(2_000);
    expect(backoffMs(3)).toBe(8_000);
    expect(backoffMs(50)).toBe(5 * 60_000);
  });

  it('migrates unknown persisted state to an empty queue', () => {
    expect(migrateOutbox(undefined, 0)).toEqual({ entries: [], failed: [] });
    expect(migrateOutbox({ entries: 'x' }, 0)).toEqual({ entries: [], failed: [] });
  });
});
