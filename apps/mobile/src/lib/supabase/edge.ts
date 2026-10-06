import { z } from 'zod';

import { env } from '@/lib/env';

import { AppError, isAppError } from './app-error';
import { getAccessToken } from './client';

export { AppError, isAppError };

/** Envelope from 00 §4.2. Codes are parsed leniently so a newer server code never crashes the client. */
const LenientErrorEnvelope = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});

export interface InvokeEdgeOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Overrides for tests. */
  baseUrl?: string;
  anonKey?: string;
  accessToken?: string | null;
  /** Extra request headers, e.g. `Idempotency-Key` (06 §2.4). */
  headers?: Record<string, string>;
}

/** URL and auth headers for an Edge Function call (shared by JSON, streaming and multipart calls). */
export async function edgeRequestInit(
  name: string,
  opts: Pick<InvokeEdgeOptions, 'baseUrl' | 'anonKey' | 'accessToken' | 'headers'> = {},
): Promise<{ url: string; headers: Record<string, string> }> {
  const baseUrl = opts.baseUrl ?? env.SUPABASE_URL;
  const anonKey = opts.anonKey ?? env.SUPABASE_ANON_KEY;
  if (!baseUrl || !anonKey)
    throw new AppError('NOT_CONFIGURED', 'Supabase URL or anon key is not configured.');
  const token = opts.accessToken !== undefined ? opts.accessToken : await getAccessToken();
  return {
    url: `${baseUrl.replace(/\/$/, '')}/functions/v1/${name}`,
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token ?? anonKey}`,
      'x-client-info': `thuluth-mobile/${env.APP_VERSION}`,
      ...opts.headers,
    },
  };
}

/** Maps a non-2xx response body (00 §4.2 envelope, parsed leniently) to an AppError. */
export function edgeErrorFrom(name: string, status: number, json: unknown): AppError {
  const envelope = LenientErrorEnvelope.safeParse(json);
  if (envelope.success) {
    const { code, message, details } = envelope.data.error;
    return new AppError(code as AppError['code'], message, { status, details: details ?? {} });
  }
  return new AppError(
    status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL',
    `Edge function ${name} failed with ${status}.`,
    { status },
  );
}

/**
 * Calls a Supabase Edge Function with a JSON body and validates the response with `responseSchema`.
 * Non-2xx responses are parsed as the error envelope and thrown as AppError.
 */
export async function invokeEdge<TReq, TRes>(
  name: string,
  body: TReq,
  responseSchema: z.ZodType<TRes, z.ZodTypeDef, unknown>,
  opts: InvokeEdgeOptions = {},
): Promise<TRes> {
  const baseUrl = opts.baseUrl ?? env.SUPABASE_URL;
  const anonKey = opts.anonKey ?? env.SUPABASE_ANON_KEY;
  if (!baseUrl || !anonKey)
    throw new AppError('NOT_CONFIGURED', 'Supabase URL or anon key is not configured.');

  const token = opts.accessToken !== undefined ? opts.accessToken : await getAccessToken();
  const doFetch = opts.fetchImpl ?? fetch;

  let res: Response;
  try {
    res = await doFetch(`${baseUrl.replace(/\/$/, '')}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: anonKey,
        authorization: `Bearer ${token ?? anonKey}`,
        'x-client-info': `thuluth-mobile/${env.APP_VERSION}`,
        ...opts.headers,
      },
      body: JSON.stringify(body),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (error) {
    throw new AppError(
      'NETWORK_ERROR',
      error instanceof Error ? error.message : 'Network request failed.',
    );
  }

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  if (!res.ok) {
    const envelope = LenientErrorEnvelope.safeParse(json);
    if (envelope.success) {
      const { code, message, details } = envelope.data.error;
      throw new AppError(code as AppError['code'], message, {
        status: res.status,
        details: details ?? {},
      });
    }
    throw new AppError(
      res.status === 401 ? 'UNAUTHENTICATED' : 'INTERNAL',
      `Edge function ${name} failed with ${res.status}.`,
      {
        status: res.status,
      },
    );
  }

  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) {
    throw new AppError('INVALID_RESPONSE', `Edge function ${name} returned an unexpected shape.`, {
      status: res.status,
      details: { issues: parsed.error.issues.map((i) => i.path.join('.')) },
    });
  }
  return parsed.data;
}
