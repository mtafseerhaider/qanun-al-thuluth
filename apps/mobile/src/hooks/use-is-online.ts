import { onlineManager } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';

/** Connectivity as React Query sees it (wired to NetInfo in query-client.ts). */
export function useIsOnline(): boolean {
  return useSyncExternalStore(
    (cb) => onlineManager.subscribe(cb),
    () => onlineManager.isOnline(),
    () => true,
  );
}
