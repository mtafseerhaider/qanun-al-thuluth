import { scan } from './text.ts';
import type { Pattern, PatternHit } from './text.ts';

/**
 * No fatwa (FR-AI-06, 00 §10.5, 12 §13.8): permissibility questions are answered by citing
 * verified sources where relevant and referring to a qualified scholar. The assistant voice never
 * asserts a ruling.
 */

const FIQH_QUESTION_EN =
  /\b(is (it|this|that|\w+( \w+)?) (halal|haram|permissible|permitted|allowed|forbidden|makruh|makrooh|sunnah|wajib|fard|obligatory|mandatory|sinful|a sin)|(halal|haram|permissible|makruh|makrooh|jaiz|najaiz) (or|to|for)|allowed in islam|(does|will|would|can) .{0,40}\b(break|invalidate|nullify|spoil) (my|the|his|her|our|a) fast|is (my|his|her|our) fast (valid|invalid|broken|accepted|ok)|(must|do|should|does|have to) (i|we|he|she|they|my \w+) (fast|make up|pay|give) |(qada|qaza) or (fidya|fidyah|kaffarah|kaffara)|kaffara|kaffarah|fidya|fidyah|fatwa|ruling on|is it a sin|exempt from fasting|obligat\w+ to fast|(can|may) (i|we|she|he) (skip|not keep|break) (the |my |her |his )?fast|is .{0,30}(zabiha|zabihah|dhabiha|mashbooh))/i;

const FIQH_QUESTION_UR =
  /(حلال|حرام|جائز|ناجائز|مکروہ|فتویٰ|فتوی|روزہ ٹوٹ|روزہ ٹوٹتا|روزہ ٹوٹے|روزہ رکھنا فرض|قضا|فدیہ|کفارہ|گناہ|\bhalal\b|\bharam\b|\bjaiz\b|\bnajaiz\b|roza toot|roza tut|roza toot|fatwa|\bmakrooh\b|\bfidya\b|\bkaffara\b|\bqaza\b|roza (rakhna|rakhna zaroori|farz)|roza (toot|tut) (jata|jaye|jayega|gaya))/iu;

/** Question forms: "Is vanilla extract with alcohol permissible?", "Is blood donation going to break my fast?". */
const FIQH_QUESTION_FORM =
  /\b(is|are|can|could|may|does|do|did|will|would|should|must)\b[^.?!]{0,80}\b(halal|haram|permissible|permitted|impermissible|makruh|makrooh|jaiz|najaiz|forbidden|a sin|sinful|allowed in islam|(break|breaks|invalidate|invalidates|nullify|spoil)\w* (my|the|his|her|our|a|your) (fast|roza)|fast (still )?(valid|invalid|count|accepted)|have to (make up|fast|pay|give)|(fast|fasting|roza|ramadan)\b[^.?!]{0,40}\ballowed)\b/i;

export function detectFiqhQuestion(text: string): boolean {
  return (
    FIQH_QUESTION_EN.test(text) || FIQH_QUESTION_FORM.test(text) || FIQH_QUESTION_UR.test(text)
  );
}

/** Rulings asserted in the assistant's voice. Negated and quoted-question forms are skipped. */
const RULING_PATTERNS: readonly Pattern[] = [
  {
    code: 'ruling_asserted',
    re: /\b(it|this|that|they|these|gelatin|it's|that's|this is) (is|are)? ?(definitely |clearly |completely |totally )?(halal|haram|permissible|impermissible|forbidden|makruh|makrooh|jaiz|najaiz|allowed in islam|not allowed in islam|a sin|sinful)\b/i,
  },
  { code: 'ruling_asserted', re: /\b(it's|it is|is) (halal|haram)\b/i },
  {
    code: 'fasting_ruling',
    re: /\b(your|her|his|the) fast (is|was|remains|will be) (valid|invalid|broken|not broken|accepted|void|fine|ok)\b/i,
  },
  {
    code: 'fasting_ruling',
    re: /\b(does not|doesn't|will not|won't|does|will) (break|invalidate|nullify) (your|her|his|the) fast\b/i,
    ignoreNegation: true,
  },
  {
    code: 'fasting_obligation',
    re: /\b(you|she|he|they) (must|have to|are (obliged|required|obligated) to|need to|are exempt from|is exempt from|do not have to|don't have to) (fast|make up|pay fidya|pay kaffara|give fidya|keep the fast)/i,
    ignoreNegation: true,
  },
  { code: 'fasting_obligation', re: /\bfasting is (obligatory|fard|wajib|not required) for\b/i },
  {
    code: 'ruling_asserted',
    re: /(حلال ہے|حرام ہے|جائز ہے|ناجائز ہے|مکروہ ہے|روزہ ٹوٹ جاتا|روزہ نہیں ٹوٹتا|روزہ ٹوٹ گیا|روزہ درست ہے|روزہ رکھنا فرض ہے|قضا (کرنی|ضروری)|فدیہ (دینا|ادا))/u,
    ignoreNegation: true,
  },
  {
    code: 'ruling_asserted',
    re: /\b(halal hai|haram hai|jaiz hai|najaiz hai|makrooh hai|roza toot jata|roza (sahi|durust|theek) (hai|raha)|roza rakhna farz hai|qaza (zaroori|karni) hai|fidya (dena|dein))\b/i,
  },
  {
    // "roza nahi toot ta" is itself a ruling: the negation is the assertion.
    code: 'fasting_ruling',
    re: /\broza (nahi|nahin) (toot|tut)(ta|ega|e ga|e gaa)?\b/i,
    ignoreNegation: true,
  },
];

export function findRulingAssertions(text: string): PatternHit[] {
  return scan(text, RULING_PATTERNS);
}

/** FR-AI-06: the response template includes "please ask a qualified scholar" in the user locale. */
export const SCHOLAR_REFERRAL_PHRASE = {
  en: 'please ask a qualified scholar',
  ur: 'براہِ کرم کسی مستند عالمِ دین سے پوچھیں',
} as const;

export function hasScholarReferral(text: string): boolean {
  return (
    /qualified scholar|ask a scholar|scholar of your tradition|local imam|mufti/i.test(text) ||
    /عالمِ دین|عالم دین|مفتی|عالم سے/u.test(text)
  );
}
