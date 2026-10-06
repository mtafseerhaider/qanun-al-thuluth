import * as Sentry from '@sentry/react-native';
import * as Updates from 'expo-updates';

import { scrubBreadcrumb, scrubEvent } from './scrub';

type NavigationIntegration = ReturnType<typeof Sentry.reactNavigationIntegration>;
let navigationIntegration: NavigationIntegration | null = null;

/**
 * React Navigation instrumentation (07 §9.1). Created only when Sentry is enabled, so importing this
 * module has no side effects and the app runs unchanged without a DSN.
 */
export function registerNavigationContainer(ref: unknown): void {
  navigationIntegration?.registerNavigationContainer(ref);
}

let enabled = false;

/**
 * Release tags for EAS Update (S7, 19 §6 rollback by channel pinning): which OTA bundle and channel
 * an event came from. The embedded bundle reports `embedded`; a build without updates `none`.
 */
export function easUpdateTags(updates: {
  updateId?: string | null;
  channel?: string | null;
  isEmbeddedLaunch?: boolean;
}): { eas_update_id: string; eas_channel: string } {
  return {
    eas_update_id: updates.updateId ?? (updates.isEmbeddedLaunch ? 'embedded' : 'none'),
    eas_channel: updates.channel ?? 'none',
  };
}

export function isSentryEnabled(): boolean {
  return enabled;
}

/** Initialises Sentry; a no-op when no DSN is configured so the app runs without the owner's account. */
export function initSentry({
  dsn,
  environment,
  release,
}: {
  dsn: string | undefined;
  environment: string;
  release?: string;
}): void {
  if (!dsn || enabled) return;
  navigationIntegration = Sentry.reactNavigationIntegration({ enableTimeToInitialDisplay: true });
  Sentry.init({
    dsn,
    environment,
    ...(release ? { release } : {}),
    sendDefaultPii: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    tracesSampleRate: environment === 'production' ? 0.1 : 1.0,
    integrations: [navigationIntegration],
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
    initialScope: { tags: easUpdateTags(Updates) },
  });
  enabled = true;
}

export function captureException(
  error: unknown,
  context?: { tags?: Record<string, string> },
): void {
  if (!enabled) {
    if (__DEV__) console.warn('[sentry disabled]', error);
    return;
  }
  Sentry.captureException(error, context);
}

export { Sentry };

/** User id only, never email (11 §9 step 3). No-op when Sentry is disabled. */
export function setSentryUser(userId: string | null): void {
  if (!enabled) return;
  Sentry.setUser(userId ? { id: userId } : null);
}

/** Cold-start timings as a breadcrumb (numbers only, 24 S7-01). No-op when Sentry is disabled. */
export function recordStartupTimings(data: Record<string, number | null>): void {
  if (!enabled) return;
  Sentry.addBreadcrumb({ category: 'perf.startup', level: 'info', data });
}
