import { formatMinor } from '@shared';

/** Money for display in minor units; Urdu uses Western digits (03 §5.5). */
export function money(amountMinor: number, currency: string, locale: string): string {
  try {
    return formatMinor(amountMinor, currency, locale === 'ur' ? 'en' : locale);
  } catch {
    return `${currency} ${Math.round(amountMinor / 100)}`;
  }
}

/** Parses a typed major-unit amount ("1,250" or "1250.50") into minor units; null when invalid. */
export function parseMajorToMinor(text: string, digits = 2): number | null {
  const n = Number(text.replace(/[,\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 10 ** digits);
}
