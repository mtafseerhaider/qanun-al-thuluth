import type { Locale } from './text.ts';

/**
 * Clinician disclaimer (FR-AI-10, 00 §10.1). Structured responses carry `disclaimer_key` and the
 * app renders the disclaimer component; free text (chat, plan rationales) gets the one-line
 * reminder appended once when it contains health guidance.
 */
export const DISCLAIMER_KEY = 'disclaimer.not_medical_advice' as const;

export const DISCLAIMER_TEXT: Record<Locale, string> = {
  en: 'This is general guidance, not medical advice. Your doctor or dietitian knows your situation best.',
  ur: 'یہ عمومی رہنمائی ہے، طبی مشورہ نہیں۔ آپ کی صورتحال آپ کا ڈاکٹر یا ماہرِ غذائیت بہتر جانتے ہیں۔',
};

const HEALTH_GUIDANCE =
  /\b(kcal|calorie|protein|carb|fibre|fiber|portion|meal plan|diabetes|blood sugar|pregnan|breastfeed|allerg|medicine|medication|hydration|water|weight|fasting|doctor|paediatrician|pediatrician|growth)\b|(کیلوری|پروٹین|ذیابیطس|حمل|دودھ پلا|الرجی|دوا|پانی|وزن|روزہ|ڈاکٹر)/iu;

export function hasHealthGuidance(text: string): boolean {
  return HEALTH_GUIDANCE.test(text);
}

export function hasDisclaimer(text: string): boolean {
  return text.includes(DISCLAIMER_TEXT.en) || text.includes(DISCLAIMER_TEXT.ur);
}

/** Appends the disclaimer once when the text includes health guidance (or when forced). */
export function injectDisclaimer(text: string, locale: Locale, force = false): string {
  if (hasDisclaimer(text) || (!force && !hasHealthGuidance(text))) return text;
  return `${text.trimEnd()}\n\n${DISCLAIMER_TEXT[locale]}`;
}
