import { z } from 'zod';
import {
  EXPORT_OBJECT_TTL_DAYS,
  EXPORT_PDF_MVP_KINDS,
  EXPORT_SIGNED_URL_TTL_SECONDS,
  ExportPdfAccepted,
  ExportPdfReady,
  ExportPdfRequest,
} from '@thuluth/shared/contracts/export-pdf.ts';
import type { ExportPaper } from '@thuluth/shared/contracts/export-pdf.ts';

import { requireInternal, requireUser } from '../_shared/auth.ts';
import type { ClaimsVerifier, InternalSecrets } from '../_shared/auth.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { sha256Hex } from '../_shared/crypto.ts';
import { consumeTierQuota, requirePremium, resolveEntitlement } from '../_shared/entitlements.ts';
import type { EntitlementStore } from '../_shared/entitlements.ts';
import { errorResponse, HttpError } from '../_shared/errors.ts';
import { jsonHandler, requestIdOf } from '../_shared/http.ts';
import { notificationRow, routeFor } from '../_shared/notifications/templates.ts';
import { countPdfPages, RendererError } from './renderer.ts';
import type { PdfRenderer } from './renderer.ts';
import type { ExportRow, ExportStorage, ExportStore } from './store.ts';
import { groceryHtml, growthReportHtml, mealPlanHtml } from './templates.ts';
import type { ExportLocale } from './i18n.ts';

export const SCOPE = 'export-pdf';
/** 06 §2.8: switch to 202 after the 20 s soft deadline. */
export const SOFT_DEADLINE_MS = 20_000;
export const POLL_AFTER_MS = 3000;
/** A `processing` row older than this was abandoned (function wall clock is far shorter). */
export const STALE_PROCESSING_MS = 30 * 60_000;

export interface ExportPdfDeps {
  verify: ClaimsVerifier;
  secrets: InternalSecrets;
  store: ExportStore;
  storage: ExportStorage;
  entitlements: EntitlementStore;
  /** Null when GOTENBERG_URL / GOTENBERG_TOKEN are unset. */
  renderer: PdfRenderer | null;
  /** Keeps a render running after a 202 (index.ts: `EdgeRuntime.waitUntil`). */
  kick: (run: () => Promise<unknown>) => void;
  now?: () => Date;
  softDeadlineMs?: number;
}

const PurgeRequest = z.object({
  action: z.literal('purge_expired'),
  limit: z.number().int().min(1).max(1000).default(500),
});

/** Storage path (10 §6.2): `{household_id}/{export_id}.pdf`. */
export const exportPath = (householdId: string, exportId: string) =>
  `${householdId}/${exportId}.pdf`;

/**
 * 06 §4.10 `export-pdf` (S6-08, FR-EXP-01 to -04). Premium. Routes:
 * - `POST` (user): renders meal_plan, grocery_list or growth_report HTML (en or ur, RTL for ur, A4
 *   or Letter) through the private Gotenberg service, stores `{household_id}/{export_id}.pdf` in the
 *   private `exports` bucket and returns a 24 h signed URL; after the soft deadline it answers 202
 *   and finishes in the background (`exports` row on Realtime, `export_ready` push).
 * - `GET ?export_id=` (user, any member of the export's household): status, or a fresh 24 h URL.
 * - `POST {"action":"purge_expired"}` with `x-internal-secret` (cron `exports-purge-expired`):
 *   deletes expired objects through the Storage API and marks rows `expired` (18 §6, AC-E6).
 */
export function createExportPdfHandler(deps: ExportPdfDeps) {
  const now = deps.now ?? (() => new Date());
  const softDeadline = deps.softDeadlineMs ?? SOFT_DEADLINE_MS;
  const { store, storage } = deps;

  const post = jsonHandler(ExportPdfRequest, async ({ req, input, requestId }) => {
    const user = await requireUser(req, deps.verify);
    const key = req.headers.get('idempotency-key')?.trim() ?? '';
    if (key.length < 8 || key.length > 128)
      throw new HttpError('VALIDATION_FAILED', 'Idempotency-Key header is required.', {
        header: 'Idempotency-Key',
      });
    const role = await store.membership(input.household_id, user.userId);
    if (!role) throw new HttpError('NOT_FOUND', 'Household not found.');
    const kind = input.params.kind;
    if (!(EXPORT_PDF_MVP_KINDS as readonly string[]).includes(kind))
      throw new HttpError('EXPORT_KIND_UNSUPPORTED', 'This export is not available yet.', { kind });
    const ent = await resolveEntitlement(deps.entitlements, {
      userId: user.userId,
      householdId: input.household_id,
      scope: 'household',
    });
    requirePremium(ent, 'export.pdf', 'PDF exports need Premium.');
    if (!(await store.featureEnabled('exports.pdf.enabled')))
      throw new HttpError('FEATURE_DISABLED', 'PDF exports are paused right now.', {
        flag: 'exports.pdf.enabled',
      });
    if (!deps.renderer)
      throw new HttpError('FEATURE_DISABLED', 'PDF exports are not available yet.', {
        reason: 'renderer_not_configured',
      });
    const renderer = deps.renderer;
    const quota = await consumeTierQuota(store, SCOPE, user.userId, ent.tier);

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
      throw new HttpError('IDEMPOTENCY_IN_PROGRESS', 'This export is still being prepared.', {
        retry_after_seconds: 2,
      });

    let exportId: string | null = null;
    try {
      const locale = input.locale as ExportLocale;
      const today = now().toISOString().slice(0, 10);
      const householdName = (await store.householdName(input.household_id)) ?? '';
      const p = input.params;
      let html: string;
      let title: string;
      if (p.kind === 'meal_plan') {
        const data = await store.mealPlan(input.household_id, p.meal_plan_id, p.week_index, locale);
        if (!data) throw new HttpError('NOT_FOUND', 'Meal plan not found.');
        html = mealPlanHtml(
          {
            ...data,
            householdName,
            includeRecipes: p.include_recipes,
            includeSources: p.include_sources,
          },
          locale,
          input.paper,
          today,
        );
        title = data.title ?? 'Meal plan';
      } else if (p.kind === 'grocery_list') {
        const data = await store.groceryList(input.household_id, p.grocery_list_id);
        if (!data) throw new HttpError('NOT_FOUND', 'Grocery list not found.');
        html = groceryHtml(
          { ...data, householdName, groupBy: p.group_by },
          locale,
          input.paper,
          today,
        );
        title = 'Grocery list';
      } else if (p.kind === 'growth_report') {
        const data = await store.growth(input.household_id, p.family_member_id);
        if (!data) throw new HttpError('NOT_FOUND', 'Family member not found.');
        html = growthReportHtml(
          { ...data, householdName, includeNotesForClinician: p.include_notes_for_clinician },
          locale,
          input.paper,
          today,
        );
        title = 'Growth report';
      } else {
        throw new HttpError('EXPORT_KIND_UNSUPPORTED', 'This export is not available yet.', {
          kind,
        });
      }

      const params = { ...p, locale, paper: input.paper };
      exportId = await store.insertExport({
        household_id: input.household_id,
        user_id: user.userId,
        kind,
        params,
      });
      const id = exportId;
      const job = renderAndStore({
        renderer,
        html,
        exportId: id,
        householdId: input.household_id,
        userId: user.userId,
        paper: input.paper,
        locale,
        title,
        kind,
        params,
        requestId,
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        job.then(
          (r) => ({ done: true as const, r, err: null }),
          (err: unknown) => ({ done: true as const, r: null, err }),
        ),
        new Promise<{ done: false }>((resolve) => {
          timer = setTimeout(() => resolve({ done: false }), softDeadline);
        }),
      ]);
      clearTimeout(timer);
      if (outcome.done) {
        if (outcome.err || !outcome.r) throw outcome.err;
        await store.idempotencyComplete(begin.id, 200, outcome.r);
        return Response.json(outcome.r, { headers: { ...corsHeaders, ...quota } });
      }
      // Slow render: 202 now, finish in the background (06 §2.8).
      const beginId = begin.id;
      deps.kick(() =>
        job.then(
          async (r) => {
            await store.idempotencyComplete(beginId, 200, r);
            await store.notify([
              notificationRow({
                key: 'export_ready',
                user_id: user.userId,
                household_id: input.household_id,
                locale,
                scheduled_for: now(),
                dedupe_key: `export_ready:${id}`,
                route: routeFor('export_ready', { export_id: id }),
                data: { export_id: id },
              }),
            ]);
          },
          () => store.idempotencyFail(beginId),
        ),
      );
      const accepted = ExportPdfAccepted.parse({
        status: 'accepted',
        export_id: id,
        export_status: 'processing',
        poll_after_ms: POLL_AFTER_MS,
        realtime: { schema: 'public', table: 'exports', filter: `id=eq.${id}` },
      });
      return Response.json(accepted, { status: 202, headers: { ...corsHeaders, ...quota } });
    } catch (err) {
      await store.idempotencyFail(begin.id).catch(() => {});
      throw err;
    }
  });

  /** Render, upload, mark ready, sign. Marks the row failed and throws UPSTREAM_UNAVAILABLE on error. */
  async function renderAndStore(a: {
    renderer: PdfRenderer;
    html: string;
    exportId: string;
    householdId: string;
    userId: string;
    paper: ExportPaper;
    locale: ExportLocale;
    title: string;
    kind: string;
    params: Record<string, unknown>;
    requestId: string;
  }) {
    const started = Date.now();
    let pdf: Uint8Array;
    try {
      pdf = await a.renderer.render(a.html, {
        paper: a.paper,
        marginMm: a.kind === 'grocery_list' ? 12 : 14,
        title: a.title,
        lang: a.locale,
      });
    } catch (err) {
      await store
        .updateExport(a.exportId, { status: 'failed', error: 'render_failed' })
        .catch(() => {});
      console.error(
        JSON.stringify({
          level: 'error',
          scope: SCOPE,
          request_id: a.requestId,
          msg: 'render_failed',
          status: err instanceof RendererError ? err.status : null,
        }),
      );
      throw new HttpError(
        'UPSTREAM_UNAVAILABLE',
        'We could not create the PDF right now. Please try again.',
        {
          export_id: a.exportId,
        },
      );
    }
    const path = exportPath(a.householdId, a.exportId);
    const at = now();
    const expiresAt = new Date(at.getTime() + EXPORT_OBJECT_TTL_DAYS * 86_400_000).toISOString();
    const pages = countPdfPages(pdf);
    try {
      await storage.upload(path, pdf, 'application/pdf');
      await store.updateExport(a.exportId, {
        status: 'ready',
        storage_path: path,
        expires_at: expiresAt,
        params: { ...a.params, pages },
      });
    } catch (err) {
      await store
        .updateExport(a.exportId, { status: 'failed', error: 'upload_failed' })
        .catch(() => {});
      throw err;
    }
    const url = await storage.signedUrl(path, EXPORT_SIGNED_URL_TTL_SECONDS);
    await store.audit({
      actor: a.userId,
      householdId: a.householdId,
      action: 'export',
      entity: 'exports',
      entityId: a.exportId,
      diff: { kind: a.kind, locale: a.locale, paper: a.paper, pages },
    });
    await store.analytics(a.userId, 'export_created', { kind: a.kind, locale: a.locale, pages });
    // Duration and page count only; never content (18 §2 observability).
    console.log(
      JSON.stringify({
        level: 'info',
        scope: SCOPE,
        request_id: a.requestId,
        ms: Date.now() - started,
        pages,
      }),
    );
    return ExportPdfReady.parse({
      status: 'ready',
      export_id: a.exportId,
      url,
      expires_at: new Date(now().getTime() + EXPORT_SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
      pages,
    });
  }

  async function get(req: Request): Promise<Response> {
    const requestId = requestIdOf(req);
    try {
      const user = await requireUser(req, deps.verify);
      const id = new URL(req.url).searchParams.get('export_id') ?? '';
      if (!z.string().uuid().safeParse(id).success)
        throw new HttpError('VALIDATION_FAILED', 'export_id is required.', { field: 'export_id' });
      const row = await store.exportRow(id);
      // Account data exports belong to their user only; PDFs to members of the household (AC-E5).
      const visible =
        row &&
        (row.household_id
          ? row.kind !== 'account_data' &&
            (await store.membership(row.household_id, user.userId)) !== null
          : row.user_id === user.userId);
      if (!row || !visible) throw new HttpError('NOT_FOUND', 'Export not found.');
      const body = await statusBody(row);
      return Response.json(body, { headers: { ...corsHeaders, 'x-request-id': requestId } });
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err, requestId);
      console.error(
        JSON.stringify({ level: 'error', scope: SCOPE, request_id: requestId, error: String(err) }),
      );
      return errorResponse(
        new HttpError('INTERNAL', 'Something went wrong. Please try again.'),
        requestId,
      );
    }
  }

  async function statusBody(row: ExportRow) {
    if (row.status === 'processing')
      return ExportPdfAccepted.parse({
        status: 'accepted',
        export_id: row.id,
        export_status: 'processing',
        poll_after_ms: POLL_AFTER_MS,
        realtime: { schema: 'public', table: 'exports', filter: `id=eq.${row.id}` },
      });
    const expired = new Date(row.expires_at).getTime() <= now().getTime();
    if (row.status !== 'ready' || !row.storage_path || expired)
      throw new HttpError(
        'CONFLICT',
        'This export is no longer available. Please create it again.',
        {
          export_status: row.status === 'ready' ? 'expired' : row.status,
        },
      );
    const url = await storage.signedUrl(row.storage_path, EXPORT_SIGNED_URL_TTL_SECONDS);
    return ExportPdfReady.parse({
      status: 'ready',
      export_id: row.id,
      url,
      expires_at: new Date(now().getTime() + EXPORT_SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
      pages: typeof row.params?.pages === 'number' && row.params.pages > 0 ? row.params.pages : 1,
    });
  }

  const purge = jsonHandler(PurgeRequest, async ({ req, input, requestId }) => {
    requireInternal(req, deps.secrets);
    const at = now();
    const rows = await store.expiredExports(at.toISOString(), input.limit);
    const paths = rows.map((r) => r.storage_path).filter((p): p is string => !!p);
    if (paths.length) await storage.remove(paths);
    for (const r of rows) await store.updateExport(r.id, { status: 'expired', storage_path: null });
    const failed = await store.failStale(
      new Date(at.getTime() - STALE_PROCESSING_MS).toISOString(),
    );
    console.log(
      JSON.stringify({
        level: 'info',
        scope: SCOPE,
        request_id: requestId,
        expired: rows.length,
        failed,
      }),
    );
    return { expired: rows.length, objects_removed: paths.length, stale_failed: failed };
  });

  return (req: Request): Promise<Response> => {
    if (req.method === 'GET') return get(req);
    if (req.headers.has('x-internal-secret')) return purge(req);
    return post(req);
  };
}
