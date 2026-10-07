import { z } from 'zod';

/**
 * Forced upgrade (06 §1, 19 §4.3, 02 §7.1.1 "Forced update"): `feature_flags['app.min_supported_version']`
 * holds the lowest supported store version per platform. The seeded rules are
 * `{"value":{"ios":"1.0.0","android":"1.0.0"}}`; 19 §4.3 writes the same object without `value`, so
 * both shapes are read. Optional `ios_store_url` / `android_store_url` override the store link (the
 * App Store id is not known until the App Store Connect record exists).
 */
export type StorePlatform = 'ios' | 'android';

export interface MinSupportedVersion {
  ios?: string;
  android?: string;
  ios_store_url?: string;
  android_store_url?: string;
}

const VERSION = /^\d+(\.\d+)*$/;
const Rules = z
  .object({
    ios: z.string().regex(VERSION).optional().catch(undefined),
    android: z.string().regex(VERSION).optional().catch(undefined),
    ios_store_url: z.string().url().optional().catch(undefined),
    android_store_url: z.string().url().optional().catch(undefined),
  })
  .passthrough();

/** Reads the flag row; a disabled flag or unreadable rules mean "no minimum". */
export function parseMinSupportedVersion(
  row: { enabled: boolean; rules: unknown } | null,
): MinSupportedVersion | null {
  if (!row?.enabled || typeof row.rules !== 'object' || row.rules === null) return null;
  const rules = row.rules as Record<string, unknown>;
  const candidate = typeof rules.value === 'object' && rules.value !== null ? rules.value : rules;
  const parsed = Rules.safeParse(candidate);
  if (!parsed.success) return null;
  const { ios, android, ios_store_url, android_store_url } = parsed.data;
  return {
    ...(ios ? { ios } : {}),
    ...(android ? { android } : {}),
    ...(ios_store_url ? { ios_store_url } : {}),
    ...(android_store_url ? { android_store_url } : {}),
  };
}

/** Numeric dotted compare ("1.10.0" > "1.9.2"); missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** True when the installed version is below this platform's minimum. Unknown versions never block. */
export function isBelowMinimum(
  installed: string,
  min: MinSupportedVersion | null,
  platform: StorePlatform,
): boolean {
  const required = min?.[platform];
  if (!required || !VERSION.test(installed)) return false;
  return compareVersions(installed, required) < 0;
}

/** Store links to try in order: the flag's override, the store app, then the store website. */
export function storeUrls(
  platform: StorePlatform,
  packageId: string,
  min: MinSupportedVersion | null,
): string[] {
  if (platform === 'android') {
    return [
      ...(min?.android_store_url ? [min.android_store_url] : []),
      `market://details?id=${packageId}`,
      `https://play.google.com/store/apps/details?id=${packageId}`,
    ];
  }
  return [
    ...(min?.ios_store_url ? [min.ios_store_url] : []),
    'itms-apps://apps.apple.com/',
    'https://apps.apple.com/',
  ];
}
