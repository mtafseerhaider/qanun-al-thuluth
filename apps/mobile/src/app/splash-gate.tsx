import * as Font from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState, type ReactNode } from 'react';

import { captureException } from '@/lib/sentry/init';
import { FONT_ASSETS } from '@/theme/font-assets';

/**
 * Holds the native splash until fonts are loaded (07 §4). The Boot branch covers the short wait for
 * AuthProvider's INITIAL_SESSION.
 * Fonts are also embedded by the expo-font config plugin; loadAsync covers dev clients built before
 * a font was added. A font failure never blocks launch (system fonts are the fallback).
 */
export function SplashGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await Font.loadAsync(FONT_ASSETS);
      } catch (error) {
        captureException(error, { tags: { phase: 'fonts' } });
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  return ready ? children : null;
}
