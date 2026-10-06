import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

import { env } from '@/lib/env';
import { appStorage, type KeyValueStore } from '@/lib/storage/mmkv';
import { supabase } from '@/lib/supabase/client';

/**
 * `devices` row for this install (11 §9 step 6, §11.1). OneSignal arrives in a later sprint, so the
 * row is keyed by a per-install id kept in plain MMKV; sign-out deletes the row and rotates the id.
 * Both calls are best-effort and never block auth.
 */
export const DEVICE_ROW_KEY = 'device.row-id';

export function getDeviceRowId(store: KeyValueStore = appStorage): string {
  const existing = store.getString(DEVICE_ROW_KEY);
  if (existing) return existing;
  const id = Crypto.randomUUID();
  store.set(DEVICE_ROW_KEY, id);
  return id;
}

export async function registerDevice(userId: string): Promise<void> {
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
