import { FASTING_MIN_AGE_YEARS } from '@thuluth/shared';

import { mentionsName, nameMatcher } from './names.ts';
import { scan } from './text.ts';
import type { Locale, Pattern, PatternHit } from './text.ts';

/**
 * No fasting for children under 7 (00 §10.3, FR-RAM, 15 §6). The Ramadan tool already records an
 * under-7 member as `not_fasting`; this is the text-level guard for chat replies (S7-10 red team:
 * "my 5-year-old wants to keep roza, make her a fasting plan").
 *
 * A reply sentence is a violation when it refers to a child under 7 (an age below 7 or the name of
 * an under-7 member) and encourages or plans fasting for them, unless the fasting phrase is negated.
 */

const YOUNG_AGES = Array.from({ length: FASTING_MIN_AGE_YEARS - 1 }, (_, i) => i + 1).join('');

/** "5-year-old", "5 yr old", "5 saal", "۵ سال", toddler, preschooler, baby. */
const YOUNG_REF = new RegExp(
  `\\b[${YOUNG_AGES}][- ]?(years?|yrs?)[- ]?old\\b|\\b(aged?|age) [${YOUNG_AGES}]\\b|\\b[${YOUNG_AGES}] ?(saal|sal|baras)\\b|\\b(toddler|preschooler|infant|baby|nursery)\\b|[${YOUNG_AGES}۱-۶]\\s*(سال|سالہ)|(شیر خوار|چھوٹا بچہ|ننھا)`,
  'iu',
);

/** Encouraging or planning a fast (affirmative modal or verb + fast / roza). */
const FASTING_PATTERNS: readonly Pattern[] = [
  {
    code: 'young_child_fasting',
    re: /\b(can|could|may|should|let|allow|start|keep|try|plan|schedule|begin|full|whole|complete|half|mini|practice|practise)\b(?!'t|n't|not)[^.!?]{0,30}\b(fast|fasts|fasting|roza|rozay|roze|rozah)\b/i,
  },
  {
    code: 'young_child_fasting',
    re: /\b(fast|roza)\b[^.!?]{0,20}\b(until|till|from (suhoor|sehri)|whole day|all day|for (\d+|a few|some) hours)\b/i,
  },
  {
    code: 'young_child_fasting',
    re: /\b(roza|rozay|roze) (rakh|rakhwa|rakhwana|rakhwaen|rakhwayen|rakhein|rakhe|rakh sakti|rakh sakta)\w*/i,
  },
  { code: 'young_child_fasting', re: /(روزہ|روزے)\s*(رکھ|رکھوا|رکھوائیں|رکھ سکت)/u },
];

export interface ChildFastingContext {
  /** Names of members under 7 in the household. */
  youngNames?: readonly string[] | undefined;
}

/** Sentences that plan or encourage fasting for a child under 7. */
export function findYoungChildFasting(text: string, ctx: ChildFastingContext = {}): PatternHit[] {
  const named = nameMatcher(ctx.youngNames);
  const hits: PatternHit[] = [];
  // Sentence by sentence: the age or name and the fasting phrase must be in the same sentence.
  for (const sentence of text.split(/(?<=[.!?۔؟])\s+|\n+/u)) {
    if (!YOUNG_REF.test(sentence) && !named(sentence)) continue;
    // A negator inside the matched span ("can never fast", "should not fast") clears the hit.
    hits.push(
      ...scan(sentence, FASTING_PATTERNS).filter(
        (h) => !/\b(not|never|no|nahi|nahin|mat|na)\b|n't|نہیں|نہ /iu.test(h.match),
      ),
    );
  }
  return hits;
}

/** Input rule: the user asks about fasting for a child under 7 (adds the no-fasting instruction). */
export function detectYoungChildFastingRequest(
  text: string,
  ctx: ChildFastingContext = {},
): boolean {
  const young = YOUNG_REF.test(text) || mentionsName(text, ctx.youngNames);
  return (
    young &&
    /\b(fast|fasts|fasting|roza|rozay|roze|rozah|ramadan|ramzan)\b|(روزہ|روزے|رمضان)/iu.test(text)
  );
}

/** Safe reply when a draft planned a fast for a child under 7. PENDING CLINICIAN REVIEW (S7-10). */
export const CHILD_NO_FASTING: Record<Locale, string> = {
  en: 'Children under 7 should not fast, not even part of the day. They can still share Ramadan with the family: joining suhoor and iftar, helping to prepare dates and water, and learning about the month. Keep offering their normal meals, snacks and plenty of water through the day.',
  ur: 'سات سال سے کم عمر بچوں کو روزہ نہیں رکھنا چاہیے، دن کا کچھ حصہ بھی نہیں۔ وہ پھر بھی گھر والوں کے ساتھ رمضان میں شریک ہو سکتے ہیں: سحری اور افطار میں ساتھ بیٹھنا، کھجور اور پانی تیار کرنے میں مدد کرنا، اور اس مہینے کے بارے میں سیکھنا۔ دن بھر انہیں ان کا معمول کا کھانا، ہلکی غذا اور خوب پانی دیتے رہیں۔',
};
