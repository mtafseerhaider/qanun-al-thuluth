import Constants from 'expo-constants';
import { z } from 'zod';

/**
 * Typed access to `Constants.expoConfig.extra` (docs/07 §9.3). Every third-party key is optional so
 * the app starts without Supabase, Sentry, RevenueCat or OneSignal; features degrade to no-ops.
 */
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

export const EnvSchema = z.object({
  APP_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  APP_VERSION: z.string().default('0.0.0'),
  SUPABASE_URL: optionalString.pipe(z.string().url().optional()),
  SUPABASE_ANON_KEY: optionalString,
  SENTRY_DSN: optionalString,
  ONESIGNAL_APP_ID: optionalString,
  REVENUECAT_API_KEY_IOS: optionalString,
  REVENUECAT_API_KEY_ANDROID: optionalString,
  GOOGLE_WEB_CLIENT_ID: optionalString,
  GOOGLE_IOS_CLIENT_ID: optionalString,
});
export type Env = z.infer<typeof EnvSchema>;

export function parseEnv(extra: unknown): Env {
  const result = EnvSchema.safeParse(extra ?? {});
  if (result.success) return result.data;
  const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  if (__DEV__) throw new Error(`Invalid app config extra (check apps/mobile/.env): ${issues}`);
  // In release builds fall back to safe defaults instead of crashing on launch.
  return EnvSchema.parse({});
}

export const env: Env = parseEnv(Constants.expoConfig?.extra);

export const isDevelopment = env.APP_ENV === 'development';
export const isSupabaseConfigured = Boolean(env.SUPABASE_URL && env.SUPABASE_ANON_KEY);
