import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

import { usePreferencesStore } from '@/stores/use-preferences-store';

/**
 * True when motion should be replaced by an instant change (01 §9.3, 03 §8.3 rule 2): the OS
 * "Reduce motion" setting is on, or the user turned on Sensory-calm mode, which forces it.
 */
export function useReducedMotion(): boolean {
  const calm = usePreferencesStore((s) => s.sensoryCalm);
  const [system, setSystem] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (active) setSystem(on);
      })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setSystem);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  return calm || system;
}
