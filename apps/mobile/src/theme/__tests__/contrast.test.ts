import { colors, type ColorToken, type ThemeName } from '../tokens';

/** WCAG 2.2 relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r as number) + 0.7152 * (g as number) + 0.0722 * (b as number);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES: ThemeName[] = ['light', 'dark', 'calmLight', 'calmDark'];
const SURFACES: ColorToken[] = ['surface', 'surface-raised', 'surface-sunken'];
const TEXT: ColorToken[] = [
  'ink',
  'ink-muted',
  'ink-subtle',
  'primary',
  'danger',
  'success',
  'warning',
  'info',
];

/** Accessibility pass 2 and launch follow-up (01 §9.3, WCAG 1.4.3 and 1.4.11), all four themes. */
describe.each(THEMES)('%s theme contrast', (theme) => {
  const c = colors[theme];

  it.each(SURFACES)('line-strong (control borders) is at least 3:1 on %s', (surface) => {
    expect(contrast(c['line-strong'], c[surface])).toBeGreaterThanOrEqual(3);
  });

  it.each(SURFACES)('text tokens are at least 4.5:1 on %s', (surface) => {
    for (const ink of TEXT) expect(contrast(c[ink], c[surface])).toBeGreaterThanOrEqual(4.5);
  });

  it('focus is at least 3:1 on every surface', () => {
    for (const surface of SURFACES) expect(contrast(c.focus, c[surface])).toBeGreaterThanOrEqual(3);
  });
});
