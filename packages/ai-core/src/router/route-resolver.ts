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
 * Resolves enabled routes for a key ordered by priority, cached per isolate for 60 s
 * (12 §5.3: the TTL is the contract, there is no change notification).
 */
export class RouteResolver {
  readonly #load: RouteLoader;
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #cache = new Map<RouteKey, { at: number; routes: ModelRoute[] }>();

  constructor(load: RouteLoader, opts: { ttlMs?: number; now?: () => number } = {}) {
    this.#load = load;
    this.#ttlMs = opts.ttlMs ?? 60_000;
    this.#now = opts.now ?? Date.now;
  }

  async resolve(routeKey: RouteKey): Promise<ModelRoute[]> {
    const hit = this.#cache.get(routeKey);
    if (hit && this.#now() - hit.at < this.#ttlMs) return hit.routes;
    const routes = (await this.#load(routeKey))
      .filter((r) => r.enabled && r.route_key === routeKey)
      .map(toModelRoute)
      .sort((a, b) => a.priority - b.priority);
    this.#cache.set(routeKey, { at: this.#now(), routes });
    return routes;
  }
}
