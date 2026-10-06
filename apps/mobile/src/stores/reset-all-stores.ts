import { resetters } from './create-store';
import { useFeatureFlagStore } from './use-feature-flag-store';
import { usePreferencesStore } from './use-preferences-store';

/**
 * Sign-out reset (09 §8). User-specific stores register themselves in `resetters` (session, active
 * household, onboarding). Feature flags are re-evaluated for the next user; device preferences such
 * as theme and locale are kept, except the biometric lock.
 */
export function resetAllStores(): void {
  for (const reset of resetters) reset();
  useFeatureFlagStore.getState().reset();
  usePreferencesStore.setState({ biometricLock: { enabled: false, timeout: '1m' } });
}
