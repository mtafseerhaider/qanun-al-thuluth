import { breaker, providers, routeResolver } from '../_shared/ai/router.ts';
import { adminClient, verifyWithSupabase } from '../_shared/clients.ts';
import { supabaseEntitlementStore } from '../_shared/entitlements.ts';
import { supabasePlatformStore } from '../_shared/platform.ts';
import { createAnalyzeMealHandler } from './handler.ts';
import { supabaseMealStore } from './store.ts';

const admin = adminClient();

Deno.serve(
  createAnalyzeMealHandler({
    verify: verifyWithSupabase,
    platform: supabasePlatformStore(admin),
    entitlements: supabaseEntitlementStore(admin),
    store: supabaseMealStore(admin),
    fallback: { resolver: routeResolver(admin), providers: providers(), breaker },
    writeUsage: async (row) => {
      const { error } = await admin.from('ai_usage').insert(row);
      if (error) throw error;
    },
  }),
);
