import { assertEquals } from 'jsr:@std/assert@1';
import { AIError, FakeProvider, RouteResolver } from '@thuluth/ai-core';
import type { AiModelRouteRow, AiUsageInsert } from '@thuluth/ai-core';

import { createSmokeHandler, SMOKE_DAILY_LIMIT } from '../../functions/ai-smoke/handler.ts';
import type { SmokeDeps } from '../../functions/ai-smoke/handler.ts';

const USER = '00000000-0000-4000-8000-0000000000aa';
const routes: AiModelRouteRow[] = [
  {
    route_key: 'chat.default',
    provider: 'anthropic',
    model: 'claude-sonnet-5-5',
    params: {},
    priority: 1,
    enabled: true,
  },
  {
    route_key: 'chat.default',
    provider: 'google',
    model: 'gemini-pro',
    params: {},
    priority: 2,
    enabled: true,
  },
];

function setup(
  overrides: Partial<SmokeDeps> = {},
  anthropic = new FakeProvider({ id: 'anthropic' }),
) {
  const usage: AiUsageInsert[] = [];
  const handler = createSmokeHandler({
    appEnv: 'development',
    verify: async (jwt) => (jwt === 'good' ? { sub: USER } : null),
    fallback: {
      resolver: new RouteResolver(async () => routes),
      providers: { anthropic, gemini: new FakeProvider({ id: 'gemini' }) },
      sleep: async () => {},
    },
    writeUsage: async (row) => {
      usage.push(row);
    },
    countTodayCalls: async () => 0,
    ...overrides,
  });
  return { handler, usage };
}

function post(body: unknown, jwt = 'good'): Request {
  return new Request('http://localhost/ai-smoke', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${jwt}`,
      'content-type': 'application/json',
      'x-request-id': 'req-1',
    },
    body: JSON.stringify(body),
  });
}

Deno.test('returns a reply and meters usage', async () => {
  const { handler, usage } = setup();
  const res = await handler(post({ prompt: 'Salaam' }));
  assertEquals(res.status, 200);
  const json = await res.json();
  assertEquals(json.reply, 'echo: Salaam');
  assertEquals(json.provider, 'anthropic');
  assertEquals(usage.length, 1);
  assertEquals(usage[0]?.user_id, USER);
  assertEquals(usage[0]?.status, 'ok');
  assertEquals(usage[0]?.request_id, 'req-1');
});

Deno.test('falls back and records the failed attempts', async () => {
  const { handler, usage } = setup(
    {},
    new FakeProvider({ id: 'anthropic', script: () => new AIError('AUTH', 'bad key') }),
  );
  const res = await handler(post({ prompt: 'Salaam' }));
  const json = await res.json();
  assertEquals(json.provider, 'gemini');
  assertEquals(
    usage.map((u) => `${u.provider}:${u.status}`),
    ['anthropic:error', 'google:fallback'],
  );
});

Deno.test('rejects missing auth with the error envelope', async () => {
  const { handler } = setup();
  const res = await handler(post({ prompt: 'Salaam' }, 'bad'));
  assertEquals(res.status, 401);
  const json = await res.json();
  assertEquals(json.error.code, 'UNAUTHENTICATED');
  assertEquals(json.error.details.request_id, 'req-1');
});

Deno.test('validates the body', async () => {
  const { handler } = setup();
  const res = await handler(post({ prompt: '' }));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, 'VALIDATION_FAILED');
});

Deno.test('is disabled in production', async () => {
  const { handler } = setup({ appEnv: 'production' });
  const res = await handler(post({ prompt: 'Salaam' }));
  assertEquals(res.status, 503);
});

Deno.test('enforces the daily cap', async () => {
  const { handler } = setup({ countTodayCalls: async () => SMOKE_DAILY_LIMIT });
  const res = await handler(post({ prompt: 'Salaam' }));
  assertEquals(res.status, 429);
  assertEquals((await res.json()).error.code, 'QUOTA_EXCEEDED');
});

Deno.test('returns AI_UNAVAILABLE when every route fails', async () => {
  const failing = new FakeProvider({ id: 'anthropic', script: () => new AIError('AUTH', 'x') });
  const { handler } = setup({
    fallback: {
      resolver: new RouteResolver(async () => routes.slice(0, 1)),
      providers: { anthropic: failing },
      sleep: async () => {},
    },
  });
  const res = await handler(post({ prompt: 'Salaam' }));
  assertEquals(res.status, 503);
  assertEquals((await res.json()).error.code, 'AI_UNAVAILABLE');
});
