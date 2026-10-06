import { assert, assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1';
import type { HouseholdRole } from '@thuluth/shared';
import { ExportPdfAccepted, ExportPdfReady } from '@thuluth/shared/contracts/export-pdf.ts';

import { createExportPdfHandler } from '../../functions/export-pdf/handler.ts';
import type { ExportPdfDeps } from '../../functions/export-pdf/handler.ts';
import {
  countPdfPages,
  gotenbergRenderer,
  RendererError,
  rendererFromEnv,
} from '../../functions/export-pdf/renderer.ts';
import type { PdfRenderer, RenderOptions } from '../../functions/export-pdf/renderer.ts';
import type { ExportRow, ExportStorage, ExportStore } from '../../functions/export-pdf/store.ts';
import type { NotificationRow } from '../../functions/_shared/notifications/templates.ts';

const HH = '00000000-0000-4000-b000-000000000001';
const OWNER = '00000000-0000-4000-a000-000000000001';
const VIEWER = '00000000-0000-4000-a000-000000000003';
const STRANGER = '00000000-0000-4000-a000-000000000004';
const PLAN = '00000000-0000-4000-e000-000000000001';
const LIST = '00000000-0000-4000-e000-000000000002';
const CHILD = '00000000-0000-4000-c000-000000000001';
const KID2 = '00000000-0000-4000-c000-000000000002';
const SECRET = 'cron-secret-for-tests';
const NOW = new Date('2026-10-06T08:00:00Z');
const FAKE_PDF = new TextEncoder().encode(
  '%PDF-1.7\n1 0 obj <</Type /Pages>> 2 0 obj <</Type /Page>> 3 0 obj <</Type /Page>>',
);

function fakeRenderer(opts: { fail?: boolean; delayMs?: number } = {}) {
  const calls: Array<{ html: string; opts: RenderOptions }> = [];
  const renderer: PdfRenderer = {
    async render(html, o) {
      calls.push({ html, opts: o });
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (opts.fail) throw new RendererError('renderer returned 503', 503);
      return FAKE_PDF;
    },
  };
  return { renderer, calls };
}

function setup(
  o: {
    premium?: boolean;
    renderer?: PdfRenderer | null;
    roles?: Record<string, HouseholdRole>;
  } = {},
) {
  const roles = o.roles ?? { [OWNER]: 'owner', [VIEWER]: 'viewer' };
  const state = {
    exports: [] as Array<ExportRow & { error?: string | null }>,
    objects: new Map<string, Uint8Array>(),
    idem: new Map<
      string,
      { id: string; hash: string; status?: number; body?: unknown; done: boolean }
    >(),
    notifications: [] as NotificationRow[],
    audits: [] as string[],
    analytics: [] as string[],
    kicked: [] as Promise<unknown>[],
  };
  let seq = 0;
  const store: ExportStore = {
    membership: async (h, u) => (h === HH ? (roles[u] ?? null) : null),
    featureEnabled: async () => true,
    consumeRateLimit: async () => ({ allowed: true, remaining: 4, reset_at: 'x' }),
    idempotencyBegin: async (_s, user, key, hash) => {
      const row = state.idem.get(`${user}:${key}`);
      if (!row) {
        const id = crypto.randomUUID();
        state.idem.set(`${user}:${key}`, { id, hash, done: false });
        return { state: 'new', id };
      }
      if (row.hash !== hash) return { state: 'mismatch' };
      if (!row.done) return { state: 'in_progress' };
      return { state: 'replay', status: row.status ?? 200, body: row.body };
    },
    idempotencyComplete: async (id, status, body) => {
      for (const r of state.idem.values())
        if (r.id === id) Object.assign(r, { status, body, done: true });
    },
    idempotencyFail: async (id) => {
      for (const [k, r] of state.idem) if (r.id === id) state.idem.delete(k);
    },
    audit: async (e) => {
      state.audits.push(`${e.action}:${e.entity}`);
    },
    householdName: async () => 'Khan <Family>',
    mealPlan: async (h, id, week) =>
      h === HH && id === PLAN
        ? {
            title: 'October plan',
            startDate: week === 1 ? '2026-10-12' : '2026-10-05',
            endDate: week === 1 ? '2026-10-18' : '2026-10-11',
            members: [
              { id: CHILD, name: 'Ibrahim' },
              { id: KID2, name: 'Maryam' },
            ],
            meals: [
              {
                plan_date: '2026-10-05',
                meal_type: 'breakfast',
                slot: 0,
                scheduled_time: '08:00:00',
                title: 'Aloo paratha',
                notes: '<img src=http://attacker.example/x>',
                servings: [
                  { family_member_id: CHILD, adaptation: 'deconstructed' },
                  { family_member_id: KID2, adaptation: 'none' },
                ],
              },
            ],
          }
        : null,
    groceryList: async (h, id) =>
      h === HH && id === LIST
        ? {
            startsOn: '2026-10-05',
            endsOn: '2026-10-11',
            currency: 'PKR',
            estimatedTotalMinor: 1250000,
            items: [
              {
                label: 'Guava',
                quantity: 1,
                unit: 'kg',
                aisle: 'fruit',
                category: 'fruit',
                estimated_minor: 30000,
                is_fresh: true,
                sort_order: 1,
              },
              {
                label: 'Masoor dal',
                quantity: 0.5,
                unit: 'kg',
                aisle: 'dry_goods',
                category: 'pulses',
                estimated_minor: null,
                is_fresh: false,
                sort_order: 2,
              },
            ],
          }
        : null,
    growth: async (h, m) =>
      h === HH && m === CHILD
        ? {
            memberName: 'Ibrahim',
            dateOfBirth: '2017-03-20',
            reference: 'who_2007',
            rows: [
              {
                measured_on: '2026-09-01',
                age_months: 113.4,
                height_cm: 136.2,
                weight_kg: 29.1,
                bmi: 15.7,
                height_for_age_z: 0.21,
                weight_for_age_z: -0.35,
                bmi_for_age_z: -0.48,
                height_for_age_percentile: 58.3,
                weight_for_age_percentile: 36.3,
                bmi_for_age_percentile: 31.6,
                flags: ['red_flag.crossed_two_major_percentiles'],
              },
            ],
          }
        : null,
    insertExport: async (row) => {
      seq += 1;
      const id = `00000000-0000-4000-f000-${String(seq).padStart(12, '0')}`;
      state.exports.push({
        id,
        household_id: row.household_id,
        user_id: row.user_id,
        kind: row.kind,
        status: 'processing',
        storage_path: null,
        expires_at: new Date(NOW.getTime() + 7 * 86_400_000).toISOString(),
        created_at: NOW.toISOString(),
        params: row.params,
      });
      return id;
    },
    updateExport: async (id, patch) => {
      Object.assign(
        state.exports.find((e) => e.id === id)!,
        patch,
      );
    },
    exportRow: async (id) => state.exports.find((e) => e.id === id) ?? null,
    expiredExports: async (now) =>
      state.exports.filter((e) => e.status === 'ready' && e.expires_at < now),
    failStale: async (before) => {
      let n = 0;
      for (const e of state.exports)
        if (e.status === 'processing' && e.created_at < before) {
          e.status = 'failed';
          n++;
        }
      return n;
    },
    analytics: async (_u, event) => {
      state.analytics.push(event);
    },
    notify: async (rows) => {
      state.notifications.push(...rows);
    },
  };
  const storage: ExportStorage = {
    upload: async (path, bytes) => {
      state.objects.set(path, bytes);
    },
    signedUrl: async (path, ttl) =>
      `https://api.thuluth.test/storage/v1/object/sign/exports/${path}?token=t&ttl=${ttl}`,
    remove: async (paths) => {
      for (const p of paths) state.objects.delete(p);
    },
  };
  const fr = fakeRenderer();
  const deps: ExportPdfDeps = {
    verify: async (jwt) => ({ sub: jwt }),
    secrets: () => [SECRET],
    store,
    storage,
    entitlements: {
      userPremium: async () => false,
      householdPremium: async () => o.premium ?? true,
      householdReadOnly: async () => false,
    },
    renderer: o.renderer === undefined ? fr.renderer : o.renderer,
    kick: (run) => {
      state.kicked.push(run());
    },
    now: () => NOW,
  };
  return { deps, state, calls: fr.calls, handler: createExportPdfHandler(deps) };
}

const post = (
  handler: (r: Request) => Promise<Response>,
  body: unknown,
  opts: { user?: string; key?: string } = {},
) =>
  handler(
    new Request('http://localhost/export-pdf', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${opts.user ?? OWNER}`,
        'idempotency-key': opts.key ?? crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    }),
  );

const mealPlan = (over: Record<string, unknown> = {}) => ({
  household_id: HH,
  locale: 'en',
  params: { kind: 'meal_plan', meal_plan_id: PLAN, week_index: 0 },
  ...over,
});

Deno.test('export-pdf: meal plan renders, uploads and returns a 24 h signed URL', async () => {
  const { handler, state, calls } = setup();
  const res = await post(handler, mealPlan());
  assertEquals(res.status, 200);
  const body = ExportPdfReady.parse(await res.json());
  assertEquals(body.pages, 2);
  assertEquals(body.expires_at, '2026-10-07T08:00:00.000Z');
  assertStringIncludes(body.url, `exports/${HH}/${body.export_id}.pdf`);
  assertStringIncludes(body.url, 'ttl=86400');
  const row = state.exports[0]!;
  assertEquals(row.status, 'ready');
  assertEquals(row.storage_path, `${HH}/${body.export_id}.pdf`);
  assertEquals(row.expires_at, '2026-10-13T08:00:00.000Z');
  assert(state.objects.has(`${HH}/${body.export_id}.pdf`));
  const html = calls[0]!.html;
  assertStringIncludes(html, '<html lang="en" dir="ltr">');
  assertStringIncludes(html, 'Aloo paratha');
  assertStringIncludes(html, '@page { size: A4');
  // AC-E7: injected markup is escaped; AC-E4: no kcal or z-scores in a meal plan.
  assert(!html.includes('<img'));
  assertStringIncludes(html, '&lt;img src=http://attacker.example/x&gt;');
  assertStringIncludes(html, 'Khan &lt;Family&gt;');
  assert(!/kcal|z-score|percentile/i.test(html));
  assertEquals(calls[0]!.opts.paper, 'A4');
  assertEquals(state.audits, ['export:exports']);
  assertEquals(state.analytics, ['export_created']);
});

Deno.test('export-pdf: Urdu is RTL with Nastaliq, Letter paper is passed through', async () => {
  const { handler, calls } = setup();
  const res = await post(handler, mealPlan({ locale: 'ur', paper: 'Letter' }));
  assertEquals(res.status, 200);
  const html = calls[0]!.html;
  assertStringIncludes(html, '<html lang="ur" dir="rtl">');
  assertStringIncludes(html, "'Noto Nastaliq Urdu'");
  assertStringIncludes(html, '@page { size: letter');
  assertStringIncludes(html, '<bdi>Aloo paratha</bdi>');
  assertEquals(calls[0]!.opts.paper, 'Letter');
});

Deno.test('export-pdf: grocery list and growth report templates', async () => {
  const { handler, calls } = setup();
  assertEquals(
    (
      await post(handler, {
        household_id: HH,
        locale: 'en',
        params: { kind: 'grocery_list', grocery_list_id: LIST },
      })
    ).status,
    200,
  );
  const grocery = calls[0]!.html;
  assert(grocery.indexOf('Fruit') < grocery.indexOf('Dry goods'));
  assertStringIncludes(grocery, '1 items have no price estimate yet.');
  const res = await post(handler, {
    household_id: HH,
    locale: 'en',
    params: { kind: 'growth_report', family_member_id: CHILD },
  });
  assertEquals(res.status, 200);
  const growth = calls[1]!.html;
  assertStringIncludes(growth, 'Screening information, not a diagnosis.');
  assertStringIncludes(growth, 'WHO Growth Reference 2007');
  assertStringIncludes(growth, '0.21 / 58.3');
  assertStringIncludes(growth, 'Crossed two major percentile lines downward');
  assertStringIncludes(growth, '<svg dir="ltr"');
  assertStringIncludes(growth, 'Questions for the paediatrician');
});

Deno.test('export-pdf: gating, kinds, membership and configuration', async () => {
  const code = async (r: Promise<Response>) => (await (await r).json()).error;
  const free = setup({ premium: false });
  assertEquals((await code(post(free.handler, mealPlan()))).code, 'PREMIUM_REQUIRED');
  assertEquals(free.state.exports.length, 0); // AC-E2: no row left behind
  const off = setup({ renderer: null });
  const err = await code(post(off.handler, mealPlan()));
  assertEquals(err.code, 'FEATURE_DISABLED');
  assertEquals(err.details.reason, 'renderer_not_configured');
  const { handler } = setup();
  assertEquals(
    (
      await code(
        post(handler, { household_id: HH, locale: 'en', params: { kind: 'family_summary' } }),
      )
    ).code,
    'EXPORT_KIND_UNSUPPORTED',
  );
  assertEquals((await code(post(handler, mealPlan(), { user: STRANGER }))).code, 'NOT_FOUND');
  assertEquals(
    (await code(post(handler, mealPlan({ params: { kind: 'meal_plan', meal_plan_id: LIST } }))))
      .code,
    'NOT_FOUND',
  );
  const nokey = await handler(
    new Request('http://localhost/export-pdf', {
      method: 'POST',
      headers: { authorization: `Bearer ${OWNER}` },
      body: JSON.stringify(mealPlan()),
    }),
  );
  assertEquals((await nokey.json()).error.code, 'VALIDATION_FAILED');
  // Viewers may export what they can read.
  assertEquals((await post(handler, mealPlan(), { user: VIEWER })).status, 200);
});

Deno.test('export-pdf: same Idempotency-Key replays the stored response', async () => {
  const { handler, calls } = setup();
  const a = await (await post(handler, mealPlan(), { key: 'key-0001-abcdef' })).json();
  const res = await post(handler, mealPlan(), { key: 'key-0001-abcdef' });
  assertEquals(res.headers.get('idempotent-replayed'), 'true');
  assertEquals(await res.json(), a);
  assertEquals(calls.length, 1);
  const reused = await post(handler, mealPlan({ locale: 'ur' }), { key: 'key-0001-abcdef' });
  assertEquals((await reused.json()).error.code, 'IDEMPOTENCY_KEY_REUSED');
});

Deno.test('export-pdf: renderer failure marks the export failed', async () => {
  const { handler, state } = setup({ renderer: fakeRenderer({ fail: true }).renderer });
  const res = await post(handler, mealPlan());
  assertEquals(res.status, 503);
  assertEquals((await res.json()).error.code, 'UPSTREAM_UNAVAILABLE');
  assertEquals(state.exports[0]!.status, 'failed');
  assertEquals(state.idem.size, 0);
});

Deno.test('export-pdf: slow render answers 202 and finishes in the background', async () => {
  const s = setup({ renderer: fakeRenderer({ delayMs: 30 }).renderer });
  const handler = createExportPdfHandler({ ...s.deps, softDeadlineMs: 5 });
  const res = await post(handler, mealPlan());
  assertEquals(res.status, 202);
  const body = ExportPdfAccepted.parse(await res.json());
  assertEquals(body.realtime.filter, `id=eq.${body.export_id}`);
  await Promise.all(s.state.kicked);
  assertEquals(s.state.exports[0]!.status, 'ready');
  assertEquals(s.state.notifications[0]!.kind, 'export_ready');
  // Polling returns the ready export with a fresh URL.
  const poll = await handler(
    new Request(`http://localhost/export-pdf?export_id=${body.export_id}`, {
      headers: { authorization: `Bearer ${VIEWER}` },
    }),
  );
  const ready = ExportPdfReady.parse(await poll.json());
  assertEquals(ready.pages, 2);
  const stranger = await handler(
    new Request(`http://localhost/export-pdf?export_id=${body.export_id}`, {
      headers: { authorization: `Bearer ${STRANGER}` },
    }),
  );
  assertEquals((await stranger.json()).error.code, 'NOT_FOUND'); // AC-E5
});

Deno.test('export-pdf: internal purge removes expired objects', async () => {
  const s = setup();
  const body = ExportPdfReady.parse(await (await post(s.handler, mealPlan())).json());
  const later = createExportPdfHandler({ ...s.deps, now: () => new Date('2026-10-14T00:00:00Z') });
  const call = (secret: string) =>
    later(
      new Request('http://localhost/export-pdf', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-secret': secret },
        body: JSON.stringify({ action: 'purge_expired' }),
      }),
    );
  assertEquals((await call('wrong-secret-value')).status, 401);
  const res = await call(SECRET);
  assertEquals(await res.json(), { expired: 1, objects_removed: 1, stale_failed: 0 });
  assertEquals(s.state.objects.size, 0);
  assertEquals(s.state.exports[0]!.status, 'expired');
  const poll = await later(
    new Request(`http://localhost/export-pdf?export_id=${body.export_id}`, {
      headers: { authorization: `Bearer ${OWNER}` },
    }),
  );
  assertEquals((await poll.json()).error.details.export_status, 'expired');
});

Deno.test('export-pdf: Gotenberg client sends the HTML form with basic auth', async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const r = gotenbergRenderer({
    url: 'https://pdf.example.run.app/',
    token: 'token-for-tests',
    fetch: (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(FAKE_PDF, {
        status: 200,
        headers: { 'content-type': 'application/pdf' },
      });
    }) as unknown as typeof fetch,
  });
  const pdf = await r.render('<p>x</p>', { paper: 'Letter', marginMm: 14, title: 'T', lang: 'en' });
  assertEquals(countPdfPages(pdf), 2);
  const s = seen as unknown as { url: string; init: RequestInit };
  assertEquals(s.url, 'https://pdf.example.run.app/forms/chromium/convert/html');
  assertEquals(
    (s.init.headers as Record<string, string>).authorization,
    `Basic ${btoa('thuluth:token-for-tests')}`,
  );
  const form = s.init.body as FormData;
  assertEquals(form.get('paperWidth'), '8.5');
  assertEquals(form.get('printBackground'), 'true');
  assert(form.get('files') instanceof Blob);
  const failing = gotenbergRenderer({
    url: 'https://pdf.example.run.app',
    token: 't',
    fetch: (async () => new Response('no', { status: 401 })) as unknown as typeof fetch,
  });
  await assertRejects(
    () => failing.render('x', { paper: 'A4', marginMm: 14, title: 'T', lang: 'en' }),
    RendererError,
  );
  Deno.env.delete('GOTENBERG_URL');
  assertEquals(rendererFromEnv(), null);
});
