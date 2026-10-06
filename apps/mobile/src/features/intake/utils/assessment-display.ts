import type { MemberAssessment } from '@shared/contracts';
import type { LifeStage } from '@shared';

/**
 * Display rules for the assessment summary (02 §7.4.1, §1.1, Q-08). Children (under 18) never see a
 * calorie or macro number anywhere; their guidance for parents is collapsed and filtered.
 */
const MINOR_STAGES: readonly LifeStage[] = ['infant', 'toddler', 'child', 'teen'];

export const isMinorStage = (stage: LifeStage) => MINOR_STAGES.includes(stage);

/** Calorie wording in English and Urdu (the server never sends it for children; this is a backstop). */
const ENERGY_WORDS = /k\s?cal|kilocal|calori|کیلوری|کیلو\s?کیلوری|حرارے/i;

export function mentionsEnergy(text: string): boolean {
  return ENERGY_WORDS.test(text);
}

/** Child guidance lines safe to show: anything mentioning calories is dropped. */
export function childSafeLines(lines: readonly string[] | undefined): string[] {
  return (lines ?? []).filter((l) => l.trim() !== '' && !mentionsEnergy(l));
}

/** Summary paragraph for a member: for children, sentences mentioning calories are removed. */
export function memberSummaryText(a: Pick<MemberAssessment, 'summary' | 'life_stage'>): string {
  if (!isMinorStage(a.life_stage)) return a.summary;
  return (a.summary.match(/[^.!?۔]+[.!?۔]*/g) ?? [])
    .map((s) => s.trim())
    .filter((s) => s !== '' && !mentionsEnergy(s))
    .join(' ');
}

const round50 = (n: number) => Math.round(n / 50) * 50;

/** "Around 1,900 to 2,100 kcal" from a point target (±5 percent, to the nearest 50). Adults only. */
export function energyRange(kcal: number): { low: number; high: number } {
  return { low: round50(kcal * 0.95), high: round50(kcal * 1.05) };
}

/** Glasses (adults) or cups (children) of 250 ml, with litres to one decimal. */
export function hydrationDisplay(ml: number): { count: number; litres: string } {
  return { count: Math.max(1, Math.round(ml / 250)), litres: (ml / 1000).toFixed(1) };
}

export function formatNumber(n: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale === 'ur' ? 'ur-PK' : 'en-US', {
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return String(Math.round(n));
  }
}

/** i18n key for a risk flag code from the server (`red_flag.<code>` or a bare code). */
export function riskFlagKey(flag: string): string {
  const code = flag.replace(/^red_flag\./, '');
  const known = [
    'eating_disorder_signals',
    'ed_signals',
    'rapid_child_weight_loss',
    'faltering_growth',
    'dehydration_signs',
    'pregnancy_complication',
    'severe_allergy_reaction',
    'insulin_or_sulfonylurea_fasting',
  ];
  return known.includes(code) ? `riskFlags.${code}` : 'riskFlags.other';
}
