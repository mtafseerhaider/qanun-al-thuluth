export type AppEnv = 'development' | 'staging' | 'production';

export function appEnv(): AppEnv {
  const value = Deno.env.get('APP_ENV');
  return value === 'staging' || value === 'production' ? value : 'development';
}

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing secret ${name}`);
  return value;
}
