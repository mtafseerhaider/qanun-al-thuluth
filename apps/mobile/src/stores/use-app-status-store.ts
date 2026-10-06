import { createStore } from './create-store';

/**
 * Blocking app states learned from Edge Function errors (06 §2.3): `UPGRADE_REQUIRED`, and
 * `FEATURE_DISABLED` with `details.reason = 'maintenance'` (supabase/functions/_shared/maintenance.ts).
 * Not persisted: the next launch re-reads the flags. The maintenance screen's retry clears it.
 */
export interface AppStatusState {
  maintenance: boolean;
  upgradeRequired: boolean;
}

export interface AppStatusActions {
  noteEdgeError(error: { code: string; details?: Record<string, unknown> }): void;
  clearMaintenance(): void;
}

export const useAppStatusStore = createStore<AppStatusState & AppStatusActions>(
  'app-status',
  (set) => ({
    maintenance: false,
    upgradeRequired: false,
    noteEdgeError: ({ code, details }) => {
      if (code === 'UPGRADE_REQUIRED') set({ upgradeRequired: true });
      else if (code === 'FEATURE_DISABLED' && details?.reason === 'maintenance')
        set({ maintenance: true });
    },
    clearMaintenance: () => set({ maintenance: false }),
  }),
);
