import { createMMKV, type MMKV } from 'react-native-mmkv';

export type { MMKV };

/** App preferences and Zustand persisted stores. Not encrypted: contains no secrets or health data (09 §6.1). */
export const appStorage: MMKV = createMMKV({ id: 'thuluth.app' });

export interface SensitiveStorage {
  queryCache: MMKV;
  drafts: MMKV;
}

/**
 * React Query persisted cache and drafts contain health data, so they are encrypted (07 §9.5).
 * The key comes from expo-secure-store (see sensitive-key.ts).
 */
export function createSensitiveStorage(encryptionKey: string): SensitiveStorage {
  return {
    queryCache: createMMKV({ id: 'thuluth.query-cache', encryptionKey, encryptionType: 'AES-256' }),
    drafts: createMMKV({ id: 'thuluth.drafts', encryptionKey, encryptionType: 'AES-256' }),
  };
}

/** Minimal synchronous key-value surface shared by MMKV and test fakes. */
export interface KeyValueStore {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  remove(key: string): unknown;
}
