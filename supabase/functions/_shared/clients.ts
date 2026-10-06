import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

import type { ClaimsVerifier } from './auth.ts';
import { requireEnv } from './env.ts';

/** Service-role client for writes after all checks pass. Never returned to callers. */
export function adminClient(): SupabaseClient {
  return createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const verifyWithSupabase: ClaimsVerifier = async (jwt) => {
  const client = createClient(requireEnv('SUPABASE_URL'), requireEnv('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getClaims(jwt);
  if (error || !data) return null;
  const claims = data.claims as { sub?: string; email?: string };
  return claims.sub ? { sub: claims.sub, ...(claims.email ? { email: claims.email } : {}) } : null;
};
