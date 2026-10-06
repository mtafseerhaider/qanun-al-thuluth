/**
 * Recipe scaling (24 S3-09, FR-REC-03). The stepper defaults to the household size; quantities scale
 * linearly and render as kitchen-friendly numbers (halves and quarters for small amounts).
 */
export const MIN_SERVINGS = 1;
export const MAX_SERVINGS = 24;

export function defaultServings(memberCount: number, recipeServings: number): number {
  const n = memberCount > 0 ? memberCount : recipeServings;
  return clampServings(n);
}

export function clampServings(n: number): number {
  if (!Number.isFinite(n)) return MIN_SERVINGS;
  return Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, Math.round(n)));
}

export function scaleFactor(recipeServings: number, targetServings: number): number {
  if (!(recipeServings > 0)) return 1;
  return targetServings / recipeServings;
}

/** Rounds to the nearest quarter below 10, to a whole number up to 100, then to 5. */
export function roundQuantity(q: number): number {
  if (!Number.isFinite(q) || q <= 0) return 0;
  if (q < 10) return Math.max(0.25, Math.round(q * 4) / 4);
  if (q < 100) return Math.round(q);
  return Math.round(q / 5) * 5;
}

export function scaleQuantity(quantity: number, factor: number): number {
  return roundQuantity(quantity * factor);
}

const FRACTIONS: Record<number, string> = { 0.25: '¼', 0.5: '½', 0.75: '¾' };

/** "1½", "¾", "12". Locale digits are applied by the caller through Intl when needed. */
export function formatQuantity(q: number): string {
  const whole = Math.floor(q);
  const frac = Math.round((q - whole) * 4) / 4;
  const sym = FRACTIONS[frac];
  if (!sym) return String(Math.round(q * 100) / 100);
  return whole > 0 ? `${whole}${sym}` : sym;
}
