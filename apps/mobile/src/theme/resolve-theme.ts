import type { ThemeName } from './tokens';

export function resolveThemeName(scheme: 'light' | 'dark', calm: boolean): ThemeName {
  if (calm) return scheme === 'dark' ? 'calmDark' : 'calmLight';
  return scheme;
}
