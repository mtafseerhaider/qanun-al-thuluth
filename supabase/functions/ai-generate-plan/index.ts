import { breaker, providers, routeResolver } from '../_shared/ai/router.ts';
import { internalSecretsFromEnv } from '../_shared/auth.ts';
import { adminClient, verifyWithSupabase } from '../_shared/clients.ts';
import { supabaseEntitlementStore } from '../_shared/entitlements.ts';
import { supabasePlanStore } from '../_shared/plan/store.ts';
import { createGeneratePlanHandler } from './handler.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const admin = adminClient();

/** Runs after the response; outside the edge runtime (local tools) it simply runs detached. */
function background(run: () => Promise<unknown>): void {
  const p = run().catch((err) =>
    console.error(JSON.stringify({ level: 'error', scope: 'plan-worker', error: String(err) })),
  );
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(p);
}

Deno.serve(
  createGeneratePlanHandler({
    verify: verifyWithSupabase,
    secrets: internalSecretsFromEnv,
    store: supabasePlanStore(admin),
    entitlements: supabaseEntitlementStore(admin),
    fallback: { resolver: routeResolver(admin), providers: providers(), breaker },
    writeUsage: async (row) => {
      const { error } = await admin.from('ai_usage').insert(row);
      if (error) throw error;
    },
    kick: background,
  }),
);
