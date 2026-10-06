import { recordUsage } from '../metering/usage.ts';
import type { UsageWriter } from '../metering/usage.ts';
import { runWithFallback } from '../router/fallback.ts';
import type { FallbackDeps } from '../router/fallback.ts';
import { AIError, ZERO_USAGE } from '../types.ts';
import type { ModelParams, ModelRoute, RequestMetadata, TranscribeResponse } from '../types.ts';

/**
 * Voice input (FR-CHAT-03, 12 §15). Providers implement the optional `transcribe` method; routes
 * whose provider has none are skipped. Metering (12 §15): `tokens_in = ceil(durationSec)` and the
 * cost comes from `params.pricePerMinuteUsd` (USD per audio minute).
 */

export const TRANSCRIBE_ROUTE = 'speech.transcribe' as const;

/** Food words that bias recognition toward the family's vocabulary (12 §15 step 3). */
export const TRANSCRIBE_VOCABULARY =
  'roti, chapati, paratha, daal, sabzi, karahi, biryani, pulao, dahi, raita, lassi, talbina, kalonji, khajoor, suhoor, sehri, iftar, roza, Ramadan, haleem, nihari, chana, aloo, palak';

/** Params whose per-token prices make `costUsdMicros(seconds)` equal the per-minute price. */
export function transcriptionParams(params: ModelParams): ModelParams {
  const perMinute = typeof params.pricePerMinuteUsd === 'number' ? params.pricePerMinuteUsd : 0;
  return { ...params, priceInPerMTokUsd: (perMinute * 1_000_000) / 60, priceOutPerMTokUsd: 0 };
}

export async function transcribeMetered(args: {
  audio: Uint8Array;
  mimeType: string;
  languageHint?: 'en' | 'ur' | 'ar' | undefined;
  durationSec: number;
  metadata: RequestMetadata;
  deps: { fallback: FallbackDeps; writeUsage: UsageWriter; onUsageError?: (err: unknown) => void };
  signal?: AbortSignal | undefined;
}): Promise<TranscribeResponse & { route: ModelRoute }> {
  const seconds = Math.max(1, Math.ceil(args.durationSec));
  const meter = (
    route: ModelRoute,
    res: TranscribeResponse | null,
    status: 'ok' | 'error' | 'fallback',
  ) =>
    recordUsage(
      args.deps.writeUsage,
      {
        requestId: args.metadata.requestId,
        userId: args.metadata.userId,
        householdId: args.metadata.householdId,
        routeKey: TRANSCRIBE_ROUTE,
        provider: route.provider,
        model: route.model,
        usage: res ? { ...ZERO_USAGE, inputTokens: seconds } : ZERO_USAGE,
        latencyMs: res?.latencyMs ?? 0,
        status,
        params: transcriptionParams(route.params),
      },
      args.deps.onUsageError,
    );
  const { result, route, attempts } = await runWithFallback(
    TRANSCRIBE_ROUTE,
    async (provider, r) => {
      if (!provider.transcribe) {
        throw new AIError('INVALID_REQUEST', `${provider.id} has no transcription`, {
          provider: provider.id,
        });
      }
      try {
        return await provider.transcribe(
          {
            route: TRANSCRIBE_ROUTE,
            audio: args.audio,
            mimeType: args.mimeType,
            languageHint: args.languageHint,
            prompt: TRANSCRIBE_VOCABULARY,
            metadata: args.metadata,
            signal: args.signal,
          },
          r.model,
          r.params,
        );
      } catch (err) {
        await meter(r, null, 'error');
        throw err;
      }
    },
    { overallDeadlineMs: 30_000 },
    args.deps.fallback,
  );
  await meter(route, result, attempts.length > 1 ? 'fallback' : 'ok');
  return { ...result, route };
}
