import { adminClient, verifyWithSupabase } from '../_shared/clients.ts';
import { appEnv } from '../_shared/env.ts';
import { breaker, providers, routeResolver } from '../_shared/ai/router.ts';
import { createSmokeHandler } from './handler.ts';

const admin = adminClient();

Deno.serve(
  createSmokeHandler({
    appEnv: appEnv(),
    verify: verifyWithSupabase,
    fallback: { resolver: routeResolver(admin), providers: providers(), breaker },
    writeUsage: async (row) => {
      const { error } = await admin.from('ai_usage').insert(row);
      if (error) throw error;
    },
    countTodayCalls: async (userId) => {
      const since = new Date();
      since.setUTCHours(0, 0, 0, 0);
      const { count, error } = await admin
        .from('ai_usage')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('route_key', 'chat.default')
        .gte('created_at', since.toISOString());
      if (error) throw error;
      return count ?? 0;
    },
  }),
);
