import { getEnv } from '../runtime/env.ts';
import { AIError, effectiveMaxOutputTokens } from '../types.ts';
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
  [k: string]: unknown;
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
      content: json.content.flatMap((b) => fromAnthropicBlock(b, model)),
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

/**
 * Models that reject sampling parameters (`temperature`, `top_p`): a non-default value is a 400 on
 * Claude Opus 4.7+, Opus 5.x, Sonnet 5.x, Fable and Mythos. Routes keep `temperature` in params for
 * the other providers; this adapter drops it for these models instead of failing the call.
 */
export function anthropicAcceptsSampling(model: string): boolean {
  return !/^claude-(opus-(4-[789]|5)|sonnet-5|fable|mythos)/.test(model);
}

/** `output_config.effort` is accepted on Opus 4.5+, Sonnet 4.6+/5.x, Fable and Mythos, not Haiku. */
function acceptsEffort(model: string): boolean {
  return /^claude-(opus-(4-[5-9]|5)|sonnet-(4-6|5)|fable|mythos)/.test(model);
}

/** Max four `cache_control` breakpoints per request (Anthropic prompt caching). */
const MAX_BREAKPOINTS = 4;

export function toAnthropicBody(
  req: ChatRequest,
  model: string,
  params: ModelParams,
): Record<string, unknown> {
  let breakpoints = 0;
  // The conversation-tail marker keeps a slot: it is the one later steps and turns read from.
  const reserved = req.cacheTail ? 1 : 0;
  const mark = (tail = false) =>
    breakpoints < MAX_BREAKPOINTS - (tail ? 0 : reserved) ? (breakpoints++, true) : false;
  // Tools render first, then system, then messages (prompt-cache prefix order). Tools are kept even
  // when `toolChoice` is 'none' (sent as tool_choice none): dropping them would change the prefix
  // and miss the tools + system cache on the final step of every tool loop (S7-02).
  const tools = req.tools?.length
    ? req.tools.map((t, i, all) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
        ...(i === all.length - 1 && mark() ? { cache_control: { type: 'ephemeral' } } : {}),
      }))
    : undefined;
  const system = req.system
    .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => ({
      type: 'text',
      text: p.text,
      ...(p.cache && mark() ? { cache_control: { type: 'ephemeral' } } : {}),
    }));
  const messages = req.messages
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content.flatMap((part) => toAnthropicBlock(part, model)),
    }))
    .filter((m) => m.content.length > 0);
  if (req.cacheTail && mark(true)) {
    const last = messages[messages.length - 1]?.content;
    const block = last?.[last.length - 1];
    if (block && block.type !== 'thinking' && block.type !== 'redacted_thinking') {
      block.cache_control = { type: 'ephemeral' };
    }
  }
  const body: Record<string, unknown> = {
    model,
    max_tokens: effectiveMaxOutputTokens(req, params),
    system,
    messages,
  };
  const temperature = req.temperature ?? params.temperature;
  if (temperature !== undefined && anthropicAcceptsSampling(model)) body.temperature = temperature;
  if (req.stopSequences?.length) body.stop_sequences = req.stopSequences;
  if (params.effort && acceptsEffort(model)) body.output_config = { effort: params.effort };
  if (params.thinking === 'between_tools' && /^claude-sonnet-5-5/.test(model)) {
    body.thinking = { type: 'between_tools' };
  } else if (params.thinking === 'adaptive' && acceptsEffort(model)) {
    body.thinking = { type: 'adaptive' };
  }
  if (tools) {
    body.tools = tools;
    if (req.toolChoice === 'none') body.tool_choice = { type: 'none' };
    else if (req.toolChoice && typeof req.toolChoice === 'object') {
      body.tool_choice = { type: 'tool', name: req.toolChoice.name };
    }
  }
  return body;
}

function toAnthropicBlock(part: ContentPart, model: string): Record<string, unknown>[] {
  switch (part.type) {
    case 'text':
      return [{ type: 'text', text: part.text }];
    case 'image':
      return [
        {
          type: 'image',
          source:
            part.data instanceof Uint8Array
              ? { type: 'base64', media_type: part.mediaType, data: toBase64(part.data) }
              : { type: 'url', url: part.data.url },
        },
      ];
    case 'tool_call':
      return [{ type: 'tool_use', id: part.id, name: part.name, input: part.input }];
    case 'tool_result':
      return [
        {
          type: 'tool_result',
          tool_use_id: part.toolCallId,
          content: part.content,
          ...(part.isError ? { is_error: true } : {}),
        },
      ];
    case 'opaque':
      // Thinking blocks are replayed unchanged, and only to the model that wrote them.
      return part.provider === 'anthropic' && part.model === model ? [{ ...part.block }] : [];
  }
}

function fromAnthropicBlock(block: AnthropicBlock, model: string): ContentPart[] {
  if (block.type === 'text' && typeof block.text === 'string')
    return [{ type: 'text', text: block.text }];
  if (block.type === 'tool_use' && block.id && block.name) {
    return [{ type: 'tool_call', id: block.id, name: block.name, input: block.input ?? {} }];
  }
  if (block.type === 'thinking' || block.type === 'redacted_thinking') {
    // Must go back unchanged with the assistant turn in a tool loop (adaptive / between_tools).
    return [{ type: 'opaque', provider: 'anthropic', model, block: { ...block } }];
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
