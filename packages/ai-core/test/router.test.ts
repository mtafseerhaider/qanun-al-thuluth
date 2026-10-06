import { describe, expect, it } from 'vitest';

import { costUsdMicros, toUsageRow } from '../src/metering/usage.ts';
import { chatRouteForTier, checkDailyChatCap } from '../src/metering/caps.ts';
import { FakeProvider } from '../src/providers/fake.ts';
import { CircuitBreaker, runWithFallback } from '../src/router/fallback.ts';
import { normalizeParams, RouteResolver } from '../src/router/route-resolver.ts';
import type { AiModelRouteRow } from '../src/router/route-resolver.ts';
import { AIError, textOf } from '../src/types.ts';
import { params, request } from './helpers.ts';

const rows: AiModelRouteRow[] = [
  {
    route_key: 'chat.default',
    provider: 'google',
    model: 'gemini-pro',
    params: {},
    priority: 3,
    enabled: true,
  },
  {
    route_key: 'chat.default',
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    params: { timeout_ms: 5000 },
    priority: 1,
    enabled: true,
  },
  {
    route_key: 'chat.default',
    provider: 'openai',
    model: 'gpt-x',
    params: {},
    priority: 2,
    enabled: false,
  },
];

describe('RouteResolver', () => {
  it('orders enabled routes and maps google to gemini', async () => {
    const routes = await new RouteResolver(async () => rows).resolve('chat.default');
    expect(routes.map((r) => `${r.provider}:${r.model}`)).toEqual([
      'anthropic:claude-sonnet-5-5',
      'gemini:gemini-pro',
    ]);
    expect(routes[0]!.params.timeoutMs).toBe(5000);
  });

  it('caches for the TTL', async () => {
    let loads = 0;
    let t = 0;
    const resolver = new RouteResolver(async () => (loads++, rows), { now: () => t });
    await resolver.resolve('chat.default');
    t = 59_000;
    await resolver.resolve('chat.default');
    expect(loads).toBe(1);
    t = 61_000;
    await resolver.resolve('chat.default');
    expect(loads).toBe(2);
  });

  it('normalizes snake_case params', () => {
    expect(normalizeParams({ max_tokens: 10, temperature: 0.2 })).toMatchObject({
      maxOutputTokens: 10,
      temperature: 0.2,
      timeoutMs: 45000,
    });
  });
});

describe('runWithFallback', () => {
  const resolver = new RouteResolver(async () => rows);
  const noSleep = async () => {};

  it('retries then falls back to the next provider', async () => {
    const anthropic = new FakeProvider({
      id: 'anthropic',
      script: () => new AIError('OVERLOADED', 'busy'),
    });
    const gemini = new FakeProvider({ id: 'gemini' });
    const { result, route, attempts } = await runWithFallback(
      'chat.default',
      (p, r) => p.chat(request('hi'), r.model, r.params),
      { overallDeadlineMs: 10_000 },
      { resolver, providers: { anthropic, gemini }, sleep: noSleep },
    );
    expect(route.provider).toBe('gemini');
    expect(textOf(result.content)).toBe('echo: hi');
    expect(anthropic.calls).toHaveLength(3);
    expect(attempts.filter((a) => !a.ok)).toHaveLength(3);
  });

  it('moves on immediately for non-retryable errors', async () => {
    const anthropic = new FakeProvider({
      id: 'anthropic',
      script: () => new AIError('AUTH', 'bad key'),
    });
    const gemini = new FakeProvider({ id: 'gemini' });
    await runWithFallback(
      'chat.default',
      (p, r) => p.chat(request(), r.model, r.params),
      { overallDeadlineMs: 10_000 },
      {
        resolver,
        providers: { anthropic, gemini },
        sleep: noSleep,
      },
    );
    expect(anthropic.calls).toHaveLength(1);
  });

  it('throws ALL_ROUTES_FAILED when every route fails', async () => {
    const failing = new FakeProvider({ script: () => new AIError('AUTH', 'bad key') });
    const err = await runWithFallback(
      'chat.default',
      (p, r) => p.chat(request(), r.model, r.params),
      { overallDeadlineMs: 10_000 },
      {
        resolver,
        providers: {
          anthropic: failing,
          gemini: new FakeProvider({ id: 'gemini', script: () => new AIError('AUTH', 'x') }),
        },
        sleep: noSleep,
      },
    ).catch((e: unknown) => e);
    expect((err as AIError).code).toBe('ALL_ROUTES_FAILED');
  });
});

describe('CircuitBreaker', () => {
  it('opens after five failures and half-opens after 30 s', () => {
    let t = 0;
    const breaker = new CircuitBreaker(() => t);
    for (let i = 0; i < 5; i++) breaker.recordFailure('a');
    expect(breaker.isOpen('a')).toBe(true);
    t = 30_000;
    expect(breaker.isOpen('a')).toBe(false);
  });
});

describe('metering', () => {
  it('computes cost in micro-USD', () => {
    const usage = {
      inputTokens: 1000,
      outputTokens: 100,
      cacheReadTokens: 400,
      cacheWriteTokens: 0,
    };
    expect(costUsdMicros(usage, { ...params, priceCacheReadPerMTokUsd: 0.3 })).toBe(
      600 * 3 + 400 * 0.3 + 100 * 15,
    );
  });

  it('builds an ai_usage row with the database provider name', () => {
    const row = toUsageRow({
      requestId: 'r',
      userId: 'u',
      householdId: null,
      routeKey: 'chat.default',
      provider: 'gemini',
      model: 'g',
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      latencyMs: 12.4,
      status: 'ok',
      params,
    });
    expect(row).toMatchObject({
      provider: 'google',
      tokens_in: 1,
      latency_ms: 12,
      cost_usd_micros: 18,
    });
  });

  it('routes free chat to the cheap route and caps messages', () => {
    expect(chatRouteForTier('free')).toBe('chat.free');
    expect(chatRouteForTier('premium')).toBe('chat.default');
    expect(checkDailyChatCap('free', 20)).toEqual({ allowed: false, limit: 20, remaining: 0 });
    expect(checkDailyChatCap('premium', 20).allowed).toBe(true);
  });
});
