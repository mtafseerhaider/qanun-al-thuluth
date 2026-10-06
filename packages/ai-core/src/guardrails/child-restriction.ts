import { scan } from './text.ts';
import type { Pattern, PatternHit } from './text.ts';

/**
 * Child-restriction filter (FR-AI-03, 12 §13.4, 00 §10.3): nothing addressed to or about a member
 * under 18 may contain a calorie number or target, a deficit, a diet, weight-loss language or a
 * restriction such as "eat less" or "no seconds".
 */

/** Restriction language that is a violation unless negated ("never put a child on a diet"). */
const RESTRICTION_PATTERNS: readonly Pattern[] = [
  {
    code: 'kcal_number',
    re: /\b\d[\d,.]*\s*(k?cals?|kilocalories|calories?)\b/i,
    ignoreNegation: true,
  },
  { code: 'kcal_number', re: /\d[\d,.]*\s*(کیلوری|کیلو کیلوری|kcal)/u, ignoreNegation: true },
  {
    code: 'calorie_target',
    re: /\bcalorie[s]?\s*(target|limit|goal|budget|cap|count(ing)?|allowance)\b/i,
  },
  { code: 'deficit', re: /\b(calorie|caloric|energy)?\s*deficit\b/i },
  {
    code: 'diet',
    re: /\b(on a diet|diet plan|dieting|a diet|calorie diet|low[- ]calorie|crash diet|keto)\b/i,
  },
  {
    code: 'weight_loss',
    re: /\b(lose weight|losing weight|weight[- ]loss|slim (him|her|them) down|slim down|shed (the )?(kilos|pounds|weight)|burn (off )?(fat|calories)|get (him|her|them) thinner)\b/i,
  },
  {
    code: 'eat_less',
    re: /\b(eat(ing)? less|eat(ing)? fewer|feed (him|her|them) less|less food|smaller portions?|half portions?|reduce (his|her|their) (food|portions?|intake|calories|meals)|cut (down|back)( on)?|cut (his|her|their) (food|portions?|calories|meals|snacks)|portion (control|cap|limit)s?|limit (his|her|their) (food|portions?|intake|eating|meals))\b/i,
  },
  { code: 'skip_meals', re: /\bskip(ping)? (meals?|breakfast|lunch|dinner|snacks?)\b/i },
  {
    code: 'no_seconds',
    re: /\b(no (second helpings|seconds)|(don't|do not|never) (allow|give|let) .{0,20}seconds)\b/i,
    ignoreNegation: true,
  },
  { code: 'too_much_food', re: /\b(too much food|eats too much|overeat(ing|s)?)\b/i },
  { code: 'stop_point', re: /\b(70|80) ?(percent|%) full\b/i },
  // Urdu (Nastaliq) and roman Urdu.
  { code: 'weight_loss', re: /(وزن\s*کم|پتلا\s*کر|wazan\s*kam|patla\s*kar)/iu },
  // Roman Urdu (S7-10 red team): "1000 kalori", "diet par rakhein", "roti kam karein".
  {
    code: 'kcal_number',
    re: /\d[\d,.]*\s*(kalori|kelori|calori|kailori)\w*/i,
    ignoreNegation: true,
  },
  {
    code: 'calorie_target',
    re: /\b(calorie|calories|kalori|calori)\s*(ka|ki|ke)?\s*(target|had|hadd|limit|ginti)\b/i,
  },
  {
    code: 'diet',
    re: /\b(diet (par|pe|pr|py) (rakh|daal|dal|laga|shuru)\w*|diet chart|dieting (karwa|karao|karayen)\w*|parhez(i)? khana)\b/i,
  },
  {
    code: 'weight_loss',
    re: /\b(wazan (ghata|kam ka?r|kam ho)\w*|(dubla|dubli|patla|patli|smart) (kar|karna|karo|karein|karen|karwa)\w*|motapa (kam|khatam) (kar|karna|karo|karein)\w*)\b/i,
  },
  {
    code: 'eat_less',
    re: /\b(kam khana|khana kam|kam khila\w*|kam khilay\w*|kam kha(o|ye|aye|ein|en|na)|(roti|chawal|chaawal|khana|portion|hissa) (kam|chhota|chota|aadha|adha) (kar|kardo|kar do|karein|karen|karo|dein|den)\w*|aadhi roti|adhi roti|ek hi roti)\b/i,
  },
  {
    code: 'skip_meals',
    re: /\b(nashta|nashtay|khana|dinner|lunch|raat ka khana) (skip|chhor|chor|chhurwa|band)\w*/i,
  },
  {
    code: 'no_seconds',
    re: /\b(dobara|dubara|doosri (baar|dafa)|dusri (baar|dafa)) (na|mat|nahi|nahin) (dein|do|den|dena)\b/i,
    ignoreNegation: true,
  },
  { code: 'diet', re: /(ڈائٹ|ڈائیٹ|پرہیزی\s*کھانا)/iu },
  {
    code: 'eat_less',
    re: /(کم\s*کھلا|کھانا\s*کم|کم\s*کھائ|kam\s*khila|khana\s*kam|kam\s*khaye)/iu,
  },
  { code: 'calorie_target', re: /(کیلوری\s*(کا|کی)?\s*(ہدف|حد))/u },
];

export interface ChildRestrictionContext {
  /** Kcal values computed for minors (`displayToUser: false`); any appearance is a violation. */
  internalKcalValues?: readonly number[] | undefined;
}

/** Scans text that is about or addressed to a member under 18. */
export function findChildRestrictionViolations(
  text: string,
  ctx: ChildRestrictionContext = {},
): PatternHit[] {
  const hits = scan(text, RESTRICTION_PATTERNS);
  for (const kcal of ctx.internalKcalValues ?? []) {
    const plain = String(Math.round(kcal));
    const grouped = Math.round(kcal).toLocaleString('en-US');
    if (new RegExp(`(^|[^\\d])(${plain}|${grouped.replace(',', '\\,')})([^\\d]|$)`).test(text)) {
      hits.push({ code: 'internal_estimate_leaked', match: plain });
    }
  }
  return hits;
}

const MINOR_STAGES = new Set(['infant', 'toddler', 'child', 'teen']);

/**
 * Structural check on an assessment for a minor: no energy or macro targets, and no restriction
 * language in the summary or guidance (FR-AI-03; 06 §4.2).
 */
export function validateMinorAssessment(
  a: {
    life_stage: string;
    energy_targets: unknown;
    macro_targets: unknown;
    summary: string;
    child_guidance?: readonly string[] | undefined;
  },
  ctx: ChildRestrictionContext = {},
): PatternHit[] {
  if (!MINOR_STAGES.has(a.life_stage)) return [];
  const hits: PatternHit[] = [];
  if (a.energy_targets !== null)
    hits.push({ code: 'minor_energy_targets', match: 'energy_targets' });
  if (a.macro_targets !== null) hits.push({ code: 'minor_macro_targets', match: 'macro_targets' });
  hits.push(...findChildRestrictionViolations(a.summary, ctx));
  for (const g of a.child_guidance ?? []) hits.push(...findChildRestrictionViolations(g, ctx));
  return hits;
}

const CHILD_REF =
  /\b(son|daughter|child|children|kid|kids|boy|girl|toddler|baby|teen|teenager|\d{1,2}[- ]?(year|yr)s?[- ]?old|\d{1,2} ?(y\/o|yo)|grade \d|class \d|beta|bete|betay|beti|bacha|bachay|bachi|bachon|bachche|bachchay|bachchi|baccha|bacche|bacchi|munna|munni|larka|larki|ladka|ladki|\d{1,2} ?(saal|sal|baras) (ka|ki|ke))\b|(بیٹا|بیٹے|بیٹی|بچہ|بچے|بچی|بچوں|سالہ|سال کا|سال کی)/iu;

const WEIGHT_REQUEST =
  /\b(lose weight|weight loss|lose some weight|lose \d+(\.\d+)? ?(kg|kgs|kilos?|pounds|lbs)|slim\w*|thin|thinner|heavy|deficit|portions?|reduce|cut for|weigh-?in|make weight|diet|calorie|calories|kcal|eat less|cut (his|her|their|down|back)|smaller portions?|fat|chubby|overweight|obese|too heavy|fewer meals|skip|reduce (his|her|their)|portion size|stop eating|less rice|less roti|70 ?percent|80 ?percent|fast(ing)? to lose|wazan|patla|mota|moti|motapa|dubla|dubli|kalori|calori|kam khila\w*|khana kam|kam khana)\b|(وزن|ڈائٹ|کیلوری|موٹا|موٹی|پتلا|کم کھا|کم کھلا)/iu;

/**
 * Input classifier rule: the user asks to restrict a child's food, calories or weight (12 §13.2
 * `child_weight_request`). Deliberately broad: a false positive only adds the growth-first
 * instruction, while a miss could produce restriction advice.
 */
/** The text refers to a child (son, daughter, "8-year-old", بیٹا, ...). */
export function mentionsChild(text: string): boolean {
  return CHILD_REF.test(text);
}

export function detectChildWeightRequest(text: string): boolean {
  return CHILD_REF.test(text) && WEIGHT_REQUEST.test(text);
}
