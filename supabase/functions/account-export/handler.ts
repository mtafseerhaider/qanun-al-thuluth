import {
  ACCOUNT_EXPORT_LINK_TTL_HOURS,
  AccountExportAccepted,
  AccountExportRequest,
} from '@thuluth/shared/contracts/account-export.ts';
import { ACCOUNT_DELETION_REAUTH_MAX_AGE_SEC } from '@thuluth/shared/contracts/account-delete.ts';

import { assertRecentAuth, requireUser } from '../_shared/auth.ts';
import type { ClaimsVerifier } from '../_shared/auth.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { sha256Hex } from '../_shared/crypto.ts';
import { consumeTierQuota } from '../_shared/entitlements.ts';
import { HttpError } from '../_shared/errors.ts';
import { jsonHandler } from '../_shared/http.ts';
import { emailLocale } from '../_shared/integrations/account-emails.ts';
import type { AccountEmailSender } from '../_shared/integrations/account-emails.ts';
import { notificationRow, routeFor } from '../_shared/notifications/templates.ts';
import type { StorageAdmin } from '../_shared/storage.ts';
import { zip } from '../_shared/zip.ts';
import type { ZipEntry } from '../_shared/zip.ts';
import { HOUSEHOLD_TABLES, isRedactedColumn } from './store.ts';
import type { AccountExportStore } from './store.ts';

export const SCOPE = 'account-export';
export const POLL_AFTER_MS = 5000;
/** The `exports` bucket accepts 25 MiB per object; photos are added while the bundle stays below this. */
export const MEDIA_BUDGET_BYTES = 20 * 1024 * 1024;

export interface PdfAttachment {
  name: string;
  bytes: Uint8Array;
}

export interface AccountExportDeps {
  verify: ClaimsVerifier;
  store: AccountExportStore;
  storage: StorageAdmin;
  /** Meal plan and growth report PDFs per household (`include_pdfs`); null when no renderer is configured. */
  pdfs: ((householdId: string, locale: 'en' | 'ur') => Promise<PdfAttachment[]>) | null;
  kick: (run: () => Promise<unknown>) => void;
  /** "Your data is ready" email (06 §4.12); no-op without POSTMARK_SERVER_TOKEN. */
  email?: AccountEmailSender;
  now?: () => Date;
}

export const accountExportPath = (userId: string, exportId: string) =>
  `account/${userId}/${exportId}.zip`;

const README = (at: string, missing: string[]) => `Thuluth data export
Generated: ${at}

user.json                     Your account and everything stored about you outside a household:
                              profile, memberships, consents, devices, notification settings,
                              notifications, chat sessions and messages, AI usage, subscriptions,
                              privacy requests, source reports and export history.
households/<id>/<table>.json  One file per table for each household you belong to, with the rows
                              you can see in the app (row-level security applies).
media/                        Your households' meal photos, while the bundle stays under 20 MB.
pdf/                          Current meal plan and growth report PDFs, when requested.

Omitted on purpose: encrypted note ciphertext (read your notes in the app), search vectors and
internal hashes. Dates are ISO 8601 in UTC; amounts are in minor units (paisa, cents).
${missing.length ? `\nNot included (size limit or not available):\n${missing.map((m) => `  ${m}`).join('\n')}\n` : ''}
Questions: privacy@thuluth.app
`;

/**
 * 06 §4.12 `account-export` (S6-10, FR-EXP-06, 16 §7.4). Free on every tier; needs a sign-in no older
 * than 300 s (11 §15.1, the same step-up as deletion); 2 per day. Answers 202 at once and builds a ZIP
 * in the background: user.json from `account_export_user_data`, household tables read with the
 * caller's JWT (RLS), meal photos within a size budget, optional PDFs. The ZIP goes to
 * `exports/account/{user_id}/{export_id}.zip`; the row turns `ready` with `expires_at` 24 h later and
 * an `export_ready` push is sent. The link is fetched with `GET export-pdf?export_id=` (24 h URL).
 */
export function createAccountExportHandler(deps: AccountExportDeps) {
  const now = deps.now ?? (() => new Date());
  const { store, storage } = deps;

  return jsonHandler(AccountExportRequest, async ({ req, input, requestId }) => {
    const user = await requireUser(req, deps.verify);
    assertRecentAuth(user, ACCOUNT_DELETION_REAUTH_MAX_AGE_SEC, now(), req);
    const key = req.headers.get('idempotency-key')?.trim() ?? '';
    if (key.length < 8 || key.length > 128)
      throw new HttpError('VALIDATION_FAILED', 'Idempotency-Key header is required.', {
        header: 'Idempotency-Key',
      });

    const mine = await store.memberships(user.userId);
    const households = input.household_ids ?? mine;
    const foreign = households.filter((h) => !mine.includes(h));
    if (foreign.length)
      throw new HttpError('NOT_FOUND', 'Household not found.', { household_ids: foreign });

    const quota = await consumeTierQuota(store, SCOPE, user.userId, 'free');
    const begin = await store.idempotencyBegin(
      SCOPE,
      user.userId,
      key,
      await sha256Hex(JSON.stringify(input)),
    );
    if (begin.state === 'replay')
      return Response.json(begin.body, {
        status: begin.status,
        headers: { ...corsHeaders, 'idempotent-replayed': 'true' },
      });
    if (begin.state === 'mismatch')
      throw new HttpError(
        'IDEMPOTENCY_KEY_REUSED',
        'This request key was used for a different request.',
      );
    if (begin.state === 'in_progress')
      throw new HttpError('IDEMPOTENCY_IN_PROGRESS', 'Your export is still being set up.', {
        retry_after_seconds: 2,
      });

    try {
      const exportId = await store.insertExport({
        user_id: user.userId,
        params: { include_pdfs: input.include_pdfs, household_ids: households },
      });
      const body = AccountExportAccepted.parse({
        status: 'accepted',
        export_id: exportId,
        export_status: 'processing',
        poll_after_ms: POLL_AFTER_MS,
        realtime: { schema: 'public', table: 'exports', filter: `id=eq.${exportId}` },
      });
      await store.idempotencyComplete(begin.id, 202, body);
      deps.kick(() =>
        build({
          userId: user.userId,
          jwt: user.jwt,
          exportId,
          households,
          includePdfs: input.include_pdfs,
          requestId,
        }),
      );
      return Response.json(body, { status: 202, headers: { ...corsHeaders, ...quota } });
    } catch (err) {
      await store.idempotencyFail(begin.id).catch(() => {});
      throw err;
    }
  });

  async function build(a: {
    userId: string;
    jwt: string;
    exportId: string;
    households: string[];
    includePdfs: boolean;
    requestId: string;
  }): Promise<void> {
    const enc = new TextEncoder();
    const json = (v: unknown) => enc.encode(JSON.stringify(v, null, 2));
    const entries: ZipEntry[] = [];
    const missing: string[] = [];
    try {
      const at = now();
      entries.push({ name: 'user.json', data: json(await store.userData(a.userId)) });
      const photoPaths: string[] = [];
      for (const hh of a.households) {
        for (const table of HOUSEHOLD_TABLES) {
          const rows = await store.householdRows(a.jwt, table, hh);
          if (rows === null) continue;
          const clean = rows.map((r) =>
            Object.fromEntries(Object.entries(r).filter(([k]) => !isRedactedColumn(k))),
          );
          entries.push({ name: `households/${hh}/${table}.json`, data: json(clean) });
          if (table === 'meal_logs')
            for (const r of rows)
              if (typeof r.photo_path === 'string' && r.photo_path) photoPaths.push(r.photo_path);
        }
      }
      let size = entries.reduce((n, e) => n + e.data.length, 0);
      if (a.includePdfs) {
        if (!deps.pdfs) missing.push('pdf/ (PDF service not configured)');
        else {
          const locale = (await store.userLocale(a.userId)) === 'ur' ? 'ur' : 'en';
          for (const hh of a.households) {
            for (const p of await deps.pdfs(hh, locale).catch(() => [] as PdfAttachment[])) {
              entries.push({ name: `pdf/${hh}/${p.name}`, data: p.bytes });
              size += p.bytes.length;
            }
          }
        }
      }
      for (const path of photoPaths) {
        if (size >= MEDIA_BUDGET_BYTES) {
          missing.push(`media/${path}`);
          continue;
        }
        const bytes = await storage.download('meal-photos', path).catch(() => null);
        if (!bytes) {
          missing.push(`media/${path}`);
          continue;
        }
        if (size + bytes.length > MEDIA_BUDGET_BYTES) {
          missing.push(`media/${path}`);
          continue;
        }
        entries.push({ name: `media/${path}`, data: bytes });
        size += bytes.length;
      }
      entries.unshift({ name: 'README.txt', data: enc.encode(README(at.toISOString(), missing)) });

      const bundle = await zip(entries, at);
      const path = accountExportPath(a.userId, a.exportId);
      await storage.upload('exports', path, bundle, 'application/zip');
      const expiresAt = new Date(
        now().getTime() + ACCOUNT_EXPORT_LINK_TTL_HOURS * 3600_000,
      ).toISOString();
      await store.updateExport(a.exportId, {
        status: 'ready',
        storage_path: path,
        expires_at: expiresAt,
        params: {
          include_pdfs: a.includePdfs,
          household_ids: a.households,
          files: entries.length,
          bytes: bundle.length,
        },
      });
      await store.audit(a.userId, a.exportId, {
        kind: 'account_data',
        files: entries.length,
        households: a.households.length,
      });
      await store.notify(
        notificationRow({
          key: 'export_ready.account',
          user_id: a.userId,
          household_id: null,
          locale: await store.userLocale(a.userId),
          scheduled_for: now(),
          dedupe_key: `export_ready:${a.exportId}`,
          route: routeFor('export_ready.account'),
          data: { export_id: a.exportId },
        }),
      );
      if (deps.email) {
        const contact = await store.contact(a.userId).catch(() => null);
        if (contact)
          await deps
            .email({
              kind: 'export_ready',
              to: contact.email,
              locale: emailLocale(contact.locale),
              ...(contact.timezone ? { timezone: contact.timezone } : {}),
              at: expiresAt,
            })
            .catch((err) =>
              console.warn(
                JSON.stringify({
                  level: 'warn',
                  scope: SCOPE,
                  request_id: a.requestId,
                  msg: 'email_failed',
                  error: String(err),
                }),
              ),
            );
      }
      console.log(
        JSON.stringify({
          level: 'info',
          scope: SCOPE,
          request_id: a.requestId,
          files: entries.length,
          bytes: bundle.length,
        }),
      );
    } catch (err) {
      await store
        .updateExport(a.exportId, { status: 'failed', error: 'bundle_failed' })
        .catch(() => {});
      console.error(
        JSON.stringify({
          level: 'error',
          scope: SCOPE,
          request_id: a.requestId,
          msg: 'bundle_failed',
          error: String(err),
        }),
      );
      throw err;
    }
  }
}
