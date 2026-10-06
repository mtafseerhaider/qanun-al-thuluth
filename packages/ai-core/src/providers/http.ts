import { AIError } from '../types.ts';
import type { ChatRequest, ChatResponse, ProviderId, StreamEvent } from '../types.ts';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface PostJsonOptions {
  provider: ProviderId;
  timeoutMs: number;
  signal?: AbortSignal | undefined;
  fetch?: FetchLike | undefined;
}

/** POSTs JSON and maps transport and HTTP failures onto `AIError` codes (12 §5.3, §5.4). */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  opts: PostJsonOptions,
): Promise<unknown> {
  const doFetch = opts.fetch ?? fetch;
  const timeout = AbortSignal.timeout(opts.timeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (timeout.aborted)
      throw new AIError('TIMEOUT', `${opts.provider} timed out`, { provider: opts.provider });
    if (opts.signal?.aborted) throw err;
    throw new AIError('NETWORK', `${opts.provider} network error: ${String(err)}`, {
      provider: opts.provider,
    });
  }
  if (res.ok) return res.json();
  const text = await res.text().catch(() => '');
  throw httpError(opts.provider, res.status, text, res.headers);
}

export function httpError(
  provider: ProviderId,
  status: number,
  body: string,
  headers: Headers,
): AIError {
  const retryAfterMs = parseRetryAfter(headers);
  const opts = { provider, status, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) };
  const snippet = body.slice(0, 300);
  if (status === 429) return new AIError('RATE_LIMITED', `${provider} rate limited`, opts);
  if (status === 529 || status === 503)
    return new AIError('OVERLOADED', `${provider} overloaded`, opts);
  if (status === 401 || status === 403)
    return new AIError('AUTH', `${provider} rejected credentials`, opts);
  if (status === 408 || status === 504)
    return new AIError('TIMEOUT', `${provider} timed out`, opts);
  if (status >= 500) return new AIError('SERVER_ERROR', `${provider} ${status}: ${snippet}`, opts);
  if (/context|too long|maximum.*tokens|token limit/i.test(body)) {
    return new AIError('CONTEXT_TOO_LONG', `${provider}: ${snippet}`, opts);
  }
  return new AIError('INVALID_REQUEST', `${provider} ${status}: ${snippet}`, opts);
}

function parseRetryAfter(headers: Headers): number | undefined {
  const ms = headers.get('retry-after-ms');
  if (ms && !Number.isNaN(Number(ms))) return Number(ms);
  const s = headers.get('retry-after');
  if (s && !Number.isNaN(Number(s))) return Number(s) * 1000;
  return undefined;
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function systemText(req: ChatRequest): string {
  return req.system
    .filter((p): p is Extract<typeof p, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('\n\n');
}

/**
 * Emits a whole `ChatResponse` as stream events. Adapters use this until token-level streaming lands
 * with `ai-chat` (Sprint 5); the event shape is already final so callers do not change.
 */
export async function* streamFromChat(
  req: ChatRequest,
  provider: ProviderId,
  model: string,
  chat: () => Promise<ChatResponse>,
): AsyncGenerator<StreamEvent> {
  yield { type: 'start', requestId: req.metadata.requestId, provider, model };
  try {
    const res = await chat();
    for (const part of res.content) {
      if (part.type === 'text') yield { type: 'text_delta', text: part.text };
      if (part.type === 'tool_call') {
        yield { type: 'tool_call_start', id: part.id, name: part.name };
        yield { type: 'tool_call_end', id: part.id, name: part.name, input: part.input };
      }
    }
    yield { type: 'usage', usage: res.usage };
    yield { type: 'end', stopReason: res.stopReason };
  } catch (err) {
    const error =
      err instanceof AIError ? err : new AIError('SERVER_ERROR', String(err), { provider });
    yield { type: 'error', error };
  }
}
