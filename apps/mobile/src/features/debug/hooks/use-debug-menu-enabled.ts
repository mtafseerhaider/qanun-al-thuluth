import { useFeatureFlag } from '@/hooks/use-feature-flag';
import { isDevelopment } from '@/lib/env';

/** The debug screen is reachable in development builds or when the `debug_menu` flag is on. */
export function useDebugMenuEnabled(): boolean {
  const flag = useFeatureFlag('debug_menu');
  return isDevelopment || flag;
}
