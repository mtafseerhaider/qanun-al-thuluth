import type { NotificationRow } from '../../functions/_shared/notifications/templates.ts';
import type { PushMessage, PushSender } from '../../functions/_shared/integrations/onesignal.ts';
import type {
  Snapshot,
  SnapshotPreference,
} from '../../functions/notifications-dispatch/materialize.ts';
import type {
  DueNotification,
  NotificationPatch,
  NotificationsStore,
} from '../../functions/notifications-dispatch/store.ts';

export const HH = '0b000000-0000-4000-8000-000000000001';
export const OWNER = '0b000000-0000-4000-8000-0000000000a1';
export const CAREGIVER = '0b000000-0000-4000-8000-0000000000a2';
export const VIEWER = '0b000000-0000-4000-8000-0000000000a3';
export const PLAN = '0b000000-0000-4000-8000-0000000000p1';
export const FATHER = 'fm-father';
export const CHILD5 = 'fm-child-5';
export const TEEN = 'fm-teen-12';

/** Usman's household in Lahore (Asia/Karachi, UTC+5): father linked to OWNER, a 5-year-old, a 12-year-old. */
export function baseSnapshot(): Snapshot {
  return {
    households: [
      {
        id: HH,
        timezone: 'Asia/Karachi',
        city: 'Lahore',
        country_code: 'PK',
        hijri_offset_days: 0,
      },
    ],
    memberships: [
      { household_id: HH, user_id: OWNER, role: 'owner' },
      { household_id: HH, user_id: CAREGIVER, role: 'caregiver' },
      { household_id: HH, user_id: VIEWER, role: 'viewer' },
    ],
    users: [
      { id: OWNER, locale: 'en', timezone: 'Asia/Karachi', tradition_preference: 'sunni' },
      { id: CAREGIVER, locale: 'ur', timezone: 'Asia/Karachi', tradition_preference: 'sunni' },
      { id: VIEWER, locale: 'en', timezone: 'Asia/Karachi', tradition_preference: 'sunni' },
    ],
    preferences: [],
    family: [
      {
        id: FATHER,
        household_id: HH,
        date_of_birth: '1988-04-02',
        life_stage: 'adult',
        linked_user_id: OWNER,
      },
      {
        id: CHILD5,
        household_id: HH,
        date_of_birth: '2021-03-01',
        life_stage: 'child',
        linked_user_id: null,
      },
      {
        id: TEEN,
        household_id: HH,
        date_of_birth: '2014-01-10',
        life_stage: 'child',
        linked_user_id: null,
      },
    ],
    hydration: [
      {
        household_id: HH,
        family_member_id: FATHER,
        schedule: [
          { kind: 'on_waking', start: '06:30', end: '07:00', targetMl: 220 },
          { kind: 'pre_meal', start: '12:30', end: '12:40', targetMl: 250, mealType: 'lunch' },
          { kind: 'pre_meal', start: '19:30', end: '19:40', targetMl: 250, mealType: 'dinner' },
        ],
      },
      {
        household_id: HH,
        family_member_id: CHILD5,
        schedule: [{ window: 'pre_lunch', start: '12:30', ml: 150 }],
      },
      // No stored windows: falls back to the plan's lunch at 13:00 minus 25 minutes.
      { household_id: HH, family_member_id: TEEN, schedule: [] },
    ],
    plans: [{ id: PLAN, household_id: HH, start_date: '2026-10-05', end_date: '2026-10-11' }],
    meals: [
      {
        id: 'dm-lunch',
        household_id: HH,
        meal_plan_id: PLAN,
        meal_type: 'lunch',
        plan_date: '2026-10-06',
        scheduled_time: '13:00:00',
      },
      {
        id: 'dm-lunch-2',
        household_id: HH,
        meal_plan_id: PLAN,
        meal_type: 'lunch',
        plan_date: '2026-10-06',
        scheduled_time: '13:00:00',
      },
      {
        id: 'dm-dinner',
        household_id: HH,
        meal_plan_id: PLAN,
        meal_type: 'dinner',
        plan_date: '2026-10-06',
        scheduled_time: '20:00',
      },
      {
        id: 'dm-snack',
        household_id: HH,
        meal_plan_id: PLAN,
        meal_type: 'snack',
        plan_date: '2026-10-06',
        scheduled_time: null,
      },
    ],
    fasts: [],
  };
}

export const pref = (
  user_id: string,
  kind: string,
  enabled: boolean,
  settings: Record<string, unknown> = {},
  quiet_hours: Record<string, unknown> = {},
): SnapshotPreference => ({ user_id, kind, enabled, settings, quiet_hours });

export interface StoredNotification extends DueNotification {
  status: string;
  dedupe_key: string;
  sent_at: string | null;
  onesignal_id: string | null;
  channel: string;
}

export function memoryNotifications(snapshot: Snapshot, opts: { lease?: boolean | null } = {}) {
  const state = {
    rows: [] as StoredNotification[],
    leases: [] as string[],
    released: [] as string[],
    updates: 0,
  };
  let seq = 0;
  const store: NotificationsStore = {
    acquireLease: async (name, holder) => {
      state.leases.push(`${name}:${holder}`);
      return opts.lease === undefined ? true : opts.lease;
    },
    releaseLease: async (name, holder) => {
      state.released.push(`${name}:${holder}`);
    },
    snapshot: async () => snapshot,
    existingKeys: async (rows) => {
      const have = new Set(state.rows.map((r) => `${r.user_id}:${r.dedupe_key}`));
      return new Set(rows.map((r) => `${r.user_id}:${r.dedupe_key}`).filter((k) => have.has(k)));
    },
    insert: async (rows: readonly NotificationRow[]) => {
      for (const r of rows) {
        seq += 1;
        state.rows.push({
          ...r,
          id: `n-${String(seq).padStart(3, '0')}`,
          status: 'pending',
          attempts: 0,
          sent_at: null,
          onesignal_id: null,
        });
      }
      return rows.length;
    },
    due: async (nowIso, limit) =>
      state.rows
        .filter((r) => r.status === 'pending' && r.channel === 'push' && r.scheduled_for <= nowIso)
        .sort((a, b) => a.scheduled_for.localeCompare(b.scheduled_for))
        .slice(0, limit)
        .map((r) => ({ ...r, data: { ...r.data } })),
    recipients: async (ids) => ({
      users: snapshot.users.filter((u) => ids.includes(u.id)),
      preferences: snapshot.preferences.filter((p) => ids.includes(p.user_id)),
    }),
    sentSince: async (ids, since) =>
      state.rows
        .filter((r) => ids.includes(r.user_id) && r.status === 'sent' && (r.sent_at ?? '') >= since)
        .map((r) => ({ user_id: r.user_id, kind: r.kind, sent_at: r.sent_at! })),
    update: async (id, patch: NotificationPatch) => {
      state.updates += 1;
      const row = state.rows.find((r) => r.id === id);
      if (row) Object.assign(row, patch);
    },
  };
  /** Adds a ready-made row (e.g. a `plan_ready` from the plan pipeline, or history for the cap). */
  const add = (
    row: Partial<StoredNotification> & { user_id: string; kind: string; scheduled_for: string },
  ) => {
    seq += 1;
    const full: StoredNotification = {
      id: `n-${String(seq).padStart(3, '0')}`,
      household_id: HH,
      title: 'Title',
      body: 'Body',
      data: { route: 'thuluth://today' },
      attempts: 0,
      status: 'pending',
      dedupe_key: `manual:${seq}`,
      sent_at: null,
      onesignal_id: null,
      channel: 'push',
      ...row,
    };
    state.rows.push(full);
    return full;
  };
  return { store, state, add };
}

export function fakePush(behaviour: (m: PushMessage) => 'ok' | 'none' | 'throw' = () => 'ok') {
  const sent: PushMessage[] = [];
  const push: PushSender = async (m) => {
    const b = behaviour(m);
    if (b === 'throw') throw new Error('OneSignal 503: unavailable');
    if (b === 'none') return { sent: false, reason: 'no_subscribers' };
    sent.push(m);
    return { sent: true, id: `os-${m.notification_id}` };
  };
  return { push, sent };
}
