import { TrackEventInput } from '@shared/contracts';

import {
  createAnalyticsClient,
  STORAGE_KEY,
  type AnalyticsRow,
  type AnalyticsTransport,
} from '../queue';

class MemoryStore {
  data = new Map<string, string>();
  getString(k: string) {
    return this.data.get(k);
  }
  set(k: string, v: string) {
    this.data.set(k, v);
  }
  remove(k: string) {
    return this.data.delete(k);
  }
}

function setup(
  overrides: {
    userId?: string | null;
    batchSize?: number;
    failing?: boolean;
    maxQueue?: number;
    sessionId?: string;
  } = {},
) {
  const store = new MemoryStore();
  const sent: AnalyticsRow[][] = [];
  let n = 0;
  let clock = Date.parse('2026-10-06T10:00:00Z');
  const transport: AnalyticsTransport = {
    send: jest.fn(async (rows: AnalyticsRow[]) => {
      if (overrides.failing) throw new Error('offline');
      sent.push(rows);
    }),
  };
  const client = createAnalyticsClient({
    storage: store,
    transport,
    uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`,
    now: () => clock,
    sessionId: overrides.sessionId ?? 'session-1',
    getContext: () => ({
      userId: overrides.userId === undefined ? 'user-1' : overrides.userId,
      householdId: null,
      locale: 'en',
      appVersion: '1.0.0',
      platform: 'android',
    }),
    ...(overrides.batchSize ? { batchSize: overrides.batchSize } : {}),
    ...(overrides.maxQueue ? { maxQueue: overrides.maxQueue } : {}),
  });
  return { client, store, sent, transport, advance: (ms: number) => (clock += ms) };
}

const flushPromises = () => new Promise((r) => setImmediate(r));

describe('analytics queue', () => {
  it('rejects events whose props fail the registry schema', () => {
    const { client } = setup();
    // @ts-expect-error unknown prop is a type error and a runtime rejection
    expect(client.track('debug_test_event', { source: 'debug_screen', email: 'a@b.co' })).toBe(
      false,
    );
    expect(client.size()).toBe(0);
  });

  it('queues valid events in memory and in storage', () => {
    const { client, store } = setup();
    client.track('debug_test_event', { source: 'test' });
    expect(client.size()).toBe(1);
    expect(JSON.parse(store.getString(STORAGE_KEY) ?? '[]')).toHaveLength(1);
  });

  it('auto-flushes when the batch size is reached', async () => {
    const { client, sent } = setup({ batchSize: 3 });
    client.track('app_opened', { cold_start: true });
    client.track('screen_viewed', { screen: 'Dashboard' });
    expect(sent).toHaveLength(0);
    client.track('debug_test_event', { source: 'test' });
    await flushPromises();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(3);
    expect(client.size()).toBe(0);
  });

  it('maps queued events to track_events inputs (S7-12 contract)', async () => {
    const { client, sent } = setup();
    client.track('screen_viewed', { screen: 'Dashboard' }, { locale: 'ur' });
    await client.flush();
    // session-1 is not a UUID, so it is left out rather than failing the server's Uuid check.
    expect(sent[0]?.[0]).toEqual({
      event_id: '00000000-0000-4000-8000-000000000001',
      event: 'screen_viewed',
      props: { screen: 'Dashboard' },
      occurred_at: '2026-10-06T10:00:00.000Z',
      household_id: null,
    });
    expect(TrackEventInput.safeParse(sent[0]?.[0]).success).toBe(true);
  });

  it('sends the session id at the top level when it is a UUID', async () => {
    const { client, sent } = setup({ sessionId: '00000000-0000-4000-8000-0000000000aa' });
    client.track('screen_viewed', { screen: 'Dashboard' });
    await client.flush();
    expect(sent[0]?.[0]?.session_id).toBe('00000000-0000-4000-8000-0000000000aa');
  });

  it('splits large queues into batches of at most 50', async () => {
    const { client, sent } = setup({ batchSize: 1000 });
    for (let i = 0; i < 120; i++) client.track('debug_test_event', { source: 'test' });
    const result = await client.flush();
    expect(result.sent).toBe(120);
    expect(sent.map((b) => b.length)).toEqual([50, 50, 20]);
  });

  it('keeps events queued when the transport fails', async () => {
    const { client, store } = setup({ failing: true });
    client.track('debug_test_event', { source: 'test' });
    await expect(client.flush()).rejects.toThrow('offline');
    expect(client.size()).toBe(1);
    expect(store.getString(STORAGE_KEY)).toBeDefined();
  });

  it('waits for a signed-in user before sending', async () => {
    const { client, transport } = setup({ userId: null });
    client.track('debug_test_event', { source: 'test' });
    expect(await client.flush()).toEqual({ sent: 0, remaining: 1, skipped: 'no_user' });
    expect(transport.send).not.toHaveBeenCalled();
  });

  it('drops events older than seven days', async () => {
    const { client, advance, sent } = setup();
    client.track('debug_test_event', { source: 'test' });
    advance(8 * 24 * 60 * 60 * 1000);
    client.track('app_opened', { cold_start: false });
    await client.flush();
    expect(sent[0]?.map((r) => r.event)).toEqual(['app_opened']);
  });

  it('caps the queue and drops the oldest events', () => {
    const { client } = setup({ batchSize: 1000, maxQueue: 5 });
    for (let i = 0; i < 8; i++) client.track('debug_test_event', { source: 'test' });
    expect(client.size()).toBe(5);
    expect(client.peek()[0]?.event_id).toBe('00000000-0000-4000-8000-000000000004');
  });

  it('restores the persisted queue on start', () => {
    const first = setup();
    first.client.track('debug_test_event', { source: 'test' });
    const restored = createAnalyticsClient({
      storage: first.store,
      transport: first.transport,
      uuid: () => 'x',
      getContext: () => ({
        userId: 'u',
        householdId: null,
        locale: 'en',
        appVersion: '1',
        platform: 'ios',
      }),
    });
    expect(restored.size()).toBe(1);
  });
});
