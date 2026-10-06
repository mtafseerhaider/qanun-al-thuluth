import type { NativeStackNavigationOptions } from '@react-navigation/native-stack';

import { useReducedMotion } from '@/hooks/use-reduced-motion';

const CROSSFADE: NativeStackNavigationOptions = { animation: 'fade' };
const DEFAULT: NativeStackNavigationOptions = {};

/**
 * Stack transitions under reduced motion (01 §9.3, 03 §8.3): slides and modal pushes become a
 * short crossfade when the OS setting or Sensory-calm mode asks for less motion.
 */
export function useStackMotion(): NativeStackNavigationOptions {
  return useReducedMotion() ? CROSSFADE : DEFAULT;
}
