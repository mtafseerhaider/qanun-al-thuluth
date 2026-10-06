import { StatusBar } from 'expo-status-bar';
import { useColorScheme as useNwColorScheme, vars } from 'nativewind';
import { useEffect, type ReactNode } from 'react';
import { View } from 'react-native';

import { usePreferencesStore } from '@/stores/use-preferences-store';
import { resolveThemeName } from '@/theme/resolve-theme';
import { cssVarsFor, type ThemeName } from '@/theme/tokens';
import { useResolvedScheme } from '@/theme/use-theme-colors';

const themeVars: Record<ThemeName, ReturnType<typeof vars>> = {
  light: vars(cssVarsFor('light')),
  dark: vars(cssVarsFor('dark')),
  calmLight: vars(cssVarsFor('calmLight')),
  calmDark: vars(cssVarsFor('calmDark')),
};

/** Applies the token variable set for the resolved theme and keeps NativeWind's scheme in sync (03 §11.5). */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useResolvedScheme();
  const calm = usePreferencesStore((s) => s.sensoryCalm);
  const { setColorScheme } = useNwColorScheme();

  useEffect(() => {
    setColorScheme(scheme);
  }, [scheme, setColorScheme]);

  return (
    <View style={[{ flex: 1 }, themeVars[resolveThemeName(scheme, calm)]]} className="bg-surface">
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      {children}
    </View>
  );
}
