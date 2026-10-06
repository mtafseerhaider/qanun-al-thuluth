import { createStore, resetters } from './create-store';

/**
 * Client view of the subscription (09 §5, 17 §6). Memory only: `clientPremium` mirrors the
 * RevenueCat `premium` entitlement for optimistic UI (up to 10 minutes after a purchase, before the
 * webhook lands); the server (`get_my_entitlements`) stays the truth. `pendingIntent` is the action
 * a paywall interrupted ("send this photo"), replayed after purchase (02 §5.11).
 */
export interface PendingIntent {
  id: string;
  run: () => void;
}

export interface SubscriptionState {
  clientPremium: boolean;
  purchasedAt: number | null;
  pendingIntent: PendingIntent | null;
}

export interface SubscriptionActions {
  setClientPremium(premium: boolean): void;
  markPurchased(at?: number): void;
  setPendingIntent(intent: PendingIntent | null): void;
  /** Runs and clears the pending intent (after purchase or when already premium). */
  resumePendingIntent(): void;
  reset(): void;
}

const initial: SubscriptionState = { clientPremium: false, purchasedAt: null, pendingIntent: null };

export const useSubscriptionStore = createStore<SubscriptionState & SubscriptionActions>(
  'subscription',
  (set, get) => ({
    ...initial,
    setClientPremium: (clientPremium) => set({ clientPremium }),
    markPurchased: (at = Date.now()) => set({ purchasedAt: at, clientPremium: true }),
    setPendingIntent: (pendingIntent) => set({ pendingIntent }),
    resumePendingIntent: () => {
      const intent = get().pendingIntent;
      set({ pendingIntent: null });
      intent?.run();
    },
    reset: () => set(initial),
  }),
);

resetters.add(() => useSubscriptionStore.getState().reset());
