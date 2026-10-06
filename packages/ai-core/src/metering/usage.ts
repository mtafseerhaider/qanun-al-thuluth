import { providerToDb } from '../router/route-resolver.ts';
import type { ModelParams, ProviderId, RouteKey, Usage } from '../types.ts';

/** USD per million tokens equals micro-USD per token, so no scaling is needed (12 §5.6). */
export function costUsdMicros(usage: Usage, p: ModelParams): number {
  const uncachedIn = Math.max(
    0,
    usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens,
  );
  return Math.round(
    uncachedIn * p.priceInPerMTokUsd +
      usage.cacheReadTokens * (p.priceCacheReadPerMTokUsd ?? p.priceInPerMTokUsd) +
      usage.cacheWriteTokens * (p.priceCacheWritePerMTokUsd ?? p.priceInPerMTokUsd) +
      usage.outputTokens * p.priceOutPerMTokUsd,
  );
}

export type UsageStatus = 'ok' | 'error' | 'fallback' | 'blocked';

export interface UsageRecord {
  requestId: string;
  userId: string;
  householdId: string | null;
  routeKey: RouteKey;
  provider: ProviderId;
  model: string;
  usage: Usage;
  latencyMs: number;
  status: UsageStatus;
  params: ModelParams;
}

/** The `ai_usage` insert shape (05 §10.5). */
export interface AiUsageInsert {
  user_id: string;
  household_id: string | null;
  route_key: string;
  provider: 'anthropic' | 'openai' | 'google';
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd_micros: number;
  latency_ms: number;
  status: UsageStatus;
  request_id: string;
}

export function toUsageRow(u: UsageRecord): AiUsageInsert {
  return {
    user_id: u.userId,
    household_id: u.householdId,
    route_key: u.routeKey,
    provider: providerToDb(u.provider),
    model: u.model,
    tokens_in: u.usage.inputTokens,
    tokens_out: u.usage.outputTokens,
    cost_usd_micros: costUsdMicros(u.usage, u.params),
    latency_ms: Math.max(0, Math.round(u.latencyMs)),
    status: u.status,
    request_id: u.requestId,
  };
}

export type UsageWriter = (row: AiUsageInsert) => Promise<void>;

/** Writes one `ai_usage` row. Failures are reported but never thrown into the user's request. */
export async function recordUsage(
  write: UsageWriter,
  u: UsageRecord,
  onError: (err: unknown) => void = () => {},
): Promise<void> {
  try {
    await write(toUsageRow(u));
  } catch (err) {
    onError(err);
  }
}
