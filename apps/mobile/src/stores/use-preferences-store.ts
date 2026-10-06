import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

import { appJsonStorage } from '@/lib/storage/zustand-storage';

/**
 * Device preferences (09 §5.6). Sprint 0 implements locale and theme; the remaining fields exist so
 * later sprints do not need a storage migration. Plain MMKV, read synchronously before first render.
 */
export type ThemePreference = 'system' | 'light' | 'dark';
export type AppLocale = 'en' | 'ur';

export interface PreferencesState {
  theme: ThemePreference;
  locale: AppLocale;
  /** True once the locale was chosen explicitly (or seeded from the device on first launch). */
  localeChosen: boolean;
  units: 'metric' | 'imperial';
  traditionPreference: 'shared' | 'sunni' | 'shia';
  sensoryCalm: boolean;
  haptics: boolean;
  biometricLock: { enabled: boolean; timeout: 'immediate' | '1m' | '5m' };
  showArabicWithTranslation: boolean;
  hijriDateDisplay: boolean;
  lastSyncedAt: number | null;
}

export interface PreferencesActions {
  setTheme(theme: ThemePreference): void;
  /** Store-only update. Use `changeLocale()` from lib/i18n to also switch i18next and RTL. */
  setLocale(locale: AppLocale): void;
  setSensoryCalm(on: boolean): void;
  setHaptics(on: boolean): void;
}

export const initialPreferences: PreferencesState = {
  theme: 'system',
  locale: 'en',
  localeChosen: false,
  units: 'metric',
  traditionPreference: 'shared',
  sensoryCalm: false,
  haptics: true,
  biometricLock: { enabled: false, timeout: '1m' },
  showArabicWithTranslation: true,
  hijriDateDisplay: true,
  lastSyncedAt: null,
};

export const PREFERENCES_STORE_VERSION = 1;

/** Pure migration (09 §6.3). Version 1 is the first shipped shape, so there is nothing to migrate yet. */
export function migratePreferences(persisted: unknown, _version: number): PreferencesState {
  return { ...initialPreferences, ...(persisted as Partial<PreferencesState> | undefined) };
}

export const usePreferencesStore = create<PreferencesState & PreferencesActions>()(
  devtools(
    persist(
      (set) => ({
        ...initialPreferences,
        setTheme: (theme) => set({ theme }),
        setLocale: (locale) => set({ locale, localeChosen: true }),
        setSensoryCalm: (sensoryCalm) => set({ sensoryCalm }),
        setHaptics: (haptics) => set({ haptics }),
      }),
      {
        name: 'store.preferences',
        version: PREFERENCES_STORE_VERSION,
        storage: appJsonStorage,
        migrate: migratePreferences,
        partialize: ({
          theme,
          locale,
          localeChosen,
          units,
          traditionPreference,
          sensoryCalm,
          haptics,
          biometricLock,
          showArabicWithTranslation,
          hijriDateDisplay,
          lastSyncedAt,
        }) => ({
          theme,
          locale,
          localeChosen,
          units,
          traditionPreference,
          sensoryCalm,
          haptics,
          biometricLock,
          showArabicWithTranslation,
          hijriDateDisplay,
          lastSyncedAt,
        }),
      },
    ),
    { name: 'preferences', enabled: __DEV__ },
  ),
);
