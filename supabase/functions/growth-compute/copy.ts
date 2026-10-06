import type { GrowthRuleCode } from '@thuluth/ai-core';

/**
 * Parent-facing alert copy (15 §2.8). Never framed as the child's fault, never a weight-loss goal
 * or restriction, no kcal (00 §10.3). Urdu awaits native review (S4-19 process); clinical wording
 * awaits the paediatric reviewer (S6-03).
 */
export const ALERT_COPY: Record<GrowthRuleCode, { en: string; ur: string }> = {
  weight_for_age_below_p3: {
    en: 'This weight is below the 3rd percentile for age. It can have many causes and is worth checking with your paediatrician soon. New growth plans are paused until then; everyday family meals stay the same.',
    ur: 'یہ وزن عمر کے لحاظ سے تیسرے پرسنٹائل سے کم ہے۔ اس کی کئی وجوہات ہو سکتی ہیں، جلد بچوں کے ڈاکٹر کو دکھانا بہتر ہے۔ تب تک بڑھوتری کے نئے پلان روک دیے گئے ہیں؛ گھر کا روزمرہ کھانا ویسا ہی رہے گا۔',
  },
  crossed_two_major_percentiles: {
    en: 'Recent measurements have dropped across two lines on the growth chart. This can have many causes and is worth checking with your paediatrician soon. New growth plans are paused until then; everyday family meals stay the same.',
    ur: 'حالیہ پیمائشیں بڑھوتری کے چارٹ پر دو لکیروں سے نیچے آ گئی ہیں۔ اس کی کئی وجوہات ہو سکتی ہیں، جلد بچوں کے ڈاکٹر کو دکھانا بہتر ہے۔ تب تک بڑھوتری کے نئے پلان روک دیے گئے ہیں؛ گھر کا روزمرہ کھانا ویسا ہی رہے گا۔',
  },
  rapid_weight_loss: {
    en: 'Weight has gone down since the last measurement. Losing weight is not expected for a growing child, so please see your paediatrician soon. Keep offering normal family meals and do not reduce food.',
    ur: 'پچھلی پیمائش کے بعد وزن کم ہوا ہے۔ بڑھتے بچے کا وزن کم ہونا متوقع نہیں، اس لیے جلد بچوں کے ڈاکٹر کو دکھائیں۔ گھر کا عام کھانا دیتے رہیں اور کھانا کم نہ کریں۔',
  },
  severe_thinness: {
    en: 'This BMI-for-age is well below the expected range. Please see your paediatrician soon. New growth plans are paused until then; keep offering normal family meals.',
    ur: 'عمر کے لحاظ سے یہ بی ایم آئی متوقع حد سے کافی کم ہے۔ براہِ کرم جلد بچوں کے ڈاکٹر کو دکھائیں۔ تب تک بڑھوتری کے نئے پلان روک دیے گئے ہیں؛ گھر کا عام کھانا دیتے رہیں۔',
  },
  height_for_age_below_p3: {
    en: 'This height is below the 3rd percentile for age. Many children are simply shorter, like their parents; mention it at your next paediatrician visit.',
    ur: 'یہ قد عمر کے لحاظ سے تیسرے پرسنٹائل سے کم ہے۔ کئی بچے اپنے والدین کی طرح قدرتی طور پر چھوٹے ہوتے ہیں؛ اگلی بار بچوں کے ڈاکٹر سے ذکر کریں۔',
  },
  bmi_for_age_above_p97: {
    en: 'This BMI-for-age is above the 97th percentile. Children should never diet: shared family meals, water instead of sweet drinks and active play help the whole family. Your paediatrician can advise.',
    ur: 'عمر کے لحاظ سے یہ بی ایم آئی ستانوے پرسنٹائل سے زیادہ ہے۔ بچوں کو کبھی ڈائٹ نہیں کروانی چاہیے: مل کر گھر کا کھانا، میٹھے مشروبات کی جگہ پانی اور کھیل کود پورے خاندان کے لیے مفید ہیں۔ بچوں کے ڈاکٹر مشورہ دے سکتے ہیں۔',
  },
  head_circumference_out_of_range: {
    en: 'This head measurement is outside the usual range for age. Please re-measure carefully and show it to your paediatrician.',
    ur: 'سر کی یہ پیمائش عمر کے لحاظ سے معمول کی حد سے باہر ہے۔ براہِ کرم احتیاط سے دوبارہ ناپیں اور بچوں کے ڈاکٹر کو دکھائیں۔',
  },
  implausible_measurement: {
    en: 'This measurement looks unusual. Please check the numbers and measure again; it is left out of the chart until confirmed.',
    ur: 'یہ پیمائش غیر معمولی لگتی ہے۔ براہِ کرم اعداد چیک کر کے دوبارہ ناپیں؛ تصدیق تک اسے چارٹ میں شامل نہیں کیا گیا۔',
  },
};
