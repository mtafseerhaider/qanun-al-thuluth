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
import { postJson, streamFromChat, systemText, toBase64 } from './http.ts';
import type { FetchLike } from './http.ts';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: unknown };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
  };
}

export interface GeminiProviderOptions {
  apiKey?: string;
  fetch?: FetchLike;
}

/** Google Gemini `generateContent` adapter over raw fetch (12 §5.2). */
export class GeminiProvider implements AIProvider {
  readonly id = 'gemini' as const;
  readonly supports = {
    tools: true,
    vision: true,
    jsonSchema: true,
    promptCaching: 'automatic',
    streaming: true,
  } as const;

  readonly #apiKey: string | undefined;
  readonly #fetch: FetchLike | undefined;

  constructor(opts: GeminiProviderOptions = {}) {
    this.#apiKey = opts.apiKey;
    this.#fetch = opts.fetch;
  }

  async chat(req: ChatRequest, model: string, params: ModelParams): Promise<ChatResponse> {
    const apiKey = this.#apiKey ?? getEnv('GEMINI_API_KEY');
    if (!apiKey) throw new AIError('AUTH', 'GEMINI_API_KEY is not set', { provider: this.id });
    const started = Date.now();
    const json = (await postJson(
      `${API_BASE}/${encodeURIComponent(model)}:generateContent`,
      { 'x-goog-api-key': apiKey },
      toGeminiBody(req, params),
      { provider: this.id, timeoutMs: params.timeoutMs, signal: req.signal, fetch: this.#fetch },
    )) as GeminiResponse;

    const candidate = json.candidates?.[0];
    const content: ContentPart[] = [];
    let callIndex = 0;
    for (const part of candidate?.content?.parts ?? []) {
      if (typeof part.text === 'string') content.push({ type: 'text', text: part.text });
      if (part.functionCall) {
        content.push({
          type: 'tool_call',
          id: `${part.functionCall.name}_${callIndex++}`,
          name: part.functionCall.name,
          input: part.functionCall.args ?? {},
        });
      }
    }
    return {
      provider: this.id,
      model,
      content,
      stopReason: mapFinishReason(candidate?.finishReason, content),
      usage: {
        inputTokens: json.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0,
        cacheReadTokens: json.usageMetadata?.cachedContentTokenCount ?? 0,
        cacheWriteTokens: 0,
      },
      latencyMs: Date.now() - started,
    };
  }

  stream(req: ChatRequest, model: string, params: ModelParams): AsyncIterable<StreamEvent> {
    return streamFromChat(req, this.id, model, () => this.chat(req, model, params));
  }
}

/** Gemini's schema dialect is an OpenAPI subset; drop keywords it rejects. */
function stripUnsupported(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(stripUnsupported);
  if (schema && typeof schema === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema)) {
      if (k === 'additionalProperties' || k === '$schema' || k === 'pattern') continue;
      out[k] = stripUnsupported(v);
    }
    return out;
  }
  return schema;
}

export function toGeminiBody(req: ChatRequest, params: ModelParams): Record<string, unknown> {
  const toolNames = new Map<string, string>();
  const contents = req.messages
    .map((m) => ({ ...m, content: m.content.filter((p) => p.type !== 'opaque') }))
    .filter((m) => m.content.length > 0)
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: m.content.map((part) => {
        switch (part.type) {
          case 'text':
            return { text: part.text };
          case 'image':
            if (!(part.data instanceof Uint8Array)) {
              return { fileData: { mimeType: part.mediaType, fileUri: part.data.url } };
            }
            return { inlineData: { mimeType: part.mediaType, data: toBase64(part.data) } };
          case 'tool_call':
            toolNames.set(part.id, part.name);
            return { functionCall: { name: part.name, args: part.input } };
          case 'tool_result':
            return {
              functionResponse: {
                name: toolNames.get(part.toolCallId) ?? part.toolCallId,
                response: { content: part.content },
              },
            };
        }
      }),
    }));
  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: effectiveMaxOutputTokens(req, params),
  };
  const temperature = req.temperature ?? params.temperature;
  if (temperature !== undefined) generationConfig.temperature = temperature;
  if (req.stopSequences?.length) generationConfig.stopSequences = req.stopSequences;

  const body: Record<string, unknown> = { contents, generationConfig };
  const system = systemText(req);
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (req.tools?.length) {
    if (req.toolChoice === 'none') body.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
    body.tools = [
      {
        functionDeclarations: req.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: stripUnsupported(t.inputSchema),
        })),
      },
    ];
  }
  return body;
}

function mapFinishReason(reason: string | undefined, content: ContentPart[]): StopReason {
  if (content.some((c) => c.type === 'tool_call')) return 'tool_use';
  switch (reason) {
    case 'MAX_TOKENS':
      return 'max_tokens';
    case 'SAFETY':
    case 'RECITATION':
    case 'PROHIBITED_CONTENT':
    case 'BLOCKLIST':
      return 'content_filter';
    default:
      return 'end_turn';
  }
}
