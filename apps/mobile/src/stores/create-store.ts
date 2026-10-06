import { create, type StateCreator } from 'zustand';
import { devtools } from 'zustand/middleware';

/** Reset functions for user-specific stores, called by resetAllStores() on sign-out (09 §8). */
export const resetters = new Set<() => void>();

export function createStore<T>(
  name: string,
  initializer: StateCreator<T, [['zustand/devtools', never]], []>,
) {
  return create<T>()(devtools(initializer, { name, enabled: __DEV__ }));
}
