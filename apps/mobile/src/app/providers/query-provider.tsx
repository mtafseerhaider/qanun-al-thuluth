import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider, type Persister } from '@tanstack/react-query-persist-client';
import { useEffect, useState, type ReactNode } from 'react';

import { env } from '@/lib/env';
import { createQueryPersister, PERSIST_MAX_AGE, SCHEMA_CACHE_VERSION } from '@/lib/query/persister';
import { queryClient as defaultClient } from '@/lib/query/query-client';
import { captureException } from '@/lib/sentry/init';
import { getSensitiveStorage } from '@/lib/storage/sensitive-key';

/**
 * Persisted React Query cache on the encrypted MMKV instance (09 §2). The persister needs the key from
 * SecureStore, so children wait for it (the native splash is still visible). If the key cannot be
 * read, the app continues with an in-memory cache.
 */
export function QueryProvider({
  children,
  client = defaultClient,
}: {
  children: ReactNode;
  client?: QueryClient;
}) {
  const [persister, setPersister] = useState<Persister | null | 'memory'>(null);

  useEffect(() => {
    let cancelled = false;
    getSensitiveStorage()
      .then((s) => !cancelled && setPersister(createQueryPersister(s.queryCache)))
      .catch((error: unknown) => {
        captureException(error, { tags: { phase: 'query-persister' } });
        if (!cancelled) setPersister('memory');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (persister === null) return null;
  if (persister === 'memory')
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: PERSIST_MAX_AGE,
        buster: `${env.APP_VERSION}:${SCHEMA_CACHE_VERSION}`,
        dehydrateOptions: {
          shouldDehydrateQuery: (q) => q.state.status === 'success' && q.meta?.persist !== false,
          shouldDehydrateMutation: (m) => m.state.isPaused,
        },
      }}
      onSuccess={() => {
        void client.resumePausedMutations().then(() => client.invalidateQueries());
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
