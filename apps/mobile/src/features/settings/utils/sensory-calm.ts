import { track } from '@/lib/analytics/track';
import { usePreferencesStore } from '@/stores/use-preferences-store';

/**
 * A user turned Sensory-calm mode on or off (settings switch, autism hub, suggestion sheet). Emits
 * `sensory_calm_toggled { enabled }` only when the value changes.
 */
export function setSensoryCalmByUser(enabled: boolean): void {
  const prefs = usePreferencesStore.getState();
  if (prefs.sensoryCalm === enabled) return;
  prefs.setSensoryCalm(enabled);
  track('sensory_calm_toggled', { enabled });
}

/** Members as the suggestion needs them: only the enabled module list. */
export interface MemberModules {
  special_modules: readonly string[] | null;
}

/**
 * 02 §7.10: Sensory-calm is suggested once, in a sheet, when the autism module is on for any member.
 * `skip` means the suggestion is spent without showing it (Sensory-calm is already on).
 */
export function sensoryCalmSuggestion(
  members: readonly MemberModules[] | undefined,
  prefs: { sensoryCalm: boolean; sensoryCalmSuggested: boolean },
): 'none' | 'show' | 'skip' {
  if (prefs.sensoryCalmSuggested || !members) return 'none';
  if (!members.some((m) => (m.special_modules ?? []).includes('autism'))) return 'none';
  return prefs.sensoryCalm ? 'skip' : 'show';
}
