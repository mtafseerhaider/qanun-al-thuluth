import type { z } from 'zod';

import { corsHeaders } from './cors.ts';
import { errorResponse, HttpError } from './errors.ts';

/** 06 §2.8: JSON request bodies over 256 KB are refused with PAYLOAD_TOO_LARGE. */
export const MAX_JSON_BODY_BYTES = 256 * 1024;

/**
 * Reads the request body as UTF-8 text, refusing it (PAYLOAD_TOO_LARGE) as soon as it passes
 * `maxBytes`. The declared content-length is checked first; the stream is still counted because
 * chunked uploads carry no length (S7-03).
 */
export async function readBodyText(req: Request, maxBytes: number): Promise<string> {
  const tooLarge = () =>
    new HttpError('PAYLOAD_TOO_LARGE', 'Request body is too large', { max_bytes: maxBytes });
  const declared = Number(req.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

/** Client request ids are echoed in headers and logs, so only a short token is accepted. */
export function requestIdOf(req: Request): string {
  const given = req.headers.get('x-request-id') ?? '';
  return /^[A-Za-z0-9._:-]{1,64}$/.test(given) ? given : crypto.randomUUID();
}

export interface HandlerContext<I> {
  req: Request;
  input: I;
  requestId: string;
}

/**
 * Wraps a JSON POST handler: CORS preflight, request id, JSON parse, Zod validation, and the
 * error envelope (10 §2.2). Returns a plain `(Request) => Promise<Response>` so tests call it directly.
 */
export function jsonHandler<S extends z.ZodTypeAny, O>(
  input: S,
  handler: (ctx: HandlerContext<z.infer<S>>) => Promise<O | Response>,
  opts: { onError?: (err: unknown, requestId: string) => void; maxBodyBytes?: number } = {},
): (req: Request) => Promise<Response> {
  return async (req) => {
    const requestId = requestIdOf(req);
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    try {
      if (req.method !== 'POST') throw new HttpError('NOT_FOUND', 'Not found');
      const text = await readBodyText(req, opts.maxBodyBytes ?? MAX_JSON_BODY_BYTES);
      let raw: unknown;
      try {
        raw = JSON.parse(text);
      } catch {
        throw new HttpError('VALIDATION_FAILED', 'Body must be JSON');
      }
      const parsed = input.safeParse(raw);
      if (!parsed.success) {
        throw new HttpError('VALIDATION_FAILED', 'Request is invalid', {
          issues: parsed.error.issues,
        });
      }
      const body = await handler({ req, input: parsed.data, requestId });
      // A handler may return a full Response (idempotent replays, rate-limit headers).
      if (body instanceof Response) {
        for (const [k, v] of Object.entries(corsHeaders)) body.headers.set(k, v);
        body.headers.set('x-request-id', requestId);
        return body;
      }
      return Response.json(body, { headers: { ...corsHeaders, 'x-request-id': requestId } });
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err, requestId);
      opts.onError?.(err, requestId);
      console.error(JSON.stringify({ level: 'error', request_id: requestId, error: String(err) }));
      return errorResponse(
        new HttpError('INTERNAL', 'Something went wrong. Please try again.'),
        requestId,
      );
    }
  };
}
