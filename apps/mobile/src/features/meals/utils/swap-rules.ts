/**
 * Who sees AI swap suggestions (24 S3-13, 17, FR-PLAN-12). Catalog swaps are always free. AI
 * suggestions need Premium; the `ai.plan.enabled` flag is the kill switch. The server is the source
 * of truth: a `PREMIUM_REQUIRED` answer downgrades to the upsell even if the client thought otherwise.
 */
export type SwapAiAccess = 'ai' | 'upsell' | 'disabled';

export function swapAccess(input: {
  premium: boolean;
  aiFlag: boolean;
  serverSaidPremiumRequired: boolean;
}): SwapAiAccess {
  if (input.serverSaidPremiumRequired || !input.premium) return 'upsell';
  if (!input.aiFlag) return 'disabled';
  return 'ai';
}
