import { z } from 'zod';

import { supabase } from '@/lib/supabase/client';

const Flags = z.record(z.string(), z.boolean());

/**
 * Evaluates `feature_flags` server-side with `evaluate_feature_flags()` (05 §25.5, 09 §5): country,
 * tier, min app version (from the x-app-version header), percent and allow-list rules all apply.
 * Returns {} when signed out or not configured, so every flag falls back to its safe default
 * (disabled). Unknown or non-boolean values are dropped.
 */
export async function fetchFeatureFlags(): Promise<Record<string, boolean>> {
  if (!supabase) return {};
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return {};
  const { data, error } = await supabase.rpc('evaluate_feature_flags');
  if (error) throw new Error(`evaluate_feature_flags failed: ${error.message}`);
  const parsed = Flags.safeParse(data ?? {});
  if (parsed.success) return parsed.data;
  const out: Record<string, boolean> = {};
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const [key, value] of Object.entries(data))
      if (typeof value === 'boolean') out[key] = value;
  }
  return out;
}
