import type { ModelParams, ModelRoute, ProviderId, RouteKey } from '../types.ts';

/** A row of `ai_model_routes` as PostgREST returns it. */
export interface AiModelRouteRow {
  route_key: string;
  provider: string;
  model: string;
  params: Record<string, unknown> | null;
  priority: number;
  enabled: boolean;
}

const DEFAULT_TIMEOUT_MS = 45_000;

/** `ai_model_routes.provider` uses `google` for Gemini (05 §10.6). */
export function providerFromDb(value: string): ProviderId {
  if (value === 'google' || value === 'gemini') return 'gemini';
  if (value === 'anthropic' || value === 'openai') return value;
  throw new Error(`Unknown AI provider in ai_model_routes: ${value}`);
}

export function providerToDb(id: ProviderId): 'anthropic' | 'openai' | 'google' {
  return id === 'gemini' ? 'google' : id;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Accepts both the camelCase keys in 12 §5.3 and the snake_case keys in 05 §10.6. */
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
const THINKING = ['adaptive', 'between_tools'] as const;

export function normalizeParams(raw: Record<string, unknown> | null): ModelParams {
  const { effort, thinking, ...p } = raw ?? {};
  const params: ModelParams = {
    ...p,
    timeoutMs: num(p.timeoutMs) ?? num(p.timeout_ms) ?? DEFAULT_TIMEOUT_MS,
    priceInPerMTokUsd: num(p.priceInPerMTokUsd) ?? num(p.price_in_per_mtok_usd) ?? 0,
    priceOutPerMTokUsd: num(p.priceOutPerMTokUsd) ?? num(p.price_out_per_mtok_usd) ?? 0,
  };
  const maxOutputTokens = num(p.maxOutputTokens) ?? num(p.max_tokens) ?? num(p.max_output_tokens);
  if (maxOutputTokens !== undefined) params.maxOutputTokens = maxOutputTokens;
  const temperature = num(p.temperature);
  if (temperature !== undefined) params.temperature = temperature;
  const cacheRead = num(p.priceCacheReadPerMTokUsd) ?? num(p.price_cache_read_per_mtok_usd);
  if (cacheRead !== undefined) params.priceCacheReadPerMTokUsd = cacheRead;
  const cacheWrite = num(p.priceCacheWritePerMTokUsd) ?? num(p.price_cache_write_per_mtok_usd);
  if (cacheWrite !== undefined) params.priceCacheWritePerMTokUsd = cacheWrite;
  // Unknown values are dropped rather than sent: a bad admin edit must not 400 every call.
  const e = EFFORTS.find((x) => x === effort);
  if (e) params.effort = e;
  const t = THINKING.find((x) => x === thinking);
  if (t) params.thinking = t;
  return params;
}

export function toModelRoute(row: AiModelRouteRow): ModelRoute {
  return {
    routeKey: row.route_key as RouteKey,
    provider: providerFromDb(row.provider),
    model: row.model,
    params: normalizeParams(row.params),
    priority: row.priority,
    enabled: row.enabled,
  };
}

export type RouteLoader = (routeKey: RouteKey) => Promise<AiModelRouteRow[]>;

/**
 * True when metering a call on this route would record $0 (12 §5.6): no input price, no output price
 * on a generating route (embeddings have no output tokens), or no `pricePerMinuteUsd` on
 * `speech.transcribe` (metered per audio second, `speech/transcribe.ts`). Unpriced routes make every
 * USD cap and the daily cost alert blind, so the resolver reports them (seed: 140_ai_model_routes.sql).
 */
export function isUnpriced(route: ModelRoute): boolean {
  const p = route.params;
  if (route.routeKey === 'speech.transcribe') {
    return !(typeof p.pricePerMinuteUsd === 'number' && p.pricePerMinuteUsd > 0);
  }
  if (!(p.priceInPerMTokUsd > 0)) return true;
  return !route.routeKey.startsWith('embed.') && !(p.priceOutPerMTokUsd > 0);
}

/** Default report for an unpriced route: one structured warning (the resolver dedupes per route). */
export function warnUnpriced(route: ModelRoute): void {
  console.warn(
    JSON.stringify({
      level: 'warn',
      msg: 'ai_route_unpriced',
      route_key: route.routeKey,
      provider: route.provider,
      model: route.model,
      detail: 'route params have no list price; ai_usage records cost 0 and USD caps do not apply',
    }),
  );
}

/**
 * Resolves enabled routes for a key ordered by priority, cached per isolate for 60 s
 * (12 §5.3: the TTL is the contract, there is no change notification).
 */
export class RouteResolver {
  readonly #load: RouteLoader;
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #onUnpriced: (route: ModelRoute) => void;
  readonly #cache = new Map<RouteKey, { at: number; routes: ModelRoute[] }>();
  readonly #reported = new Set<string>();

  /**
   * `onUnpriced` is called once per route (key, provider, model) per resolver whose params carry no
   * price (`isUnpriced`); the route is still used and metered at 0, never refused.
   */
  constructor(
    load: RouteLoader,
    opts: { ttlMs?: number; now?: () => number; onUnpriced?: (route: ModelRoute) => void } = {},
  ) {
    this.#load = load;
    this.#ttlMs = opts.ttlMs ?? 60_000;
    this.#now = opts.now ?? Date.now;
    this.#onUnpriced = opts.onUnpriced ?? warnUnpriced;
  }

  async resolve(routeKey: RouteKey): Promise<ModelRoute[]> {
    const hit = this.#cache.get(routeKey);
    if (hit && this.#now() - hit.at < this.#ttlMs) return hit.routes;
    const routes = (await this.#load(routeKey))
      .filter((r) => r.enabled && r.route_key === routeKey)
      .map(toModelRoute)
      .sort((a, b) => a.priority - b.priority);
    for (const r of routes) {
      const id = `${r.routeKey}|${r.provider}|${r.model}`;
      if (!this.#reported.has(id) && isUnpriced(r)) {
        this.#reported.add(id);
        this.#onUnpriced(r);
      }
    }
    this.#cache.set(routeKey, { at: this.#now(), routes });
    return routes;
  }
}
