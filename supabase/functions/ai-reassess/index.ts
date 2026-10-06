import { internalSecretsFromEnv } from '../_shared/auth.ts';
import { adminClient } from '../_shared/clients.ts';
import { createReassessHandler } from './handler.ts';
import { supabaseReassessStore } from './store.ts';

Deno.serve(
  createReassessHandler({
    secrets: internalSecretsFromEnv,
    store: supabaseReassessStore(adminClient()),
  }),
);
