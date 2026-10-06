import { breaker, providers, routeResolver } from '../_shared/ai/router.ts';
import { adminClient, verifyWithSupabase } from '../_shared/clients.ts';
import { supabaseEntitlementStore } from '../_shared/entitlements.ts';
import { supabasePlatformStore } from '../_shared/platform.ts';
import { createTranscribeHandler } from './handler.ts';

const admin = adminClient();

Deno.serve(
  createTranscribeHandler({
    verify: verifyWithSupabase,
    platform: supabasePlatformStore(admin),
    entitlements: supabaseEntitlementStore(admin),
    fallback: { resolver: routeResolver(admin), providers: providers(), breaker },
    writeUsage: async (row) => {
      const { error } = await admin.from('ai_usage').insert(row);
      if (error) throw error;
    },
  }),
);
