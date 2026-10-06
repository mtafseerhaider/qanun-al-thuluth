import { AIError, ZERO_USAGE } from '../types.ts';
import type {
  AIProvider,
  ChatRequest,
  ChatResponse,
  ModelParams,
  ProviderId,
  StreamEvent,
} from '../types.ts';
import { streamFromChat } from './http.ts';

export type FakeScript = (req: ChatRequest, model: string) => Partial<ChatResponse> | AIError;

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

  constructor(opts: { id?: ProviderId; script?: FakeScript } = {}) {
    this.id = opts.id ?? 'anthropic';
    this.#script = opts.script;
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
}
