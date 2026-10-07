/**
 * Script-aware matching of household member names in free text (en, ur, Roman Urdu).
 *
 * Reply scoping (is this turn about a minor? does this sentence name an under-7 child?) and intent
 * routing match member names in the user's message and in drafts. `\b` only knows ASCII word
 * characters, so a name written in Urdu script never matched, and spelling variants of the same
 * Urdu name (Arabic vs Urdu yeh, heh and kaf; hamza and madda forms of alef; diacritics; a
 * zero-width non-joiner typed by the keyboard) did not match each other either.
 *
 * Both the name and the text are folded the same way, then the name must stand alone: not preceded
 * or followed by a letter, mark or digit of any script.
 */

/** Invisible format characters that keyboards and copy-paste insert inside Urdu words. */
const INVISIBLE = /[\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/gu;

/** Kashida (tatweel), a purely typographic stretch. */
const TATWEEL = /\u0640/gu;

/** Combining marks after NFD: harakat, superscript alef, hamza and madda, Latin accents. */
const MARKS = /\p{M}/gu;

/**
 * Letter folds for Arabic-script spelling variants of the same name. NFD has already split
 * alef with madda or hamza, waw with hamza, yeh with hamza and heh with hamza into a base letter
 * plus a mark, so only the base letters are unified here.
 */
const FOLDS: ReadonlyArray<[RegExp, string]> = [
  // alef wasla and other alef forms -> alef
  [/[\u0671\u0672\u0673\u0675]/gu, '\u0627'],
  // Arabic yeh, alef maksura, bari yeh and other yeh forms -> Farsi/Urdu yeh
  [/[\u064A\u0649\u06D0\u06D2\u06CD\u0678]/gu, '\u06CC'],
  // Arabic heh, do-chashmi heh, teh marbuta (Arabic and Urdu), ae -> gol heh
  [/[\u0647\u06BE\u06C3\u06D5\u0629]/gu, '\u06C1'],
  // Arabic kaf, swash kaf -> keheh
  [/[\u0643\u06AA]/gu, '\u06A9'],
  // noon ghunna -> noon
  [/\u06BA/gu, '\u0646'],
  // typographic apostrophes -> '
  [/[\u2018\u2019\u02BC`\u00B4]/gu, "'"],
];

/** Arabic-Indic and Extended Arabic-Indic (Urdu) digits -> ASCII. */
const DIGITS = /[\u0660-\u0669\u06F0-\u06F9]/gu;
const asciiDigit = (d: string): string => String((d.codePointAt(0) ?? 0) % 16);

/**
 * Folds `text` for name matching: compatibility forms (Arabic presentation forms, full-width
 * Latin) expanded, invisible characters, tatweel and diacritics removed, Arabic-script letter
 * variants unified, digits made ASCII, lower case, whitespace collapsed.
 */
export function foldForNameMatch(text: string): string {
  let s = text.normalize('NFKC').replace(INVISIBLE, '').replace(TATWEEL, '');
  s = s.normalize('NFD').replace(MARKS, '');
  for (const [re, to] of FOLDS) s = s.replace(re, to);
  s = s.replace(DIGITS, asciiDigit);
  return s.normalize('NFC').toLowerCase().replace(/\s+/gu, ' ').trim();
}

const letterCount = (s: string): number => [...s.replace(/[^\p{L}]/gu, '')].length;

/**
 * The forms a member name can appear in: the whole name and, when the stored name carries a
 * nickname ("Hina (<Urdu>)", "Ibrahim / <Urdu>", "Maryam, Mimi"), each part. Parts with fewer than
 * two letters are dropped. Multi-word names are not split on spaces ("Muhammad" alone would match
 * far too much).
 */
export function nameAliases(name: string): string[] {
  const out = new Set<string>();
  const whole = foldForNameMatch(name.replace(/[()[\]]/gu, ' '));
  if (letterCount(whole) >= 2) out.add(whole);
  for (const part of name.split(/[()[\]/|,\u060C;]+/u)) {
    const f = foldForNameMatch(part);
    if (letterCount(f) >= 2) out.add(f);
  }
  return [...out];
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A matcher for any of `names` in a text, script-aware. Build it once per turn; with no usable
 * name it returns false for every text.
 */
export function nameMatcher(
  names: readonly (string | null | undefined)[] = [],
): (text: string) => boolean {
  const aliases = [...new Set(names.flatMap((n) => (n ? nameAliases(n) : [])))]
    // Longest first, so "Hina Fatima" is tried before "Hina".
    .sort((a, b) => b.length - a.length)
    .map((a) => escapeRe(a).replace(/ /gu, '\\s+'));
  if (!aliases.length) return () => false;
  const re = new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}])(?:${aliases.join('|')})(?![\\p{L}\\p{M}\\p{N}])`,
    'u',
  );
  return (text: string) => re.test(foldForNameMatch(text));
}

/** True when `text` names any of `names` (see `nameMatcher`). */
export function mentionsName(
  text: string,
  names: readonly (string | null | undefined)[] = [],
): boolean {
  return nameMatcher(names)(text);
}
