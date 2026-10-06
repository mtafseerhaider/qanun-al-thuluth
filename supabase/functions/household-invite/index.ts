import { adminClient, verifyWithSupabase } from '../_shared/clients.ts';
import { postmarkSender } from '../_shared/integrations/email.ts';
import { createInviteHandler } from './handler.ts';
import { supabaseInviteStore } from './store.ts';

Deno.serve(
  createInviteHandler({
    verify: verifyWithSupabase,
    store: supabaseInviteStore(adminClient()),
    sendEmail: postmarkSender(Deno.env.get('POSTMARK_SERVER_TOKEN')),
  }),
);
