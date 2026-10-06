// Types for tokens.js (docs/03-design-system.md §11.2). Keep in sync with tokens.js.
export type ThemeName = 'light' | 'dark' | 'calmLight' | 'calmDark';

export declare const colorTokenNames: readonly [
  'surface',
  'surface-raised',
  'surface-sunken',
  'ink',
  'ink-muted',
  'ink-subtle',
  'line',
  'line-strong',
  'primary',
  'primary-pressed',
  'on-primary',
  'primary-soft',
  'on-primary-soft',
  'secondary',
  'on-secondary',
  'accent',
  'on-accent',
  'accent-ink',
  'success',
  'on-success',
  'success-soft',
  'on-success-soft',
  'warning',
  'on-warning',
  'warning-soft',
  'on-warning-soft',
  'danger',
  'on-danger',
  'danger-soft',
  'on-danger-soft',
  'info',
  'on-info',
  'info-soft',
  'on-info-soft',
  'focus',
  'plate-veg',
  'plate-protein',
  'plate-carb',
  'water',
  'plate-space',
];
export type ColorToken = (typeof colorTokenNames)[number];
export type ColorTheme = Readonly<Record<ColorToken, string>>;
export declare const colors: Readonly<Record<ThemeName, ColorTheme>>;

type Ramp = Readonly<Record<50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900, string>>;
export declare const ramps: Readonly<{ teal: Ramp; clay: Ramp; saffron: Ramp; neutral: Ramp }>;

export declare const spacing: Readonly<Record<string, number>>;
export declare const radius: Readonly<
  Record<'none' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full', number>
>;

export type TextVariant =
  'display' | 'title' | 'heading' | 'body' | 'bodyStrong' | 'label' | 'caption' | 'overline';
export interface TypeSpec {
  size: number;
  lineHeight: number;
  family: string;
  letterSpacing?: number;
  uppercase?: boolean;
  maxMultiplier: number;
}
export declare const fontFamilies: Readonly<{
  ui: Readonly<{ 400: string; 500: string; 600: string; 700: string; display600: string }>;
  urdu: Readonly<{ 400: string; 700: string }>;
  quran: Readonly<{ 400: string }>;
  arabic: Readonly<{ 400: string; 700: string }>;
}>;
export declare const typeScale: Readonly<
  Record<'latin' | 'urdu', Readonly<Record<TextVariant, TypeSpec>>>
>;
export type ScriptTypeToken = 'quran-lg' | 'quran-md' | 'arabic-md' | 'arabic-sm';
export declare const scriptType: Readonly<
  Record<ScriptTypeToken, { size: number; lineHeight: number; family: string }>
>;
export declare const motion: Readonly<{
  instant: number;
  fast: number;
  base: number;
  slow: number;
}>;

export interface ElevationSpec {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffsetY: number;
  androidElevation: number;
}
export declare const elevation: Readonly<Record<0 | 1 | 2 | 3 | 4, ElevationSpec>>;
export declare const sizing: Readonly<{
  touchMin: number;
  controlSm: number;
  controlMd: number;
  controlLg: number;
  tabBar: number;
  header: number;
  fab: number;
}>;

export declare function hexToRgbTriplet(hex: string): string;
export declare function cssVarsFor(theme: ThemeName): Record<`--color-${ColorToken}`, string>;
