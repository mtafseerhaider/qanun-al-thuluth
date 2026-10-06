import { DevSettings, I18nManager } from 'react-native';
import * as Updates from 'expo-updates';

import { isRtlLocale } from '@shared';

/** Whether the native layout direction must flip for `locale` (08 §10.3). */
export function needsDirectionChange(
  locale: string,
  currentIsRtl: boolean = I18nManager.isRTL,
): boolean {
  return isRtlLocale(locale) !== currentIsRtl;
}

/**
 * Applies the layout direction for `locale` with I18nManager. React Native only re-lays out after a
 * reload, so the return value says whether the caller should reload.
 */
export function applyDirection(locale: string): boolean {
  const rtl = isRtlLocale(locale);
  I18nManager.allowRTL(rtl);
  I18nManager.swapLeftAndRightInRTL(true);
  if (I18nManager.isRTL === rtl) return false;
  I18nManager.forceRTL(rtl);
  return true;
}

/** Reloads the JS bundle: DevSettings in development, expo-updates in release builds. */
export async function reloadApp(): Promise<void> {
  if (__DEV__) {
    DevSettings.reload();
    return;
  }
  try {
    await Updates.reloadAsync();
  } catch {
    // Updates disabled (no EAS project yet): fall back to a dev-settings reload where available.
    DevSettings.reload();
  }
}

/** Logical text alignment helper. RN swaps 'left'/'right' in RTL, so 'end' maps to 'right'. */
export function logicalTextAlign(
  align: 'start' | 'center' | 'end' | undefined,
): 'auto' | 'center' | 'right' {
  if (align === 'center') return 'center';
  if (align === 'end') return 'right';
  return 'auto';
}
