import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import { env } from '@/lib/env';
import { appStorage } from '@/lib/storage/mmkv';

import type { Database } from './database';
import { secureSessionStorage } from './secure-session-storage';

export const AUTH_STORAGE_KEY = 'thuluth.auth';
export const INSTALL_MARKER_KEY = 'install.marker';

/**
 * iOS Keychain items survive an uninstall, MMKV does not. On the first launch after an install the
 * marker is missing, so the stored session is wiped before supabase-js reads it (11 §7.2): a
 * reinstall never resurrects an old session.
 */
export function createInstallAwareStorage(
  storage: typeof secureSessionStorage = secureSessionStorage,
  marker: Pick<typeof appStorage, 'getString' | 'set'> = appStorage,
) {
  let checked = false;
  const ensureFresh = async (key: string) => {
    if (checked) return;
    checked = true;
    if (marker.getString(INSTALL_MARKER_KEY)) return;
    await storage.removeItem(key);
    marker.set(INSTALL_MARKER_KEY, String(Date.now()));
  };
  return {
    async getItem(key: string) {
      await ensureFresh(key);
      return storage.getItem(key);
    },
    async setItem(key: string, value: string) {
      await ensureFresh(key);
      return storage.setItem(key, value);
    },
    removeItem: (key: string) => storage.removeItem(key),
  };
}

function create(): SupabaseClient<Database> | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      storage: createInstallAwareStorage(),
      storageKey: AUTH_STORAGE_KEY,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
    global: {
      headers: {
        'x-client-info': `thuluth-mobile/${env.APP_VERSION}`,
        'x-app-version': env.APP_VERSION,
        'x-platform': Platform.OS,
      },
    },
  });
}

/** Null when EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY are not set; callers must degrade gracefully. */
export const supabase: SupabaseClient<Database> | null = create();

export async function getAccessToken(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function getCurrentUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}
