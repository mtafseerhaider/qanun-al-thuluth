import { z } from 'zod';

import { CLIENT_CAPS_HEADER, REAUTH_CLIENT_CAP } from '@shared/contracts';

import { env } from '@/lib/env';
import { useAppStatusStore } from '@/stores/use-app-status-store';

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

/**
 * Headers on every Edge Function call. The client-caps header tells the server this build handles
 * `REAUTH_REQUIRED` (older builds get UNAUTHENTICATED + details.reauth instead; S7 backend).
 */
function baseHeaders(anonKey: string, token: string | null): Record<string, string> {
  return {
    apikey: anonKey,
    authorization: `Bearer ${token ?? anonKey}`,
    'x-client-info': `thuluth-mobile/${env.APP_VERSION}`,
    [CLIENT_CAPS_HEADER]: REAUTH_CLIENT_CAP,
  };
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
    headers: { ...baseHeaders(anonKey, token), ...opts.headers },
  };
}

/**
 * Maps a non-2xx response body (00 §4.2 envelope, parsed leniently) to an AppError. UPGRADE_REQUIRED
 * and maintenance (FEATURE_DISABLED, details.reason 'maintenance') also switch the app to its
 * blocking screen (app/app-gate.tsx).
 */
export function edgeErrorFrom(name: string, status: number, json: unknown): AppError {
  const envelope = LenientErrorEnvelope.safeParse(json);
  if (envelope.success) {
    const { code, message, details } = envelope.data.error;
    useAppStatusStore.getState().noteEdgeError({ code, details: details ?? {} });
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
        ...baseHeaders(anonKey, token),
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

  if (!res.ok) throw edgeErrorFrom(name, res.status, json);

  const parsed = responseSchema.safeParse(json);
  if (!parsed.success) {
    throw new AppError('INVALID_RESPONSE', `Edge function ${name} returned an unexpected shape.`, {
      status: res.status,
      details: { issues: parsed.error.issues.map((i) => i.path.join('.')) },
    });
  }
  return parsed.data;
}

/**
 * GET on an Edge Function with query parameters (e.g. `export-pdf?export_id=`), validated like
 * `invokeEdge`. Used for status polling and refreshing a signed URL.
 */
export async function getEdge<TRes>(
  name: string,
  query: Record<string, string>,
  responseSchema: z.ZodType<TRes, z.ZodTypeDef, unknown>,
  opts: InvokeEdgeOptions = {},
): Promise<TRes> {
  const { url, headers } = await edgeRequestInit(name, opts);
  const qs = new URLSearchParams(query).toString();
  let res: Response;
  try {
    res = await (opts.fetchImpl ?? fetch)(`${url}?${qs}`, {
      method: 'GET',
      headers,
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
  if (!res.ok) throw edgeErrorFrom(name, res.status, json);
  const parsed = responseSchema.safeParse(json);
  if (!parsed.success)
    throw new AppError('INVALID_RESPONSE', `Edge function ${name} returned an unexpected shape.`, {
      status: res.status,
    });
  return parsed.data;
}
