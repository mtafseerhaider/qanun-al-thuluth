/**
 * Chat quota (FR-CHAT-02, 02 §5.6): free 20 a day, premium 200 fair use. The server reports the
 * remaining count in `message.start`; the composer shows it from 5 down on the free tier.
 */
export const FREE_DAILY_MESSAGES = 20;
export const COUNTER_FROM = 5;

export interface QuotaView {
  limit: number;
  remaining: number;
}

export type QuotaDisplay =
  | { kind: 'hidden' }
  | { kind: 'counter'; remaining: number }
  | { kind: 'reached'; premium: boolean };

export function quotaDisplay(quota: QuotaView | null, premium: boolean): QuotaDisplay {
  if (!quota) return { kind: 'hidden' };
  if (quota.remaining <= 0) return { kind: 'reached', premium };
  if (!premium && quota.remaining <= COUNTER_FROM)
    return { kind: 'counter', remaining: quota.remaining };
  return { kind: 'hidden' };
}

/** Quota from a pre-stream `QUOTA_EXCEEDED` error (`details.limit`). */
export function quotaFromError(details: Record<string, unknown> | undefined): QuotaView {
  const limit = typeof details?.limit === 'number' ? details.limit : FREE_DAILY_MESSAGES;
  return { limit, remaining: 0 };
}
