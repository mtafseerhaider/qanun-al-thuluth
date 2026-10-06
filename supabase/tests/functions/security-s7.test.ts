// S7-03 structured security review: cross-cutting Edge Function controls.
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { z } from 'zod';

import { requireInternal, requireRevenueCat } from '../../functions/_shared/auth.ts';
import { HttpError } from '../../functions/_shared/errors.ts';
import {
  jsonHandler,
  MAX_JSON_BODY_BYTES,
  readBodyText,
  requestIdOf,
} from '../../functions/_shared/http.ts';
import { createReassessHandler } from '../../functions/ai-reassess/handler.ts';
import { createAnalyticsRollupHandler } from '../../functions/analytics-rollup/handler.ts';
import { createNotificationsDispatchHandler } from '../../functions/notifications-dispatch/handler.ts';
import { createPricesRefreshHandler } from '../../functions/prices-refresh/handler.ts';
import { createChatHandler, resetGlobalCostCache } from '../../functions/ai-chat/handler.ts';
import { chatDeps, memoryChatStore } from './chat-fixtures.ts';
import { HH, kicker, NOW, OWNER } from './plan-fixtures.ts';
import { memoryPlatform } from './platform-fixtures.ts';

// Built at runtime: fixture values, not credentials (keeps the secret scanner quiet).
const SECRET = 'fixture'.padEnd(24, '0');
const NEXT_SECRET = 'fixture-next'.padEnd(24, '1');
const WRONG_SECRET = 'fixture-wrong'.padEnd(24, '2');

/** A store that fails the test if a handler touches it before authenticating the caller. */
const untouchable = new Proxy(
  {},
  {
    get(_t, prop) {
      if (prop === 'then') return undefined;
      throw new Error(`store.${String(prop)} used before the caller was authenticated`);
    },
  },
) as never;

const echo = jsonHandler(z.object({ a: z.string().optional() }).passthrough(), async () => ({
  ok: true,
}));

Deno.test('S7-03 jsonHandler refuses bodies over 256 KB by declared length', async () => {
  const body = JSON.stringify({ a: 'x'.repeat(MAX_JSON_BODY_BYTES) });
  const res = await echo(
    new Request('http://local/fn', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }),
  );
  assertEquals(res.status, 413);
  assertEquals((await res.json()).error.code, 'PAYLOAD_TOO_LARGE');
});

Deno.test('S7-03 jsonHandler counts streamed (chunked) bodies without a length', async () => {
  const chunk = new TextEncoder().encode('x'.repeat(64 * 1024));
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent++ < 10) c.enqueue(chunk);
      else c.close();
    },
  });
  const res = await echo(new Request('http://local/fn', { method: 'POST', body: stream }));
  assertEquals(res.status, 413);
  // The reader stops early instead of buffering the whole upload.
  assert(sent <= 6, `read ${sent} chunks`);
});

Deno.test('S7-03 readBodyText keeps small bodies and multi-byte text intact', async () => {
  const text = JSON.stringify({ a: 'سلام' });
  assertEquals(
    await readBodyText(new Request('http://l', { method: 'POST', body: text }), 64),
    text,
  );
  await assertRejects(
    () => readBodyText(new Request('http://l', { method: 'POST', body: 'x'.repeat(65) }), 64),
    HttpError,
  );
});

Deno.test('S7-03 request ids from clients are echoed only when they are short tokens', () => {
  const ok = new Request('http://l', { headers: { 'x-request-id': 'abc-123_x.y:z' } });
  assertEquals(requestIdOf(ok), 'abc-123_x.y:z');
  for (const bad of ['a b', 'x'.repeat(65), '{"log":"inject"}', '']) {
    const id = requestIdOf(new Request('http://l', { headers: { 'x-request-id': bad } }));
    assert(/^[0-9a-f-]{36}$/.test(id), `replaced ${JSON.stringify(bad)}`);
  }
});

Deno.test('S7-03 requireInternal: refused without config, wrong or prefix secret', () => {
  const req = (s?: string) =>
    new Request('http://l', { headers: s === undefined ? {} : { 'x-internal-secret': s } });
  const none = () => [] as string[];
  const one = () => [SECRET];
  for (const [r, secrets] of [
    [req(SECRET), none],
    [req(), one],
    [req(''), one],
    [req(SECRET.slice(0, -1)), one],
    [req(SECRET + 'x'), one],
  ] as const) {
    try {
      requireInternal(r, secrets);
      throw new Error('accepted');
    } catch (err) {
      assert(err instanceof HttpError && err.code === 'UNAUTHENTICATED');
    }
  }
  requireInternal(req(SECRET), one);
  // Rotation: the next secret is accepted as well.
  requireInternal(req(NEXT_SECRET), () => [SECRET, NEXT_SECRET]);
});

Deno.test('S7-03 requireRevenueCat needs the exact bearer secret', () => {
  const req = (h?: string) =>
    new Request('http://l', { headers: h === undefined ? {} : { authorization: h } });
  const one = () => [SECRET];
  for (const h of [undefined, SECRET, `Bearer ${SECRET}x`, `bearer ${SECRET}`, 'Bearer ']) {
    try {
      requireRevenueCat(req(h), one);
      throw new Error('accepted');
    } catch (err) {
      assert(err instanceof HttpError && err.code === 'WEBHOOK_UNAUTHORIZED', String(h));
    }
  }
  requireRevenueCat(req(`Bearer ${SECRET}`), one);
});

Deno.test('S7-03 internal (cron) functions refuse callers without the secret', async () => {
  const handlers: Array<[string, (r: Request) => Promise<Response>]> = [
    [
      'analytics-rollup',
      createAnalyticsRollupHandler({ secrets: () => [SECRET], store: untouchable }),
    ],
    ['prices-refresh', createPricesRefreshHandler({ secrets: () => [SECRET], store: untouchable })],
    [
      'notifications-dispatch',
      createNotificationsDispatchHandler({
        secrets: () => [SECRET],
        store: untouchable,
        push: untouchable,
      }),
    ],
    ['ai-reassess', createReassessHandler({ secrets: () => [SECRET], store: untouchable })],
  ];
  for (const [name, handler] of handlers) {
    const variants: Record<string, string>[] = [{}, { 'x-internal-secret': WRONG_SECRET }];
    for (const headers of variants) {
      const res = await handler(
        new Request(`http://local/${name}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: '{}',
        }),
      );
      assertEquals(res.status, 401, name);
      assertEquals((await res.json()).error.code, 'UNAUTHENTICATED', name);
    }
  }
});

function chatSetup() {
  resetGlobalCostCache();
  const mem = memoryChatStore({});
  const plat = memoryPlatform({ roles: { [OWNER]: 'owner' } });
  plat.state.userPremium = true;
  const ai = chatDeps();
  return createChatHandler({
    verify: async (jwt) => (jwt === 'owner' ? { sub: OWNER } : null),
    platform: plat.platform,
    entitlements: plat.entitlements,
    store: mem.store,
    fallback: ai.fallback,
    writeUsage: ai.writeUsage,
    kick: kicker().kick,
    now: () => NOW,
  });
}

Deno.test('S7-03 ai-chat photos must sit under the caller own session prefix', async () => {
  const handler = chatSetup();
  const OTHER_SESSION = '00000000-0000-4000-8000-0000000000aa';
  const MY_SESSION = '00000000-0000-4000-8000-0000000000bb';
  const cases: Array<[string | null, string]> = [
    // Another member's private session in the same household.
    [null, `${HH}/${OTHER_SESSION}/x.jpg`],
    [MY_SESSION, `${HH}/${OTHER_SESSION}/x.jpg`],
    // Path segments that climb out of the session prefix.
    [MY_SESSION, `${HH}/${MY_SESSION}/../${OTHER_SESSION}/x.jpg`],
  ];
  let n = 0;
  for (const [session, path] of cases) {
    const res = await handler(
      new Request('http://local/ai-chat', {
        method: 'POST',
        headers: { authorization: 'Bearer owner', 'content-type': 'application/json' },
        body: JSON.stringify({
          session_id: session,
          household_id: HH,
          client_message_id: `00000000-0000-4000-9999-7700000000${String(++n).padStart(2, '0')}`,
          message: {
            text: 'What is this?',
            attachments: [{ kind: 'image', storage_path: path, mime: 'image/jpeg' }],
          },
        }),
      }),
    );
    assertEquals(res.status, 400, path);
    assertEquals((await res.json()).error.code, 'VALIDATION_FAILED', path);
  }
});
