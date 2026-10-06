import { HttpError } from './errors.ts';

export interface AuthContext {
  userId: string;
  jwt: string;
  email?: string;
}

/** Verifies a JWT and returns its claims, or null when invalid. Real impl: `supabase.auth.getClaims`. */
export type ClaimsVerifier = (jwt: string) => Promise<{ sub: string; email?: string } | null>;

export async function requireUser(req: Request, verify: ClaimsVerifier): Promise<AuthContext> {
  const header = req.headers.get('authorization') ?? '';
  const jwt = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!jwt) throw new HttpError('UNAUTHENTICATED', 'Sign in to continue.');
  const claims = await verify(jwt).catch(() => null);
  if (!claims?.sub)
    throw new HttpError('UNAUTHENTICATED', 'Your session has expired. Sign in again.');
  return { userId: claims.sub, jwt, ...(claims.email ? { email: claims.email } : {}) };
}
