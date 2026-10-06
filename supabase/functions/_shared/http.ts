import type { z } from 'zod';

import { corsHeaders } from './cors.ts';
import { errorResponse, HttpError } from './errors.ts';

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
  handler: (ctx: HandlerContext<z.infer<S>>) => Promise<O>,
  opts: { onError?: (err: unknown, requestId: string) => void } = {},
): (req: Request) => Promise<Response> {
  return async (req) => {
    const requestId = req.headers.get('x-request-id') ?? crypto.randomUUID();
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    try {
      if (req.method !== 'POST') throw new HttpError('NOT_FOUND', 'Not found');
      const raw = await req.json().catch(() => {
        throw new HttpError('VALIDATION_FAILED', 'Body must be JSON');
      });
      const parsed = input.safeParse(raw);
      if (!parsed.success) {
        throw new HttpError('VALIDATION_FAILED', 'Request is invalid', {
          issues: parsed.error.issues,
        });
      }
      const body = await handler({ req, input: parsed.data, requestId });
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
