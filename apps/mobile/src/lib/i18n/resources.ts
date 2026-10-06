import enAuth from '@locales/en/auth.json';
import enCommon from '@locales/en/common.json';
import enDebug from '@locales/en/debug.json';
import enErrors from '@locales/en/errors.json';
import enNavigation from '@locales/en/navigation.json';
import enOnboarding from '@locales/en/onboarding.json';
import enSettings from '@locales/en/settings.json';
import urAuth from '@locales/ur/auth.json';
import urCommon from '@locales/ur/common.json';
import urDebug from '@locales/ur/debug.json';
import urErrors from '@locales/ur/errors.json';
import urNavigation from '@locales/ur/navigation.json';
import urOnboarding from '@locales/ur/onboarding.json';
import urSettings from '@locales/ur/settings.json';

export const NAMESPACES = [
  'common',
  'auth',
  'onboarding',
  'navigation',
  'settings',
  'errors',
  'debug',
] as const;
export type Namespace = (typeof NAMESPACES)[number];

export const resources = {
  en: {
    common: enCommon,
    auth: enAuth,
    onboarding: enOnboarding,
    navigation: enNavigation,
    settings: enSettings,
    errors: enErrors,
    debug: enDebug,
  },
  ur: {
    common: urCommon,
    auth: urAuth,
    onboarding: urOnboarding,
    navigation: urNavigation,
    settings: urSettings,
    errors: urErrors,
    debug: urDebug,
  },
} as const;
