/** Font family map per script (03 §5.1). Keys are PostScript names of the bundled TTFs. */
export type UiScript = 'latin' | 'urdu';

export function scriptForLocale(locale: string): UiScript {
  return locale.startsWith('ur') ? 'urdu' : 'latin';
}
