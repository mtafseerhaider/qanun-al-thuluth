import type { Locale } from './text.ts';

/**
 * Fixed, reviewed safe responses used when a deterministic guardrail blocks a draft or the input
 * needs no model at all (12 §13.1, §13.4, §13.8). Urdu copy needs native-speaker review.
 */

export const CHILD_GROWTH_FIRST: Record<Locale, string> = {
  en: "Growing children need enough food, so Thuluth never sets calorie numbers or food limits for anyone under 18. What helps most is family-wide habits: regular meals eaten together, more vegetables and fruit on everyone's plate, water instead of sugary drinks, and active play every day. You decide what and when to serve; your child decides how much to eat, and seconds are always allowed when they are hungry. If you are worried about growth, please talk with your paediatrician, who can check their growth chart.",
  ur: 'بڑھتے ہوئے بچوں کو پوری غذا چاہیے، اس لیے ثلث اٹھارہ سال سے کم عمر کسی کے لیے بھی کیلوری کے نمبر یا کھانے کی حد مقرر نہیں کرتا۔ سب سے زیادہ فائدہ پورے گھر کی اچھی عادتوں سے ہوتا ہے: مقررہ وقت پر مل کر کھانا، سب کی پلیٹ میں زیادہ سبزی اور پھل، میٹھے مشروبات کی جگہ پانی، اور روزانہ کھیل کود۔ آپ طے کریں کہ کیا اور کب کھانا ہے؛ بچہ خود طے کرے کہ کتنا کھانا ہے، اور بھوک ہو تو دوبارہ لینے کی ہمیشہ اجازت ہے۔ اگر بڑھوتری کے بارے میں فکر ہو تو براہِ کرم بچوں کے ڈاکٹر سے بات کریں جو گروتھ چارٹ دیکھ سکتے ہیں۔',
};

export const SCHOLAR_REFERRAL: Record<Locale, string> = {
  en: 'Questions about what is permitted, or how a fast is affected, are matters of religious ruling (fiqh). Thuluth does not give rulings, so please ask a qualified scholar of your tradition. I can share verified sources on the topic and help with the nutrition side.',
  ur: 'حلال و حرام اور روزے کے احکام سے متعلق سوالات فقہی مسائل ہیں۔ ثلث فتویٰ نہیں دیتا، اس لیے براہِ کرم کسی مستند عالمِ دین سے پوچھیں۔ میں اس موضوع پر تصدیق شدہ حوالے بتا سکتا ہوں اور غذائیت والے پہلو میں مدد کر سکتا ہوں۔',
};

export const RED_FLAG_REFERRAL: Record<Locale, string> = {
  en: 'What you describe is worth checking with a doctor soon, so I will pause planning around it. Please contact your doctor (or your paediatrician for a child). If things get worse, seek urgent care.',
  ur: 'آپ نے جو بتایا وہ جلد ڈاکٹر کو دکھانا ضروری ہے، اس لیے میں اس بارے میں منصوبہ بندی روک رہا ہوں۔ براہِ کرم اپنے ڈاکٹر (یا بچے کے لیے بچوں کے ڈاکٹر) سے رابطہ کریں۔ حالت بگڑے تو فوراً طبی مدد لیں۔',
};

/** Emergency numbers by country (12 §8.15; seed file `emergency_contacts.json` is the source later). */
export const EMERGENCY_NUMBERS: Record<string, string> = {
  PK: '1122 (Rescue) or 115 (Edhi)',
  GB: '999',
  US: '911',
  CA: '911',
  AE: '998',
  SA: '997',
};

export function emergencyTemplate(locale: Locale, countryCode = 'PK'): string {
  const number = EMERGENCY_NUMBERS[countryCode] ?? EMERGENCY_NUMBERS.PK ?? '';
  return locale === 'ur'
    ? `یہ ایمرجنسی ہو سکتی ہے۔ ابھی ${number} پر کال کریں یا قریبی ایمرجنسی میں جائیں۔ طبی مدد ملنے کے بعد میں کھانے کے بارے میں مدد کر سکتا ہوں۔`
    : `This could be an emergency. Call ${number} now or go to the nearest emergency department. Once you are safe and have medical help, I can help with food questions.`;
}

export const CURE_CLAIM_SAFE: Record<Locale, string> = {
  en: "Foods valued in the Islamic tradition can be part of a healthy diet, but no food or narration is a cure for a disease. Please follow your doctor's treatment and enjoy these foods as part of balanced meals.",
  ur: 'اسلامی روایت میں پسندیدہ غذائیں صحت مند کھانے کا حصہ ہو سکتی ہیں، مگر کوئی غذا یا روایت کسی بیماری کا قطعی علاج نہیں۔ براہِ کرم اپنے ڈاکٹر کے علاج پر عمل کریں اور یہ غذائیں متوازن کھانے کے ساتھ لیں۔',
};
