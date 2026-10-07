import { breaker, providers, routeResolver } from '../_shared/ai/router.ts';
import { adminClient, verifyWithSupabase } from '../_shared/clients.ts';
import { supabaseEntitlementStore } from '../_shared/entitlements.ts';
import { maintenanceProbe, withMaintenance } from '../_shared/maintenance.ts';
import { supabasePlanStore } from '../_shared/plan/store.ts';
import { createRamadanGenerateHandler } from './handler.ts';
import { supabaseRamadanStore } from './store.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const admin = adminClient();

/** Runs the plan worker after the response; the plan_generation queue stays the retry path. */
function background(run: () => Promise<unknown>): void {
  const p = run().catch((err) =>
    console.error(JSON.stringify({ level: 'error', scope: 'ramadan-worker', error: String(err) })),
  );
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(p);
}

Deno.serve(
  withMaintenance(
    createRamadanGenerateHandler({
      verify: verifyWithSupabase,
      store: supabasePlanStore(admin),
      ramadan: supabaseRamadanStore(admin),
      entitlements: supabaseEntitlementStore(admin),
      fallback: { resolver: routeResolver(admin), providers: providers(), breaker },
      writeUsage: async (row) => {
        const { error } = await admin.from('ai_usage').insert(row);
        if (error) throw error;
      },
      kick: background,
    }),
    maintenanceProbe(admin),
  ),
);
