import { assert, assertEquals } from 'jsr:@std/assert@1';
import { AIError, FakeProvider, RouteResolver } from '@thuluth/ai-core';
import type { AiUsageInsert } from '@thuluth/ai-core';

import { createTranscribeHandler } from '../../functions/ai-transcribe/handler.ts';
import { HH, OWNER, VIEWER } from './plan-fixtures.ts';
import { memoryPlatform } from './platform-fixtures.ts';

function setup(opts: { premium?: boolean; fail?: boolean; flags?: Record<string, boolean> } = {}) {
  const plat = memoryPlatform({
    roles: { [OWNER]: 'owner', [VIEWER]: 'viewer' },
    premium: opts.premium ?? true,
    flags: opts.flags ?? {},
  });
  const usage: AiUsageInsert[] = [];
  const provider = new FakeProvider({
    id: 'openai',
    transcript: (req) =>
      opts.fail
        ? new AIError('OVERLOADED', 'busy')
        : {
            text: ` Aaj Ahmed ne aadhi roti khayi ${req.prompt?.includes('roti') ? '' : 'x'}`,
            language: 'ur',
          },
  });
  const handler = createTranscribeHandler({
    verify: async (jwt) =>
      jwt === 'owner' ? { sub: OWNER } : jwt === 'viewer' ? { sub: VIEWER } : null,
    platform: plat.platform,
    entitlements: plat.entitlements,
    fallback: {
      resolver: new RouteResolver(async (key) =>
        key === 'speech.transcribe'
          ? [
              {
                route_key: key,
                provider: 'openai',
                model: 'gpt-4o-transcribe',
                params: { pricePerMinuteUsd: 0.006 },
                priority: 1,
                enabled: true,
              },
            ]
          : [],
      ),
      providers: { openai: provider },
      sleep: async () => {},
    },
    writeUsage: async (row) => {
      usage.push(row);
    },
  });
  return { handler, usage, provider, plat: plat.state };
}

function upload(
  opts: { meta?: unknown; type?: string; bytes?: number; jwt?: string; noAudio?: boolean } = {},
): Request {
  const form = new FormData();
  form.set(
    'meta',
    JSON.stringify(opts.meta ?? { household_id: HH, language_hint: 'ur', duration_ms: 6400 }),
  );
  if (!opts.noAudio) {
    form.set(
      'audio',
      new File([new Uint8Array(opts.bytes ?? 2048)], 'note.m4a', {
        type: opts.type ?? 'audio/m4a',
      }),
    );
  }
  return new Request('http://local/ai-transcribe', {
    method: 'POST',
    headers: { authorization: `Bearer ${opts.jwt ?? 'owner'}` },
    body: form,
  });
}

Deno.test('ai-transcribe returns the transcript and meters seconds', async () => {
  const t = setup();
  const res = await t.handler(upload());
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    text: 'Aaj Ahmed ne aadhi roti khayi',
    language: 'ur',
    duration_ms: 6400,
  });
  assertEquals(t.usage.length, 1);
  assertEquals(t.usage[0]!.route_key, 'speech.transcribe');
  assertEquals(t.usage[0]!.tokens_in, 7);
  assert(t.usage[0]!.cost_usd_micros > 0);
  assertEquals(t.provider.transcribeCalls[0]!.req.languageHint, 'ur');
  assertEquals(res.headers.get('x-quota-limit'), '60');
});

Deno.test('ai-transcribe accepts the iOS m4a alias', async () => {
  const res = await setup().handler(upload({ type: 'audio/x-m4a' }));
  assertEquals(res.status, 200);
});

Deno.test('ai-transcribe limits and gates', async () => {
  let res = await setup().handler(upload({ bytes: 5 * 1024 * 1024 + 1 }));
  assertEquals(res.status, 413);
  res = await setup().handler(
    upload({ meta: { household_id: HH, language_hint: 'en', duration_ms: 121_000 } }),
  );
  assertEquals(res.status, 413);
  res = await setup().handler(upload({ type: 'audio/wav' }));
  assertEquals(res.status, 415);
  res = await setup().handler(upload({ noAudio: true }));
  assertEquals(res.status, 400);
  res = await setup().handler(upload({ meta: { household_id: 'x' } }));
  assertEquals(res.status, 400);
  res = await setup({ premium: false }).handler(upload());
  assertEquals(res.status, 402);
  res = await setup({ flags: { 'ai.voice.enabled': false } }).handler(upload());
  assertEquals((await res.json()).error.code, 'FEATURE_DISABLED');
  res = await setup().handler(upload({ jwt: 'stranger' }));
  assertEquals(res.status, 401);
  res = await setup().handler(
    new Request('http://local/ai-transcribe', {
      method: 'POST',
      headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
      body: '{}',
    }),
  );
  assertEquals(res.status, 415);
});

Deno.test('ai-transcribe provider failure maps to AI_UNAVAILABLE', async () => {
  const t = setup({ fail: true });
  const res = await t.handler(upload());
  assertEquals(res.status, 503);
  assertEquals((await res.json()).error.code, 'AI_UNAVAILABLE');
  assert(t.usage.some((u) => u.status === 'error'));
});

Deno.test('ai-transcribe burst limit', async () => {
  const t = setup();
  for (let i = 0; i < 10; i++) assertEquals((await t.handler(upload())).status, 200);
  const res = await t.handler(upload());
  assertEquals(res.status, 429);
});
