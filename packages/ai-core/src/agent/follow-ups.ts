import type { Locale } from '../guardrails/text.ts';

/**
 * Follow-up chips (FR-CHAT-09). Deterministic: chosen from the turn's tools and topic, so they
 * cost no tokens and never carry numbers, restriction language or unreviewed claims. At most three,
 * each under 80 characters (06 §4.1 `follow_up`).
 */

export type FollowUpTopic =
  | 'meals'
  | 'hydration'
  | 'islamic'
  | 'ramadan'
  | 'plan_change'
  | 'logging'
  | 'cost'
  | 'child'
  | 'general';

const CHIPS: Record<FollowUpTopic, Record<Locale, string[]>> = {
  meals: {
    en: [
      'Show me a quick option for tomorrow',
      'What can the kids have instead?',
      'Make it cheaper',
    ],
    ur: ['کل کے لیے کوئی جلدی بننے والا کھانا', 'بچوں کے لیے متبادل کیا ہو؟', 'اسے سستا بنائیں'],
  },
  hydration: {
    en: [
      'When should we drink water around meals?',
      'Water ideas for the kids',
      'Log a glass of water',
    ],
    ur: ['کھانے کے ساتھ پانی کب پئیں؟', 'بچوں کو پانی پلانے کے طریقے', 'ایک گلاس پانی درج کریں'],
  },
  islamic: {
    en: [
      'What does the rule of thirds look like at dinner?',
      'Show the practical steps',
      'More on eating etiquette',
    ],
    ur: [
      'رات کے کھانے میں تہائی کا اصول کیسے؟',
      'عملی اقدامات دکھائیں',
      'کھانے کے آداب کے بارے میں مزید',
    ],
  },
  ramadan: {
    en: ['What should we eat at suhoor?', 'Ideas for a gentle iftar', 'How do we stay hydrated?'],
    ur: ['سحری میں کیا کھائیں؟', 'ہلکی افطاری کے خیالات', 'روزے میں پانی کی کمی سے کیسے بچیں؟'],
  },
  plan_change: {
    en: ['Show this week’s plan', 'Swap another meal', 'Build the grocery list'],
    ur: ['اس ہفتے کا پلان دکھائیں', 'ایک اور کھانا بدلیں', 'سودے کی فہرست بنائیں'],
  },
  logging: {
    en: ['What should dinner be?', 'Log a glass of water', 'How was today overall?'],
    ur: ['رات کا کھانا کیا ہو؟', 'ایک گلاس پانی درج کریں', 'آج کا دن کیسا رہا؟'],
  },
  cost: {
    en: ['Cheaper swaps this week', 'Which items are in season?', 'Show the grocery list'],
    ur: ['اس ہفتے سستے متبادل', 'موسمی چیزیں کون سی ہیں؟', 'سودے کی فہرست دکھائیں'],
  },
  child: {
    en: [
      'Ideas to make vegetables fun',
      'How do we keep mealtimes calm?',
      'Snack ideas for school',
    ],
    ur: ['سبزیوں کو دلچسپ بنانے کے طریقے', 'کھانے کا وقت پرسکون کیسے رکھیں؟', 'اسکول کے لیے ناشتے'],
  },
  general: {
    en: [
      'What’s for dinner tonight?',
      'Explain the rule of thirds',
      'Ideas for a healthy breakfast',
    ],
    ur: ['آج رات کیا پکائیں؟', 'تہائی کا اصول سمجھائیں', 'صحت مند ناشتے کے خیالات'],
  },
};

const TOOL_TOPIC: Record<string, FollowUpTopic> = {
  search_meals: 'meals',
  compute_hydration_target: 'hydration',
  log_hydration: 'logging',
  search_islamic_sources: 'islamic',
  plan_ramadan: 'ramadan',
  log_fasting: 'ramadan',
  adjust_meal_plan: 'plan_change',
  log_meal: 'logging',
  estimate_cost: 'cost',
};

export function followUpTopic(args: {
  toolsUsed: readonly string[];
  aboutMinor: boolean;
  isRamadan?: boolean | undefined;
}): FollowUpTopic {
  for (const t of [...args.toolsUsed].reverse()) {
    const topic = TOOL_TOPIC[t];
    if (topic) return topic;
  }
  if (args.isRamadan) return 'ramadan';
  if (args.aboutMinor) return 'child';
  return 'general';
}

export function followUps(topic: FollowUpTopic, locale: Locale): string[] {
  return CHIPS[topic][locale].slice(0, 3).map((s) => s.slice(0, 80));
}
