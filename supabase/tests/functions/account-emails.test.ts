import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';

import {
  emailLocale,
  postmarkAccountEmailSender,
  renderAccountEmail,
} from '../../functions/_shared/integrations/account-emails.ts';
import type { AccountEmailKind } from '../../functions/_shared/integrations/account-emails.ts';

const KINDS: AccountEmailKind[] = [
  'deletion_requested',
  'deletion_cancelled',
  'deletion_completed',
  'export_ready',
];

Deno.test('account emails: every kind renders in en and ur without links or tokens', () => {
  for (const kind of KINDS)
    for (const locale of ['en', 'ur'] as const) {
      const r = renderAccountEmail({
        kind,
        to: 'u@example.com',
        locale,
        at: '2026-11-05T08:00:00.000Z',
        timezone: 'Asia/Karachi',
      });
      assert(r.subject.length > 10, `${kind}/${locale} subject`);
      assert(r.text.length > 40);
      assert(!/https?:\/\//.test(r.html), 'no links in the body');
      assertStringIncludes(r.html, locale === 'ur' ? 'dir="rtl"' : 'dir="ltr"');
    }
  const req = renderAccountEmail({
    kind: 'deletion_requested',
    to: 'u@example.com',
    locale: 'en',
    at: '2026-11-05T08:00:00.000Z',
    timezone: 'Asia/Karachi',
  });
  assertStringIncludes(req.text, '5 November 2026'); // date in the user's zone
  assertStringIncludes(req.text, '13:00');
  assertEquals(emailLocale('ur'), 'ur');
  assertEquals(emailLocale('ar'), 'en');
  assertEquals(emailLocale(null), 'en');
});

Deno.test('account emails: no-op without a token, Postmark /email with one', async () => {
  const unset = postmarkAccountEmailSender(undefined);
  assertEquals(await unset({ kind: 'export_ready', to: 'u@example.com', locale: 'en' }), {
    sent: false,
    reason: 'not_configured',
  });
  const seen: Array<{ url: string; body: Record<string, unknown>; token: string | null }> = [];
  const send = postmarkAccountEmailSender('pm-test-token', {
    fetchImpl: (async (url: string, init: RequestInit) => {
      seen.push({
        url,
        body: JSON.parse(String(init.body)),
        token: new Headers(init.headers).get('x-postmark-server-token'),
      });
      return new Response('{}', { status: 200 });
    }) as typeof fetch,
  });
  assertEquals(await send({ kind: 'deletion_cancelled', to: 'u@example.com', locale: 'ur' }), {
    sent: true,
  });
  assertEquals(seen[0]!.url, 'https://api.postmarkapp.com/email');
  assertEquals(seen[0]!.token, 'pm-test-token');
  assertEquals(seen[0]!.body.Tag, 'deletion_cancelled');
  assertEquals(seen[0]!.body.TrackLinks, 'None');
  assertEquals(await send({ kind: 'export_ready', to: '', locale: 'en' }), {
    sent: false,
    reason: 'no_address',
  });
});
