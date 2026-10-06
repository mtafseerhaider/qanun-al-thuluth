import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic Expo config (docs/07-react-native-folder-structure.md §9.3).
 * Plugins are listed only for packages that are installed. RevenueCat, OneSignal, image picker,
 * audio and local authentication are added in later sprints. Google sign-in's plugin is added only
 * when EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID is set (it needs the reversed client id as a URL scheme);
 * without it the Google button is hidden at runtime.
 * The New Architecture is the only architecture in Expo SDK 55+, so there is no `newArchEnabled` flag.
 */
type AppEnv = 'development' | 'staging' | 'production';

const APP_ENVS: readonly AppEnv[] = ['development', 'staging', 'production'];
// 07 §9.3 names the variable APP_ENV; 19 §2 names it APP_VARIANT ('preview' = staging). Accept both.
const VARIANT_TO_ENV: Record<string, AppEnv> = {
  development: 'development',
  preview: 'staging',
  production: 'production',
};
const rawEnv =
  process.env.APP_ENV ?? VARIANT_TO_ENV[process.env.APP_VARIANT ?? ''] ?? 'development';
const APP_ENV: AppEnv = (APP_ENVS as readonly string[]).includes(rawEnv)
  ? (rawEnv as AppEnv)
  : 'development';

const suffix: Record<AppEnv, string> = { development: '.dev', staging: '.staging', production: '' };
const nameSuffix: Record<AppEnv, string> = {
  development: ' (Dev)',
  staging: ' (Staging)',
  production: '',
};

const VERSION = '1.0.0';
const EAS_PROJECT_ID = process.env.EAS_PROJECT_ID;
const SPLASH_BACKGROUND = '#F7F3EA';
const SPLASH_BACKGROUND_DARK = '#0F1513';

/** `123-abc.apps.googleusercontent.com` -> `com.googleusercontent.apps.123-abc` (11 §5.2). */
export function googleIosUrlScheme(iosClientId: string | undefined): string | null {
  const match = /^([\w-]+)\.apps\.googleusercontent\.com$/.exec(iosClientId?.trim() ?? '');
  return match ? `com.googleusercontent.apps.${match[1]}` : null;
}
const GOOGLE_IOS_URL_SCHEME = googleIosUrlScheme(process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: `Thuluth${nameSuffix[APP_ENV]}`,
  slug: 'thuluth',
  scheme: 'thuluth',
  version: VERSION,
  runtimeVersion: { policy: 'fingerprint' },
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/icons/icon.png',
  experiments: { tsconfigPaths: true, typedRoutes: false },
  // EAS Update needs the project id; leave updates disabled until EAS_PROJECT_ID is set.
  ...(EAS_PROJECT_ID
    ? { updates: { url: `https://u.expo.dev/${EAS_PROJECT_ID}`, fallbackToCacheTimeout: 0 } }
    : { updates: { enabled: false } }),
  ios: {
    bundleIdentifier: `app.thuluth.mobile${suffix[APP_ENV]}`,
    supportsTablet: false,
    associatedDomains: ['applinks:thuluth.app'],
    usesAppleSignIn: true,
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      CFBundleAllowMixedLocalizations: true,
    },
    privacyManifests: {
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
        },
      ],
    },
  },
  android: {
    package: `app.thuluth.mobile${suffix[APP_ENV]}`,
    adaptiveIcon: {
      foregroundImage: './assets/icons/adaptive-icon.png',
      backgroundColor: SPLASH_BACKGROUND,
    },
    blockedPermissions: ['android.permission.READ_EXTERNAL_STORAGE'],
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: 'thuluth.app', pathPrefix: '/invite' }],
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  web: { favicon: './assets/icons/favicon.png' },
  locales: { en: './locales/en/native.json', ur: './locales/ur/native.json' },
  extra: {
    APP_ENV,
    APP_VERSION: VERSION,
    SUPABASE_URL: process.env.EXPO_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN,
    ONESIGNAL_APP_ID: process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID,
    REVENUECAT_API_KEY_IOS: process.env.EXPO_PUBLIC_RC_IOS_KEY,
    REVENUECAT_API_KEY_ANDROID: process.env.EXPO_PUBLIC_RC_ANDROID_KEY,
    GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
    eas: { projectId: EAS_PROJECT_ID },
  },
  plugins: [
    ['expo-build-properties', { android: { minSdkVersion: 26 } }],
    'expo-localization',
    'expo-secure-store',
    'expo-apple-authentication',
    ...(GOOGLE_IOS_URL_SCHEME
      ? [
          [
            '@react-native-google-signin/google-signin',
            { iosUrlScheme: GOOGLE_IOS_URL_SCHEME },
          ] as [string, unknown],
        ]
      : []),
    [
      'expo-font',
      {
        fonts: [
          './assets/fonts/Inter-Regular.ttf',
          './assets/fonts/Inter-Medium.ttf',
          './assets/fonts/Inter-SemiBold.ttf',
          './assets/fonts/Inter-Bold.ttf',
          './assets/fonts/InterDisplay-SemiBold.ttf',
          './assets/fonts/NotoNastaliqUrdu-Regular.ttf',
          './assets/fonts/NotoNastaliqUrdu-Bold.ttf',
          './assets/fonts/Amiri-Regular.ttf',
          './assets/fonts/Amiri-Bold.ttf',
          './assets/fonts/AmiriQuran-Regular.ttf',
        ],
      },
    ],
    [
      'expo-splash-screen',
      {
        image: './assets/icons/splash.png',
        imageWidth: 160,
        resizeMode: 'contain',
        backgroundColor: SPLASH_BACKGROUND,
        dark: { image: './assets/icons/splash.png', backgroundColor: SPLASH_BACKGROUND_DARK },
      },
    ],
    'expo-status-bar',
    'expo-system-ui',
    'expo-dev-client',
    [
      '@sentry/react-native/expo',
      {
        // Source maps upload only when SENTRY_AUTH_TOKEN is present in the EAS build environment.
        organization: process.env.SENTRY_ORG,
        project: 'thuluth-mobile',
        url: 'https://sentry.io/',
      },
    ],
    'expo-updates',
  ],
});
