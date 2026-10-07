import { useEffect } from 'react';

import { useFamilyMembers } from '@/features/family';
import { navigationRef } from '@/navigation/navigation-ref';
import { useActiveHouseholdStore } from '@/stores/use-active-household-store';
import { usePreferencesStore } from '@/stores/use-preferences-store';
import { useSessionStore } from '@/stores/use-session-store';

import { sensoryCalmSuggestion } from '../utils/sensory-calm';

export const SENSORY_CALM_SHEET = 'SensoryCalmSuggestionSheet' as const;

/**
 * Opens the one-time Sensory-calm suggestion (02 §7.10) once the autism module is on for any member
 * of the active household, wherever it was turned on (intake on this device, or another caregiver).
 * The suggestion is marked as spent when the sheet opens, so it never shows twice. Family members
 * are not fetched at all once it is spent.
 */
export function useSensoryCalmSuggestion(ready: boolean): void {
  const status = useSessionStore((s) => s.status);
  const householdId = useActiveHouseholdStore((s) => s.activeHouseholdId);
  const sensoryCalm = usePreferencesStore((s) => s.sensoryCalm);
  const sensoryCalmSuggested = usePreferencesStore((s) => s.sensoryCalmSuggested);
  const signedIn = status === 'signed_in' || status === 'needs_onboarding';
  const members = useFamilyMembers(signedIn && !sensoryCalmSuggested ? householdId : null);
  const decision = signedIn
    ? sensoryCalmSuggestion(members.data, { sensoryCalm, sensoryCalmSuggested })
    : 'none';

  useEffect(() => {
    if (!ready || decision === 'none') return;
    if (decision === 'skip') {
      usePreferencesStore.getState().markSensoryCalmSuggested();
      return;
    }
    // Let a screen change that is in progress (an intake step) settle before presenting the sheet.
    const id = setTimeout(() => {
      if (!navigationRef.isReady()) return;
      if (usePreferencesStore.getState().sensoryCalmSuggested) return;
      if (navigationRef.getCurrentRoute()?.name === SENSORY_CALM_SHEET) return;
      usePreferencesStore.getState().markSensoryCalmSuggested();
      navigationRef.navigate(SENSORY_CALM_SHEET);
    }, 0);
    return () => clearTimeout(id);
  }, [ready, decision]);
}
