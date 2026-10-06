import { AIError } from '../types.ts';
import type { AIProvider, ModelRoute, ProviderId, RouteKey } from '../types.ts';
import { backoffMs, maxAttemptsFor, sleep } from './retry.ts';
import type { RouteResolver } from './route-resolver.ts';

export interface AttemptLog {
  provider: ProviderId;
  model: string;
  attempt: number;
  ok: boolean;
  errorCode?: AIError['code'];
  latencyMs: number;
}

/** Per-isolate circuit breaker: open after 5 retryable failures within 60 s, half-open after 30 s. */
export class CircuitBreaker {
  readonly #failures = new Map<string, number[]>();
  readonly #openedAt = new Map<string, number>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  isOpen(key: string): boolean {
    const opened = this.#openedAt.get(key);
    if (opened === undefined) return false;
    if (this.#now() - opened >= 30_000) {
      this.#openedAt.delete(key);
      this.#failures.delete(key);
      return false;
    }
    return true;
  }

  recordFailure(key: string): void {
    const now = this.#now();
    const recent = (this.#failures.get(key) ?? []).filter((t) => now - t < 60_000);
    recent.push(now);
    this.#failures.set(key, recent);
    if (recent.length >= 5) this.#openedAt.set(key, now);
  }

  recordSuccess(key: string): void {
    this.#failures.delete(key);
    this.#openedAt.delete(key);
  }
}

export interface FallbackDeps {
  resolver: RouteResolver;
  providers: Partial<Record<ProviderId, AIProvider>>;
  breaker?: CircuitBreaker;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}

const NEXT_ROUTE_CODES: readonly AIError['code'][] = [
  'AUTH',
  'CONTENT_FILTERED',
  'INVALID_REQUEST',
  'CONTEXT_TOO_LONG',
];

/**
 * Runs `attempt` against each enabled route in priority order with retries, honouring the
 * overall deadline (12 §5.3, §5.4). Throws `ALL_ROUTES_FAILED` with the last error's message.
 */
export async function runWithFallback<T>(
  routeKey: RouteKey,
  attempt: (provider: AIProvider, route: ModelRoute) => Promise<T>,
  opts: { overallDeadlineMs: number },
  deps: FallbackDeps,
): Promise<{ result: T; route: ModelRoute; attempts: AttemptLog[] }> {
  const now = deps.now ?? Date.now;
  const wait = deps.sleep ?? sleep;
  const deadline = now() + opts.overallDeadlineMs;
  const attempts: AttemptLog[] = [];
  const routes = await deps.resolver.resolve(routeKey);
  if (routes.length === 0)
    throw new AIError('ALL_ROUTES_FAILED', `No enabled routes for ${routeKey}`);
  let lastError: AIError | undefined;

  for (const route of routes) {
    const provider = deps.providers[route.provider];
    const breakerKey = `${route.provider}:${route.model}`;
    if (!provider || deps.breaker?.isOpen(breakerKey)) continue;

    const maxAttempts = maxAttemptsFor(routeKey);
    for (let n = 0; n < maxAttempts; n++) {
      if (now() >= deadline) break;
      const started = now();
      try {
        const result = await attempt(provider, route);
        attempts.push({
          provider: route.provider,
          model: route.model,
          attempt: n + 1,
          ok: true,
          latencyMs: now() - started,
        });
        deps.breaker?.recordSuccess(breakerKey);
        return { result, route, attempts };
      } catch (err) {
        const error =
          err instanceof AIError
            ? err
            : new AIError('SERVER_ERROR', String(err), { provider: route.provider });
        lastError = error;
        attempts.push({
          provider: route.provider,
          model: route.model,
          attempt: n + 1,
          ok: false,
          errorCode: error.code,
          latencyMs: now() - started,
        });
        if (error.retryable) deps.breaker?.recordFailure(breakerKey);
        if (!error.retryable || NEXT_ROUTE_CODES.includes(error.code)) break;
        if (n + 1 < maxAttempts) {
          const delay = Math.max(error.retryAfterMs ?? 0, backoffMs(n, deps.random));
          if (now() + delay >= deadline) break;
          await wait(delay);
        }
      }
    }
  }
  throw new AIError(
    'ALL_ROUTES_FAILED',
    `All routes failed for ${routeKey}: ${lastError?.message ?? 'no provider available'}`,
  );
}
