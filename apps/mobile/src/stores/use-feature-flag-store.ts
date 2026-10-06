import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

import { appJsonStorage } from '@/lib/storage/zustand-storage';

/**
 * Mirror of server-evaluated feature flags for synchronous reads at startup (09 §5.10).
 * Refreshed by useFeatureFlag's query; never written back to the server.
 */
/** Boolean keys seeded in supabase/seed (feature_flags) plus the 09 §5.10 list. */
export type FeatureFlagKey =
  | 'debug_menu'
  | 'app.maintenance'
  | 'ai.chat.enabled'
  | 'ai.vision.enabled'
  | 'ai.voice.enabled'
  | 'ai.plan.enabled'
  | 'plan.generate.enabled'
  | 'ramadan_planner'
  | 'photo_meal_analysis'
  | 'allow_sandbox_premium'
  | 'chat.voice'
  | 'chat.photo'
  | 'growth.alerts'
  | 'autism.food_chaining'
  | 'exports.pdf';

export interface FeatureFlagState {
  flags: Record<string, boolean>;
  fetchedAt: number | null;
  overrides: Record<string, boolean>;
}

export interface FeatureFlagActions {
  setFlags(flags: Record<string, boolean>): void;
  setOverride(key: FeatureFlagKey, value: boolean | null): void;
  reset(): void;
}

const initialFlags: FeatureFlagState = { flags: {}, fetchedAt: null, overrides: {} };

export const useFeatureFlagStore = create<FeatureFlagState & FeatureFlagActions>()(
  devtools(
    persist(
      (set) => ({
        ...initialFlags,
        setFlags: (flags) => set({ flags, fetchedAt: Date.now() }),
        setOverride: (key, value) =>
          set((s) => {
            const rest = Object.fromEntries(Object.entries(s.overrides).filter(([k]) => k !== key));
            return { overrides: value === null ? rest : { ...rest, [key]: value } };
          }),
        reset: () => set(initialFlags),
      }),
      {
        name: 'store.feature-flags',
        version: 1,
        storage: appJsonStorage,
        partialize: (s) => ({
          flags: s.flags,
          fetchedAt: s.fetchedAt,
          overrides: __DEV__ ? s.overrides : {},
        }),
      },
    ),
    { name: 'feature-flags', enabled: __DEV__ },
  ),
);

/** Safe default is disabled; dev overrides win only in development builds. */
export const selectFlag =
  (key: FeatureFlagKey, fallback = false) =>
  (s: FeatureFlagState): boolean =>
    (__DEV__ ? s.overrides[key] : undefined) ?? s.flags[key] ?? fallback;
