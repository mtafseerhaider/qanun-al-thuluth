import type { z } from 'zod';

/** Provider ids. The database stores Gemini as `google` (05 §10.5); the route resolver maps it. */
export type ProviderId = 'anthropic' | 'openai' | 'gemini';

export type RouteKey =
  | 'chat.default'
  | 'chat.free' // Addition beyond 00-foundations: free-tier chat on the cheapest model (00 §11 open decision 1 default)
  | 'plan.generate'
  | 'plan.adjust'
  | 'vision.meal_analysis'
  | 'classify.safety'
  | 'classify.intent'
  | 'speech.transcribe'
  | 'embed.knowledge'
  | 'chat.summarize' // Addition beyond 00-foundations (12 §21)
  | 'eval.judge'; // Addition beyond 00-foundations (12 §21)

export type ContentPart =
  | { type: 'text'; text: string; cache?: boolean }
  | {
      type: 'image';
      mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
      data: Uint8Array | { url: string };
    }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolCallId: string; content: string; isError?: boolean };

export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool';
  content: ContentPart[];
}

export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [k: string]: unknown;
}

export interface ToolDefinition<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  inputZod: z.ZodType<I>;
  outputZod: z.ZodType<O>;
  tier: 'free' | 'premium';
  sideEffects: 'none' | 'writes';
  timeoutMs: number;
}

export interface RequestMetadata {
  requestId: string;
  userId: string;
  householdId: string | null;
  promptKey: string;
  promptVersion: number;
  tier: 'free' | 'premium';
  experiment?: { key: string; variant: string };
}

export interface ChatRequest {
  route: RouteKey;
  /** System prompt blocks; stable blocks first for caching. */
  system: ContentPart[];
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | { name: string };
  maxOutputTokens: number;
  temperature?: number;
  stopSequences?: string[];
  metadata: RequestMetadata;
  signal?: AbortSignal;
}

export type StopReason =
  'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'content_filter' | 'error';

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const ZERO_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

export interface ChatResponse {
  provider: ProviderId;
  model: string;
  content: ContentPart[];
  stopReason: StopReason;
  usage: Usage;
  latencyMs: number;
}

export type StreamEvent =
  | { type: 'start'; requestId: string; provider: ProviderId; model: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_start'; id: string; name: string }
  | { type: 'tool_call_delta'; id: string; partialJson: string }
  | { type: 'tool_call_end'; id: string; name: string; input: unknown }
  | { type: 'usage'; usage: Usage }
  | { type: 'end'; stopReason: StopReason }
  | { type: 'error'; error: AIError };

export interface ModelParams {
  temperature?: number;
  maxOutputTokens?: number;
  /** Per-attempt timeout. */
  timeoutMs: number;
  /** USD per million tokens; numerically equal to micro-USD per token. */
  priceInPerMTokUsd: number;
  priceOutPerMTokUsd: number;
  priceCacheReadPerMTokUsd?: number;
  priceCacheWritePerMTokUsd?: number;
  [k: string]: unknown;
}

export interface ModelRoute {
  routeKey: RouteKey;
  provider: ProviderId;
  model: string;
  params: ModelParams;
  /** 1 = primary, 2 = first fallback, ... */
  priority: number;
  enabled: boolean;
}

export interface ProviderCapabilities {
  tools: boolean;
  vision: boolean;
  jsonSchema: boolean;
  promptCaching: 'explicit' | 'automatic' | 'none';
  streaming: boolean;
}

export interface EmbedRequest {
  route: RouteKey;
  inputs: string[];
  /** Output dimensions (12 §4.2: text-embedding-3-large reduced to 1536). */
  dimensions: number;
  metadata: RequestMetadata;
  signal?: AbortSignal;
}

export interface EmbedResponse {
  provider: ProviderId;
  model: string;
  vectors: number[][];
  usage: Usage;
  latencyMs: number;
}

export interface TranscribeRequest {
  route: RouteKey;
  audio: Uint8Array;
  mimeType: string;
  /** Advisory; the provider returns the detected language when it can (12 §15). */
  languageHint?: 'en' | 'ur' | 'ar' | undefined;
  /** Vocabulary bias (food words), sent as the provider's prompt where supported. */
  prompt?: string | undefined;
  metadata: RequestMetadata;
  signal?: AbortSignal | undefined;
}

export interface TranscribeResponse {
  provider: ProviderId;
  model: string;
  text: string;
  /** Detected language (BCP-47) or null when the provider does not report it. */
  language: string | null;
  latencyMs: number;
}

export interface AIProvider {
  readonly id: ProviderId;
  readonly supports: ProviderCapabilities;
  chat(req: ChatRequest, model: string, params: ModelParams): Promise<ChatResponse>;
  stream(req: ChatRequest, model: string, params: ModelParams): AsyncIterable<StreamEvent>;
  /** Embeddings (route `embed.knowledge`); only providers that serve an embedding route implement it. */
  embed?(req: EmbedRequest, model: string, params: ModelParams): Promise<EmbedResponse>;
  /** Speech to text (route `speech.transcribe`, 12 §15); optional per provider. */
  transcribe?(
    req: TranscribeRequest,
    model: string,
    params: ModelParams,
  ): Promise<TranscribeResponse>;
}

export type AIErrorCode =
  | 'RATE_LIMITED'
  | 'OVERLOADED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'SERVER_ERROR'
  | 'CONTEXT_TOO_LONG'
  | 'INVALID_REQUEST'
  | 'AUTH'
  | 'CONTENT_FILTERED'
  | 'SCHEMA_VALIDATION_FAILED'
  | 'ALL_ROUTES_FAILED'
  | 'BUDGET_EXCEEDED';

const RETRYABLE: readonly AIErrorCode[] = [
  'RATE_LIMITED',
  'OVERLOADED',
  'TIMEOUT',
  'NETWORK',
  'SERVER_ERROR',
];

export class AIError extends Error {
  readonly code: AIErrorCode;
  readonly provider: ProviderId | undefined;
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;

  constructor(
    code: AIErrorCode,
    message: string,
    opts: { provider?: ProviderId; status?: number; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = 'AIError';
    this.code = code;
    this.provider = opts.provider;
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
  }

  get retryable(): boolean {
    return RETRYABLE.includes(this.code);
  }
}

/** Concatenates the text parts of a response. */
export function textOf(content: readonly ContentPart[]): string {
  return content
    .filter((p): p is Extract<ContentPart, { type: 'text' }> => p.type === 'text')
    .map((p) => p.text)
    .join('');
}
