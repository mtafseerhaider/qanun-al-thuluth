import { recordUsage } from '../metering/usage.ts';
import type { UsageWriter } from '../metering/usage.ts';
import { ZERO_USAGE } from '../types.ts';
import type { ChatRequest, ChatResponse, ModelRoute, RequestMetadata, RouteKey } from '../types.ts';
import { runWithFallback } from './fallback.ts';
import type { AttemptLog, FallbackDeps } from './fallback.ts';

export interface MeteredDeps {
  fallback: FallbackDeps;
  /** One `ai_usage` row per provider call, including failed attempts (12 §5.6). */
  writeUsage: UsageWriter;
  onUsageError?: (err: unknown) => void;
}

export interface MeteredResult {
  response: ChatResponse;
  route: ModelRoute;
  attempts: AttemptLog[];
}

/**
 * `provider.chat` through the route's fallback chain, metering every attempt: failed attempts as
 * `error`, the served call as `ok` (or `fallback` when an earlier attempt failed).
 */
export async function chatMetered(
  routeKey: RouteKey,
  build: (route: ModelRoute) => Omit<ChatRequest, 'route' | 'metadata'>,
  metadata: RequestMetadata,
  opts: { overallDeadlineMs: number },
  deps: MeteredDeps,
): Promise<MeteredResult> {
  const meter = (
    route: ModelRoute,
    response: ChatResponse | null,
    status: 'ok' | 'error' | 'fallback',
  ) =>
    recordUsage(
      deps.writeUsage,
      {
        requestId: metadata.requestId,
        userId: metadata.userId,
        householdId: metadata.householdId,
        routeKey,
        provider: route.provider,
        model: route.model,
        usage: response?.usage ?? ZERO_USAGE,
        latencyMs: response?.latencyMs ?? 0,
        status,
        params: route.params,
      },
      deps.onUsageError,
    );

  const { result, route, attempts } = await runWithFallback(
    routeKey,
    async (provider, r) => {
      try {
        return await provider.chat({ ...build(r), route: routeKey, metadata }, r.model, r.params);
      } catch (err) {
        await meter(r, null, 'error');
        throw err;
      }
    },
    opts,
    deps.fallback,
  );
  await meter(route, result, attempts.length > 1 ? 'fallback' : 'ok');
  return { response: result, route, attempts };
}

/** Extracts the first JSON object from model text (tolerates code fences and prose around it). */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const body = fenced?.[1] ?? text;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new SyntaxError('No JSON object in model output');
  return JSON.parse(body.slice(start, end + 1));
}
