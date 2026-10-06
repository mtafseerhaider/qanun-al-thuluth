import NetInfo from '@react-native-community/netinfo';
import {
  focusManager,
  MutationCache,
  onlineManager,
  QueryCache,
  QueryClient,
} from '@tanstack/react-query';
import { AppState, type AppStateStatus } from 'react-native';

import { captureException } from '@/lib/sentry/init';
import { isAppError } from '@/lib/supabase/app-error';

const NON_RETRYABLE = [
  'FORBIDDEN',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'NOT_CONFIGURED',
  'UNAUTHENTICATED',
];

export const QUERY_GC_TIME = 1000 * 60 * 60 * 24 * 7;

export function createQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (
          isAppError(error) &&
          (error.code === 'UNAUTHENTICATED' || error.code === 'NOT_CONFIGURED')
        )
          return;
        captureException(error, { tags: { queryKey: String(query.queryKey[0]) } });
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, _v, _c, mutation) =>
        captureException(error, {
          tags: { mutationKey: String(mutation.options.mutationKey?.[0]) },
        }),
    }),
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        gcTime: QUERY_GC_TIME,
        retry: (count, error) =>
          !(isAppError(error) && NON_RETRYABLE.includes(error.code)) && count < 2,
        networkMode: 'offlineFirst',
        refetchOnWindowFocus: true,
      },
      mutations: { networkMode: 'offlineFirst', retry: 0 },
    },
  });
}

export const queryClient = createQueryClient();

let wired = false;

/** Connects React Query to NetInfo and AppState (09 §2). Called once from bootstrap(). */
export function wireQueryManagers(): void {
  if (wired) return;
  wired = true;
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((s) =>
      setOnline(Boolean(s.isConnected && s.isInternetReachable !== false)),
    ),
  );
  AppState.addEventListener('change', (status: AppStateStatus) =>
    focusManager.setFocused(status === 'active'),
  );
}
