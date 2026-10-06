import { breaker, providers, routeResolver } from '../_shared/ai/router.ts';
import { adminClient, verifyWithSupabase } from '../_shared/clients.ts';
import { supabaseEntitlementStore } from '../_shared/entitlements.ts';
import { supabaseGroceryCatalog } from '../_shared/grocery/store.ts';
import { supabasePlanStore } from '../_shared/plan/store.ts';
import { createAdjustPlanHandler } from './handler.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const admin = adminClient();

function background(run: () => Promise<unknown>): void {
  const p = run().catch((err) =>
    console.error(
      JSON.stringify({ level: 'error', scope: 'plan-adjust-worker', error: String(err) }),
    ),
  );
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(p);
}

Deno.serve(
  createAdjustPlanHandler({
    verify: verifyWithSupabase,
    store: supabasePlanStore(admin),
    entitlements: supabaseEntitlementStore(admin),
    fallback: { resolver: routeResolver(admin), providers: providers(), breaker },
    writeUsage: async (row) => {
      const { error } = await admin.from('ai_usage').insert(row);
      if (error) throw error;
    },
    kick: background,
    grocery: supabaseGroceryCatalog(admin),
  }),
);
