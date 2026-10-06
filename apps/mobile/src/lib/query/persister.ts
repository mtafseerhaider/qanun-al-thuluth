import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';

import type { KeyValueStore } from '@/lib/storage/mmkv';

/** Bump when cached row shapes change (09 §6.3 rule 5). */
export const SCHEMA_CACHE_VERSION = 1;
export const PERSIST_MAX_AGE = 1000 * 60 * 60 * 24 * 7;

/** React Query persister backed by the encrypted `thuluth.query-cache` MMKV instance. */
export function createQueryPersister(store: KeyValueStore) {
  return createAsyncStoragePersister({
    key: 'rq-cache',
    throttleTime: 1000,
    storage: {
      getItem: async (k) => store.getString(k) ?? null,
      setItem: async (k, v) => store.set(k, v),
      removeItem: async (k) => {
        store.remove(k);
      },
    },
  });
}
