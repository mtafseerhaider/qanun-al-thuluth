import { internalSecretsFromEnv } from '../_shared/auth.ts';
import { adminClient } from '../_shared/clients.ts';
import { createPricesRefreshHandler } from './handler.ts';
import { supabasePricesStore } from './store.ts';

Deno.serve(
  createPricesRefreshHandler({
    secrets: internalSecretsFromEnv,
    store: supabasePricesStore(adminClient()),
  }),
);
