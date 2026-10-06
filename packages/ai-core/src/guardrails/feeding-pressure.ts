import { scan, sentences } from './text.ts';
import type { Locale, Pattern, PatternHit } from './text.ts';

/**
 * Feeding-pressure filter (15 §3.8 rule 1, §4.2; 12 §4.6): nothing about a child may push, bribe,
 * reward or punish with food, hide foods, or make a "clean plate" the goal. Division of
 * Responsibility: the parent decides what, when and where; the child decides whether and how much.
 * Negated mentions ("never bribe", "no pressure to finish") are allowed.
 */
const PRESSURE_PATTERNS: readonly Pattern[] = [
  {
    code: 'one_more_bite',
    re: /\b(just |at least )?(one|two|three|a few) more (bites?|spoons?(ful)?|mouthfuls?)\b/i,
  },
  {
    code: 'clean_plate',
    re: /\b(clean (his|her|their|your|the) plate|clean plate|finish(es|ing)? (his|her|their|your|the|it all|everything|all of)|(eat|eats|eating) (it )?all (of it|up)|until (the plate|it) is empty|empty plate)\b/i,
  },
  {
    code: 'force',
    re: /\b(force|forcing|forced|make (him|her|them) (eat|taste|try|finish)|insist (that )?(he|she|they) (eat|taste|try)|(must|has to|have to|needs? to) (eat|taste|try|finish) (it|the|this|that|his|her|their)|hold (his|her|their) (nose|mouth))\b/i,
  },
  {
    code: 'bribe',
    re: /\b(bribe|bribing|bribes|reward (him|her|them|it)? ?(with|for)|rewarding .{0,20}with (sweets?|dessert|chocolate|candy|treats?|ice[- ]cream)|(dessert|sweets?|treats?|chocolate|ice[- ]cream|screen time|ipad|tablet time) (if|when|only (if|after)|after) (he|she|they)( eats?| finish(es)?| tries?| tastes?)|no (dessert|sweets?|treats?) (until|unless))\b/i,
  },
  {
    code: 'punish',
    re: /\b(punish|punishment|time[- ]out|take away (his|her|their)|no (tv|screen|ipad|games?) (until|unless)|sit there until|stay at the table until)\b/i,
  },
  {
    code: 'hide_food',
    re: /\b(hide|hiding|hidden|sneak|sneaking|disguise|disguising) (the |some )?(vegetables?|veg|veggies|spinach|carrots?|it|food|foods)\b|\bwithout (him|her|them) (knowing|noticing)\b/i,
  },
  {
    code: 'shaming',
    re: /\b(good (boy|girl) for (eating|finishing)|bad (boy|girl)|shame on|picky eaters? (are|is) (naughty|spoiled|bad)|spoiled (child|kid|brat))\b/i,
  },
  // Urdu and roman Urdu.
  { code: 'force', re: /(زبردستی\s*(کھلا|کھا)|zabardasti\s*(khila|kha))/iu },
  {
    code: 'one_more_bite',
    re: /(بس\s*ایک\s*(اور\s*)?(نوالہ|لقمہ)|bas\s*ek\s*(aur\s*)?(niwala|luqma))/iu,
  },
  { code: 'bribe', re: /(لالچ\s*د|انعام\s*میں\s*(مٹھائی|چاکلیٹ)|lalach\s*d)/iu },
  { code: 'clean_plate', re: /(پلیٹ\s*(صاف|ختم)\s*کر|plate\s*(saaf|khatam)\s*kar)/iu },
  { code: 'hide_food', re: /(چھپا\s*کر\s*(کھلا|ڈال)|chupa\s*kar\s*(khila|daal))/iu },
];

export function findFeedingPressure(text: string): PatternHit[] {
  return scan(text, PRESSURE_PATTERNS);
}

/** The calm Division of Responsibility line that replaces removed pressure sentences. */
export const NO_PRESSURE_NOTE: Record<Locale, string> = {
  en: 'Offer it calmly next to a food your child already enjoys. You decide what, when and where; your child decides whether and how much. Looking, touching and smelling all count, and leaving it is fine.',
  ur: 'اسے سکون سے کسی ایسی چیز کے ساتھ رکھیں جو بچہ پہلے سے شوق سے کھاتا ہے۔ کیا، کب اور کہاں آپ طے کریں؛ کھانا ہے یا نہیں اور کتنا، یہ بچہ طے کرے۔ دیکھنا، چھونا اور سونگھنا بھی کامیابی ہے، اور چھوڑ دینا بالکل ٹھیک ہے۔',
};

/** Drops sentences with feeding pressure and appends the no-pressure line once. */
export function removeFeedingPressure(
  text: string,
  locale: Locale,
): { text: string; hits: PatternHit[] } {
  const hits = findFeedingPressure(text);
  if (!hits.length) return { text, hits };
  const kept = sentences(text).filter((s) => findFeedingPressure(s).length === 0);
  const note = NO_PRESSURE_NOTE[locale];
  return { text: kept.length ? `${kept.join(' ')}\n\n${note}` : note, hits };
}
