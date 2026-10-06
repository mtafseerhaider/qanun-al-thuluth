import { z } from 'zod';

/**
 * RevenueCat webhook payload, the fields we read (06 §5.1). Kept next to the function because
 * the shape is RevenueCat's, not ours; the app never sends it. Unknown event types are accepted,
 * logged and acknowledged with 200.
 */
export const RcEventType = z.enum([
  'TEST',
  'INITIAL_PURCHASE',
  'RENEWAL',
  'CANCELLATION',
  'UNCANCELLATION',
  'NON_RENEWING_PURCHASE',
  'SUBSCRIPTION_PAUSED',
  'EXPIRATION',
  'BILLING_ISSUE',
  'PRODUCT_CHANGE',
  'TRANSFER',
  'SUBSCRIPTION_EXTENDED',
  'TEMPORARY_ENTITLEMENT_GRANT',
  'REFUND_REVERSED',
]);
export type RcEventType = z.infer<typeof RcEventType>;

export const RcStore = z.enum([
  'APP_STORE',
  'MAC_APP_STORE',
  'PLAY_STORE',
  'AMAZON',
  'STRIPE',
  'PROMOTIONAL',
  'RC_BILLING',
  'PADDLE',
  'TEST_STORE',
]);

export const RevenueCatEvent = z
  .object({
    id: z.string().min(1).max(200),
    type: z.string().min(1).max(64),
    app_user_id: z.string().max(200).default(''),
    original_app_user_id: z.string().max(200).optional(),
    aliases: z.array(z.string()).optional(),
    transferred_from: z.array(z.string()).optional(),
    transferred_to: z.array(z.string()).optional(),
    product_id: z.string().optional(),
    new_product_id: z.string().optional(),
    entitlement_ids: z.array(z.string()).nullable().optional(),
    period_type: z.enum(['TRIAL', 'INTRO', 'NORMAL', 'PROMOTIONAL', 'PREPAID']).optional(),
    purchased_at_ms: z.number().nullable().optional(),
    expiration_at_ms: z.number().nullable().optional(),
    grace_period_expiration_at_ms: z.number().nullable().optional(),
    store: z.union([RcStore, z.string()]).optional(),
    environment: z.enum(['SANDBOX', 'PRODUCTION']),
    cancel_reason: z.string().optional(),
    expiration_reason: z.string().optional(),
    transaction_id: z.string().optional(),
    original_transaction_id: z.string().optional(),
    country_code: z.string().optional(),
    event_timestamp_ms: z.number(),
  })
  .passthrough();
export type RevenueCatEvent = z.infer<typeof RevenueCatEvent>;

export const RevenueCatWebhook = z.object({
  api_version: z.string().default('1.0'),
  event: RevenueCatEvent,
});
export type RevenueCatWebhook = z.infer<typeof RevenueCatWebhook>;

/** `POST /revenuecat-webhook/sync` (17 §7.5): the caller's own subscriber is refetched. */
export const SyncRequest = z.object({}).passthrough();
export const SyncResponse = z.object({
  premium: z.boolean(),
  status: z.string().nullable(),
  current_period_end: z.string().nullable(),
  synced: z.boolean(),
});
export type SyncResponse = z.infer<typeof SyncResponse>;
