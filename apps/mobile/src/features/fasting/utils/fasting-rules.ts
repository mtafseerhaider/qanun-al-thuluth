import {
  ageInYears,
  FAST_KINDS,
  FASTING_MIN_AGE_YEARS,
  CHILD_AGE_YEARS,
  type FastKind,
  type LifeStage,
  type SpecialModule,
} from '@shared';
import type { EXEMPTION_REASONS } from '@shared/domain/tracking';
import { hijriIso, tabularToGregorian, toHijri } from '@shared/prayer/hijri';

import { addDays } from '@/lib/dates/local-date';
import type { OutboxEntry } from '@/lib/offline/outbox';

/**
 * Pure fasting rules (02 §7.12.4 to §7.12.5, 15 §5.5 to §5.9, FR-FAST-01 to -08, 00 §10). The
 * database enforces the same child rules (CHILD_RULE triggers); these keep the UI from offering
 * what the server would refuse.
 */

export const FASTING_LOG_KIND = 'fasting.log';
export const FASTING_DELETE_KIND = 'fasting.delete';

export type ExemptionReason = (typeof EXEMPTION_REASONS)[number];
/** Permanent exemptions get a fidya note instead of a qada counter (15 §5.9). */
const PERMANENT_EXEMPTIONS: ReadonlySet<string> = new Set(['age', 'chronic_condition']);

export interface FastingLogView {
  id: string;
  familyMemberId: string;
  fastDate: string;
  kind: FastKind;
  startedAt: string | null;
  endedAt: string | null;
  completed: boolean;
  /** Null when the viewer may not see it (fasting_logs_visible, FR-FAST-02 privacy). */
  exemptionReason: ExemptionReason | null;
  isPracticeFast: boolean;
  notes: string | null;
  hijriDate: string | null;
  qadaForHijriYear: number | null;
  queued?: boolean;
}

/** Outbox payload; `id` is the row id and the idempotency key. */
export interface FastingLogWrite {
  id: string;
  householdId: string;
  familyMemberId: string;
  fastDate: string;
  kind: FastKind;
  startedAt: string | null;
  endedAt: string | null;
  completed: boolean;
  exemptionReason: ExemptionReason | null;
  isPracticeFast: boolean;
  notes: string | null;
  hijriDate: string | null;
  qadaForHijriYear: number | null;
}

export interface FastingDeleteWrite {
  id: string;
  householdId: string;
}

// ---- Safety and age rules --------------------------------------------------------------------

export type SafetyReason =
  | 'insulin_or_sulfonylurea'
  | 'gestational_diabetes'
  | 'pregnancy_complication'
  | 'eating_disorder_signals';

export interface MemberSafety {
  reasons: SafetyReason[];
  pregnant: boolean;
  breastfeeding: boolean;
}

export const NO_SAFETY: MemberSafety = { reasons: [], pregnant: false, breastfeeding: false };

export interface FastingMember {
  id: string;
  name: string;
  dateOfBirth: string | null;
  lifeStage: LifeStage;
  specialModules: readonly SpecialModule[];
  linkedUserId: string | null;
}

export type FastingEligibility =
  /** No fasting options at all under 7 (FR-FAST-06). */
  | { mode: 'under_7' }
  /** Clinician card, no fasting logs (FR-FAST-07). */
  | { mode: 'blocked'; reasons: SafetyReason[] }
  /** 7 to puberty: gentle practice fasts only (FR-FAST-06). */
  | { mode: 'practice' }
  | {
      mode: 'full';
      /** Pregnant or breastfeeding: "decide with your clinician and scholar"; either choice is fine. */
      decideWithClinician: boolean;
      /** Intermittent fasting: adults only, never pregnant, breastfeeding or with ED signals (FR-FAST-08). */
      intermittentAllowed: boolean;
      minor: boolean;
    };

/** Practice fasts until the teen years; from 13 the parent decides (puberty is not ruled on, 15 §5.5). */
export const PRACTICE_UNTIL_AGE = 13;

export function memberAgeYears(
  m: Pick<FastingMember, 'dateOfBirth'>,
  today: string,
): number | null {
  if (!m.dateOfBirth) return null;
  try {
    return ageInYears(m.dateOfBirth, today);
  } catch {
    return null;
  }
}

export function fastingEligibility(
  member: FastingMember,
  safety: MemberSafety,
  today: string,
): FastingEligibility {
  const age = memberAgeYears(member, today);
  // Without a date of birth, infants, toddlers and children get the safest rule.
  const under7 =
    age !== null
      ? age < FASTING_MIN_AGE_YEARS
      : member.lifeStage === 'infant' ||
        member.lifeStage === 'toddler' ||
        member.lifeStage === 'child';
  if (under7) return { mode: 'under_7' };
  if (safety.reasons.length > 0) return { mode: 'blocked', reasons: [...safety.reasons] };
  const minor = age !== null ? age < CHILD_AGE_YEARS : member.lifeStage === 'teen';
  if (age !== null && age < PRACTICE_UNTIL_AGE) return { mode: 'practice' };
  const pregnant = safety.pregnant || member.specialModules.includes('pregnancy');
  const breastfeeding = safety.breastfeeding || member.specialModules.includes('breastfeeding');
  return {
    mode: 'full',
    decideWithClinician: pregnant || breastfeeding,
    intermittentAllowed: !minor && !pregnant && !breastfeeding,
    minor,
  };
}

/** Practice fasts are logged as Ramadan or nafl with `is_practice_fast` (15 §5.8). */
export const PRACTICE_KINDS: readonly FastKind[] = ['ramadan', 'nafl'];
export const PRACTICE_PATTERNS = ['until_dhuhr', 'until_asr', 'weekend_full'] as const;
export type PracticePattern = (typeof PRACTICE_PATTERNS)[number];

/** `fast_kind` chips offered for a member (02 §7.12.5 "filtered by age and context"). */
export function availableKinds(e: FastingEligibility): readonly FastKind[] {
  switch (e.mode) {
    case 'under_7':
    case 'blocked':
      return [];
    case 'practice':
      return PRACTICE_KINDS;
    case 'full':
      return FAST_KINDS.filter((k) => k !== 'intermittent' || e.intermittentAllowed);
  }
}

// ---- Building a write -------------------------------------------------------------------------

export type FastOutcome = 'completed' | 'broke_early' | 'exempt';

export interface FastFormValues {
  memberId: string;
  date: string;
  kind: FastKind;
  outcome: FastOutcome;
  exemptionReason: ExemptionReason | null;
  practicePattern: PracticePattern | null;
  notes: string;
  /** Fajr and Maghrib for the date when the prayer module could compute them. */
  startedAt: string | null;
  endedAt: string | null;
  qadaForHijriYear: number | null;
}

export type FastFormError =
  'not_allowed' | 'kind_not_allowed' | 'too_far_ahead' | 'exemption_reason_required';

/** Date may be at most 1 day in the future (pre-logging an intention, 02 §7.12.5). */
export function validateFastForm(
  v: FastFormValues,
  eligibility: FastingEligibility,
  today: string,
): FastFormError | null {
  if (eligibility.mode === 'under_7' || eligibility.mode === 'blocked') return 'not_allowed';
  if (!availableKinds(eligibility).includes(v.kind)) return 'kind_not_allowed';
  if (v.date > addDays(today, 1)) return 'too_far_ahead';
  if (v.outcome === 'exempt' && !v.exemptionReason) return 'exemption_reason_required';
  return null;
}

export function buildFastingWrite(
  v: FastFormValues,
  ctx: {
    id: string;
    householdId: string;
    eligibility: FastingEligibility;
    hijriOffsetDays?: number;
  },
): FastingLogWrite {
  const exempt = v.outcome === 'exempt';
  const practice = ctx.eligibility.mode === 'practice';
  const tag = practice && v.practicePattern ? `practice_${v.practicePattern}` : null;
  const notes = [tag, v.notes.trim() || null].filter(Boolean).join(' ').slice(0, 2000) || null;
  return {
    id: ctx.id,
    householdId: ctx.householdId,
    familyMemberId: v.memberId,
    fastDate: v.date,
    kind: v.kind,
    startedAt: exempt ? null : v.startedAt,
    endedAt: exempt || v.outcome === 'broke_early' ? null : v.endedAt,
    completed: v.outcome === 'completed',
    exemptionReason: exempt ? v.exemptionReason : null,
    isPracticeFast: practice,
    notes,
    hijriDate: hijriIso(toHijri(v.date, { offsetDays: ctx.hijriOffsetDays ?? 0 })),
    qadaForHijriYear: v.kind === 'qada' ? v.qadaForHijriYear : null,
  };
}

// ---- Offline overlay ------------------------------------------------------------------------

export function applyPendingFasting(
  logs: readonly FastingLogView[],
  entries: readonly OutboxEntry[],
): FastingLogView[] {
  const byKey = new Map(logs.map((l) => [`${l.familyMemberId}:${l.fastDate}:${l.kind}`, l]));
  const deleted = new Set<string>();
  for (const e of entries) {
    if (e.kind === FASTING_DELETE_KIND) deleted.add((e.payload as FastingDeleteWrite).id);
    if (e.kind !== FASTING_LOG_KIND) continue;
    const w = e.payload as FastingLogWrite;
    byKey.set(`${w.familyMemberId}:${w.fastDate}:${w.kind}`, {
      id: w.id,
      familyMemberId: w.familyMemberId,
      fastDate: w.fastDate,
      kind: w.kind,
      startedAt: w.startedAt,
      endedAt: w.endedAt,
      completed: w.completed,
      exemptionReason: w.exemptionReason,
      isPracticeFast: w.isPracticeFast,
      notes: w.notes,
      hijriDate: w.hijriDate,
      qadaForHijriYear: w.qadaForHijriYear,
      queued: true,
    });
  }
  return [...byKey.values()]
    .filter((l) => !deleted.has(l.id))
    .sort((a, b) => b.fastDate.localeCompare(a.fastDate));
}

/**
 * A fast kept (or intended) on `date`: drives the hydration "fasting" state. Exempt and broken fasts
 * are stored with `completed = false` (reasons may be hidden from this viewer).
 */
export function isFastingOn(log: FastingLogView, date: string): boolean {
  return log.fastDate === date && log.completed && !log.exemptionReason;
}

// ---- Ramadan grid and qada -------------------------------------------------------------------

export type RamadanDayStatus = 'fasted' | 'exempt' | 'missed' | 'practice' | 'none' | 'future';

/** Gregorian dates of Ramadan in a Hijri year (Umm al-Qura where available, plus the offset). */
export function ramadanDates(hijriYear: number, hijriOffsetDays = 0): string[] {
  const anchor = tabularToGregorian(hijriYear, 9, 1);
  const out: string[] = [];
  for (let i = -4; i <= 34; i += 1) {
    const d = addDays(anchor, i);
    const h = toHijri(d, { offsetDays: hijriOffsetDays });
    if (h.year === hijriYear && h.month === 9) out.push(d);
  }
  return out;
}

/** The Ramadan to show by default: this year's once it has started, otherwise last year's. */
export function defaultRamadanYear(today: string, hijriOffsetDays = 0): number {
  const h = toHijri(today, { offsetDays: hijriOffsetDays });
  return h.month >= 9 ? h.year : h.year - 1;
}

export function ramadanGrid(
  dates: readonly string[],
  logs: readonly FastingLogView[],
  memberId: string,
  today: string,
): Array<{ date: string; day: number; status: RamadanDayStatus }> {
  const byDate = new Map(
    logs
      .filter((l) => l.familyMemberId === memberId && l.kind === 'ramadan')
      .map((l) => [l.fastDate, l]),
  );
  return dates.map((date, i) => {
    const l = byDate.get(date);
    let status: RamadanDayStatus;
    if (!l) status = date > today ? 'future' : 'none';
    else if (l.exemptionReason) status = 'exempt';
    else if (l.isPracticeFast) status = 'practice';
    else if (l.completed) status = 'fasted';
    else status = 'missed';
    return { date, day: i + 1, status };
  });
}

export interface QadaBalance {
  missed: number;
  madeUp: number;
  remaining: number;
  /** A permanent exemption (age, chronic condition): show the fidya note, not a counter. */
  permanent: boolean;
}

/**
 * Qada balance (FR-FAST-03, 15 §5.9): Ramadan days not fasted (exempt or broken, practice fasts
 * excluded) minus completed qada fasts. The app records; it never rules on qada or fidya.
 */
export function qadaBalance(logs: readonly FastingLogView[], memberId: string): QadaBalance {
  const mine = logs.filter((l) => l.familyMemberId === memberId);
  let missed = 0;
  let permanent = false;
  for (const l of mine) {
    if (l.kind !== 'ramadan' || l.isPracticeFast) continue;
    if (l.exemptionReason && PERMANENT_EXEMPTIONS.has(l.exemptionReason)) {
      permanent = true;
      continue;
    }
    if (!l.completed) missed += 1;
  }
  const madeUp = mine.filter((l) => l.kind === 'qada' && l.completed).length;
  return { missed, madeUp, remaining: Math.max(0, missed - madeUp), permanent };
}

/**
 * Who sees qada and exemption details (FR-FAST-02 privacy): the member themself, or the household
 * owner when the member has no account of their own. The server view enforces the same for reasons.
 */
export function canSeePrivateFasting(
  member: Pick<FastingMember, 'linkedUserId'>,
  viewer: { userId: string | null; isOwner: boolean },
): boolean {
  if (member.linkedUserId) return member.linkedUserId === viewer.userId;
  return viewer.isOwner;
}
