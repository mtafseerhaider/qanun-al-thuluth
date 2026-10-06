import { adminClient, verifyWithSupabase } from '../_shared/clients.ts';
import { supabaseEntitlementStore } from '../_shared/entitlements.ts';
import { createGrowthComputeHandler } from './handler.ts';
import { supabaseGrowthStore } from './store.ts';

const admin = adminClient();

Deno.serve(
  createGrowthComputeHandler({
    verify: verifyWithSupabase,
    store: supabaseGrowthStore(admin),
    entitlements: supabaseEntitlementStore(admin),
  }),
);
