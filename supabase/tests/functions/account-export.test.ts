import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { AccountExportAccepted } from '@thuluth/shared/contracts/account-export.ts';

import {
  accountExportPath,
  createAccountExportHandler,
} from '../../functions/account-export/handler.ts';
import type { AccountExportDeps } from '../../functions/account-export/handler.ts';
import type { AccountExportStore } from '../../functions/account-export/store.ts';
import type { AccountEmail } from '../../functions/_shared/integrations/account-emails.ts';
import type { NotificationRow } from '../../functions/_shared/notifications/templates.ts';
import type { StorageAdmin } from '../../functions/_shared/storage.ts';
import { crc32, unzip, zip } from '../../functions/_shared/zip.ts';

const USER = '00000000-0000-4000-a000-000000000001';
const HH = '00000000-0000-4000-b000-000000000001';
const OTHER_HH = '00000000-0000-4000-b000-000000000002';
const NOW = new Date('2026-10-06T08:00:00Z');
const nowSec = NOW.getTime() / 1000;

function setup(o: { pdfs?: AccountExportDeps['pdfs']; photoBytes?: number } = {}) {
  const state = {
    exports: new Map<string, Record<string, unknown>>(),
    uploads: new Map<string, Uint8Array>(),
    notifications: [] as NotificationRow[],
    jobs: [] as Promise<unknown>[],
    jwtSeen: [] as string[],
    audits: 0,
    emails: [] as AccountEmail[],
  };
  const store: AccountExportStore = {
    consumeRateLimit: async () => ({ allowed: true, remaining: 1, reset_at: 'x' }),
    idempotencyBegin: async () => ({ state: 'new', id: 'idem-1' }),
    idempotencyComplete: async () => {},
    idempotencyFail: async () => {},
    memberships: async () => [HH],
    insertExport: async (row) => {
      const id = '00000000-0000-4000-f000-000000000001';
      state.exports.set(id, { ...row, status: 'processing' });
      return id;
    },
    updateExport: async (id, patch) => {
      Object.assign(state.exports.get(id)!, patch);
    },
    userData: async () => ({ user: { id: USER, email: 'u@example.com' }, consents: [] }),
    householdRows: async (jwt, table, hh) => {
      state.jwtSeen.push(jwt);
      if (table === 'pantry_items') return null; // table absent: skipped
      if (table === 'meal_logs')
        return [{ id: 'm1', household_id: hh, photo_path: `${hh}/p/1.jpg` }];
      if (table === 'medical_conditions')
        return [
          { id: 'c1', household_id: hh, name: 'x', notes_enc: '\\x00', notes_key_version: 1 },
        ];
      return [{ id: `${table}-1`, household_id: hh }];
    },
    notify: async (row) => {
      state.notifications.push(row);
    },
    userLocale: async () => 'ur',
    contact: async () => ({ email: 'u@example.com', locale: 'ur', timezone: 'Asia/Karachi' }),
    audit: async () => {
      state.audits++;
    },
  };
  const storage: StorageAdmin = {
    listAll: async () => [],
    remove: async () => {},
    download: async () => new Uint8Array(o.photoBytes ?? 16).fill(7),
    upload: async (bucket, path, bytes) => {
      state.uploads.set(`${bucket}/${path}`, bytes);
    },
    signedUrl: async () => 'https://x.test',
  };
  const handler = createAccountExportHandler({
    verify: async (jwt) => ({
      sub: USER,
      amr: [{ method: 'otp', timestamp: nowSec - Number(jwt) }],
    }),
    store,
    storage,
    pdfs: o.pdfs ?? null,
    kick: (run) => {
      state.jobs.push(run());
    },
    email: async (e) => {
      state.emails.push(e);
      return { sent: true };
    },
    now: () => NOW,
  });
  return { handler, state };
}

const call = (h: (r: Request) => Promise<Response>, body: unknown, age = 30) =>
  h(
    new Request('http://localhost/account-export', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${age}`,
        'idempotency-key': crypto.randomUUID(),
      },
      body: JSON.stringify(body),
    }),
  );

Deno.test(
  'account-export: 202 then a ZIP with user.json, household tables and a README',
  async () => {
    const { handler, state } = setup();
    const res = await call(handler, {});
    assertEquals(res.status, 202);
    const body = AccountExportAccepted.parse(await res.json());
    assertEquals(body.realtime.table, 'exports');
    await Promise.all(state.jobs);
    const row = state.exports.get(body.export_id)!;
    assertEquals(row.status, 'ready');
    assertEquals(row.storage_path, accountExportPath(USER, body.export_id));
    assertEquals(row.expires_at, '2026-10-07T08:00:00.000Z'); // 24 h link
    const files = await unzip(state.uploads.get(`exports/account/${USER}/${body.export_id}.zip`)!);
    const names = files.map((f) => f.name);
    assert(names.includes('README.txt'));
    assert(names.includes('user.json'));
    assert(names.includes(`households/${HH}/growth_tracking.json`));
    assert(!names.includes(`households/${HH}/pantry_items.json`));
    assert(names.includes(`media/${HH}/p/1.jpg`));
    const cond = JSON.parse(
      new TextDecoder().decode(files.find((f) => f.name.endsWith('medical_conditions.json'))!.data),
    );
    assertEquals(cond, [{ id: 'c1', household_id: HH, name: 'x' }]); // ciphertext never exported
    assertStringIncludes(new TextDecoder().decode(files[0]!.data), 'Thuluth data export');
    assertStringIncludes(
      new TextDecoder().decode(files[0]!.data),
      'pdf/ (PDF service not configured)',
    );
    // Household tables are read with the caller's own JWT (RLS).
    assert(state.jwtSeen.every((j) => j === '30'));
    assertEquals(state.notifications[0]!.kind, 'export_ready');
    assertEquals(state.audits, 1);
    // "Your data is ready" email in the user's locale, with the expiry and no link (06 §4.12).
    assertEquals(state.emails, [
      {
        kind: 'export_ready',
        to: 'u@example.com',
        locale: 'ur',
        timezone: 'Asia/Karachi',
        at: '2026-10-07T08:00:00.000Z',
      },
    ]);
  },
);

Deno.test(
  'account-export: PDFs are added when a renderer is configured; photos respect the budget',
  async () => {
    const { handler, state } = setup({
      pdfs: async (hh) => [
        { name: 'meal-plan.pdf', bytes: new TextEncoder().encode(`%PDF ${hh}`) },
      ],
      photoBytes: 21 * 1024 * 1024,
    });
    const body = AccountExportAccepted.parse(
      await (await call(handler, { include_pdfs: true })).json(),
    );
    await Promise.all(state.jobs);
    const files = await unzip(state.uploads.get(`exports/account/${USER}/${body.export_id}.zip`)!);
    assert(files.some((f) => f.name === `pdf/${HH}/meal-plan.pdf`));
    assert(!files.some((f) => f.name.startsWith('media/')));
    assertStringIncludes(new TextDecoder().decode(files[0]!.data), `media/${HH}/p/1.jpg`);
  },
);

Deno.test("account-export: needs a recent sign-in and only the caller's households", async () => {
  const { handler } = setup();
  const stale = await call(handler, {}, 400);
  const staleBody = await stale.json();
  assertEquals(stale.status, 401);
  assertEquals(staleBody.error.code, 'UNAUTHENTICATED'); // older clients: no capability header
  assertEquals(staleBody.error.details.reauth, true);
  const capable = await handler(
    new Request('http://localhost/account-export', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer 400',
        'idempotency-key': crypto.randomUUID(),
        'x-thuluth-client-caps': 'other, reauth_required',
      },
      body: '{}',
    }),
  );
  const capableBody = await capable.json();
  assertEquals(capable.status, 401);
  assertEquals(capableBody.error.code, 'REAUTH_REQUIRED');
  assertEquals(capableBody.error.details.reauth, true);
  const foreign = await call(handler, { household_ids: [OTHER_HH] });
  assertEquals((await foreign.json()).error.code, 'NOT_FOUND');
});

Deno.test('zip: round trip, stored and deflated entries, CRC32', async () => {
  assertEquals(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const text = new TextEncoder().encode('ثلث '.repeat(500));
  const random = crypto.getRandomValues(new Uint8Array(256));
  const out = await zip([
    { name: 'a/ثلث.txt', data: text },
    { name: 'b.bin', data: random },
    { name: 'empty', data: new Uint8Array() },
  ]);
  assert(out.length < text.length);
  const files = await unzip(out);
  assertEquals(
    files.map((f) => f.name),
    ['a/ثلث.txt', 'b.bin', 'empty'],
  );
  assertEquals(files[0]!.data, text);
  assertEquals(files[1]!.data, random);
  assertEquals(files[2]!.data.length, 0);
});
