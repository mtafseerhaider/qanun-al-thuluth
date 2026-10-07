import { z } from 'zod';

import { parseMinSupportedVersion, type MinSupportedVersion } from '@/lib/app-status/app-version';
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

/**
 * The `app.min_supported_version` row (a config flag: its rules carry the per-platform minimum,
 * which `evaluate_feature_flags()` reduces to a boolean). `feature_flags` is readable by every
 * authenticated user; signed out or not configured returns null (no forced upgrade until sign-in;
 * Edge Functions still answer UPGRADE_REQUIRED).
 */
export async function fetchMinSupportedVersion(): Promise<MinSupportedVersion | null> {
  if (!supabase) return null;
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return null;
  const { data, error } = await supabase
    .from('feature_flags')
    .select('enabled, rules')
    .eq('key', 'app.min_supported_version')
    .maybeSingle();
  if (error) throw new Error(`app.min_supported_version read failed: ${error.message}`);
  return parseMinSupportedVersion(data as { enabled: boolean; rules: unknown } | null);
}
