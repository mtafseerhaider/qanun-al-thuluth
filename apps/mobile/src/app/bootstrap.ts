import * as SplashScreen from 'expo-splash-screen';

import { setAnalyticsContext, startAnalytics, track } from '@/lib/analytics/track';
import { env } from '@/lib/env';
import { initI18n } from '@/lib/i18n/i18n';
import { registerMealOutboxHandlers } from '@/features/meals';
import { startOutboxSync } from '@/lib/offline/outbox-sync';
import { queryClient, wireQueryManagers } from '@/lib/query/query-client';
import { initSentry } from '@/lib/sentry/init';

let done = false;

/**
 * Synchronous pre-render init (07 §9.2): Sentry first so later failures are captured, then i18n
 * (locale read synchronously from MMKV). RevenueCat and OneSignal are added in later sprints. The
 * outbox replays queued writes (meal logs now; hydration and fasting later).
 */
export function bootstrap(): void {
  if (done) return;
  done = true;
  void SplashScreen.preventAutoHideAsync().catch(() => undefined);
  initSentry({
    dsn: env.SENTRY_DSN,
    environment: env.APP_ENV,
    release: `thuluth-mobile@${env.APP_VERSION}`,
  });
  const i18n = initI18n();
  setAnalyticsContext({ locale: i18n.language });
  wireQueryManagers();
  // Offline writes (24 S3-15): handlers first, then replay on reconnect and foreground.
  registerMealOutboxHandlers(queryClient);
  startOutboxSync();
  startAnalytics();
  track('app_opened', { cold_start: true });
}
