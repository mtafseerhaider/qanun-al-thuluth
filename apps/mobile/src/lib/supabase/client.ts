import 'react-native-url-polyfill/auto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

import type { Database } from '@shared/db/database.types';

import { env } from '@/lib/env';

import { secureSessionStorage } from './secure-session-storage';

function create(): SupabaseClient<Database> | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null;
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      storage: secureSessionStorage,
      storageKey: 'thuluth.auth',
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
