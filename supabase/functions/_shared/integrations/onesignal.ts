/** One push message for one user (OneSignal `external_id` = `users.id`, 06 §4.15). */
export interface PushMessage {
  notification_id: string;
  user_id: string;
  kind: string;
  /** Lock-screen-safe copy in both app languages; OneSignal picks by device language. */
  headings: { en: string; ur: string };
  contents: { en: string; ur: string };
  route: string;
  /** Seconds after which the push is dropped if undelivered. */
  ttl_seconds: number;
  /** Android channel and iOS interruption level for time-critical fasting reminders. */
  time_sensitive?: boolean;
}

export interface PushResult {
  /** False when the push was not handed to OneSignal (not configured, or no subscribed device). */
  sent: boolean;
  id?: string;
  /** Why it was not sent: 'not_configured', 'no_subscribers'. */
  reason?: string;
}

/** Throws on transport or 5xx errors so the dispatcher can retry; returns `sent: false` otherwise. */
export type PushSender = (message: PushMessage) => Promise<PushResult>;

/**
 * OneSignal REST (`POST /notifications`). Until the owner creates the OneSignal app and sets
 * ONESIGNAL_REST_API_KEY and ONESIGNAL_APP_ID, pushes are not sent: rows are recorded as not
 * sent and the dispatcher keeps going, like the Postmark stub in `email.ts`.
 */
export function oneSignalSender(
  apiKey: string | undefined,
  appId: string | undefined,
  fetchImpl: typeof fetch = fetch,
): PushSender {
  let warned = false;
  return async (message) => {
    if (!apiKey || !appId) {
      if (!warned) {
        warned = true;
        console.warn(
          JSON.stringify({
            level: 'warn',
            msg: 'ONESIGNAL_REST_API_KEY or ONESIGNAL_APP_ID not set; pushes recorded as not sent',
          }),
        );
      }
      return { sent: false, reason: 'not_configured' };
    }
    const res = await fetchImpl('https://api.onesignal.com/notifications?c=push', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        authorization: `Key ${apiKey}`,
      },
      body: JSON.stringify({
        app_id: appId,
        target_channel: 'push',
        include_aliases: { external_id: [message.user_id] },
        headings: message.headings,
        contents: message.contents,
        data: {
          kind: message.kind,
          route: message.route,
          notification_id: message.notification_id,
        },
        // OneSignal deduplicates on this key for 30 days, so a retried run never double-sends.
        idempotency_key: message.notification_id,
        ttl: message.ttl_seconds,
        ...(message.time_sensitive
          ? { ios_interruption_level: 'time_sensitive', priority: 10 }
          : {}),
      }),
    });
    const text = await res.text();
    if (res.status >= 500 || res.status === 429) {
      throw new Error(`OneSignal ${res.status}: ${text.slice(0, 200)}`);
    }
    let body: { id?: string; errors?: unknown } = {};
    try {
      body = JSON.parse(text);
    } catch {
      // Non-JSON 4xx bodies fall through as not sent.
    }
    if (!res.ok) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          msg: 'onesignal_rejected',
          status: res.status,
          body: text.slice(0, 200),
        }),
      );
      return { sent: false, reason: `http_${res.status}` };
    }
    // A 200 with an empty id means no subscribed device matched the external id.
    if (!body.id) return { sent: false, reason: 'no_subscribers' };
    return { sent: true, id: body.id };
  };
}
