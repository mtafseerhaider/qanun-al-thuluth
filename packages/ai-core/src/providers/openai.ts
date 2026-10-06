import { getEnv } from '../runtime/env.ts';
import { AIError } from '../types.ts';
import type {
  AIProvider,
  ChatRequest,
  ChatResponse,
  ContentPart,
  EmbedRequest,
  EmbedResponse,
  ModelParams,
  StopReason,
  StreamEvent,
  TranscribeRequest,
  TranscribeResponse,
} from '../types.ts';
import { httpError, postJson, streamFromChat, systemText, toBase64 } from './http.ts';
import type { FetchLike } from './http.ts';

const API_URL = 'https://api.openai.com/v1/responses';
const EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings';
const TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';

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

  /**
   * Audio transcription (route `speech.transcribe`, 12 §15) over multipart `fetch`. The audio is
   * held in memory only. `language` is the hint when given (the json format does not report one).
   */
  async transcribe(
    req: TranscribeRequest,
    model: string,
    params: ModelParams,
  ): Promise<TranscribeResponse> {
    const apiKey = this.#apiKey ?? getEnv('OPENAI_API_KEY');
    if (!apiKey) throw new AIError('AUTH', 'OPENAI_API_KEY is not set', { provider: this.id });
    const started = Date.now();
    const form = new FormData();
    const ext = req.mimeType.includes('webm')
      ? 'webm'
      : req.mimeType.includes('mpeg')
        ? 'mp3'
        : 'm4a';
    form.append(
      'file',
      new Blob([new Uint8Array(req.audio)], { type: req.mimeType }),
      `audio.${ext}`,
    );
    form.append('model', model);
    form.append('response_format', 'json');
    if (req.languageHint) form.append('language', req.languageHint);
    if (req.prompt) form.append('prompt', req.prompt);
    const timeout = AbortSignal.timeout(params.timeoutMs);
    const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await (this.#fetch ?? fetch)(TRANSCRIBE_URL, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}` },
        body: form,
        signal,
      });
    } catch (err) {
      if (timeout.aborted) throw new AIError('TIMEOUT', 'openai timed out', { provider: this.id });
      throw new AIError('NETWORK', `openai network error: ${String(err)}`, { provider: this.id });
    }
    if (!res.ok)
      throw httpError(this.id, res.status, await res.text().catch(() => ''), res.headers);
    const json = (await res.json()) as { text?: string; language?: string };
    return {
      provider: this.id,
      model,
      text: (json.text ?? '').trim(),
      language: json.language ?? req.languageHint ?? null,
      latencyMs: Date.now() - started,
    };
  }

  /** Embeddings API with `dimensions` (text-embedding-3-large at 1536 for `embed.knowledge`). */
  async embed(req: EmbedRequest, model: string, params: ModelParams): Promise<EmbedResponse> {
    const apiKey = this.#apiKey ?? getEnv('OPENAI_API_KEY');
    if (!apiKey) throw new AIError('AUTH', 'OPENAI_API_KEY is not set', { provider: this.id });
    const started = Date.now();
    const json = (await postJson(
      EMBEDDINGS_URL,
      { authorization: `Bearer ${apiKey}` },
      { model, input: req.inputs, dimensions: req.dimensions, encoding_format: 'float' },
      { provider: this.id, timeoutMs: params.timeoutMs, signal: req.signal, fetch: this.#fetch },
    )) as { data: { index: number; embedding: number[] }[]; usage?: { prompt_tokens?: number } };
    const vectors = [...json.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
    if (vectors.length !== req.inputs.length || vectors.some((v) => v.length !== req.dimensions)) {
      throw new AIError('INVALID_REQUEST', 'Embedding response shape mismatch', {
        provider: this.id,
      });
    }
    return {
      provider: this.id,
      model,
      vectors,
      usage: {
        inputTokens: json.usage?.prompt_tokens ?? 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      latencyMs: Date.now() - started,
    };
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
