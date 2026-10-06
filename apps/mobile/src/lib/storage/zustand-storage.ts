import { createJSONStorage, type StateStorage } from 'zustand/middleware';

import { appStorage, type KeyValueStore } from './mmkv';

export const mmkvStateStorage = (store: KeyValueStore = appStorage): StateStorage => ({
  getItem: (name) => store.getString(name) ?? null,
  setItem: (name, value) => store.set(name, value),
  removeItem: (name) => {
    store.remove(name);
  },
});

export const appJsonStorage = createJSONStorage(() => mmkvStateStorage(appStorage));
