import { adminClient, verifyWithSupabase } from '../_shared/clients.ts';
import { supabaseEntitlementStore } from '../_shared/entitlements.ts';
import { supabaseGroceryStore } from '../_shared/grocery/store.ts';
import { maintenanceProbe, withMaintenance } from '../_shared/maintenance.ts';
import { supabasePlatformStore } from '../_shared/platform.ts';
import { createGroceryGenerateHandler } from './handler.ts';

const admin = adminClient();

Deno.serve(
  withMaintenance(
    createGroceryGenerateHandler({
      verify: verifyWithSupabase,
      platform: supabasePlatformStore(admin),
      entitlements: supabaseEntitlementStore(admin),
      store: supabaseGroceryStore(admin),
    }),
    maintenanceProbe(admin),
  ),
);
