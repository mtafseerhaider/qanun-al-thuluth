import { z } from 'zod';

import { supabase } from '@/lib/supabase/client';

const FlagRow = z.object({ key: z.string(), enabled: z.boolean(), rules: z.unknown().optional() });

/**
 * Reads `feature_flags` (authenticated only; anon has no access). Returns {} when signed out or not
 * configured, so every flag falls back to its safe default (disabled).
 * TODO(0025): replace with rpc('evaluate_feature_flags') and drop client-side rule handling.
 */
export async function fetchFeatureFlags(): Promise<Record<string, boolean>> {
  if (!supabase) return {};
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return {};
  const { data, error } = await supabase.from('feature_flags').select('key, enabled, rules');
  if (error) throw new Error(`feature_flags read failed: ${error.message}`);
  const out: Record<string, boolean> = {};
  for (const row of data ?? []) {
    const parsed = FlagRow.safeParse(row);
    // Rules (country, percent, min version) are not evaluated yet: a flag is on only when enabled.
    if (parsed.success) out[parsed.data.key] = parsed.data.enabled;
  }
  return out;
}
