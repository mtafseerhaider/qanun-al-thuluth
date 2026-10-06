/** Text helpers shared by the deterministic guardrails (en, ur, roman Urdu). */

/** Splits on sentence ends in English and Urdu (full stop U+06D4, question mark U+061F). */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?۔؟])\s+|\n+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Normalises whitespace and apostrophes so lexicons stay small. */
export function normalize(text: string): string {
  return text.replace(/[‘’ʼ]/g, "'").replace(/\s+/g, ' ').trim();
}

const NEGATION_BEFORE =
  /\b(no(?![,!])|not|never|don't|do not|doesn't|does not|won't|without|avoid|instead of|rather than|nahi|nahin|mat)\b/i;
/** Urdu is verb-final, so the negation usually follows the phrase. */
const NEGATION_AFTER = /(نہیں|نہ(?=[\s۔،.,]|$)|مت(?=[\s۔،.,]|$)|\bnahi\b|\bnahin\b|\bmat\b)/u;

/**
 * True when `match` at `index` inside `sentence` is negated: an English negator in the preceding
 * 50 characters, or an Urdu negator in the following 40 characters, within the same clause.
 */
export function isNegated(sentence: string, index: number, length: number): boolean {
  // A clause break ("Don't worry, put him on a diet") ends the negation's scope.
  const before =
    sentence
      .slice(Math.max(0, index - 50), index)
      .split(/[,;:\u060C]/u)
      .pop() ?? '';
  const after = sentence.slice(index + length, index + length + 40).split(/[,;:\u060C]/u)[0] ?? '';
  return NEGATION_BEFORE.test(before) || NEGATION_AFTER.test(after);
}

export interface PatternHit {
  code: string;
  match: string;
}

export interface Pattern {
  code: string;
  re: RegExp;
  /** When true the hit counts even if negated (for example any explicit kcal number). */
  ignoreNegation?: boolean;
}

/** Runs patterns sentence by sentence, skipping negated hits. */
export function scan(text: string, patterns: readonly Pattern[]): PatternHit[] {
  const hits: PatternHit[] = [];
  for (const sentence of sentences(normalize(text))) {
    for (const p of patterns) {
      const re = new RegExp(p.re.source, p.re.flags.includes('g') ? p.re.flags : `${p.re.flags}g`);
      for (const m of sentence.matchAll(re)) {
        if (!p.ignoreNegation && isNegated(sentence, m.index ?? 0, m[0].length)) continue;
        hits.push({ code: p.code, match: m[0] });
      }
    }
  }
  return hits;
}

/** Contains Arabic-script (Urdu) letters. */
export function hasUrduScript(text: string): boolean {
  return /[؀-ۿ]/u.test(text);
}

export type Locale = 'en' | 'ur';
