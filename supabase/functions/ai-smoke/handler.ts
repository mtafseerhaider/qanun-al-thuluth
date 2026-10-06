import { AIError, recordUsage, runWithFallback, textOf, ZERO_USAGE } from '@thuluth/ai-core';
import type { AiUsageInsert, FallbackDeps, RouteKey } from '@thuluth/ai-core';
import { AiSmokeRequest } from '@thuluth/shared/contracts/ai-smoke.ts';
import type { AiSmokeResponse } from '@thuluth/shared/contracts/ai-smoke.ts';

import { requireUser } from '../_shared/auth.ts';
import type { ClaimsVerifier } from '../_shared/auth.ts';
import type { AppEnv } from '../_shared/env.ts';
import { HttpError } from '../_shared/errors.ts';
import { jsonHandler } from '../_shared/http.ts';

const ROUTE: RouteKey = 'chat.default';
/** Strict cap: the smoke function is a debug tool, so it gets a small daily allowance per user. */
export const SMOKE_DAILY_LIMIT = 10;

export interface SmokeDeps {
  appEnv: AppEnv;
  verify: ClaimsVerifier;
  fallback: FallbackDeps;
  writeUsage: (row: AiUsageInsert) => Promise<void>;
  countTodayCalls: (userId: string) => Promise<number>;
}

export function createSmokeHandler(deps: SmokeDeps) {
  return jsonHandler(
    AiSmokeRequest,
    async ({ req, input, requestId }): Promise<AiSmokeResponse> => {
      if (deps.appEnv === 'production') {
        throw new HttpError('FEATURE_DISABLED', 'Not available.', { flag: 'debug_menu' });
      }
      const user = await requireUser(req, deps.verify);
      const used = await deps.countTodayCalls(user.userId);
      if (used >= SMOKE_DAILY_LIMIT) {
        throw new HttpError('QUOTA_EXCEEDED', 'Daily smoke test limit reached.', {
          limit: SMOKE_DAILY_LIMIT,
        });
      }

      const metadata = {
        requestId,
        userId: user.userId,
        householdId: null,
        promptKey: 'debug.smoke',
        promptVersion: 1,
        tier: 'free' as const,
      };
      try {
        const { result, route, attempts } = await runWithFallback(
          ROUTE,
          async (provider, r) => {
            try {
              return await provider.chat(
                {
                  route: ROUTE,
                  system: [
                    {
                      type: 'text',
                      text: 'You are Thuluth, a family nutrition companion. Reply in one short sentence.',
                    },
                  ],
                  messages: [{ role: 'user', content: [{ type: 'text', text: input.prompt }] }],
                  maxOutputTokens: 200,
                  metadata,
                },
                r.model,
                r.params,
              );
            } catch (err) {
              await recordUsage(deps.writeUsage, {
                ...metadata,
                routeKey: ROUTE,
                provider: r.provider,
                model: r.model,
                usage: ZERO_USAGE,
                latencyMs: 0,
                status: 'error',
                params: r.params,
              });
              throw err;
            }
          },
          { overallDeadlineMs: 60_000 },
          deps.fallback,
        );
        await recordUsage(deps.writeUsage, {
          ...metadata,
          routeKey: ROUTE,
          provider: route.provider,
          model: route.model,
          usage: result.usage,
          latencyMs: result.latencyMs,
          status: attempts.length > 1 ? 'fallback' : 'ok',
          params: route.params,
        });
        return {
          reply: textOf(result.content),
          provider: route.provider,
          model: route.model,
          route_key: ROUTE,
          usage: { tokens_in: result.usage.inputTokens, tokens_out: result.usage.outputTokens },
          latency_ms: result.latencyMs,
        };
      } catch (err) {
        if (err instanceof AIError) {
          throw new HttpError(
            err.code === 'TIMEOUT' ? 'AI_TIMEOUT' : 'AI_UNAVAILABLE',
            'The assistant is unavailable. Try again.',
          );
        }
        throw err;
      }
    },
  );
}
