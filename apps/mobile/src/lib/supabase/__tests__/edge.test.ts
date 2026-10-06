import { AiSmokeResponse } from '@shared/contracts';

import { AppError } from '../app-error';
import { invokeEdge } from '../edge';

const okBody = {
  reply: 'Salaam!',
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  route_key: 'chat.default',
  usage: { tokens_in: 12, tokens_out: 4 },
  latency_ms: 812,
};

function fetchReturning(status: number, body: unknown) {
  return jest.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
  );
}

const opts = { baseUrl: 'https://example.supabase.co', anonKey: 'anon', accessToken: 'jwt' };

describe('invokeEdge', () => {
  it('posts JSON with auth headers and parses the response schema', async () => {
    const fetchImpl = fetchReturning(200, okBody);
    const res = await invokeEdge('ai-smoke', { prompt: 'hi' }, AiSmokeResponse, {
      ...opts,
      fetchImpl,
    });
    expect(res.reply).toBe('Salaam!');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://example.supabase.co/functions/v1/ai-smoke');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer jwt');
    expect(init.body).toBe(JSON.stringify({ prompt: 'hi' }));
  });

  it('throws AppError from the error envelope', async () => {
    const fetchImpl = fetchReturning(429, {
      error: { code: 'QUOTA_EXCEEDED', message: 'Daily limit', details: { limit: 20 } },
    });
    await expect(
      invokeEdge('ai-smoke', { prompt: 'hi' }, AiSmokeResponse, { ...opts, fetchImpl }),
    ).rejects.toMatchObject({
      code: 'QUOTA_EXCEEDED',
      status: 429,
      details: { limit: 20 },
    });
  });

  it('flags responses that do not match the schema', async () => {
    const fetchImpl = fetchReturning(200, { reply: 1 });
    await expect(
      invokeEdge('ai-smoke', {}, AiSmokeResponse, { ...opts, fetchImpl }),
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('reports NOT_CONFIGURED without Supabase settings', async () => {
    await expect(
      invokeEdge('ai-smoke', {}, AiSmokeResponse, { baseUrl: '', anonKey: '' }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('wraps network failures', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    await expect(
      invokeEdge('ai-smoke', {}, AiSmokeResponse, { ...opts, fetchImpl }),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
