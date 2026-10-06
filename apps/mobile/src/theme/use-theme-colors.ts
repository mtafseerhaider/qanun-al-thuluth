import { DarkTheme, DefaultTheme, type Theme } from '@react-navigation/native';
import { useColorScheme } from 'react-native';

import { usePreferencesStore } from '@/stores/use-preferences-store';

import { resolveThemeName } from './resolve-theme';
import { colors, type ColorTheme } from './tokens';

export function useResolvedScheme(): 'light' | 'dark' {
  const pref = usePreferencesStore((s) => s.theme);
  const system = useColorScheme();
  if (pref === 'system') return system === 'dark' ? 'dark' : 'light';
  return pref;
}

/** Resolved hex values for SVG, charts and the navigation theme (03 §11.5). */
export function useThemeColors(): ColorTheme {
  const scheme = useResolvedScheme();
  const calm = usePreferencesStore((s) => s.sensoryCalm);
  return colors[resolveThemeName(scheme, calm)];
}

export function useNavigationTheme(): Theme {
  const scheme = useResolvedScheme();
  const c = useThemeColors();
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    dark: scheme === 'dark',
    colors: {
      ...base.colors,
      background: c.surface,
      card: c['surface-raised'],
      text: c.ink,
      border: c.line,
      primary: c.primary,
      notification: c.danger,
    },
  };
}
