/**
 * Processor-side deletion on account erasure (06 §4.13, 16 §7.5): RevenueCat subscriber and
 * OneSignal user. Each is a no-op that reports `not_configured` until its secret is set, like the
 * Postmark and OneSignal senders. A 404 counts as done (already gone).
 */

export type ProcessorDelete = (userId: string) => Promise<{ done: boolean; reason?: string }>;

export function revenueCatDeleter(
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): ProcessorDelete {
  return async (userId) => {
    if (!apiKey) return { done: false, reason: 'not_configured' };
    const res = await fetchImpl(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`,
      {
        method: 'DELETE',
        headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      },
    );
    await res.body?.cancel();
    if (res.ok || res.status === 404) return { done: true };
    throw new Error(`RevenueCat delete ${res.status}`);
  };
}

export function oneSignalDeleter(
  apiKey: string | undefined,
  appId: string | undefined,
  fetchImpl: typeof fetch = fetch,
): ProcessorDelete {
  return async (userId) => {
    if (!apiKey || !appId) return { done: false, reason: 'not_configured' };
    const res = await fetchImpl(
      `https://api.onesignal.com/apps/${encodeURIComponent(appId)}/users/by/external_id/${encodeURIComponent(userId)}`,
      {
        method: 'DELETE',
        headers: { authorization: `Key ${apiKey}` },
        signal: AbortSignal.timeout(5000),
      },
    );
    await res.body?.cancel();
    if (res.ok || res.status === 404) return { done: true };
    throw new Error(`OneSignal delete ${res.status}`);
  };
}
