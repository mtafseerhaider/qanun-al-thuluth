import { revenueCatSecretsFromEnv } from '../_shared/auth.ts';
import { adminClient, verifyWithSupabase } from '../_shared/clients.ts';
import { appEnv } from '../_shared/env.ts';
import { createRevenueCatWebhookHandler } from './handler.ts';
import { revenueCatRest, supabaseRevenueCatStore } from './store.ts';

// verify_jwt = false (config.toml): the webhook authenticates with REVENUECAT_WEBHOOK_SECRET and
// refuses everything while it is unset; /sync verifies the user JWT in code.
Deno.serve(
  createRevenueCatWebhookHandler({
    secrets: revenueCatSecretsFromEnv,
    verify: verifyWithSupabase,
    store: supabaseRevenueCatStore(adminClient()),
    rc: revenueCatRest(Deno.env.get('REVENUECAT_SECRET_API_KEY')),
    appEnv,
  }),
);
