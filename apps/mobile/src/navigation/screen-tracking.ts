import type { NavigationContainerRef, ParamListBase } from '@react-navigation/native';

import { track } from '@/lib/analytics/track';

let lastRoute: string | undefined;

/** Emits `screen_viewed` when the focused route changes (18 §9.1). */
export function trackScreenChange(ref: NavigationContainerRef<ParamListBase>): void {
  const name = ref.getCurrentRoute()?.name;
  if (!name || name === lastRoute) return;
  lastRoute = name;
  track('screen_viewed', { screen: name });
}
