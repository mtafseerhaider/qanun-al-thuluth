import { adminClient, verifyWithSupabase } from '../_shared/clients.ts';
import { postmarkAccountEmailSender } from '../_shared/integrations/account-emails.ts';
import { maintenanceProbe, withMaintenance } from '../_shared/maintenance.ts';
import { supabaseStorageAdmin } from '../_shared/storage.ts';
import { rendererFromEnv } from '../export-pdf/renderer.ts';
import { createAccountExportHandler } from './handler.ts';
import { accountPdfs } from './pdfs.ts';
import { supabaseAccountExportStore } from './store.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const admin = adminClient();
const renderer = rendererFromEnv();

function background(run: () => Promise<unknown>): void {
  const p = run().catch((err) =>
    console.error(
      JSON.stringify({ level: 'error', scope: 'account-export-background', error: String(err) }),
    ),
  );
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(p);
}

Deno.serve(
  withMaintenance(
    createAccountExportHandler({
      verify: verifyWithSupabase,
      store: supabaseAccountExportStore(admin),
      storage: supabaseStorageAdmin(admin),
      pdfs: renderer ? accountPdfs(admin, renderer) : null,
      kick: background,
      email: postmarkAccountEmailSender(Deno.env.get('POSTMARK_SERVER_TOKEN')),
    }),
    maintenanceProbe(admin),
  ),
);
