import type { SupabaseClient } from '@supabase/supabase-js';

import { check, selectAll } from '../_shared/platform.ts';
import type { NotificationRow } from '../_shared/notifications/templates.ts';
import type { Snapshot, SnapshotPreference, SnapshotUser } from './materialize.ts';

export interface DueNotification {
  id: string;
  user_id: string;
  household_id: string | null;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  scheduled_for: string;
  attempts: number;
}

export interface NotificationPatch {
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
  attempts?: number;
  sent_at?: string;
  onesignal_id?: string;
  data?: Record<string, unknown>;
}

/** Data access for `notifications-dispatch` (06 §4.15), so the job can be tested without a database. */
export interface NotificationsStore {
  /** `acquire_job_lease`; null when the RPC is not deployed (the run proceeds unlocked). */
  acquireLease(name: string, holder: string, ttlSeconds: number): Promise<boolean | null>;
  releaseLease(name: string, holder: string): Promise<void>;
  /** Everything the materializers read, for local dates in `[fromDate, toDate]`. */
  snapshot(fromDate: string, toDate: string): Promise<Snapshot>;
  /** Existing `${user_id}:${dedupe_key}` pairs among the given keys. */
  existingKeys(
    rows: readonly Pick<NotificationRow, 'user_id' | 'dedupe_key'>[],
  ): Promise<Set<string>>;
  /** Inserts rows, skipping duplicates; returns how many were inserted. */
  insert(rows: readonly NotificationRow[]): Promise<number>;
  /** Pending push rows with `scheduled_for <= now`, oldest first. */
  due(nowIso: string, limit: number): Promise<DueNotification[]>;
  /** Locale, time zone and preferences of the recipients. */
  recipients(
    userIds: readonly string[],
  ): Promise<{ users: SnapshotUser[]; preferences: SnapshotPreference[] }>;
  /** Pushes sent to these users since `sinceIso` (for the daily cap). */
  sentSince(
    userIds: readonly string[],
    sinceIso: string,
  ): Promise<Array<{ user_id: string; kind: string; sent_at: string }>>;
  update(id: string, patch: NotificationPatch): Promise<void>;
}

const UNIQUE_VIOLATION = '23505';
const MISSING_FUNCTION = 'PGRST202';

export function supabaseNotificationsStore(admin: SupabaseClient): NotificationsStore {
  const activeUsers = async (ids: readonly string[]): Promise<SnapshotUser[]> => {
    if (!ids.length) return [];
    const out: SnapshotUser[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const rows = check(
        await admin
          .from('users')
          .select('id, locale, timezone, tradition_preference')
          .in('id', ids.slice(i, i + 200) as string[])
          .is('deleted_at', null)
          .eq('processing_restricted', false),
      ) as SnapshotUser[];
      out.push(...rows);
    }
    return out;
  };
  const preferences = async (ids: readonly string[]): Promise<SnapshotPreference[]> => {
    const out: SnapshotPreference[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      out.push(
        ...((await selectAll<unknown>((a, b) =>
          admin
            .from('notification_preferences')
            .select('user_id, kind, enabled, quiet_hours, settings')
            .in('user_id', ids.slice(i, i + 200) as string[])
            .order('id')
            .range(a, b),
        )) as SnapshotPreference[]),
      );
    }
    return out;
  };

  return {
    async acquireLease(name, holder, ttl) {
      const { data, error } = await admin.rpc('acquire_job_lease', {
        p_name: name,
        p_holder: holder,
        p_ttl_seconds: ttl,
      });
      if (error?.code === MISSING_FUNCTION) return null;
      if (error) throw error;
      return data === true;
    },
    async releaseLease(name, holder) {
      const { error } = await admin.rpc('release_job_lease', { p_name: name, p_holder: holder });
      if (error && error.code !== MISSING_FUNCTION) throw error;
    },
    async snapshot(fromDate, toDate) {
      const households = (await selectAll<unknown>((a, b) =>
        admin
          .from('households')
          .select('id, timezone, city, country_code, hijri_offset_days')
          .is('deleted_at', null)
          .order('id')
          .range(a, b),
      )) as Snapshot['households'];
      const memberships = (await selectAll<unknown>((a, b) =>
        admin
          .from('household_members')
          .select('household_id, user_id, role')
          .is('deleted_at', null)
          .order('id')
          .range(a, b),
      )) as Snapshot['memberships'];
      const userIds = [...new Set(memberships.map((m) => m.user_id))];
      const users = await activeUsers(userIds);
      const family = (await selectAll<unknown>((a, b) =>
        admin
          .from('family_members')
          .select('id, household_id, date_of_birth, life_stage, linked_user_id')
          .is('deleted_at', null)
          .order('id')
          .range(a, b),
      )) as Snapshot['family'];
      const hydration = (await selectAll<unknown>((a, b) =>
        admin
          .from('hydration_targets')
          .select('household_id, family_member_id, schedule')
          .is('deleted_at', null)
          .order('id')
          .range(a, b),
      )) as Snapshot['hydration'];
      const plans = (await selectAll<unknown>((a, b) =>
        admin
          .from('meal_plans')
          .select('id, household_id, start_date, end_date')
          .eq('status', 'active')
          .is('deleted_at', null)
          .lte('start_date', toDate)
          .gte('end_date', fromDate)
          .order('id')
          .range(a, b),
      )) as Snapshot['plans'];
      const planIds = plans.map((p) => p.id);
      const meals: Snapshot['meals'] = [];
      for (let i = 0; i < planIds.length; i += 100) {
        meals.push(
          ...((await selectAll<unknown>((a, b) =>
            admin
              .from('daily_meals')
              .select('id, household_id, meal_plan_id, meal_type, plan_date, scheduled_time')
              .in('meal_plan_id', planIds.slice(i, i + 100))
              .gte('plan_date', fromDate)
              .lte('plan_date', toDate)
              .not('scheduled_time', 'is', null)
              .order('id')
              .range(a, b),
          )) as Snapshot['meals']),
        );
      }
      const fasts = (await selectAll<unknown>((a, b) =>
        admin
          .from('fasting_logs')
          .select('household_id, family_member_id, fast_date, kind, exemption_reason')
          .gte('fast_date', fromDate)
          .lte('fast_date', toDate)
          .order('id')
          .range(a, b),
      )) as Snapshot['fasts'];
      const ramadan = (await selectAll<unknown>((a, b) =>
        admin
          .from('ramadan_plans')
          .select('household_id, start_date, end_date, prayer_times, child_participation')
          .is('deleted_at', null)
          .lte('start_date', toDate)
          .gte('end_date', fromDate)
          .order('id')
          .range(a, b),
      )) as NonNullable<Snapshot['ramadan']>;
      return {
        households,
        memberships,
        users,
        preferences: await preferences(users.map((u) => u.id)),
        family,
        hydration,
        meals,
        plans,
        fasts,
        ramadan,
      };
    },
    async existingKeys(rows) {
      const out = new Set<string>();
      const byUser = new Map<string, string[]>();
      for (const r of rows) byUser.set(r.user_id, [...(byUser.get(r.user_id) ?? []), r.dedupe_key]);
      for (const [userId, keys] of byUser) {
        for (let i = 0; i < keys.length; i += 100) {
          const found = check(
            await admin
              .from('notifications')
              .select('user_id, dedupe_key')
              .eq('user_id', userId)
              .in('dedupe_key', keys.slice(i, i + 100)),
          ) as Array<{ user_id: string; dedupe_key: string }>;
          for (const f of found) out.add(`${f.user_id}:${f.dedupe_key}`);
        }
      }
      return out;
    },
    async insert(rows) {
      if (!rows.length) return 0;
      const { error } = await admin.from('notifications').insert(rows as NotificationRow[]);
      if (!error) return rows.length;
      if (error.code !== UNIQUE_VIOLATION) throw error;
      // A concurrent run inserted some of them: fall back to one row at a time.
      let inserted = 0;
      for (const row of rows) {
        const one = await admin.from('notifications').insert(row);
        if (!one.error) inserted += 1;
        else if (one.error.code !== UNIQUE_VIOLATION) throw one.error;
      }
      return inserted;
    },
    async due(nowIso, limit) {
      return check(
        await admin
          .from('notifications')
          .select('id, user_id, household_id, kind, title, body, data, scheduled_for, attempts')
          .eq('status', 'pending')
          .eq('channel', 'push')
          .lte('scheduled_for', nowIso)
          .order('scheduled_for')
          .limit(limit),
      ) as DueNotification[];
    },
    async recipients(userIds) {
      const users = await activeUsers(userIds);
      return { users, preferences: await preferences(users.map((u) => u.id)) };
    },
    async sentSince(userIds, sinceIso) {
      const out: Array<{ user_id: string; kind: string; sent_at: string }> = [];
      for (let i = 0; i < userIds.length; i += 200) {
        out.push(
          ...((await selectAll<unknown>((a, b) =>
            admin
              .from('notifications')
              .select('user_id, kind, sent_at')
              .in('user_id', userIds.slice(i, i + 200) as string[])
              .eq('status', 'sent')
              .eq('channel', 'push')
              .gte('sent_at', sinceIso)
              .order('id')
              .range(a, b),
          )) as Array<{ user_id: string; kind: string; sent_at: string }>),
        );
      }
      return out;
    },
    async update(id, patch) {
      check(await admin.from('notifications').update(patch).eq('id', id));
    },
  };
}
