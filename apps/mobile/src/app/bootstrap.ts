import * as SplashScreen from 'expo-splash-screen';

import { registerBudgetOutboxHandlers } from '@/features/budget';
import { registerFastingOutboxHandlers } from '@/features/fasting';
import { registerGroceryOutboxHandlers } from '@/features/grocery';
import { registerAlphaFeedbackOutboxHandler } from '@/features/help';
import { registerHydrationOutboxHandlers } from '@/features/hydration';
import { registerMealOutboxHandlers } from '@/features/meals';
import { openNotification, registerNotificationOutboxHandlers } from '@/features/notifications';
import { registerTrackingOutboxHandlers } from '@/features/tracking';
import { setAnalyticsContext, startAnalytics, track } from '@/lib/analytics/track';
import { registerDevice } from '@/lib/auth/device-registration';
import { env } from '@/lib/env';
import { initI18n } from '@/lib/i18n/i18n';
import { startOutboxSync } from '@/lib/offline/outbox-sync';
import { initPush, onPushSubscriptionChange } from '@/lib/push/push';
import { queryClient, wireQueryManagers } from '@/lib/query/query-client';
import { initSentry } from '@/lib/sentry/init';
import { useSessionStore } from '@/stores/use-session-store';

let done = false;

/**
 * Synchronous pre-render init (07 §9.2): Sentry first so later failures are captured, then i18n
 * (locale read synchronously from MMKV). The outbox replays queued writes (meal logs, Sprint 4
 * trackers, grocery, budget, journal, read receipts and alpha feedback). OneSignal starts only when
 * its app id is configured (24 S4-12); RevenueCat arrives in a later sprint.
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
  registerAlphaFeedbackOutboxHandler();
  startOutboxSync();
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
  startAnalytics();
  track('app_opened', { cold_start: true });
}
