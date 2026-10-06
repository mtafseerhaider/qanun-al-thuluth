import { localDate, localMinutes, parseHhmm } from '@thuluth/shared/prayer/index.ts';

import { requireInternal } from '../_shared/auth.ts';
import type { InternalSecrets } from '../_shared/auth.ts';
import { jsonHandler } from '../_shared/http.ts';
import type { PushSender } from '../_shared/integrations/onesignal.ts';
import { materialize, preferenceIndex } from './materialize.ts';
import type { SnapshotPreference, SnapshotUser } from './materialize.ts';
import type { DueNotification, NotificationPatch, NotificationsStore } from './store.ts';

export {
  NotificationsDispatchRequest,
  NotificationsDispatchResponse,
} from '@thuluth/shared/contracts/notifications-dispatch.ts';
import {
  NotificationsDispatchRequest,
  NotificationsDispatchResponse,
} from '@thuluth/shared/contracts/notifications-dispatch.ts';

export const LEASE_NAME = 'notifications-dispatch';
export const LEASE_TTL_SECONDS = 55;
/** A reminder more than this late is not sent (on-time rate is measured against it). */
export const STALE_AFTER_MIN = 30;
export const MAX_ATTEMPTS = 3;
export const DAILY_CAP = 6;
export const BATCH = 500;

/** FR-NOT-05: the cap excludes the Ramadan schedule and `plan_ready`; safety kinds are never capped. */
export const CAP_EXEMPT = new Set([
  'suhoor_reminder',
  'iftar_reminder',
  'plan_ready',
  'growth_alert',
  'allergy_warning',
]);
/** FR-NOT-02: quiet hours apply to every kind except the fasting schedule. */
const QUIET_EXEMPT = new Set(['suhoor_reminder', 'iftar_reminder']);
const ALWAYS_ON = new Set(['growth_alert', 'allergy_warning']);
const TIME_SENSITIVE = new Set(['suhoor_reminder', 'iftar_reminder']);

const TTL_SECONDS: Record<string, number> = {
  hydration_reminder: 30 * 60,
  meal_reminder: 30 * 60,
  suhoor_reminder: 60 * 60,
  iftar_reminder: 15 * 60,
  fasting_sunnah_reminder: 3 * 60 * 60,
  daily_plan: 4 * 60 * 60,
};
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

export interface NotificationsDispatchDeps {
  secrets: InternalSecrets;
  store: NotificationsStore;
  push: PushSender;
  now?: () => Date;
  holderId?: () => string;
}

/** Quiet hours `{start, end, tz?}` from the kind's row, else from any row of the user. */
export function quietHoursFor(
  prefs: readonly SnapshotPreference[],
  userId: string,
  kind: string,
): { start: number; end: number; tz?: string } | null {
  const parse = (q: Record<string, unknown> | undefined) => {
    if (!q) return null;
    const start = parseHhmm(q.start);
    const end = parseHhmm(q.end);
    if (start === null || end === null || start === end) return null;
    return { start, end, tz: typeof q.tz === 'string' ? q.tz : undefined };
  };
  const own = prefs.find((p) => p.user_id === userId && p.kind === kind);
  const fromKind = parse(own?.quiet_hours);
  if (fromKind) return fromKind;
  for (const p of prefs) {
    if (p.user_id !== userId) continue;
    const q = parse(p.quiet_hours);
    if (q) return q;
  }
  return null;
}

export function inQuietHours(q: { start: number; end: number }, minutes: number): boolean {
  return q.start < q.end
    ? minutes >= q.start && minutes < q.end
    : minutes >= q.start || minutes < q.end;
}

const zero = (): NotificationsDispatchResponse => ({
  skipped: false,
  materialized: 0,
  sent: 0,
  suppressed_quiet_hours: 0,
  stale: 0,
  failed: 0,
  suppressed_cap: 0,
  suppressed_disabled: 0,
  not_sent: 0,
});

const utcDate = (t: number) => new Date(t).toISOString().slice(0, 10);

const validTz = (tz: string | undefined): tz is string => {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/**
 * Cron, every minute (x-internal-secret). One run at a time under a job lease. Phase 1 inserts
 * reminders due in the next 15 minutes (`materialize.ts`); phase 2 sends rows that are due:
 * stale rows (over 30 minutes late) are cancelled, then the kind toggle, quiet hours and the
 * daily cap of 6 are applied, then OneSignal. `dry_run` reads but writes nothing.
 */
export function createNotificationsDispatchHandler(deps: NotificationsDispatchDeps) {
  const now = deps.now ?? (() => new Date());
  const holderId = deps.holderId ?? (() => crypto.randomUUID());
  return jsonHandler(NotificationsDispatchRequest, async ({ req, input, requestId }) => {
    requireInternal(req, deps.secrets);
    const at = now();
    const dry = input.dry_run;
    const holder = holderId();
    const lease = dry ? null : await deps.store.acquireLease(LEASE_NAME, holder, LEASE_TTL_SECONDS);
    if (lease === false) return NotificationsDispatchResponse.parse({ ...zero(), skipped: true });

    const result = zero();
    try {
      // Phase 1: materialize. Local dates across all time zones lie within a day of UTC.
      const t = at.getTime();
      const snapshot = await deps.store.snapshot(
        utcDate(t - 86_400_000),
        utcDate(t + 2 * 86_400_000),
      );
      const candidates = materialize(snapshot, at);
      const existing = candidates.length
        ? await deps.store.existingKeys(candidates)
        : new Set<string>();
      const fresh = candidates.filter((c) => !existing.has(`${c.user_id}:${c.dedupe_key}`));
      result.materialized = dry ? fresh.length : await deps.store.insert(fresh);

      // Phase 2: send what is due.
      const due = await deps.store.due(at.toISOString(), BATCH);
      if (due.length) await send(due, at, dry, result);
    } finally {
      if (lease === true) await deps.store.releaseLease(LEASE_NAME, holder).catch(() => undefined);
    }
    console.log(
      JSON.stringify({
        level: 'info',
        scope: 'notifications-dispatch',
        request_id: requestId,
        dry_run: dry,
        lease,
        ...result,
      }),
    );
    return NotificationsDispatchResponse.parse(result);
  });

  async function send(
    due: DueNotification[],
    at: Date,
    dry: boolean,
    result: NotificationsDispatchResponse,
  ) {
    const userIds = [...new Set(due.map((d) => d.user_id))];
    const { users, preferences } = await deps.store.recipients(userIds);
    const byId = new Map<string, SnapshotUser>(users.map((u) => [u.id, u]));
    const prefs = preferenceIndex(preferences);
    const sentRecently = await deps.store.sentSince(
      userIds,
      new Date(at.getTime() - 36 * 3_600_000).toISOString(),
    );
    const capUsed = new Map<string, number>();
    for (const s of sentRecently) {
      const tz = byId.get(s.user_id)?.timezone;
      if (CAP_EXEMPT.has(s.kind) || !validTz(tz)) continue;
      if (localDate(new Date(s.sent_at), tz) !== localDate(at, tz)) continue;
      capUsed.set(s.user_id, (capUsed.get(s.user_id) ?? 0) + 1);
    }

    const write = async (row: DueNotification, patch: NotificationPatch) => {
      if (!dry) await deps.store.update(row.id, patch);
    };
    const cancel = (row: DueNotification, reason: string) =>
      write(row, {
        status: 'cancelled',
        data: { ...row.data, dispatch: { reason, at: at.toISOString() } },
      });

    for (const row of due) {
      const user = byId.get(row.user_id);
      if (!user) {
        await cancel(row, 'recipient_inactive');
        result.suppressed_disabled += 1;
        continue;
      }
      if (at.getTime() - Date.parse(row.scheduled_for) > STALE_AFTER_MIN * 60_000) {
        await cancel(row, 'stale');
        result.stale += 1;
        continue;
      }
      if (!ALWAYS_ON.has(row.kind) && !prefs.enabled(row.user_id, row.kind)) {
        await cancel(row, 'disabled');
        result.suppressed_disabled += 1;
        continue;
      }
      const fastingSchedule = QUIET_EXEMPT.has(row.kind) || row.data.variant === 'suhoor';
      const quiet = fastingSchedule ? null : quietHoursFor(preferences, row.user_id, row.kind);
      const tz = validTz(quiet?.tz) ? quiet!.tz! : validTz(user.timezone) ? user.timezone : 'UTC';
      if (quiet && inQuietHours(quiet, localMinutes(at, tz))) {
        await cancel(row, 'quiet_hours');
        result.suppressed_quiet_hours += 1;
        continue;
      }
      if (!CAP_EXEMPT.has(row.kind)) {
        const used = capUsed.get(row.user_id) ?? 0;
        if (used >= DAILY_CAP) {
          await cancel(row, 'daily_cap');
          result.suppressed_cap += 1;
          continue;
        }
        capUsed.set(row.user_id, used + 1);
      }
      if (dry) {
        result.sent += 1;
        continue;
      }
      const headings = (row.data.headings as { en: string; ur: string } | undefined) ?? {
        en: row.title,
        ur: row.title,
      };
      const contents = (row.data.contents as { en: string; ur: string } | undefined) ?? {
        en: row.body,
        ur: row.body,
      };
      const attempts = row.attempts + 1;
      try {
        const res = await deps.push({
          notification_id: row.id,
          user_id: row.user_id,
          kind: row.kind,
          headings,
          contents,
          route: typeof row.data.route === 'string' ? row.data.route : 'thuluth://today',
          ttl_seconds: TTL_SECONDS[row.kind] ?? DEFAULT_TTL_SECONDS,
          time_sensitive: TIME_SENSITIVE.has(row.kind),
        });
        if (res.sent) {
          await write(row, {
            status: 'sent',
            sent_at: at.toISOString(),
            onesignal_id: res.id,
            attempts,
          });
          result.sent += 1;
        } else {
          await write(row, {
            status: 'failed',
            attempts,
            data: {
              ...row.data,
              dispatch: { reason: res.reason ?? 'not_sent', at: at.toISOString() },
            },
          });
          result.not_sent += 1;
          if (!CAP_EXEMPT.has(row.kind))
            capUsed.set(row.user_id, (capUsed.get(row.user_id) ?? 1) - 1);
        }
      } catch (err) {
        const terminal = attempts >= MAX_ATTEMPTS;
        await write(row, {
          status: terminal ? 'failed' : 'pending',
          attempts,
          data: {
            ...row.data,
            dispatch: {
              reason: 'push_error',
              error: String(err).slice(0, 200),
              at: at.toISOString(),
            },
          },
        });
        if (terminal) result.failed += 1;
        // Not counted against the cap: it was not delivered.
        if (!CAP_EXEMPT.has(row.kind))
          capUsed.set(row.user_id, (capUsed.get(row.user_id) ?? 1) - 1);
      }
    }
  }
}
