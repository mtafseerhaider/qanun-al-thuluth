import { internalSecretsFromEnv } from '../_shared/auth.ts';
import { adminClient, verifyWithSupabase } from '../_shared/clients.ts';
import { postmarkAccountEmailSender } from '../_shared/integrations/account-emails.ts';
import { oneSignalDeleter, revenueCatDeleter } from '../_shared/integrations/processors.ts';
import { supabaseStorageAdmin } from '../_shared/storage.ts';
import { createAccountDeleteHandler } from './handler.ts';
import { supabaseAccountDeleteStore } from './store.ts';

const admin = adminClient();

Deno.serve(
  createAccountDeleteHandler({
    verify: verifyWithSupabase,
    secrets: internalSecretsFromEnv,
    store: supabaseAccountDeleteStore(admin),
    storage: supabaseStorageAdmin(admin),
    processors: [
      revenueCatDeleter(Deno.env.get('REVENUECAT_SECRET_API_KEY')),
      oneSignalDeleter(Deno.env.get('ONESIGNAL_REST_API_KEY'), Deno.env.get('ONESIGNAL_APP_ID')),
    ],
    email: postmarkAccountEmailSender(Deno.env.get('POSTMARK_SERVER_TOKEN')),
  }),
);
