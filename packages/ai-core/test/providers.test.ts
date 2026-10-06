import { describe, expect, it } from 'vitest';

import { AnthropicProvider } from '../src/providers/anthropic.ts';
import { GeminiProvider } from '../src/providers/gemini.ts';
import { OpenAiProvider } from '../src/providers/openai.ts';
import { AIError, textOf } from '../src/types.ts';
import { jsonFetch, params, request } from './helpers.ts';

describe('AnthropicProvider', () => {
  it('maps request and response', async () => {
    const fetch = jsonFetch(200, {
      content: [{ type: 'text', text: 'Wa alaikum salaam' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 12,
        output_tokens: 4,
        cache_read_input_tokens: 8,
        cache_creation_input_tokens: 0,
      },
    });
    const res = await new AnthropicProvider({ apiKey: 'k', fetch }).chat(
      request(),
      'claude-sonnet-5-5',
      params,
    );
    expect(textOf(res.content)).toBe('Wa alaikum salaam');
    expect(res.usage).toEqual({
      inputTokens: 20,
      outputTokens: 4,
      cacheReadTokens: 8,
      cacheWriteTokens: 0,
    });
    const call = fetch.calls[0]!;
    expect(call.url).toBe('https://api.anthropic.com/v1/messages');
    const body = JSON.parse(String(call.init.body));
    expect(body.model).toBe('claude-sonnet-5-5');
    expect(body.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect((call.init.headers as Record<string, string>)['x-api-key']).toBe('k');
  });

  it('maps 429 to a retryable RATE_LIMITED with retry-after', async () => {
    const fetch = jsonFetch(429, { error: 'slow down' }, { 'retry-after': '2' });
    const err = await new AnthropicProvider({ apiKey: 'k', fetch })
      .chat(request(), 'm', params)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AIError);
    expect((err as AIError).code).toBe('RATE_LIMITED');
    expect((err as AIError).retryable).toBe(true);
    expect((err as AIError).retryAfterMs).toBe(2000);
  });

  it('fails with AUTH when no key is configured', async () => {
    const err = await new AnthropicProvider({ fetch: jsonFetch(200, {}) })
      .chat(request(), 'm', params)
      .catch((e: unknown) => e);
    expect((err as AIError).code).toBe('AUTH');
  });
});

describe('OpenAiProvider', () => {
  it('maps the Responses API output', async () => {
    const fetch = jsonFetch(200, {
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'Hello' }] }],
      usage: { input_tokens: 9, output_tokens: 2, input_tokens_details: { cached_tokens: 0 } },
    });
    const res = await new OpenAiProvider({ apiKey: 'k', fetch }).chat(request(), 'gpt-x', params);
    expect(textOf(res.content)).toBe('Hello');
    expect(res.usage.inputTokens).toBe(9);
    const body = JSON.parse(String(fetch.calls[0]!.init.body));
    expect(body.instructions).toBe('You are Thuluth.');
    expect(body.input[0].content[0]).toEqual({ type: 'input_text', text: 'Salaam' });
  });
});

describe('GeminiProvider', () => {
  it('maps generateContent output', async () => {
    const fetch = jsonFetch(200, {
      candidates: [{ content: { parts: [{ text: 'Hi' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 1 },
    });
    const res = await new GeminiProvider({ apiKey: 'k', fetch }).chat(
      request(),
      'gemini-x',
      params,
    );
    expect(textOf(res.content)).toBe('Hi');
    expect(fetch.calls[0]!.url).toContain('/models/gemini-x:generateContent');
    const body = JSON.parse(String(fetch.calls[0]!.init.body));
    expect(body.systemInstruction.parts[0].text).toBe('You are Thuluth.');
  });
});
