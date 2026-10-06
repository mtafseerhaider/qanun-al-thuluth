import type { HouseholdRole } from '@thuluth/shared';

import type { PlatformStore } from '../../functions/_shared/platform.ts';

/** In-memory `PlatformStore` (membership, premium, flags, rate limits, idempotency, audit). */
export function memoryPlatform(opts: {
  roles: Record<string, HouseholdRole>;
  premium?: boolean;
  flags?: Record<string, boolean>;
}) {
  const state = {
    premium: opts.premium ?? false,
    flags: opts.flags ?? {},
    counters: new Map<string, number>(),
    idem: new Map<
      string,
      { id: string; hash: string; status?: number; body?: unknown; done: boolean }
    >(),
    audits: [] as Array<{ action: string; entity: string; diff: Record<string, unknown> }>,
  };
  const platform: PlatformStore = {
    membership: async (_h, u) => opts.roles[u] ?? null,
    householdPremium: async () => state.premium,
    featureEnabled: async (k) => state.flags[k] ?? true,
    consumeRateLimit: async (key, limit) => {
      const c = (state.counters.get(key) ?? 0) + 1;
      state.counters.set(key, c);
      return {
        allowed: c <= limit,
        remaining: Math.max(0, limit - c),
        reset_at: '2026-10-06T08:01:00Z',
      };
    },
    idempotencyBegin: async (_scope, user, key, hash) => {
      const k = `${user}:${key}`;
      const row = state.idem.get(k);
      if (!row) {
        const id = crypto.randomUUID();
        state.idem.set(k, { id, hash, done: false });
        return { state: 'new', id };
      }
      if (row.hash !== hash) return { state: 'mismatch' };
      if (!row.done) return { state: 'in_progress' };
      return { state: 'replay', status: row.status ?? 200, body: row.body };
    },
    idempotencyComplete: async (id, status, body) => {
      for (const row of state.idem.values())
        if (row.id === id) Object.assign(row, { status, body, done: true });
    },
    idempotencyFail: async (id) => {
      for (const [k, row] of state.idem) if (row.id === id) state.idem.delete(k);
    },
    audit: async (e) => {
      state.audits.push({ action: e.action, entity: e.entity, diff: e.diff });
    },
  };
  return { platform, state };
}
