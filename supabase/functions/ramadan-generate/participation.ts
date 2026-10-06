import { escalationFor } from '@thuluth/ai-core';
import type { EscalationOut, Locale } from '@thuluth/ai-core';
import type { RamadanParticipant } from '@thuluth/shared/contracts/ramadan-generate.ts';
import type { LifeStage } from '@thuluth/shared';

import { HttpError } from '../_shared/errors.ts';
import type { MemberParticipation } from '../_shared/plan/ramadan.ts';

/**
 * Per-member Ramadan participation (00 §10, 06 §4.9, 15 §5.5-5.7), enforced in code before any
 * plan is written. Religious rulings are not issued: the family's choice is recorded and the app
 * points to a scholar and a clinician.
 *
 * - Under 7: never a fasting plan (`no_fasting_under_7`); normal meals, family rituals only.
 * - 7 to 11: practice fasts only (`practice_fast_only_before_puberty`); a parent who wants a full
 *   day uses a practice fast until Maghrib. 12 to 17: the parent's choice is recorded (puberty is
 *   not decided by the app). Practice fasts are refused for adults.
 * - Pregnancy and breastfeeding: the family's decision is followed exactly and recorded in
 *   `pregnancy_adjustments` with the safety guidance; gestational diabetes escalates.
 * - Insulin or sulfonylureas (or a fasting-stop red flag): the member gets non-fasting meals and
 *   an escalation; the plan is still made for everyone else.
 */

export const FASTING_MIN_AGE = 7;
export const PRACTICE_ONLY_BELOW_AGE = 12;
export const ADULT_AGE = 18;

export interface ParticipationMember {
  id: string;
  date_of_birth: string | null;
  life_stage: LifeStage;
  special_modules: readonly string[];
  medication_flags: readonly string[];
}

export interface MemberSafety {
  gestational_diabetes: boolean;
  on_insulin_or_sulfonylurea: boolean;
  /** Hard risk flags from the latest assessment (`red_flag.<code>`). */
  risk_flags: readonly string[];
}

/** Hard flags that stop fasting plans (15 §5.11). */
const FASTING_STOPS: Record<string, 'dehydration_signs' | 'insulin_or_sulfonylurea_fasting'> = {
  dehydration_signs: 'dehydration_signs',
  diabetes_fasting_high_risk: 'insulin_or_sulfonylurea_fasting',
};

export function ageYearsOn(dob: string | null, date: string): number | null {
  if (!dob) return null;
  const [y1, m1, d1] = dob.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = date.split('-').map(Number) as [number, number, number];
  return y2 - y1 - (m2 < m1 || (m2 === m1 && d2 < d1) ? 1 : 0);
}

/** Age band on the first day of Ramadan; unknown birth dates fall back to the life stage. */
export function band(m: ParticipationMember, on: string): 'under_7' | 'child' | 'teen' | 'adult' {
  const age = ageYearsOn(m.date_of_birth, on);
  if (age === null) {
    if (m.life_stage === 'infant' || m.life_stage === 'toddler') return 'under_7';
    if (m.life_stage === 'child') return 'child';
    if (m.life_stage === 'teen') return 'teen';
    return 'adult';
  }
  if (age < FASTING_MIN_AGE) return 'under_7';
  if (age < PRACTICE_ONLY_BELOW_AGE) return 'child';
  if (age < ADULT_AGE) return 'teen';
  return 'adult';
}

/** Practice days: weekends first (Saturday, Sunday, Friday), then weekdays. */
const PRACTICE_DAY_ORDER = [6, 0, 5, 4, 3, 2, 1];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** 15 §5.5 stop rules and 15 §5.6 warning signs, as i18n keys for the Ramadan screens. */
export const GUIDANCE = {
  child_practice: [
    'ramadan.guidance.child_stop_rules',
    'ramadan.guidance.suhoor_required',
    'ramadan.guidance.school_and_heat',
  ],
  teen: ['ramadan.guidance.teen_stop_rules', 'ramadan.guidance.ask_scholar_puberty'],
  under_7: ['ramadan.guidance.under_7_rituals'],
  pregnancy_fasting: [
    'ramadan.guidance.pregnancy_warning_signs',
    'ramadan.guidance.no_deficit_suhoor_protein',
    'ramadan.guidance.decision_with_clinician_and_scholar',
  ],
  breastfeeding_fasting: [
    'ramadan.guidance.breastfeeding_wet_nappies',
    'ramadan.guidance.no_deficit_suhoor_protein',
    'ramadan.guidance.decision_with_clinician_and_scholar',
  ],
  pregnancy_not_fasting: ['ramadan.guidance.decision_with_clinician_and_scholar'],
  diabetes: [
    'ramadan.guidance.diabetes_clinician_review',
    'ramadan.guidance.break_fast_thresholds',
  ],
} as const;

/** Stored per member in `ramadan_plans.child_participation` (FR-RAM-03: every member). */
export interface StoredParticipation {
  mode: MemberParticipation['mode'];
  /** The family's original choice when safety changed it. */
  requested?: RamadanParticipant['intention'];
  days?: Array<(typeof DAY_NAMES)[number]>;
  until?: 'dhuhr' | 'asr' | 'maghrib';
  escalated?: boolean;
  guidance: string[];
}

export interface PregnancyAdjustment {
  status: 'pregnancy' | 'breastfeeding';
  decision: 'fasting' | 'not_fasting';
  clinicianConfirmed: boolean;
  /** No caloric deficit; hydration and protein at suhoor and iftar (FR-RAM-04). */
  snack_plan: boolean;
  fluid_extra_ml: number;
  guidance: string[];
}

export interface ParticipationResult {
  /** For the plan pipeline. */
  members: Record<string, MemberParticipation>;
  stored: Record<string, StoredParticipation>;
  pregnancy: Record<string, PregnancyAdjustment>;
  escalations: EscalationOut[];
}

function practiceDays(n: number): number[] {
  return PRACTICE_DAY_ORDER.slice(0, Math.max(1, Math.min(7, n)));
}

/**
 * Applies the rules; throws `VALIDATION_FAILED` (`details.rule`) for a request the app must not
 * plan (fasting under 7, a full fast for a young child, a practice fast for an adult). Members
 * not listed get normal meals.
 */
export function resolveParticipation(args: {
  members: readonly ParticipationMember[];
  participants: readonly RamadanParticipant[];
  safety: ReadonlyMap<string, MemberSafety>;
  startDate: string;
  locale: Locale;
}): ParticipationResult {
  const byId = new Map(args.members.map((m) => [m.id, m]));
  const missing = args.participants.map((p) => p.family_member_id).filter((id) => !byId.has(id));
  if (missing.length) {
    throw new HttpError('NOT_FOUND', 'Some family members are not in this household.', {
      family_member_ids: missing,
    });
  }
  const seen = new Set<string>();
  for (const p of args.participants) {
    if (seen.has(p.family_member_id)) {
      throw new HttpError('VALIDATION_FAILED', 'Each family member can be listed once.', {
        family_member_id: p.family_member_id,
        rule: 'duplicate_participant',
      });
    }
    seen.add(p.family_member_id);
  }
  const chosen = new Map(args.participants.map((p) => [p.family_member_id, p]));
  const result: ParticipationResult = { members: {}, stored: {}, pregnancy: {}, escalations: [] };

  for (const m of args.members) {
    const p = chosen.get(m.id);
    const intention = p?.intention ?? 'not_fasting';
    const ageBand = band(m, args.startDate);
    const wantsToFast = intention === 'fasting' || intention === 'practice_fast';

    if (ageBand === 'under_7') {
      if (wantsToFast) {
        throw new HttpError(
          'VALIDATION_FAILED',
          'Children under 7 do not get a fasting plan. They can join suhoor and open with a date at iftar.',
          { rule: 'no_fasting_under_7', family_member_id: m.id },
        );
      }
      result.members[m.id] = { mode: 'none' };
      result.stored[m.id] = { mode: 'none', guidance: [...GUIDANCE.under_7] };
      continue;
    }
    if (intention === 'fasting' && ageBand === 'child') {
      throw new HttpError(
        'VALIDATION_FAILED',
        'Children from 7 to puberty have practice fasts. Choose a practice fast, until Maghrib for a full day.',
        { rule: 'practice_fast_only_before_puberty', family_member_id: m.id },
      );
    }
    if (intention === 'practice_fast' && ageBand === 'adult') {
      throw new HttpError('VALIDATION_FAILED', 'Practice fasts are for children.', {
        rule: 'practice_fast_children_only',
        family_member_id: m.id,
      });
    }

    // Safety stops: insulin or sulfonylureas, gestational diabetes, fasting-stop red flags.
    const s = args.safety.get(m.id);
    const pregnant = m.special_modules.includes('pregnancy');
    const breastfeeding = m.special_modules.includes('breastfeeding');
    const insulinOrSu =
      m.medication_flags.includes('insulin') ||
      m.medication_flags.includes('sulfonylurea') ||
      s?.on_insulin_or_sulfonylurea === true;
    const flags = (s?.risk_flags ?? [])
      .filter((f) => f.startsWith('red_flag.'))
      .map((f) => f.slice(9));
    let stop: 'dehydration_signs' | 'insulin_or_sulfonylurea_fasting' | null = null;
    if (insulinOrSu || (pregnant && s?.gestational_diabetes))
      stop = 'insulin_or_sulfonylurea_fasting';
    for (const f of flags) stop ??= FASTING_STOPS[f] ?? null;

    if (wantsToFast && stop) {
      const escalation = escalationFor(
        [
          {
            code: stop === 'dehydration_signs' ? 'dehydration_signs' : 'diabetes_fasting_high_risk',
            hard: true,
            severity: 'see_clinician',
            stops: 'fasting',
            reason: stop,
            recommend: ageBand === 'adult' ? 'see_gp' : 'see_pediatrician',
            evidence: {},
          },
        ],
        m.id,
        args.locale,
      );
      if (escalation) result.escalations.push(escalation);
      result.members[m.id] = { mode: 'not_fasting' };
      result.stored[m.id] = {
        mode: 'not_fasting',
        requested: intention,
        escalated: true,
        guidance:
          insulinOrSu || stop === 'insulin_or_sulfonylurea_fasting' ? [...GUIDANCE.diabetes] : [],
      };
      if (pregnant || breastfeeding) {
        result.pregnancy[m.id] = pregnancyEntry(pregnant, 'not_fasting');
      }
      continue;
    }

    if (intention === 'practice_fast' && p?.practice_fast) {
      const days = practiceDays(p.practice_fast.days_per_week);
      result.members[m.id] = { mode: 'practice_fast', days, until: p.practice_fast.until };
      result.stored[m.id] = {
        mode: 'practice_fast',
        days: days.map((d) => DAY_NAMES[d]!),
        until: p.practice_fast.until,
        guidance: [...GUIDANCE.child_practice],
      };
      continue;
    }

    const mode: MemberParticipation['mode'] =
      intention === 'fasting' ? 'fasting' : intention === 'exempt' ? 'exempt' : 'not_fasting';
    result.members[m.id] = { mode };
    // Exemption reasons are sensitive (15 §5.1): they are not stored on the household plan.
    result.stored[m.id] = {
      mode,
      guidance: mode === 'fasting' && ageBand === 'teen' ? [...GUIDANCE.teen] : [],
    };
    const reasonIsPregnancy =
      p?.exemption_reason === 'pregnancy' || p?.exemption_reason === 'breastfeeding';
    if (pregnant || breastfeeding || reasonIsPregnancy) {
      const isPregnancy = pregnant || p?.exemption_reason === 'pregnancy';
      result.pregnancy[m.id] = pregnancyEntry(
        isPregnancy,
        mode === 'fasting' ? 'fasting' : 'not_fasting',
      );
    }
  }
  return result;
}

function pregnancyEntry(
  pregnant: boolean,
  decision: 'fasting' | 'not_fasting',
): PregnancyAdjustment {
  const status = pregnant ? 'pregnancy' : 'breastfeeding';
  return {
    status,
    decision,
    clinicianConfirmed: false,
    snack_plan: decision === 'fasting',
    // 15 §5.6: +300 ml in pregnancy, +700 ml when breastfeeding.
    fluid_extra_ml: pregnant ? 300 : 700,
    guidance:
      decision === 'fasting'
        ? [...(pregnant ? GUIDANCE.pregnancy_fasting : GUIDANCE.breastfeeding_fasting)]
        : [...GUIDANCE.pregnancy_not_fasting],
  };
}
