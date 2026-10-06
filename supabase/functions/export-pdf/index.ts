import { internalSecretsFromEnv } from '../_shared/auth.ts';
import { adminClient, verifyWithSupabase } from '../_shared/clients.ts';
import { supabaseEntitlementStore } from '../_shared/entitlements.ts';
import { createExportPdfHandler } from './handler.ts';
import { rendererFromEnv } from './renderer.ts';
import { supabaseExportStorage, supabaseExportStore } from './store.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const admin = adminClient();

function background(run: () => Promise<unknown>): void {
  const p = run().catch((err) =>
    console.error(
      JSON.stringify({ level: 'error', scope: 'export-pdf-background', error: String(err) }),
    ),
  );
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(p);
}

Deno.serve(
  createExportPdfHandler({
    verify: verifyWithSupabase,
    secrets: internalSecretsFromEnv,
    store: supabaseExportStore(admin),
    storage: supabaseExportStorage(admin),
    entitlements: supabaseEntitlementStore(admin),
    renderer: rendererFromEnv(),
    kick: background,
  }),
);
