import { registerDevice } from '@/lib/auth/device-registration';

import { getPushSubscriptionId, loginPush } from './push';

/**
 * Post-auth device wiring (11 §9 step 6, 24 S4-12): links OneSignal to the user (external id =
 * `users.id`) and upserts this install's `devices` row with the subscription id when there is one.
 * Best effort: never throws, never blocks routing.
 */
export async function registerPushDevice(userId: string): Promise<void> {
  loginPush(userId);
  const subscriptionId = await getPushSubscriptionId();
  await registerDevice(userId, subscriptionId).catch(() => undefined);
}
