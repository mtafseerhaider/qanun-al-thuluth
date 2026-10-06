import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { env } from '@/lib/env';
import { appStorage, type KeyValueStore } from '@/lib/storage/mmkv';
import { supabase } from '@/lib/supabase/client';

/**
 * `devices` row for this install (11 §9 step 6, §11.1), keyed by a per-install id kept in plain MMKV;
 * sign-out deletes the row and rotates the id. Sprint 4 adds the OneSignal subscription id when push
 * is available (24 S4-12); the server targets the user by external id, the column is for support and
 * cleanup. Both calls are best-effort and never block auth.
 */
export const DEVICE_ROW_KEY = 'device.row-id';

export function getDeviceRowId(store: KeyValueStore = appStorage): string {
  const existing = store.getString(DEVICE_ROW_KEY);
  if (existing) return existing;
  const id = Crypto.randomUUID();
  store.set(DEVICE_ROW_KEY, id);
  return id;
}

export async function registerDevice(
  userId: string,
  subscriptionId: string | null = null,
): Promise<void> {
  if (!supabase) return;
  const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';
  await supabase
    .from('devices')
    .upsert(
      {
        id: getDeviceRowId(),
        user_id: userId,
        platform,
        app_version: env.APP_VERSION,
        last_seen_at: new Date().toISOString(),
        // Only written when known, so a later registration without push keeps the stored id.
        ...(subscriptionId ? { onesignal_subscription_id: subscriptionId } : {}),
      },
      { onConflict: 'id' },
    )
    .then(
      () => undefined,
      () => undefined,
    );
}

export async function unregisterDevice(store: KeyValueStore = appStorage): Promise<void> {
  const id = store.getString(DEVICE_ROW_KEY);
  store.remove(DEVICE_ROW_KEY);
  if (!supabase || !id) return;
  await supabase
    .from('devices')
    .delete()
    .eq('id', id)
    .then(
      () => undefined,
      () => undefined,
    );
}
