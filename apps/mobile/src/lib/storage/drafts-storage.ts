import { createJSONStorage, type StateStorage } from 'zustand/middleware';

import { getSensitiveStorage } from './sensitive-key';

/**
 * Zustand storage on the encrypted `thuluth.drafts` MMKV instance (09 §5.4, 07 §9.5): intake drafts
 * hold health data. The key comes from SecureStore asynchronously, so this storage is async and
 * stores using it hydrate after mount; a missing key degrades to memory only (nothing is written in
 * plain text).
 */
export const draftsStateStorage: StateStorage = {
  getItem: async (name) => {
    try {
      return (await getSensitiveStorage()).drafts.getString(name) ?? null;
    } catch {
      return null;
    }
  },
  setItem: async (name, value) => {
    try {
      (await getSensitiveStorage()).drafts.set(name, value);
    } catch {
      // Memory only for this session.
    }
  },
  removeItem: async (name) => {
    try {
      (await getSensitiveStorage()).drafts.remove(name);
    } catch {
      // Nothing persisted.
    }
  },
};

export const draftsJsonStorage = createJSONStorage(() => draftsStateStorage);
