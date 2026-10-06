import { z } from 'zod';
import {
  ACCOUNT_DELETION_REAUTH_MAX_AGE_SEC,
  AccountDeleteExecuteResponse,
  AccountDeleteRequest,
  AccountDeleteResponse,
} from '@thuluth/shared/contracts/account-delete.ts';

import { assertRecentAuth, requireInternal, requireUser } from '../_shared/auth.ts';
import type { ClaimsVerifier, InternalSecrets } from '../_shared/auth.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { sha256Hex } from '../_shared/crypto.ts';
import { consumeTierQuota } from '../_shared/entitlements.ts';
import { HttpError } from '../_shared/errors.ts';
import { jsonHandler } from '../_shared/http.ts';
import type { ProcessorDelete } from '../_shared/integrations/processors.ts';
import { removePrefix } from '../_shared/storage.ts';
import type { StorageAdmin } from '../_shared/storage.ts';
import type { AccountDeleteStore } from './store.ts';

export const SCOPE = 'account-delete';
/** Users erased per hourly run; the cron fires again while any remain due. */
export const EXECUTE_BATCH = 25;
/** Orphans younger than this are left alone (an upload may still be linking its row). */
export const ORPHAN_MIN_AGE_MS = 24 * 3600_000;

export interface AccountDeleteDeps {
  verify: ClaimsVerifier;
  secrets: InternalSecrets;
  store: AccountDeleteStore;
  storage: StorageAdmin;
  /** RevenueCat subscriber and OneSignal user deletion (06 §4.13). */
  processors: ProcessorDelete[];
  /**
   * Apple Sign in token revocation with the fresh `authorizationCode` (11 §15.2). Optional: needs
   * the Apple client secret (owner action); when unset the code is not kept and the skip is logged.
   */
  revokeApple?: (authorizationCode: string) => Promise<void>;
  now?: () => Date;
}

const SweepRequest = z.object({
  action: z.literal('sweep_orphans'),
  max_objects: z.number().int().min(1).max(20000).default(5000),
});
const ExecuteRequest = z.object({}).passthrough();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * 06 §4.13 `account-delete` (S6-10, FR-SET-05, 16 §7.5). Routes:
 * - `POST` (user): `request` (step-up re-auth within 300 s, Idempotency-Key, 30-day grace, the
 *   `under_age` age-gate decline deletes now) and `cancel` (inside the grace period).
 * - `POST /execute` (internal, hourly cron while a deletion is due): erases each due user through
 *   `execute_account_erasure`, removes their storage prefixes through the Storage API, deletes them at
 *   RevenueCat and OneSignal, then deletes the auth user.
 * - `POST {"action":"sweep_orphans"}` (internal, daily cron `storage-orphan-sweep`, 10 §6.3): removes
 *   objects whose owning household, member, chat session or meal log no longer exists.
 */
export function createAccountDeleteHandler(deps: AccountDeleteDeps) {
  const now = deps.now ?? (() => new Date());
  const { store, storage } = deps;

  const user = jsonHandler(AccountDeleteRequest, async ({ req, input }) => {
    const auth = await requireUser(req, deps.verify);
    if (input.action === 'cancel') {
      await store.cancelDeletion(auth.userId);
      return AccountDeleteResponse.parse({ action: 'cancel', cancelled: true });
    }

    assertRecentAuth(auth, ACCOUNT_DELETION_REAUTH_MAX_AGE_SEC, now());
    const key = req.headers.get('idempotency-key')?.trim() ?? '';
    if (key.length < 8 || key.length > 128)
      throw new HttpError('VALIDATION_FAILED', 'Idempotency-Key header is required.', {
        header: 'Idempotency-Key',
      });
    const quota = await consumeTierQuota(store, SCOPE, auth.userId, 'free');
    // The Apple code is single-use and never stored, so it is not part of the request hash.
    const { apple_authorization_code: appleCode, ...hashed } = input;
    const begin = await store.idempotencyBegin(
      SCOPE,
      auth.userId,
      key,
      await sha256Hex(JSON.stringify(hashed)),
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
      throw new HttpError('IDEMPOTENCY_IN_PROGRESS', 'Your request is still being processed.', {
        retry_after_seconds: 2,
      });

    try {
      const immediate = input.immediate && input.reason === 'under_age';
      const scheduledFor = await store.requestDeletion(
        auth.userId,
        input.reason ?? null,
        immediate,
      );
      const warning = await store.activeStoreSubscription(auth.userId);
      if (appleCode) {
        if (deps.revokeApple) {
          await deps.revokeApple(appleCode).catch((err) =>
            console.warn(
              JSON.stringify({
                level: 'warn',
                scope: SCOPE,
                msg: 'apple_revoke_failed',
                error: String(err),
              }),
            ),
          );
        } else {
          console.warn(
            JSON.stringify({ level: 'warn', scope: SCOPE, msg: 'apple_revoke_not_configured' }),
          );
        }
      }
      const body = AccountDeleteResponse.parse({
        action: 'request',
        scheduled_for: new Date(scheduledFor).toISOString(),
        active_subscription_warning: warning,
      });
      await store.idempotencyComplete(begin.id, 200, body);
      // Age-gate decline: no grace, erase right away (11 §13.1).
      if (immediate) await eraseOne(auth.userId).catch(() => {});
      return Response.json(body, { headers: { ...corsHeaders, ...quota } });
    } catch (err) {
      await store.idempotencyFail(begin.id).catch(() => {});
      throw err;
    }
  });

  /** Erases one due user end to end. Throws on failure (the user stays due for the next run). */
  async function eraseOne(userId: string): Promise<{ objects: number; processors: string[] }> {
    const result = await store.erase(userId);
    let objects = 0;
    for (const p of result.storage_prefixes)
      objects += await removePrefix(storage, p.bucket, p.prefix);
    const processors: string[] = [];
    for (const del of deps.processors) {
      const r = await del(userId).catch((err) => {
        // Processor deletion is retried by support from the audit trail; never block erasure on it.
        console.warn(
          JSON.stringify({
            level: 'warn',
            scope: SCOPE,
            msg: 'processor_delete_failed',
            error: String(err),
          }),
        );
        return { done: false, reason: 'failed' };
      });
      processors.push(r.done ? 'done' : (r.reason ?? 'skipped'));
    }
    await store.deleteAuthUser(userId);
    return { objects, processors };
  }

  const execute = jsonHandler(ExecuteRequest, async ({ req, requestId }) => {
    requireInternal(req, deps.secrets);
    const holder = crypto.randomUUID();
    const lease = await store.acquireLease('account-delete-execute', holder, 300);
    if (lease === false)
      return AccountDeleteExecuteResponse.parse({ deleted_users: 0, failures: 0 });
    try {
      const due = await store.dueUsers(now().toISOString(), EXECUTE_BATCH);
      let deleted = 0;
      let failures = 0;
      for (const id of due) {
        try {
          await eraseOne(id);
          deleted++;
        } catch (err) {
          failures++;
          // No user id in logs (16 §9): a salted hash would need LOG_SALT; the audit trail has the detail.
          console.error(
            JSON.stringify({
              level: 'error',
              scope: SCOPE,
              request_id: requestId,
              msg: 'erasure_failed',
              code: err instanceof HttpError ? err.code : 'INTERNAL',
            }),
          );
        }
      }
      console.log(
        JSON.stringify({
          level: 'info',
          scope: SCOPE,
          request_id: requestId,
          due: due.length,
          deleted,
          failures,
        }),
      );
      return AccountDeleteExecuteResponse.parse({ deleted_users: deleted, failures });
    } finally {
      if (lease) await store.releaseLease('account-delete-execute', holder).catch(() => {});
    }
  });

  const sweep = jsonHandler(SweepRequest, async ({ req, input, requestId }) => {
    requireInternal(req, deps.secrets);
    const cutoff = now().getTime() - ORPHAN_MIN_AGE_MS;
    const old = (o: { created_at: string | null }) =>
      !o.created_at || Date.parse(o.created_at) < cutoff;
    const removed: Record<string, number> = {};
    const seg = (path: string, i: number) => {
      const s = path.split('/')[i] ?? '';
      return UUID.test(s) ? s : null;
    };

    for (const bucket of ['meal-photos', 'chat-attachments', 'voice-notes', 'avatars', 'exports']) {
      const objects = (await storage.listAll(bucket, '', input.max_objects)).filter(old);
      const households = [
        ...new Set(objects.map((o) => seg(o.path, 0)).filter((s): s is string => !!s)),
      ];
      const liveHouseholds = await store.existing('households', households);
      const orphans = new Set<string>();
      for (const o of objects) {
        const hh = seg(o.path, 0);
        if (hh && !liveHouseholds.has(hh)) orphans.add(o.path);
      }
      const live = objects.filter((o) => !orphans.has(o.path) && seg(o.path, 0));
      if (bucket === 'chat-attachments') {
        const sessions = await store.existing('chat_sessions', [
          ...new Set(live.map((o) => seg(o.path, 1)).filter((s): s is string => !!s)),
        ]);
        for (const o of live) {
          const s = seg(o.path, 1);
          if (s && !sessions.has(s)) orphans.add(o.path);
        }
      }
      if (bucket === 'meal-photos') {
        const members = await store.existing('family_members', [
          ...new Set(live.map((o) => seg(o.path, 1)).filter((s): s is string => !!s)),
        ]);
        const referenced = await store.referencedMealPhotos([...liveHouseholds]);
        for (const o of live) {
          const m = seg(o.path, 1);
          if ((m && !members.has(m)) || !referenced.has(o.path)) orphans.add(o.path);
        }
      }
      if (bucket === 'avatars') {
        // {household_id}/members/{family_member_id}.webp
        const ids = live
          .map((o) =>
            o.path.split('/')[1] === 'members' ? (o.path.split('/')[2] ?? '').split('.')[0]! : '',
          )
          .filter((s) => UUID.test(s));
        const members = await store.existing('family_members', [...new Set(ids)]);
        for (const o of live) {
          const parts = o.path.split('/');
          const id = parts[1] === 'members' ? (parts[2] ?? '').split('.')[0]! : '';
          if (UUID.test(id) && !members.has(id)) orphans.add(o.path);
        }
      }
      if (orphans.size) await storage.remove(bucket, [...orphans]);
      removed[bucket] = orphans.size;
    }
    console.log(
      JSON.stringify({
        level: 'info',
        scope: SCOPE,
        request_id: requestId,
        msg: 'sweep_orphans',
        removed,
      }),
    );
    return { removed };
  });

  return (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname.replace(/\/+$/, '');
    if (path.endsWith('/execute')) return execute(req);
    if (req.headers.has('x-internal-secret')) return sweep(req);
    return user(req);
  };
}
