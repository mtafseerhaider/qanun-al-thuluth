import type { ChatRequest, ModelParams } from '../src/types.ts';

export const params: ModelParams = {
  timeoutMs: 1_000,
  priceInPerMTokUsd: 3,
  priceOutPerMTokUsd: 15,
};

export function request(text = 'Salaam'): ChatRequest {
  return {
    route: 'chat.default',
    system: [{ type: 'text', text: 'You are Thuluth.', cache: true }],
    messages: [{ role: 'user', content: [{ type: 'text', text }] }],
    maxOutputTokens: 100,
    metadata: {
      requestId: '00000000-0000-4000-8000-000000000001',
      userId: '00000000-0000-4000-8000-000000000002',
      householdId: null,
      promptKey: 'smoke',
      promptVersion: 1,
      tier: 'free',
    },
  };
}

export function jsonFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
  };
  return Object.assign(fn, { calls });
}
