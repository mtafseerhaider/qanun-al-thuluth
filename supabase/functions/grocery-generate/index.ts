import { adminClient, verifyWithSupabase } from '../_shared/clients.ts';
import { supabaseGroceryStore } from '../_shared/grocery/store.ts';
import { supabasePlatformStore } from '../_shared/platform.ts';
import { createGroceryGenerateHandler } from './handler.ts';

const admin = adminClient();

Deno.serve(
  createGroceryGenerateHandler({
    verify: verifyWithSupabase,
    platform: supabasePlatformStore(admin),
    store: supabaseGroceryStore(admin),
  }),
);
