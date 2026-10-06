import { RamadanParticipant } from '@shared/contracts';
import { toHijri } from '@shared/prayer/hijri';

import type { DayFastingTimes, FastingEligibility } from '@/features/fasting';
import { addDays } from '@/lib/dates/local-date';

/**
 * Pure Ramadan planner rules (02 §7.12.6, 15 §5.5 to §5.9, 24 S5-11). The server repeats every
 * participation rule in `ramadan-generate`; these keep the setup from offering what it would refuse.
 *
 * - Under 7: never fasting. Fixed to "not fasting"; they share suhoor and iftar as family meals.
 * - 7 to 12: a gentle practice fast (part days, a few days a week) or not fasting.
 * - Red flags (insulin or sulfonylurea, gestational diabetes, pregnancy complication, eating
 *   disorder signals): defaults to exempt; fasting only after the parent confirms a clinician
 *   approved it, and the plan still carries the clinician card.
 * - Pregnant or breastfeeding: "decide with your clinician and scholar"; either choice is fine,
 *   and "decide later" plans as not fasting.
 */

export type Intention = RamadanParticipant['intention'];
export type ExemptionReason = NonNullable<RamadanParticipant['exemption_reason']>;
export type PracticeUntil = NonNullable<RamadanParticipant['practice_fast']>['until'];
export type SuhoorStrategy = 'just_before_fajr' | 'after_tahajjud' | 'before_sleep';

export const SUHOOR_STRATEGIES: readonly SuhoorStrategy[] = [
  'just_before_fajr',
  'after_tahajjud',
  'before_sleep',
];
export const PRACTICE_UNTIL: readonly PracticeUntil[] = ['dhuhr', 'asr', 'maghrib'];
/** Menstruation is day by day, so it is logged in the fasting tracker, not planned here. */
export const SETUP_EXEMPTION_REASONS: readonly ExemptionReason[] = [
  'illness',
  'travel',
  'pregnancy',
  'breastfeeding',
  'age',
  'other',
];

export type ParticipationNotice = 'under_7' | 'blocked' | 'pregnancy' | 'practice' | 'teen' | null;

export interface ParticipationRule {
  memberId: string;
  name: string;
  mode: FastingEligibility['mode'];
  options: readonly Intention[];
  /** Under 7: nothing to choose. */
  fixed: boolean;
  defaultChoice: ParticipationChoice;
  /** Fasting needs "a clinician approved this" first (red flags). */
  fastingNeedsClinicianAck: boolean;
  notice: ParticipationNotice;
}

export interface ParticipationChoice {
  intention: Intention;
  practice: { daysPerWeek: number; until: PracticeUntil } | null;
  exemptionReason: ExemptionReason | null;
  clinicianAck: boolean;
}

export const DEFAULT_PRACTICE = { daysPerWeek: 2, until: 'dhuhr' as PracticeUntil };

const choice = (intention: Intention, extra: Partial<ParticipationChoice> = {}) => ({
  intention,
  practice: null,
  exemptionReason: null,
  clinicianAck: false,
  ...extra,
});

export function participationRule(
  member: { id: string; name: string },
  eligibility: FastingEligibility,
): ParticipationRule {
  const base = { memberId: member.id, name: member.name, mode: eligibility.mode };
  switch (eligibility.mode) {
    case 'under_7':
      return {
        ...base,
        options: ['not_fasting'],
        fixed: true,
        defaultChoice: choice('not_fasting'),
        fastingNeedsClinicianAck: false,
        notice: 'under_7',
      };
    case 'practice':
      return {
        ...base,
        options: ['practice_fast', 'not_fasting'],
        fixed: false,
        defaultChoice: choice('practice_fast', { practice: { ...DEFAULT_PRACTICE } }),
        fastingNeedsClinicianAck: false,
        notice: 'practice',
      };
    case 'blocked':
      return {
        ...base,
        options: ['exempt', 'not_fasting', 'fasting'],
        fixed: false,
        defaultChoice: choice('exempt', { exemptionReason: 'illness' }),
        fastingNeedsClinicianAck: true,
        notice: 'blocked',
      };
    case 'full':
      return {
        ...base,
        options: eligibility.minor
          ? ['fasting', 'practice_fast', 'not_fasting', 'exempt']
          : ['fasting', 'not_fasting', 'exempt'],
        fixed: false,
        // Pregnant or breastfeeding: no default either way ("decide later" plans as not fasting).
        defaultChoice: eligibility.decideWithClinician ? choice('not_fasting') : choice('fasting'),
        fastingNeedsClinicianAck: false,
        notice: eligibility.decideWithClinician ? 'pregnancy' : eligibility.minor ? 'teen' : null,
      };
  }
}

export type ChoiceError = 'not_allowed' | 'practice_details' | 'exemption_reason' | 'clinician_ack';

export function validateChoice(
  rule: ParticipationRule,
  c: ParticipationChoice,
): ChoiceError | null {
  if (!rule.options.includes(c.intention)) return 'not_allowed';
  if (c.intention === 'practice_fast') {
    const p = c.practice;
    if (!p || p.daysPerWeek < 1 || p.daysPerWeek > 7) return 'practice_details';
  }
  if (c.intention === 'exempt' && !c.exemptionReason) return 'exemption_reason';
  if (c.intention === 'fasting' && rule.fastingNeedsClinicianAck && !c.clinicianAck)
    return 'clinician_ack';
  return null;
}

/** Changing the intention keeps only the details that belong to it. */
export function withIntention(c: ParticipationChoice, intention: Intention): ParticipationChoice {
  return {
    intention,
    practice: intention === 'practice_fast' ? (c.practice ?? { ...DEFAULT_PRACTICE }) : null,
    exemptionReason: intention === 'exempt' ? (c.exemptionReason ?? null) : null,
    clinicianAck: intention === 'fasting' ? c.clinicianAck : false,
  };
}

/**
 * Contract participants for `ramadan-generate`. Throws on a choice the rules refuse, so a bug can
 * never send a fasting child to the server (which would refuse it too).
 */
export function buildParticipants(
  rules: readonly ParticipationRule[],
  choices: Readonly<Record<string, ParticipationChoice>>,
): RamadanParticipant[] {
  return rules.map((rule) => {
    const c = rule.fixed ? rule.defaultChoice : (choices[rule.memberId] ?? rule.defaultChoice);
    const err = validateChoice(rule, c);
    if (err) throw new Error(`Invalid Ramadan participation for ${rule.memberId}: ${err}`);
    return RamadanParticipant.parse({
      family_member_id: rule.memberId,
      intention: c.intention,
      ...(c.intention === 'practice_fast' && c.practice
        ? { practice_fast: { days_per_week: c.practice.daysPerWeek, until: c.practice.until } }
        : {}),
      ...(c.intention === 'exempt' && c.exemptionReason
        ? { exemption_reason: c.exemptionReason }
        : {}),
    });
  });
}

export function countFasting(participants: readonly RamadanParticipant[]) {
  return {
    fasting: participants.filter((p) => p.intention === 'fasting').length,
    practice: participants.filter((p) => p.intention === 'practice_fast').length,
  };
}

// ---- Dates ----------------------------------------------------------------------------------

/** The Ramadan to plan for: this year's until it ends, then next year's. */
export function upcomingRamadanYear(today: string, hijriOffsetDays = 0): number {
  const h = toHijri(today, { offsetDays: hijriOffsetDays });
  return h.month <= 9 ? h.year : h.year + 1;
}

export function ramadanEndDate(startDate: string, days: 29 | 30): string {
  return addDays(startDate, days - 1);
}

export type DatesError = 'length' | 'past' | 'year';

/** 29 or 30 days, not over yet, and a Hijri year the server accepts (1447 onwards). */
export function validateDates(
  v: { hijriYear: number; startDate: string; endDate: string },
  today: string,
): DatesError | null {
  if (v.hijriYear < 1447 || v.hijriYear > 1500) return 'year';
  const days = dayIndex(v.endDate, v.startDate) + 1;
  if (days !== 29 && days !== 30) return 'length';
  if (v.endDate < today) return 'past';
  return null;
}

/** Whole days from `from` to `date` (both YYYY-MM-DD). */
export function dayIndex(date: string, from: string): number {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

/** Ramadan day 1..30 for `today`, or null outside the plan. */
export function ramadanDay(
  today: string,
  plan: { startDate: string; endDate: string } | null,
): number | null {
  if (!plan || today < plan.startDate || today > plan.endDate) return null;
  return dayIndex(today, plan.startDate) + 1;
}

export function planDates(plan: { startDate: string; endDate: string }): string[] {
  const n = dayIndex(plan.endDate, plan.startDate) + 1;
  return Array.from({ length: Math.max(0, n) }, (_, i) => addDays(plan.startDate, i));
}

// ---- Ramadan Today ---------------------------------------------------------------------------

export type RamadanMoment =
  | { phase: 'before_fajr'; targetMs: number }
  | { phase: 'fasting'; targetMs: number }
  | { phase: 'after_iftar'; targetMs: null };

/** Before Fajr: count down to suhoor end. During the fast: to iftar. After Maghrib: nothing. */
export function ramadanMoment(
  times: Pick<DayFastingTimes, 'fajrIso' | 'maghribIso'>,
  nowMs: number,
): RamadanMoment {
  const fajr = Date.parse(times.fajrIso);
  const maghrib = Date.parse(times.maghribIso);
  if (nowMs < fajr) return { phase: 'before_fajr', targetMs: fajr };
  if (nowMs < maghrib) return { phase: 'fasting', targetMs: maghrib };
  return { phase: 'after_iftar', targetMs: null };
}

/** `5:42:07` for a countdown in seconds (Western digits, 08 §10.3). */
export function formatHms(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Free tips shown to everyone; the premium plan adds the schedule (17 §4). */
export const RAMADAN_TIPS = [
  'hydration',
  'suhoor',
  'iftar',
  'children',
  'pregnancy',
  'sleep',
  'activity',
  'medicines',
] as const;
export type RamadanTip = (typeof RAMADAN_TIPS)[number];

/** "Monday 8 February 2027" in the UI language; the ISO date when Intl cannot format it. */
export function formatPlanDate(isoDate: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(`${isoDate}T12:00:00Z`));
  } catch {
    return isoDate;
  }
}
