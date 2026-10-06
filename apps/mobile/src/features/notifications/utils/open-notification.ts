import { navigationRef } from '@/navigation/navigation-ref';

import type { NotificationTarget } from './notification-routing';

/** The navigator surface used here; injectable for tests. */
export interface NavigatorLike {
  isReady(): boolean;
  getRootState(): { routes: ReadonlyArray<{ name: string }> } | undefined;
  navigate(...args: never[]): void;
}

let pending: NotificationTarget | null = null;

function mainMounted(ref: NavigatorLike): boolean {
  if (!ref.isReady()) return false;
  return ref.getRootState()?.routes.some((r) => r.name === 'Main') ?? false;
}

/**
 * Opens a notification's target inside the signed-in app. A tap that arrives before the app is
 * ready (cold start, or while the session is restoring) is parked and opened by
 * `flushPendingNotification` once the Main branch is mounted (02 §3.4).
 */
export function openNotificationTarget(
  target: NotificationTarget,
  ref: NavigatorLike = navigationRef as unknown as NavigatorLike,
): boolean {
  if (!mainMounted(ref)) {
    pending = target;
    return false;
  }
  pending = null;
  const nested = {
    screen: target.screen,
    ...('params' in target ? { params: target.params } : {}),
    // Keep the tab's root screen under the target so back returns to it.
    initial: false,
  };
  (ref.navigate as (name: string, params: object) => void)('Main', {
    screen: target.tab,
    params: nested,
  });
  return true;
}

export function flushPendingNotification(
  ref: NavigatorLike = navigationRef as unknown as NavigatorLike,
): boolean {
  if (!pending) return false;
  return openNotificationTarget(pending, ref);
}

export function pendingNotificationTarget(): NotificationTarget | null {
  return pending;
}

export function clearPendingNotification(): void {
  pending = null;
}
