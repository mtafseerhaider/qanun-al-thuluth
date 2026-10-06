declare const Deno: { env: { get(name: string): string | undefined } } | undefined;
declare const process: { env: Record<string, string | undefined> } | undefined;

/** Reads an environment variable in Deno (Edge Functions) or Node (evals, tests). */
export function getEnv(name: string): string | undefined {
  if (typeof Deno !== 'undefined') return Deno.env.get(name);
  return typeof process !== 'undefined' ? process.env[name] : undefined;
}

export function requireEnv(name: string): string {
  const value = getEnv(name);
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}
