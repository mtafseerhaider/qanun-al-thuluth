import {
  AnthropicProvider,
  CircuitBreaker,
  GeminiProvider,
  OpenAiProvider,
  RouteResolver,
} from '@thuluth/ai-core';
import type { AiModelRouteRow, AIProvider, ProviderId } from '@thuluth/ai-core';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Per-isolate singletons: route cache (60 s TTL) and circuit breaker state (12 §5.3). */
let resolver: RouteResolver | undefined;
const breaker = new CircuitBreaker();

export function routeResolver(admin: SupabaseClient): RouteResolver {
  resolver ??= new RouteResolver(async (routeKey) => {
    const { data, error } = await admin
      .from('ai_model_routes')
      .select('route_key, provider, model, params, priority, enabled')
      .eq('route_key', routeKey)
      .eq('enabled', true)
      .order('priority');
    if (error) throw error;
    return (data ?? []) as AiModelRouteRow[];
  });
  return resolver;
}

export function providers(): Record<ProviderId, AIProvider> {
  return {
    anthropic: new AnthropicProvider(),
    openai: new OpenAiProvider(),
    gemini: new GeminiProvider(),
  };
}

export { breaker };
