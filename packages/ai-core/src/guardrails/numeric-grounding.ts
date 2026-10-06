/**
 * Numeric grounding (12 §13.5): every number with a nutrition unit in a model draft must match a
 * value the deterministic engines produced (within rounding). Times, dates, ages, counts and the
 * fixed Thuluth rule numbers are allowed.
 */

export interface Quantity {
  value: number;
  unit: 'kcal' | 'g' | 'mg' | 'ml' | 'kg' | 'cm' | 'percent';
  raw: string;
}

const UNIT_RE =
  /(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(kcal|kilocalories|calories|cal|grams|gram|g|mg|millilitres|milliliters|ml|litres|liters|litre|liter|l|kg|kilos?|cm|percent|%|کیلو کیلوری|کیلوری|ملی لیٹر|لیٹر|گرام|کلو|سینٹی میٹر|فیصد)(?![a-z])/giu;

function unitOf(u: string): { unit: Quantity['unit']; factor: number } {
  const x = u.toLowerCase();
  // Urdu units (S6 eval finding: an Urdu calorie number was not grounded).
  if (x === 'کیلوری' || x === 'کیلو کیلوری') return { unit: 'kcal', factor: 1 };
  if (x === 'ملی لیٹر') return { unit: 'ml', factor: 1 };
  if (x === 'لیٹر') return { unit: 'ml', factor: 1000 };
  if (x === 'گرام') return { unit: 'g', factor: 1 };
  if (x === 'کلو') return { unit: 'kg', factor: 1 };
  if (x === 'سینٹی میٹر') return { unit: 'cm', factor: 1 };
  if (x === 'فیصد') return { unit: 'percent', factor: 1 };
  if (['kcal', 'kilocalories', 'calories', 'cal'].includes(x)) return { unit: 'kcal', factor: 1 };
  if (['grams', 'gram', 'g'].includes(x)) return { unit: 'g', factor: 1 };
  if (x === 'mg') return { unit: 'mg', factor: 1 };
  if (['millilitres', 'milliliters', 'ml'].includes(x)) return { unit: 'ml', factor: 1 };
  if (['litres', 'liters', 'litre', 'liter', 'l'].includes(x)) return { unit: 'ml', factor: 1000 };
  if (['kg', 'kilo', 'kilos'].includes(x)) return { unit: 'kg', factor: 1 };
  if (x === 'cm') return { unit: 'cm', factor: 1 };
  return { unit: 'percent', factor: 1 };
}

export function extractQuantities(text: string): Quantity[] {
  const out: Quantity[] = [];
  for (const m of text.matchAll(UNIT_RE)) {
    const { unit, factor } = unitOf(m[2] ?? '');
    out.push({ value: Number((m[1] ?? '0').replace(/,/g, '')) * factor, unit, raw: m[0] });
  }
  return out;
}

/** Thuluth rule numbers that may appear without a tool result (thirds, 70-80 percent full). */
const RULE_PERCENTS = [33, 50, 25, 70, 80, 100];

/**
 * Returns the quantities that do not match an allowed value. Matching tolerance: 1 percent or one
 * unit, whichever is larger (so 2,711 matches 2711 and "2.7 litres" matches 2,700 ml).
 */
export function findUngroundedNumbers(
  text: string,
  allowed: Partial<Record<Quantity['unit'], readonly number[]>>,
): Quantity[] {
  return extractQuantities(text).filter((q) => {
    const pool = [...(allowed[q.unit] ?? []), ...(q.unit === 'percent' ? RULE_PERCENTS : [])];
    // Litres are usually rounded to one decimal, so allow 50 ml either way.
    const litres = q.unit === 'ml' && !/ml|millil|ملی/i.test(q.raw);
    return !pool.some(
      (v) => Math.abs(v - q.value) <= Math.max(1, Math.abs(v) * 0.01, litres ? 50 : 0),
    );
  });
}
