import { assert, assertEquals } from 'jsr:@std/assert@1';

import { createPricesRefreshHandler } from '../../functions/prices-refresh/handler.ts';
import { isOutlier, mad, median, repriced, screen } from '../../functions/prices-refresh/screen.ts';
import type { Observation, StatusUpdate } from '../../functions/prices-refresh/screen.ts';
import type { PricesStore } from '../../functions/prices-refresh/store.ts';

const SECRET = 'cron-secret-for-tests';
const P1 = '7f3c0000-0000-4000-8000-00000000a001';
const P2 = '7f3c0000-0000-4000-8000-00000000a002';
const NOW = new Date('2026-10-06T00:15:00Z');

let seq = 0;
function obs(partial: Partial<Observation> & { price: number }): Observation {
  seq += 1;
  return {
    id: `o-${seq}`,
    price_profile_id: P1,
    ingredient_id: 'i-masoor',
    amount_minor: partial.price,
    unit_grams: 1000,
    observed_on: '2026-10-01',
    source: 'seed',
    reporter_user_id: null,
    moderation_status: 'accepted',
    ...partial,
  };
}

const baseline = (n: number, price = 30000, extra: Partial<Observation> = {}) =>
  Array.from({ length: n }, (_, i) => obs({ price: price + (i % 3) * 500, ...extra }));

function memoryStore(observations: Observation[], profiles = [{ id: P1, region_id: 'r1' }]) {
  const state = { observations, refreshed: 0, updates: [] as StatusUpdate[] };
  const book = () => {
    const out = new Map<string, number[]>();
    for (const o of state.observations) {
      if (o.moderation_status !== 'accepted') continue;
      const k = `${o.price_profile_id}:${o.ingredient_id}`;
      out.set(k, [...(out.get(k) ?? []), (o.amount_minor * 1000) / o.unit_grams]);
    }
    return new Map([...out].map(([k, v]) => [k, median(v)]));
  };
  let current = book();
  const store: PricesStore = {
    profiles: async (regionIds) =>
      profiles.filter((p) => !regionIds?.length || regionIds.includes(p.region_id)),
    observations: async (ids, since) =>
      state.observations.filter((o) => ids.includes(o.price_profile_id) && o.observed_on >= since),
    setStatuses: async (updates) => {
      state.updates.push(...updates);
      for (const u of updates) {
        const o = state.observations.find((x) => x.id === u.id && x.source === 'user_report');
        if (o) o.moderation_status = u.status;
      }
    },
    currentPrices: async (ids) =>
      new Map([...current].filter(([k]) => ids.includes(k.split(':')[0]!))),
    refreshViews: async () => {
      state.refreshed += 1;
      current = book();
    },
  };
  return { store, state };
}

const call = (store: PricesStore, body: unknown = {}, secret: string | null = SECRET) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret !== null) headers['x-internal-secret'] = secret;
  const handler = createPricesRefreshHandler({ secrets: () => [SECRET], store, now: () => NOW });
  return handler(
    new Request('http://localhost/prices-refresh', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
  );
};

Deno.test('screen: median and MAD helpers', () => {
  assertEquals(median([3, 1, 2]), 2);
  assertEquals(median([4, 1, 2, 3]), 2.5);
  assertEquals(mad([1, 2, 3, 4, 100]), 1);
  assert(Number.isNaN(median([])));
  assert(isOutlier(90000, 30000, 0, false), 'hard band rejects 3x even with thin data');
  assert(isOutlier(10000, 30000, 0, false), 'hard band rejects a third of the median');
  assert(!isOutlier(33000, 30000, 0, false));
  assert(isOutlier(40000, 30000, 500, true), 'modified z-score above 3.5');
  assert(!isOutlier(30400, 30000, 500, true));
});

Deno.test('screen: a report at 3x the median is rejected (AC-G3); a normal one is accepted', () => {
  const report = obs({
    price: 90000,
    source: 'user_report',
    reporter_user_id: 'u1',
    moderation_status: 'pending',
  });
  const fine = obs({
    price: 30500,
    source: 'user_report',
    reporter_user_id: 'u2',
    moderation_status: 'pending',
  });
  const result = screen([...baseline(6), report, fine]);
  assertEquals(result.outliers_rejected, 1);
  assertEquals(result.pending_accepted, 1);
  assertEquals(
    result.updates.sort((a, b) => a.id.localeCompare(b.id)),
    [
      { id: report.id, status: 'rejected_outlier' },
      { id: fine.id, status: 'accepted' },
    ].sort((a, b) => a.id.localeCompare(b.id)),
  );
});

Deno.test(
  'screen: thin data needs two reporters within 15 percent; a lone report stays pending',
  () => {
    const lone = obs({
      price: 31000,
      source: 'user_report',
      reporter_user_id: 'u1',
      moderation_status: 'pending',
    });
    assertEquals(screen([...baseline(2), lone]).updates, []);

    const a = obs({
      price: 31000,
      source: 'user_report',
      reporter_user_id: 'u1',
      moderation_status: 'pending',
    });
    const b = obs({
      price: 32000,
      source: 'user_report',
      reporter_user_id: 'u2',
      moderation_status: 'pending',
    });
    const sameReporter = obs({
      price: 31500,
      source: 'user_report',
      reporter_user_id: 'u1',
      moderation_status: 'pending',
    });
    const r = screen([a, b, sameReporter]);
    assertEquals(r.pending_accepted, 3);

    const c = obs({
      price: 31000,
      source: 'user_report',
      reporter_user_id: 'u3',
      moderation_status: 'pending',
    });
    const d = obs({
      price: 31200,
      source: 'user_report',
      reporter_user_id: 'u3',
      moderation_status: 'pending',
    });
    assertEquals(screen([c, d]).updates, [], 'one reporter twice is not agreement');
  },
);

Deno.test(
  'screen: earlier accepted reports are re-screened; seed rows and bad rows are never touched',
  () => {
    const stale = obs({
      price: 70000,
      source: 'user_report',
      reporter_user_id: 'u1',
      moderation_status: 'accepted',
    });
    const seedHigh = obs({ price: 90000, source: 'seed' });
    const zero = obs({
      price: 0,
      source: 'user_report',
      reporter_user_id: 'u2',
      moderation_status: 'pending',
    });
    const r = screen([...baseline(8), stale, seedHigh, zero]);
    assertEquals(r.updates, [{ id: stale.id, status: 'rejected_outlier' }]);
  },
);

Deno.test('screen: groups are per profile and ingredient', () => {
  const other = obs({
    price: 90000,
    price_profile_id: P2,
    source: 'user_report',
    reporter_user_id: 'u1',
    moderation_status: 'pending',
  });
  // Profile 2 has no baseline, so a lone report there stays pending rather than being judged against P1.
  assertEquals(screen([...baseline(6), other]).updates, []);
});

Deno.test('repriced: moves above 3 percent and new keys only', () => {
  const before = new Map([
    ['a', 100],
    ['b', 100],
    ['c', 100],
  ]);
  const after = new Map([
    ['a', 102],
    ['b', 110],
    ['c', 100],
    ['d', 50],
  ]);
  assertEquals(repriced(before, after), ['b', 'd']);
});

Deno.test('prices-refresh: x-internal-secret required', async () => {
  const { store, state } = memoryStore(baseline(6));
  const res = await call(store, {}, null);
  assertEquals(res.status, 401);
  const wrong = await call(store, {}, 'nope');
  assertEquals(wrong.status, 401);
  assertEquals(state.refreshed, 0);
});

Deno.test(
  'prices-refresh: rejects outliers, accepts agreement, refreshes the book and counts repricing',
  async () => {
    const observations = [
      ...baseline(6),
      obs({
        price: 95000,
        source: 'user_report',
        reporter_user_id: 'u1',
        moderation_status: 'pending',
      }),
      // Thin-data ingredient: two reporters agree, so it enters the price book.
      obs({
        ingredient_id: 'i-onion',
        price: 12000,
        source: 'user_report',
        reporter_user_id: 'u1',
        moderation_status: 'pending',
      }),
      obs({
        ingredient_id: 'i-onion',
        price: 12500,
        source: 'user_report',
        reporter_user_id: 'u2',
        moderation_status: 'pending',
      }),
    ];
    const { store, state } = memoryStore(observations);
    const res = await call(store);
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.outliers_rejected, 1);
    assertEquals(body.pending_accepted, 2);
    assertEquals(body.ingredients_repriced, 1, 'onion is new in the book; masoor is unchanged');
    assertEquals(body.profiles_updated, 1);
    assertEquals(body.stale_profiles, []);
    assertEquals(state.refreshed, 1);

    // Idempotent: a second run changes nothing.
    const again = await (await call(store)).json();
    assertEquals(again.outliers_rejected, 0);
    assertEquals(again.pending_accepted, 0);
    assertEquals(again.ingredients_repriced, 0);
  },
);

Deno.test('prices-refresh: region filter, since, and stale profiles', async () => {
  const old = baseline(5, 30000, { observed_on: '2026-08-10' });
  const { store } = memoryStore(old, [
    { id: P1, region_id: 'r1' },
    { id: P2, region_id: 'r2' },
  ]);
  const body = await (await call(store, { since: '2026-08-01' })).json();
  assertEquals(
    body.stale_profiles.sort(),
    [P1, P2].sort(),
    'P1 median age 57 days; P2 has no data',
  );

  const filtered = await (
    await call(store, { region_ids: ['00000000-0000-4000-8000-000000000000'] })
  ).json();
  assertEquals(filtered.stale_profiles, []);

  const bad = await call(store, { since: 'yesterday' });
  assertEquals(bad.status, 400);
});
