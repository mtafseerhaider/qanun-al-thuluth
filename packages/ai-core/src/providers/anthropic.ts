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
import { postJson, streamFromChat, toBase64 } from './http.ts';
import type { FetchLike } from './http.ts';

const API_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

interface AnthropicBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface AnthropicResponse {
  content: AnthropicBlock[];
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
}

export interface AnthropicProviderOptions {
  apiKey?: string;
  fetch?: FetchLike;
}

/** Anthropic Messages API adapter over raw fetch (12 §5.2). */
export class AnthropicProvider implements AIProvider {
  readonly id = 'anthropic' as const;
  readonly supports = {
    tools: true,
    vision: true,
    jsonSchema: true,
    promptCaching: 'explicit',
    streaming: true,
  } as const;

  readonly #apiKey: string | undefined;
  readonly #fetch: FetchLike | undefined;

  constructor(opts: AnthropicProviderOptions = {}) {
    this.#apiKey = opts.apiKey;
    this.#fetch = opts.fetch;
  }

  async chat(req: ChatRequest, model: string, params: ModelParams): Promise<ChatResponse> {
    const apiKey = this.#apiKey ?? getEnv('ANTHROPIC_API_KEY');
    if (!apiKey) throw new AIError('AUTH', 'ANTHROPIC_API_KEY is not set', { provider: this.id });
    const started = Date.now();
    const json = (await postJson(
      API_URL,
      { 'x-api-key': apiKey, 'anthropic-version': API_VERSION },
      toAnthropicBody(req, model, params),
      { provider: this.id, timeoutMs: params.timeoutMs, signal: req.signal, fetch: this.#fetch },
    )) as AnthropicResponse;
    return {
      provider: this.id,
      model,
      content: json.content.flatMap(fromAnthropicBlock),
      stopReason: mapStopReason(json.stop_reason),
      usage: {
        inputTokens:
          json.usage.input_tokens +
          (json.usage.cache_read_input_tokens ?? 0) +
          (json.usage.cache_creation_input_tokens ?? 0),
        outputTokens: json.usage.output_tokens,
        cacheReadTokens: json.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: json.usage.cache_creation_input_tokens ?? 0,
      },
      latencyMs: Date.now() - started,
    };
  }

  stream(req: ChatRequest, model: string, params: ModelParams): AsyncIterable<StreamEvent> {
    return streamFromChat(req, this.id, model, () => this.chat(req, model, params));
  }
}

export function toAnthropicBody(
  req: ChatRequest,
  model: string,
  params: ModelParams,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    max_tokens: params.maxOutputTokens ?? req.maxOutputTokens,
    system: req.system
      .filter((p) => p.type === 'text')
      .map((p) => ({
        type: 'text',
        text: p.text,
        ...(p.cache ? { cache_control: { type: 'ephemeral' } } : {}),
      })),
    messages: req.messages.map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content.map(toAnthropicBlock),
    })),
  };
  const temperature = req.temperature ?? params.temperature;
  if (temperature !== undefined) body.temperature = temperature;
  if (req.stopSequences?.length) body.stop_sequences = req.stopSequences;
  if (req.tools?.length && req.toolChoice !== 'none') {
    body.tools = req.tools.map((t, i, all) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
      ...(i === all.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
    }));
    if (req.toolChoice && typeof req.toolChoice === 'object') {
      body.tool_choice = { type: 'tool', name: req.toolChoice.name };
    }
  }
  return body;
}

function toAnthropicBlock(part: ContentPart): Record<string, unknown> {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text };
    case 'image':
      return {
        type: 'image',
        source:
          part.data instanceof Uint8Array
            ? { type: 'base64', media_type: part.mediaType, data: toBase64(part.data) }
            : { type: 'url', url: part.data.url },
      };
    case 'tool_call':
      return { type: 'tool_use', id: part.id, name: part.name, input: part.input };
    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: part.toolCallId,
        content: part.content,
        ...(part.isError ? { is_error: true } : {}),
      };
  }
}

function fromAnthropicBlock(block: AnthropicBlock): ContentPart[] {
  if (block.type === 'text' && typeof block.text === 'string')
    return [{ type: 'text', text: block.text }];
  if (block.type === 'tool_use' && block.id && block.name) {
    return [{ type: 'tool_call', id: block.id, name: block.name, input: block.input ?? {} }];
  }
  return [];
}

function mapStopReason(reason: string | null): StopReason {
  switch (reason) {
    case 'end_turn':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
      return 'max_tokens';
    case 'stop_sequence':
      return 'stop_sequence';
    case 'refusal':
      return 'content_filter';
    default:
      return 'end_turn';
  }
}
