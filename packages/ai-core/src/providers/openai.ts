import { getEnv } from '../runtime/env.ts';
import { AIError } from '../types.ts';
import type {
  AIProvider,
  ChatRequest,
  ChatResponse,
  ContentPart,
  ModelParams,
  StopReason,
  StreamEvent,
} from '../types.ts';
import { postJson, streamFromChat, systemText, toBase64 } from './http.ts';
import type { FetchLike } from './http.ts';

const API_URL = 'https://api.openai.com/v1/responses';

interface OpenAiOutputItem {
  type: string;
  content?: { type: string; text?: string }[];
  call_id?: string;
  name?: string;
  arguments?: string;
}

interface OpenAiResponse {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output: OpenAiOutputItem[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    input_tokens_details?: { cached_tokens?: number };
  };
}

export interface OpenAiProviderOptions {
  apiKey?: string;
  fetch?: FetchLike;
}

/** OpenAI Responses API adapter over raw fetch (12 §5.2). */
export class OpenAiProvider implements AIProvider {
  readonly id = 'openai' as const;
  readonly supports = {
    tools: true,
    vision: true,
    jsonSchema: true,
    promptCaching: 'automatic',
    streaming: true,
  } as const;

  readonly #apiKey: string | undefined;
  readonly #fetch: FetchLike | undefined;

  constructor(opts: OpenAiProviderOptions = {}) {
    this.#apiKey = opts.apiKey;
    this.#fetch = opts.fetch;
  }

  async chat(req: ChatRequest, model: string, params: ModelParams): Promise<ChatResponse> {
    const apiKey = this.#apiKey ?? getEnv('OPENAI_API_KEY');
    if (!apiKey) throw new AIError('AUTH', 'OPENAI_API_KEY is not set', { provider: this.id });
    const started = Date.now();
    const json = (await postJson(
      API_URL,
      { authorization: `Bearer ${apiKey}`, 'idempotency-key': req.metadata.requestId },
      toOpenAiBody(req, model, params),
      { provider: this.id, timeoutMs: params.timeoutMs, signal: req.signal, fetch: this.#fetch },
    )) as OpenAiResponse;

    const content: ContentPart[] = [];
    for (const item of json.output) {
      if (item.type === 'message') {
        for (const c of item.content ?? []) {
          if (c.type === 'output_text' && c.text) content.push({ type: 'text', text: c.text });
        }
      } else if (item.type === 'function_call' && item.call_id && item.name) {
        content.push({
          type: 'tool_call',
          id: item.call_id,
          name: item.name,
          input: safeJson(item.arguments),
        });
      }
    }
    const cached = json.usage?.input_tokens_details?.cached_tokens ?? 0;
    let stopReason: StopReason = content.some((c) => c.type === 'tool_call')
      ? 'tool_use'
      : 'end_turn';
    if (json.status === 'incomplete') {
      stopReason =
        json.incomplete_details?.reason === 'content_filter' ? 'content_filter' : 'max_tokens';
    }
    return {
      provider: this.id,
      model,
      content,
      stopReason,
      usage: {
        inputTokens: json.usage?.input_tokens ?? 0,
        outputTokens: json.usage?.output_tokens ?? 0,
        cacheReadTokens: cached,
        cacheWriteTokens: 0,
      },
      latencyMs: Date.now() - started,
    };
  }

  stream(req: ChatRequest, model: string, params: ModelParams): AsyncIterable<StreamEvent> {
    return streamFromChat(req, this.id, model, () => this.chat(req, model, params));
  }
}

export function toOpenAiBody(
  req: ChatRequest,
  model: string,
  params: ModelParams,
): Record<string, unknown> {
  const input: Record<string, unknown>[] = [];
  for (const m of req.messages) {
    const parts: Record<string, unknown>[] = [];
    for (const part of m.content) {
      if (part.type === 'tool_call') {
        input.push({
          type: 'function_call',
          call_id: part.id,
          name: part.name,
          arguments: JSON.stringify(part.input),
        });
      } else if (part.type === 'tool_result') {
        input.push({
          type: 'function_call_output',
          call_id: part.toolCallId,
          output: part.content,
        });
      } else if (part.type === 'text') {
        parts.push({
          type: m.role === 'assistant' ? 'output_text' : 'input_text',
          text: part.text,
        });
      } else {
        parts.push({
          type: 'input_image',
          image_url:
            part.data instanceof Uint8Array
              ? `data:${part.mediaType};base64,${toBase64(part.data)}`
              : part.data.url,
        });
      }
    }
    if (parts.length > 0)
      input.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: parts });
  }
  const body: Record<string, unknown> = {
    model,
    instructions: systemText(req),
    input,
    max_output_tokens: params.maxOutputTokens ?? req.maxOutputTokens,
    store: false,
  };
  const temperature = req.temperature ?? params.temperature;
  if (temperature !== undefined) body.temperature = temperature;
  if (req.tools?.length && req.toolChoice !== 'none') {
    body.tools = req.tools.map((t) => ({
      type: 'function',
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
      strict: true,
    }));
    if (req.toolChoice && typeof req.toolChoice === 'object') {
      body.tool_choice = { type: 'function', name: req.toolChoice.name };
    }
  }
  return body;
}

function safeJson(text: string | undefined): unknown {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AIError('INVALID_REQUEST', 'Tool call arguments were not valid JSON', {
      provider: 'openai',
    });
  }
}
