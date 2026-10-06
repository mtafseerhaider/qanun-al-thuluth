/** Exponential backoff with full jitter: base 500 ms × 2^attempt, capped at 8 s (12 §5.4). */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const ceiling = Math.min(8_000, 500 * 2 ** attempt);
  return Math.floor(random() * ceiling);
}

export const MAX_ATTEMPTS: Record<string, number> = {
  chat: 3,
  vision: 3,
  classify: 2,
  plan: 4,
};

export function maxAttemptsFor(routeKey: string): number {
  return MAX_ATTEMPTS[routeKey.split('.')[0] ?? ''] ?? 3;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
