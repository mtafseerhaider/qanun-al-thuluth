import * as Crypto from 'expo-crypto';
import { AppState, Platform } from 'react-native';

import type { Json } from '@shared/db/database.types';

import { env } from '@/lib/env';
import { appStorage } from '@/lib/storage/mmkv';
import { getCurrentUserId, supabase } from '@/lib/supabase/client';

import type { EventName, EventProps } from './events';
import {
  createAnalyticsClient,
  type AnalyticsRow,
  type AnalyticsTransport,
  type FlushResult,
} from './queue';

export type { EventName, EventProps } from './events';
export type { FlushResult } from './queue';

/**
 * Direct table insert for Sprint 0 (no `.select()`: authenticated has no SELECT on analytics_events).
 * Swap the body for `supabase.rpc('track_events', { p_events })` when migration 0024 lands (18 §10).
 */
export const supabaseTransport: AnalyticsTransport = {
  async send(rows: AnalyticsRow[]) {
    if (!supabase) throw new Error('Supabase is not configured');
    // Props are validated JSON by the event registry; widen to the generated Json type.
    const { error } = await supabase
      .from('analytics_events')
      .insert(rows as (AnalyticsRow & { props: Json })[]);
    if (error) throw new Error(`analytics insert failed: ${error.code ?? ''} ${error.message}`);
  },
};

let currentLocale = 'en';
let currentHouseholdId: string | null = null;

export function setAnalyticsContext(ctx: { locale?: string; householdId?: string | null }): void {
  if (ctx.locale) currentLocale = ctx.locale;
  if (ctx.householdId !== undefined) currentHouseholdId = ctx.householdId;
}

export const analytics = createAnalyticsClient({
  storage: appStorage,
  transport: supabaseTransport,
  uuid: () => Crypto.randomUUID(),
  getContext: async () => ({
    userId: await getCurrentUserId(),
    householdId: currentHouseholdId,
    locale: currentLocale,
    appVersion: env.APP_VERSION,
    platform: Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web',
  }),
  onInvalid: (event, issues) => {
    if (__DEV__) console.warn('analytics props invalid', event, issues);
  },
});

export function track<E extends EventName>(event: E, props: EventProps<E>): boolean {
  return analytics.track(event, props, { locale: currentLocale, householdId: currentHouseholdId });
}

export function flushAnalytics(): Promise<FlushResult> {
  return analytics.flush();
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Flush every 30 s and when the app goes to the background (18 §10). */
export function startAnalytics(): void {
  if (timer) return;
  const safeFlush = () => {
    analytics.flush().catch(() => undefined);
  };
  timer = setInterval(safeFlush, 30_000);
  AppState.addEventListener('change', (s) => {
    if (s === 'background') safeFlush();
  });
}
