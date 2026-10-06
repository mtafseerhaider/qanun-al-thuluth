import { CHILD_AGE_YEARS, FASTING_MIN_AGE_YEARS } from '@thuluth/shared';
import type { GoalType, RedFlagCode } from '@thuluth/shared';

import type { Locale } from './text.ts';

/**
 * Deterministic red-flag rules (00 §10.2, 01 §7.6, 12 §13.3, 15 §8). A hard red flag is never left
 * to a model: these rules run first and a classifier can only add flags, never remove them.
 *
 * Codes: `reason` is the contract's `EscalationReason` (00 §10.2); `code` is the finer module code
 * from 15 §1.2 and is what `ai_assessments.risk_flags` stores (hard flags prefixed `red_flag.`).
 */

export type Recommend =
  'see_gp' | 'see_pediatrician' | 'see_dietitian' | 'urgent_care' | 'emergency';
export type EscalationReason = RedFlagCode | 'other_clinical';
export type FlagSeverity = 'info' | 'see_clinician' | 'urgent';
/** What the flag pauses for this member (FR-AI-04). */
export type PlanningStop = 'all' | 'fasting' | 'weight_goals' | 'texture_progression' | 'none';

export interface RiskFlag {
  code: string;
  hard: boolean;
  severity: FlagSeverity;
  stops: PlanningStop;
  reason?: EscalationReason;
  recommend?: Recommend;
  /** Data that triggered the flag, never free-text notes (15 §1.2). */
  evidence: Record<string, number | string | boolean>;
}

export interface EscalationOut {
  reason: EscalationReason;
  family_member_id: string | null;
  message: string;
  recommend: Recommend;
}

/** `RedFlagScreening` answers (packages/shared/src/domain/intake.ts), all optional here. */
export interface ScreeningAnswers {
  unintended_weight_change?: { kg: number; months: number } | null | undefined;
  eating_disorder_history?: 'prefer_not_to_say' | 'no' | 'yes' | undefined;
  refuses_food_groups_with_weight_loss?: boolean | undefined;
  gags_on_most_textures?: boolean | undefined;
  faint_or_dark_urine_when_fasting?: boolean | undefined;
  intends_to_fast?: boolean | undefined;
  pregnancy_vomiting_cannot_keep_fluids?: boolean | undefined;
}

export interface IntakeRedFlagInput {
  ageMonths: number;
  weightKg: number | null;
  pregnant: boolean;
  gestationalDiabetes: boolean;
  breastfeeding: boolean;
  conditions: ReadonlyArray<{
    label: string;
    conditionCode?: string | null | undefined;
    onInsulinOrSulfonylurea?: boolean | undefined;
  }>;
  medicationFlags: readonly string[];
  allergySeverities: readonly string[];
  goals: readonly GoalType[];
  /** `family_members.lifestyle.fasting_practice`. */
  fastingPractice: readonly string[];
  screening?: ScreeningAnswers | null | undefined;
}

/** SNOMED CT eating-disorder concepts (clinician review pending) and label patterns. */
const ED_CODES = new Set(['72366004', '56882008', '78004001', '439960005']);
const ED_LABEL = /anorexi|bulimi|binge|eating disorder|arfid|purging|کھانے کی خرابی/i;

const ORDER: Record<FlagSeverity, number> = { urgent: 3, see_clinician: 2, info: 1 };

export function evaluateIntakeRedFlags(m: IntakeRedFlagInput): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const years = m.ageMonths / 12;
  const minor = years < CHILD_AGE_YEARS;
  const s = m.screening ?? {};
  const doctor: Recommend = minor ? 'see_pediatrician' : 'see_gp';
  const intendsToFast = !!s.intends_to_fast || m.fastingPractice.length > 0;

  // Eating disorder signals: history answer or a coded/labelled condition.
  const edCondition = m.conditions.some(
    (c) => (c.conditionCode && ED_CODES.has(c.conditionCode)) || ED_LABEL.test(c.label),
  );
  if (s.eating_disorder_history === 'yes' || edCondition) {
    flags.push({
      code: 'eating_disorder_signal',
      hard: true,
      severity: 'see_clinician',
      stops: 'weight_goals',
      reason: 'eating_disorder_signals',
      recommend: doctor,
      evidence: { history: s.eating_disorder_history === 'yes', condition: edCondition },
    });
  }

  // Unintended weight loss (12 §13.3: under 18, at least 5 percent within 90 days).
  const change = s.unintended_weight_change;
  if (change && change.kg < 0 && m.weightKg) {
    const pct = (-change.kg / (m.weightKg - change.kg)) * 100;
    const evidence = {
      lost_kg: -change.kg,
      months: change.months,
      percent: Math.round(pct * 10) / 10,
    };
    if (minor && pct >= 5 && change.months <= 3) {
      flags.push({
        code: 'child_rapid_weight_loss',
        hard: true,
        severity: 'urgent',
        stops: 'all',
        reason: 'rapid_child_weight_loss',
        recommend: 'see_pediatrician',
        evidence,
      });
    } else if (minor) {
      flags.push({
        code: 'child_weight_loss_reported',
        hard: false,
        severity: 'see_clinician',
        stops: 'none',
        recommend: 'see_pediatrician',
        evidence,
      });
    } else if (pct >= 5 && change.months <= 6) {
      // Unexplained adult loss of 5 percent or more in 6 months: see a GP before any deficit.
      flags.push({
        code: 'unintended_weight_loss',
        hard: true,
        severity: 'see_clinician',
        stops: 'weight_goals',
        reason: 'other_clinical',
        recommend: 'see_gp',
        evidence,
      });
    }
  }

  if (s.refuses_food_groups_with_weight_loss) {
    flags.push({
      code: 'feeding_losing_foods',
      hard: true,
      severity: 'see_clinician',
      stops: 'all',
      reason: minor ? 'rapid_child_weight_loss' : 'other_clinical',
      recommend: doctor,
      evidence: { refuses_food_groups_with_weight_loss: true },
    });
  }

  if (s.gags_on_most_textures) {
    // Possible ARFID: refer to a feeding therapist through the paediatrician (01 §7.6).
    flags.push({
      code: 'feeding_choking_gagging_vomiting',
      hard: true,
      severity: 'urgent',
      stops: 'texture_progression',
      reason: 'other_clinical',
      recommend: doctor,
      evidence: { gags_on_most_textures: true },
    });
  }

  if (s.faint_or_dark_urine_when_fasting) {
    flags.push({
      code: 'dehydration_signs',
      hard: true,
      severity: years < 5 ? 'urgent' : 'see_clinician',
      stops: 'fasting',
      reason: 'dehydration_signs',
      recommend: years < 5 ? 'urgent_care' : doctor,
      evidence: { faint_or_dark_urine_when_fasting: true },
    });
  }

  const insulinOrSu =
    m.medicationFlags.includes('insulin') ||
    m.medicationFlags.includes('sulfonylurea') ||
    m.conditions.some((c) => c.onInsulinOrSulfonylurea);
  if ((insulinOrSu || (m.pregnant && m.gestationalDiabetes)) && intendsToFast) {
    flags.push({
      code: 'diabetes_fasting_high_risk',
      hard: true,
      severity: 'see_clinician',
      stops: 'fasting',
      reason: 'insulin_or_sulfonylurea_fasting',
      recommend: 'see_gp',
      evidence: {
        insulin_or_sulfonylurea: insulinOrSu,
        gestational_diabetes: m.pregnant && m.gestationalDiabetes,
        intends_to_fast: true,
      },
    });
  } else if (insulinOrSu) {
    flags.push({
      code: 'diabetes_medication_fasting_caution',
      hard: false,
      severity: 'info',
      stops: 'none',
      evidence: { insulin_or_sulfonylurea: true },
    });
  }

  if (m.pregnant && s.pregnancy_vomiting_cannot_keep_fluids) {
    flags.push({
      code: 'pregnancy_warning_sign',
      hard: true,
      severity: 'urgent',
      stops: 'all',
      reason: 'pregnancy_complication',
      recommend: 'urgent_care',
      evidence: { cannot_keep_fluids: true },
    });
  }

  if (m.allergySeverities.includes('anaphylactic')) {
    // Planning continues with strict exclusion and a warning banner (01 §7.6).
    flags.push({
      code: 'anaphylactic_allergy',
      hard: false,
      severity: 'info',
      stops: 'none',
      evidence: { anaphylactic: true },
    });
  }

  if (years < FASTING_MIN_AGE_YEARS && intendsToFast) {
    flags.push({
      code: 'child_under_7_no_fasting_plan',
      hard: false,
      severity: 'info',
      stops: 'fasting',
      evidence: { age_years: Math.floor(years) },
    });
  }

  if ((m.pregnant || m.breastfeeding) && m.goals.includes('weight_loss')) {
    flags.push({
      code: 'goal_suppressed_pregnancy_or_lactation',
      hard: false,
      severity: 'info',
      stops: 'weight_goals',
      evidence: { pregnant: m.pregnant, breastfeeding: m.breastfeeding },
    });
  }

  if (minor && (m.goals.includes('weight_loss') || m.goals.includes('weight_gain'))) {
    flags.push({
      code: 'child_weight_goal_ignored',
      hard: false,
      severity: 'info',
      stops: 'weight_goals',
      evidence: { minor: true },
    });
  }

  return flags.sort(
    (a, b) => Number(b.hard) - Number(a.hard) || ORDER[b.severity] - ORDER[a.severity],
  );
}

/** `ai_assessments.risk_flags` values: hard flags carry the `red_flag.` prefix (05 §10.1). */
export function riskFlagStrings(flags: readonly RiskFlag[]): string[] {
  return [...new Set(flags.map((f) => (f.hard ? `red_flag.${f.code}` : f.code)))];
}

const ESCALATION_TEXT: Record<Locale, Record<EscalationReason, string>> = {
  en: {
    eating_disorder_signals:
      'Some answers suggest eating has been difficult. We will not set any weight goal for now. Please talk with your doctor, who can help in a kind and private way.',
    rapid_child_weight_loss:
      'Losing weight quickly is not expected for a growing child. Please see your paediatrician soon. Until then, keep offering normal family meals and do not reduce food.',
    faltering_growth:
      'The growth measurements are worth checking with your paediatrician. Keep offering normal family meals in the meantime.',
    dehydration_signs:
      'Fainting or dark urine during a fast can be a sign of dehydration. Do not plan fasts for now and please speak with a doctor. If someone is very drowsy or confused, get urgent care.',
    pregnancy_complication:
      'Not being able to keep fluids down in pregnancy needs medical care today. Please contact your doctor or midwife now.',
    severe_allergy_reaction:
      'A severe allergic reaction is an emergency. If it happens, call emergency services first.',
    insulin_or_sulfonylurea_fasting:
      'Fasting while taking insulin or certain diabetes tablets can cause dangerously low blood sugar. We will not make a fasting plan until your doctor has reviewed your medicines. Normal meal planning continues.',
    other_clinical:
      'Some answers are worth checking with a doctor before we plan around them. We will keep meals normal and gentle until then.',
  },
  ur: {
    eating_disorder_signals:
      'کچھ جوابات سے لگتا ہے کہ کھانا مشکل رہا ہے۔ ہم ابھی وزن کا کوئی ہدف نہیں رکھیں گے۔ براہِ کرم اپنے ڈاکٹر سے بات کریں، وہ نرمی اور رازداری سے مدد کر سکتے ہیں۔',
    rapid_child_weight_loss:
      'بڑھتے ہوئے بچے کا تیزی سے وزن گرنا معمول کی بات نہیں۔ براہِ کرم جلد بچوں کے ڈاکٹر کو دکھائیں۔ تب تک گھر کا عام کھانا دیتے رہیں اور کھانا کم نہ کریں۔',
    faltering_growth:
      'بڑھوتری کی پیمائشیں بچوں کے ڈاکٹر کو دکھانا بہتر ہے۔ اس دوران گھر کا عام کھانا دیتے رہیں۔',
    dehydration_signs:
      'روزے کے دوران بے ہوشی یا گہرے رنگ کا پیشاب پانی کی کمی کی علامت ہو سکتی ہے۔ ابھی روزوں کی منصوبہ بندی نہ کریں اور ڈاکٹر سے بات کریں۔ اگر کوئی بہت سست یا الجھن میں ہو تو فوراً طبی مدد لیں۔',
    pregnancy_complication:
      'حمل میں پانی تک نہ رکنا آج ہی طبی توجہ مانگتا ہے۔ براہِ کرم ابھی اپنی ڈاکٹر یا دائی سے رابطہ کریں۔',
    severe_allergy_reaction:
      'شدید الرجی کا ردِعمل ایمرجنسی ہے۔ ایسا ہو تو سب سے پہلے ایمرجنسی نمبر پر کال کریں۔',
    insulin_or_sulfonylurea_fasting:
      'انسولین یا ذیابیطس کی بعض گولیوں کے ساتھ روزہ رکھنے سے شوگر خطرناک حد تک گر سکتی ہے۔ جب تک ڈاکٹر آپ کی دوائیں نہ دیکھ لیں، ہم روزوں کا منصوبہ نہیں بنائیں گے۔ عام کھانوں کی منصوبہ بندی جاری رہے گی۔',
    other_clinical: 'کچھ جوابات ڈاکٹر کو دکھانا بہتر ہے۔ تب تک کھانے عام اور نرم رکھیں گے۔',
  },
};

/** The escalation for the most severe hard flag, or null (06 §4.2: red flags do not fail the call). */
export function escalationFor(
  flags: readonly RiskFlag[],
  familyMemberId: string | null,
  locale: Locale,
): EscalationOut | null {
  const top = flags.find((f) => f.hard && f.reason && f.recommend);
  if (!top?.reason || !top.recommend) return null;
  return {
    reason: top.reason,
    family_member_id: familyMemberId,
    message: ESCALATION_TEXT[locale][top.reason],
    recommend: top.recommend,
  };
}

// ---- Free-text red-flag lexicon (12 §13.1); the classify.safety model confirms ----

export type TextSafety = 'ok' | 'red_flag' | 'emergency';

const EMERGENCY =
  /\b(can'?t breathe|cannot breathe|trouble breathing|not breathing|struggling to breathe|throat (is )?(closing|swelling)|lips? (are |is )?swell|swollen (lips|tongue|throat)|unconscious|unresponsive|passed out and|won'?t wake|seizure|fitting|overdose|heavy bleeding|bleeding heavily|kill myself|end my life|suicid|self[- ]harm|hurt myself|saans nahi|behosh)|(خون بہہ|بے ہوش|سانس نہیں|خودکشی)/iu;

const RED_FLAG_TEXT: ReadonlyArray<[RegExp, string]> = [
  [
    /\b(mak(e|ing) (myself|herself|himself) (sick|vomit|throw up)|throw(ing)? up after (eating|meals)|haven'?t eaten in (\d+|two|three|several) days|starv(e|ing) (myself|herself|himself)|laxatives to lose|purg(e|ing)|thinks? (she|he|i) (is|am|'s|'m) (fat|too fat) and (skips|won't eat|refuses)|scared to eat|afraid to eat|fear of eating|exercise to burn off everything)\b|(الٹی کر دیتی|کھانا چھوڑ دیا ہے کہ موٹی)/iu,
    'eating_disorder_signals',
  ],
  [
    /\b(dark (yellow )?urine|very dark pee|no urine|hasn'?t (peed|urinated|weed)|not (peed|passed urine)|fewer wet (nappies|diapers)|no wet (nappies|diapers)|sunken eyes|dizzy (while|during|when) fasting|faint(ed|ing)? (while|during|when) fasting|fainted during (roza|the fast))\b|(پیشاب کا رنگ گہرا|پیشاب نہیں آیا|روزے میں چکر)/iu,
    'dehydration_signs',
  ],
  [
    /\b(pregnant|pregnancy|weeks? along)\b.{0,80}\b(bleeding|spotting|can'?t keep (water|fluids|anything) down|vomit(ing)? everything|baby (is )?(moving less|not moving)|reduced (fetal |baby )?movements?|severe headache|blurred vision|swollen (face|hands))\b/iu,
    'pregnancy_complication',
  ],
  [
    /\b(anaphyla\w*|epi-?pen|throat (felt )?tight after|swell(ing|ed) up after (eating|he ate|she ate)|hives all over)\b/iu,
    'severe_allergy_reaction',
  ],
  [
    /\b(insulin|gliclazide|glimepiride|glibenclamide|glyburide|glipizide|sulfonylurea|diamicron|amaryl)\b.{0,100}\b(fast|fasting|roza|rozay|ramadan|ramzan)\b|\b(fast|fasting|roza|ramadan|ramzan)\b.{0,100}\b(insulin|gliclazide|glimepiride|glibenclamide|sulfonylurea)\b|(انسولین.{0,60}روز)/iu,
    'insulin_or_sulfonylurea_fasting',
  ],
  [
    /\b(son|daughter|child|kid|boy|girl|baby|toddler|\d{1,2}[- ]?(year|yr)s?[- ]?old)\b.{0,60}\b(lost|losing|dropped) (\d+(\.\d+)? ?kg|weight|a lot of weight)\b|\b(lost|losing) weight\b.{0,60}\b(son|daughter|child|kid|boy|girl|toddler)\b/iu,
    'rapid_child_weight_loss',
  ],
];

export interface TextRedFlagResult {
  safety: TextSafety;
  categories: string[];
}

export function detectRedFlagText(text: string): TextRedFlagResult {
  const categories: string[] = [];
  if (EMERGENCY.test(text)) categories.push('emergency');
  for (const [re, code] of RED_FLAG_TEXT) if (re.test(text)) categories.push(code);
  const safety: TextSafety = categories.includes('emergency')
    ? 'emergency'
    : categories.length
      ? 'red_flag'
      : 'ok';
  return { safety, categories };
}
