import { adminClient } from '../_shared/clients.ts';
import { appEnv } from '../_shared/env.ts';
import { createHealthHandler } from './handler.ts';
import { supabaseHealthStore } from './store.ts';

Deno.serve(
  createHealthHandler({
    store: supabaseHealthStore(adminClient()),
    env: appEnv(),
    release: Deno.env.get('GIT_SHA') ?? 'unknown',
  }),
);
