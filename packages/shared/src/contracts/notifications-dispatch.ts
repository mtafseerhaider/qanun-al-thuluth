import { z } from 'zod';

/** 06 §4.15. */
export const NotificationsDispatchRequest = z.object({
  triggered_at: z.string().datetime({ offset: true }).optional(),
  dry_run: z.boolean().default(false),
});
export const NotificationsDispatchResponse = z.object({
  skipped: z.boolean(),
  materialized: z.number().int(),
  sent: z.number().int(),
  suppressed_quiet_hours: z.number().int(),
  stale: z.number().int(),
  failed: z.number().int(),
  /** Additive: daily cap (FR-NOT-05), kind disabled since materialization, not handed to OneSignal. */
  suppressed_cap: z.number().int(),
  suppressed_disabled: z.number().int(),
  not_sent: z.number().int(),
});
export type NotificationsDispatchResponse = z.infer<typeof NotificationsDispatchResponse>;
