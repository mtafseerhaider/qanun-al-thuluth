/** Minor units per major unit for the currencies we price in; ISO 4217 default is 2. */
const MINOR_DIGITS: Record<string, number> = {
  PKR: 2,
  AED: 2,
  SAR: 2,
  GBP: 2,
  USD: 2,
  CAD: 2,
  EUR: 2,
  JPY: 0,
};

export function minorDigits(currency: string): number {
  return MINOR_DIGITS[currency] ?? 2;
}

/** Formats an integer amount in minor units, e.g. `formatMinor(4500000, 'PKR', 'en')` → "PKR 45,000". */
export function formatMinor(amountMinor: number, currency: string, locale = 'en'): string {
  const digits = minorDigits(currency);
  const major = amountMinor / 10 ** digits;
  const fractionDigits = Number.isInteger(major) ? 0 : digits;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'code',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(major);
}

export function toMinor(major: number, currency: string): number {
  return Math.round(major * 10 ** minorDigits(currency));
}
