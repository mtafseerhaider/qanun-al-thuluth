import * as SplashScreen from 'expo-splash-screen';

import { registerBudgetOutboxHandlers } from '@/features/budget';
import { registerExposureOutboxHandlers } from '@/features/exposures';
import { registerFastingOutboxHandlers } from '@/features/fasting';
import { registerGroceryOutboxHandlers } from '@/features/grocery';
import { registerGrowthOutboxHandlers } from '@/features/growth';
import { registerAlphaFeedbackOutboxHandler } from '@/features/help';
import { registerHydrationOutboxHandlers } from '@/features/hydration';
import { registerMealLogOutboxHandlers } from '@/features/meal-log';
import { registerMealOutboxHandlers } from '@/features/meals';
import { openNotification, registerNotificationOutboxHandlers } from '@/features/notifications';
import { registerTrackingOutboxHandlers } from '@/features/tracking';
import { setAnalyticsContext, startAnalytics, track } from '@/lib/analytics/track';
import { registerDevice } from '@/lib/auth/device-registration';
import { env } from '@/lib/env';
import { initI18n } from '@/lib/i18n/i18n';
import { startOutboxSync } from '@/lib/offline/outbox-sync';
import { markStartup, onStartupReport, whenIdle } from '@/lib/perf/startup';
import { onClientPremiumChange } from '@/lib/purchases/purchases';
import { initPush, onPushSubscriptionChange } from '@/lib/push/push';
import { queryClient, wireQueryManagers } from '@/lib/query/query-client';
import { initSentry, recordStartupTimings } from '@/lib/sentry/init';
import { useSessionStore } from '@/stores/use-session-store';
import { useSubscriptionStore } from '@/stores/use-subscription-store';

let done = false;

/**
 * Synchronous pre-render init (07 §9.2): Sentry first so later failures are captured, then i18n
 * (locale read synchronously from MMKV). The outbox replays queued writes (meal logs, Sprint 4
 * trackers, grocery, budget, journal, read receipts and alpha feedback). OneSignal starts only when
 * its app id is configured (24 S4-12); RevenueCat is configured after sign-in, only when its key is set (24 S5-13).
 *
 * Cold start (24 S7-01): only what the first screen needs runs before the first render. Push stays
 * here so a notification tap that launched the app is not missed. Outbox replay (network) and the
 * analytics flush timer wait until the JS thread is idle after the first frame (`whenIdle`, at
 * most 1.5 s).
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
  registerHydrationOutboxHandlers(queryClient);
  registerFastingOutboxHandlers(queryClient);
  registerGroceryOutboxHandlers(queryClient);
  registerBudgetOutboxHandlers(queryClient);
  registerTrackingOutboxHandlers(queryClient);
  registerNotificationOutboxHandlers(queryClient);
  registerMealLogOutboxHandlers(queryClient);
  registerAlphaFeedbackOutboxHandler();
  registerGrowthOutboxHandlers(queryClient);
  registerExposureOutboxHandlers(queryClient);
  // Push: a tap opens the notification's screen (parked until the signed-in app is mounted).
  if (
    initPush((data) =>
      openNotification({ id: data.notification_id ?? null, kind: data.kind ?? null, data }, 'push'),
    )
  ) {
    onPushSubscriptionChange((id) => {
      const userId = useSessionStore.getState().userId;
      if (userId && id) void registerDevice(userId, id);
    });
  }
  // RevenueCat entitlement changes mirror into the client store (UI only; the server is truth).
  // Registered now (a Set add): sign-in can configure RevenueCat before the deferred work runs.
  onClientPremiumChange((premium) => useSubscriptionStore.getState().setClientPremium(premium));
  track('app_opened', { cold_start: true });
  onStartupReport((report) =>
    recordStartupTimings({ ...report.sinceJsStart, native_to_js_start: report.nativeToJsStart }),
  );
  if (__DEV__) onStartupReport((report) => console.info('[startup]', JSON.stringify(report)));
  markStartup('bootstrap_done');
  whenIdle(bootstrapDeferred);
}

/** Non-critical init, after the first frame. Each step is independent of the others. */
function bootstrapDeferred(): void {
  startOutboxSync();
  startAnalytics();
}
