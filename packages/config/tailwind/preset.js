// Tailwind preset consumed by NativeWind v4 (docs/03-design-system.md §11.3, 08 §10.1).
// Colours are CSS variables so light/dark/calm themes are a variable swap at the root.
import { colorTokenNames, fontFamilies, radius, spacing, typeScale } from '../tokens/tokens.js';

const v = (name) => `rgb(var(--color-${name}) / <alpha-value>)`;
const px = (obj) =>
  Object.fromEntries(
    Object.entries(obj).map(([k, n]) => [k, typeof n === 'number' ? `${n}px` : n]),
  );

const fontSize = Object.fromEntries(
  Object.entries(typeScale.latin).map(([k, s]) => [
    k,
    [
      `${s.size}px`,
      { lineHeight: `${s.lineHeight}px`, letterSpacing: `${s.letterSpacing ?? 0}px` },
    ],
  ]),
);
const urduFontSize = Object.fromEntries(
  Object.entries(typeScale.urdu).map(([k, s]) => [
    `ur-${k}`,
    [`${s.size}px`, { lineHeight: `${s.lineHeight}px` }],
  ]),
);

/** @type {import('tailwindcss').Config} */
const preset = {
  darkMode: 'class',
  theme: {
    // Replace (not extend) spacing, radius and colours so only token values exist.
    spacing: px(spacing),
    borderRadius: px(radius),
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: '#FFFFFF',
      black: '#000000',
      ...Object.fromEntries(colorTokenNames.map((n) => [n, v(n)])),
    },
    fontFamily: {
      ui: [fontFamilies.ui[400]],
      'ui-medium': [fontFamilies.ui[500]],
      'ui-semibold': [fontFamilies.ui[600]],
      'ui-bold': [fontFamilies.ui[700]],
      'ui-display': [fontFamilies.ui.display600],
      urdu: [fontFamilies.urdu[400]],
      'urdu-bold': [fontFamilies.urdu[700]],
      quran: [fontFamilies.quran[400]],
      arabic: [fontFamilies.arabic[400]],
      'arabic-bold': [fontFamilies.arabic[700]],
    },
    fontSize: { ...fontSize, ...urduFontSize },
    extend: {
      minHeight: { touch: '44px', control: '48px', 'control-sm': '36px', 'control-lg': '56px' },
      minWidth: { touch: '44px' },
      borderWidth: { hairline: '0.5px', focus: '2px' },
      opacity: { pattern: '0.05', disabled: '0.5', scrim: '0.4' },
    },
  },
  plugins: [],
};

export default preset;
