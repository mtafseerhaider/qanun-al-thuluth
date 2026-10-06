import { internalSecretsFromEnv } from '../_shared/auth.ts';
import { adminClient } from '../_shared/clients.ts';
import { oneSignalSender } from '../_shared/integrations/onesignal.ts';
import { createNotificationsDispatchHandler } from './handler.ts';
import { supabaseNotificationsStore } from './store.ts';

Deno.serve(
  createNotificationsDispatchHandler({
    secrets: internalSecretsFromEnv,
    store: supabaseNotificationsStore(adminClient()),
    push: oneSignalSender(Deno.env.get('ONESIGNAL_REST_API_KEY'), Deno.env.get('ONESIGNAL_APP_ID')),
  }),
);
