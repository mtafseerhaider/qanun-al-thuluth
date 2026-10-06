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
  /**
   * True once the one-time Sensory-calm suggestion (02 §7.10) was shown on this device, or skipped
   * because Sensory-calm was already on. Never reset, so the sheet is not shown again.
   */
  sensoryCalmSuggested: boolean;
  haptics: boolean;
  biometricLock: { enabled: boolean; timeout: 'immediate' | '1m' | '5m' };
  showArabicWithTranslation: boolean;
  hijriDateDisplay: boolean;
  lastSyncedAt: number | null;
  /** Product analytics opt-out (02 §7.13.4, FR-SET-07); mirrored to `users.analytics_opt_out`. */
  analyticsOptOut: boolean;
}

export interface PreferencesActions {
  setTheme(theme: ThemePreference): void;
  /** Store-only update. Use `changeLocale()` from lib/i18n to also switch i18next and RTL. */
  setLocale(locale: AppLocale): void;
  setSensoryCalm(on: boolean): void;
  markSensoryCalmSuggested(): void;
  setHaptics(on: boolean): void;
  setUnits(units: PreferencesState['units']): void;
  setTraditionPreference(tradition: PreferencesState['traditionPreference']): void;
  setAnalyticsOptOut(on: boolean): void;
  /** Copies server profile fields after sign-in (11 §9 step 2). Locale is applied by the caller. */
  hydrateFromProfile(profile: { units: string; tradition_preference: string }): void;
}

export const initialPreferences: PreferencesState = {
  theme: 'system',
  locale: 'en',
  localeChosen: false,
  units: 'metric',
  traditionPreference: 'shared',
  sensoryCalm: false,
  sensoryCalmSuggested: false,
  haptics: true,
  biometricLock: { enabled: false, timeout: '1m' },
  showArabicWithTranslation: true,
  hijriDateDisplay: true,
  lastSyncedAt: null,
  analyticsOptOut: false,
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
        markSensoryCalmSuggested: () => set({ sensoryCalmSuggested: true }),
        setHaptics: (haptics) => set({ haptics }),
        setUnits: (units) => set({ units }),
        setTraditionPreference: (traditionPreference) => set({ traditionPreference }),
        setAnalyticsOptOut: (analyticsOptOut) => set({ analyticsOptOut }),
        hydrateFromProfile: ({ units, tradition_preference }) =>
          set((s) => ({
            units: units === 'imperial' || units === 'metric' ? units : s.units,
            traditionPreference:
              tradition_preference === 'sunni' ||
              tradition_preference === 'shia' ||
              tradition_preference === 'shared'
                ? tradition_preference
                : s.traditionPreference,
          })),
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
          sensoryCalmSuggested,
          haptics,
          biometricLock,
          showArabicWithTranslation,
          hijriDateDisplay,
          lastSyncedAt,
          analyticsOptOut,
        }) => ({
          theme,
          locale,
          localeChosen,
          units,
          traditionPreference,
          sensoryCalm,
          sensoryCalmSuggested,
          haptics,
          biometricLock,
          showArabicWithTranslation,
          hijriDateDisplay,
          lastSyncedAt,
          analyticsOptOut,
        }),
      },
    ),
    { name: 'preferences', enabled: __DEV__ },
  ),
);
