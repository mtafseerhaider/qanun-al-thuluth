import { AIError, ZERO_USAGE } from '../types.ts';
import type {
  AIProvider,
  ChatRequest,
  ChatResponse,
  EmbedRequest,
  EmbedResponse,
  ModelParams,
  ProviderId,
  StreamEvent,
  TranscribeRequest,
  TranscribeResponse,
} from '../types.ts';
import { streamFromChat } from './http.ts';

export type FakeScript = (req: ChatRequest, model: string) => Partial<ChatResponse> | AIError;
export type FakeTranscript = (
  req: TranscribeRequest,
  model: string,
) => { text: string; language?: string | null } | AIError;

/**
 * Deterministic provider for tests and evals. By default it echoes the last user text.
 * Pass a script to return canned responses or throw `AIError`s.
 */
export class FakeProvider implements AIProvider {
  readonly id: ProviderId;
  readonly supports = {
    tools: true,
    vision: true,
    jsonSchema: true,
    promptCaching: 'none',
    streaming: true,
  } as const;
  readonly calls: { req: ChatRequest; model: string }[] = [];

  readonly #script: FakeScript | undefined;
  readonly #transcript: FakeTranscript | undefined;

  constructor(opts: { id?: ProviderId; script?: FakeScript; transcript?: FakeTranscript } = {}) {
    this.id = opts.id ?? 'anthropic';
    this.#script = opts.script;
    this.#transcript = opts.transcript;
  }

  readonly transcribeCalls: { req: TranscribeRequest; model: string }[] = [];

  /** Scripted transcription; defaults to a fixed sentence in the hinted language. */
  async transcribe(
    req: TranscribeRequest,
    model: string,
    _params: ModelParams,
  ): Promise<TranscribeResponse> {
    this.transcribeCalls.push({ req, model });
    const out = this.#transcript?.(req, model) ?? { text: 'fake transcript' };
    if (out instanceof AIError) throw out;
    return {
      provider: this.id,
      model,
      text: out.text,
      language: out.language === undefined ? (req.languageHint ?? 'en') : out.language,
      latencyMs: 1,
    };
  }

  async chat(req: ChatRequest, model: string, _params: ModelParams): Promise<ChatResponse> {
    this.calls.push({ req, model });
    const scripted = this.#script?.(req, model);
    if (scripted instanceof AIError) throw scripted;
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
    const echo = lastUser?.content.find((p) => p.type === 'text');
    return {
      provider: this.id,
      model,
      content: [{ type: 'text', text: `echo: ${echo?.type === 'text' ? echo.text : ''}` }],
      stopReason: 'end_turn',
      usage: { ...ZERO_USAGE, inputTokens: 10, outputTokens: 5 },
      latencyMs: 1,
      ...scripted,
    };
  }

  stream(req: ChatRequest, model: string, params: ModelParams): AsyncIterable<StreamEvent> {
    return streamFromChat(req, this.id, model, () => this.chat(req, model, params));
  }

  readonly embedCalls: { req: EmbedRequest; model: string }[] = [];

  /** Deterministic unit vectors derived from the text, so equal inputs embed identically. */
  async embed(req: EmbedRequest, model: string, _params: ModelParams): Promise<EmbedResponse> {
    this.embedCalls.push({ req, model });
    return {
      provider: this.id,
      model,
      vectors: req.inputs.map((t) => fakeEmbedding(t, req.dimensions)),
      usage: {
        ...ZERO_USAGE,
        inputTokens: req.inputs.reduce((n, t) => n + Math.ceil(t.length / 4), 0),
      },
      latencyMs: 1,
    };
  }
}

/** FNV-1a seeded pseudo-random unit vector; similar strings do not get similar vectors. */
export function fakeEmbedding(text: string, dimensions: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const v: number[] = [];
  for (let i = 0; i < dimensions; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    v.push(((h >>> 0) / 4294967296) * 2 - 1);
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}
