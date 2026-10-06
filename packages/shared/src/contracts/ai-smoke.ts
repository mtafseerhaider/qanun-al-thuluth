import { z } from 'zod';

/**
 * `ai-smoke` (Sprint 0, S0-09): a non-production Edge Function that sends one prompt through the
 * `chat.default` route and meters it to `ai_usage`. Used by the hidden debug screen to prove the
 * provider abstraction end to end. Addition beyond 00-foundations; removed once `ai-chat` ships.
 */
export const AiSmokeRequest = z.object({
  prompt: z.string().trim().min(1).max(500),
});
export type AiSmokeRequest = z.infer<typeof AiSmokeRequest>;

export const AiSmokeResponse = z.object({
  reply: z.string(),
  provider: z.string(),
  model: z.string(),
  route_key: z.string(),
  usage: z.object({ tokens_in: z.number().int(), tokens_out: z.number().int() }),
  latency_ms: z.number().int(),
});
export type AiSmokeResponse = z.infer<typeof AiSmokeResponse>;
