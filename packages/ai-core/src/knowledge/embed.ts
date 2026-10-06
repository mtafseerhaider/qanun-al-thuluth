import { recordUsage } from '../metering/usage.ts';
import type { UsageWriter } from '../metering/usage.ts';
import { runWithFallback } from '../router/fallback.ts';
import type { FallbackDeps } from '../router/fallback.ts';
import { AIError, ZERO_USAGE } from '../types.ts';
import type { EmbedResponse, ModelRoute, RequestMetadata } from '../types.ts';

/** `embed.knowledge`: OpenAI text-embedding-3-large reduced to 1536 dimensions (12 §4.2, 13 §9.3). */
export const KNOWLEDGE_ROUTE = 'embed.knowledge' as const;
export const KNOWLEDGE_DIMENSIONS = 1536;
/** 13 §9.3: embedded text is capped at 2,000 characters. */
export const MAX_EMBED_CHARS = 2000;

export interface EmbedDeps {
  fallback: FallbackDeps;
  /** Optional: scripts without a user id cannot write `ai_usage` (user_id is not null). */
  writeUsage?: UsageWriter | undefined;
  onUsageError?: (err: unknown) => void;
}

function dimensionsOf(route: ModelRoute): number {
  const d = route.params.dimensions;
  return typeof d === 'number' && d > 0 ? d : KNOWLEDGE_DIMENSIONS;
}

/** Embeds texts through the route's fallback chain; every vector is checked to be 1536-d. */
export async function embedTexts(
  texts: readonly string[],
  metadata: RequestMetadata,
  deps: EmbedDeps,
): Promise<{ vectors: number[][]; route: ModelRoute; response: EmbedResponse }> {
  const inputs = texts.map((t) => t.slice(0, MAX_EMBED_CHARS));
  const meter = async (
    route: ModelRoute,
    res: EmbedResponse | null,
    status: 'ok' | 'error' | 'fallback',
  ) => {
    if (!deps.writeUsage) return;
    await recordUsage(
      deps.writeUsage,
      {
        requestId: metadata.requestId,
        userId: metadata.userId,
        householdId: metadata.householdId,
        routeKey: KNOWLEDGE_ROUTE,
        provider: route.provider,
        model: route.model,
        usage: res?.usage ?? ZERO_USAGE,
        latencyMs: res?.latencyMs ?? 0,
        status,
        params: route.params,
      },
      deps.onUsageError,
    );
  };
  const { result, route, attempts } = await runWithFallback(
    KNOWLEDGE_ROUTE,
    async (provider, r) => {
      if (!provider.embed) {
        throw new AIError('INVALID_REQUEST', `${provider.id} has no embeddings`, {
          provider: provider.id,
        });
      }
      const dimensions = dimensionsOf(r);
      if (dimensions !== KNOWLEDGE_DIMENSIONS) {
        // The vector(1536) columns cannot hold anything else; changing size needs a new column (13 §9.3).
        throw new AIError('INVALID_REQUEST', `embed.knowledge must be ${KNOWLEDGE_DIMENSIONS}-d`, {
          provider: provider.id,
        });
      }
      try {
        return await provider.embed(
          { route: KNOWLEDGE_ROUTE, inputs, dimensions, metadata },
          r.model,
          r.params,
        );
      } catch (err) {
        await meter(r, null, 'error');
        throw err;
      }
    },
    { overallDeadlineMs: 30_000 },
    deps.fallback,
  );
  await meter(route, result, attempts.length > 1 ? 'fallback' : 'ok');
  if (result.vectors.some((v) => v.length !== KNOWLEDGE_DIMENSIONS)) {
    throw new AIError('SCHEMA_VALIDATION_FAILED', 'Embedding has the wrong dimensions');
  }
  return { vectors: result.vectors, route, response: result };
}

/** pgvector text literal for PostgREST writes and RPC arguments. */
export function vectorLiteral(v: readonly number[]): string {
  return `[${v.map((x) => Number(x.toFixed(7))).join(',')}]`;
}
