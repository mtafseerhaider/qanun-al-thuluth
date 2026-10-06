import { AiSmokeResponse, type AiSmokeRequest } from '@shared/contracts';

import { invokeEdge } from '@/lib/supabase/edge';

/** Calls the Sprint 0 `ai-smoke` Edge Function (chat.default route, metered to ai_usage). */
export function callAiSmoke(body: AiSmokeRequest): Promise<AiSmokeResponse> {
  return invokeEdge('ai-smoke', body, AiSmokeResponse);
}
