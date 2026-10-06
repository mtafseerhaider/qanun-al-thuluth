import { adminClient, verifyWithSupabase } from '../_shared/clients.ts';
import { breaker, providers, routeResolver } from '../_shared/ai/router.ts';
import { createIntakeAssessHandler } from './handler.ts';
import { supabaseIntakeStore } from './store.ts';

const admin = adminClient();

Deno.serve(
  createIntakeAssessHandler({
    verify: verifyWithSupabase,
    store: supabaseIntakeStore(admin),
    fallback: { resolver: routeResolver(admin), providers: providers(), breaker },
    writeUsage: async (row) => {
      const { error } = await admin.from('ai_usage').insert(row);
      if (error) throw error;
    },
  }),
);
