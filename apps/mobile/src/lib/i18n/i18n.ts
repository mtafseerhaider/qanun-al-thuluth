import { getLocales } from 'expo-localization';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import { SUPPORTED_LOCALES, type SupportedLocale } from '@shared';

import { usePreferencesStore, type AppLocale } from '@/stores/use-preferences-store';

import { NAMESPACES, resources } from './resources';
import { applyDirection, reloadApp } from './rtl';

export const i18n = i18next;

function isSupported(code: string | null | undefined): code is SupportedLocale {
  return !!code && (SUPPORTED_LOCALES as readonly string[]).includes(code);
}

/** First launch: seed the locale from the device if it is Urdu; afterwards the stored choice wins. */
export function resolveInitialLocale(): AppLocale {
  const prefs = usePreferencesStore.getState();
  if (prefs.localeChosen) return prefs.locale;
  const device = getLocales()[0]?.languageCode;
  return isSupported(device) ? device : 'en';
}

let initialized = false;

/** Synchronous init (resources are bundled), called from bootstrap() before the first render. */
export function initI18n(locale: AppLocale = resolveInitialLocale()): typeof i18next {
  if (initialized) return i18next;
  initialized = true;
  void i18next.use(initReactI18next).init({
    resources,
    lng: locale,
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LOCALES],
    ns: [...NAMESPACES],
    defaultNS: 'common',
    interpolation: { escapeValue: false },
    returnNull: false,
    initAsync: false,
  });
  // Keep native direction in sync with the stored locale; takes effect on the next launch if it drifted.
  applyDirection(locale);
  return i18next;
}

/** Switches language, persists it and reloads when the layout direction flips (en <-> ur). */
export async function changeLocale(locale: AppLocale): Promise<void> {
  usePreferencesStore.getState().setLocale(locale);
  await i18next.changeLanguage(locale);
  if (applyDirection(locale)) await reloadApp();
}
