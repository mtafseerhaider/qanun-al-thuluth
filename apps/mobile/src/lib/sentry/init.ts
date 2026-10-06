import * as Sentry from '@sentry/react-native';

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
