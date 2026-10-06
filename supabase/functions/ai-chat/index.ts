import { breaker, providers, routeResolver } from '../_shared/ai/router.ts';
import { adminClient, verifyWithSupabase } from '../_shared/clients.ts';
import { supabaseEntitlementStore } from '../_shared/entitlements.ts';
import { maintenanceProbe, withMaintenance } from '../_shared/maintenance.ts';
import { supabasePlatformStore } from '../_shared/platform.ts';
import { createChatHandler } from './handler.ts';
import { supabaseChatStore } from './store.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const admin = adminClient();

function background(run: () => Promise<unknown>): void {
  const p = run().catch((err) =>
    console.error(JSON.stringify({ level: 'error', scope: 'ai-chat-memory', error: String(err) })),
  );
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(p);
}

Deno.serve(
  withMaintenance(
    createChatHandler({
      verify: verifyWithSupabase,
      platform: supabasePlatformStore(admin),
      entitlements: supabaseEntitlementStore(admin),
      store: supabaseChatStore(admin),
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
