/**
 * Ramadan participation check for the `plan_ramadan` tool (12 §8.13, 15 §5). Pure and
 * deterministic, so the evals can hold it to 100 percent:
 * - under 7: never fasting (join suhoor and iftar as family time instead);
 * - 7 to 17: a request to fast becomes gentle practice fasting, never forced;
 * - insulin or sulfonylurea (or gestational diabetes) and wanting to fast: the decision is the
 *   clinician's first (`clinician_decision_pending`) and the agent must escalate;
 * - pregnancy and breastfeeding: the user's choice is recorded as given, with a note to check with
 *   their clinician (the app does not decide for them).
 */

export const RAMADAN_MIN_FASTING_MONTHS = 84;
const ADULT_MONTHS = 216;
const FASTING_RISK_FLAGS = new Set(['insulin', 'sulfonylurea']);

export type RamadanIntent =
  'fasting' | 'not_fasting' | 'practice_partial' | 'undecided' | 'clinician_decision_pending';

export interface RamadanMemberFacts {
  id: string;
  name: string;
  ageMonths: number;
  medicationFlags: readonly string[];
  gestationalDiabetes?: boolean | undefined;
  pregnant?: boolean | undefined;
  breastfeeding?: boolean | undefined;
}

export interface RamadanParticipationOut {
  familyMemberId: string;
  name: string;
  requested: RamadanIntent;
  intent: RamadanIntent;
  exemptionReason?: string | undefined;
  notes: string[];
}

export function checkRamadanParticipation(
  members: readonly RamadanMemberFacts[],
  participation: ReadonlyArray<{
    familyMemberId: string;
    intent: RamadanIntent;
    exemptionReason?: string | null | undefined;
  }>,
): { participation: RamadanParticipationOut[]; escalate: boolean; unknownIds: string[] } {
  const out: RamadanParticipationOut[] = [];
  const unknownIds: string[] = [];
  let escalate = false;
  for (const p of participation) {
    const m = members.find((x) => x.id === p.familyMemberId);
    if (!m) {
      unknownIds.push(p.familyMemberId);
      continue;
    }
    const wantsFast = p.intent === 'fasting' || p.intent === 'practice_partial';
    let intent: RamadanIntent = p.intent;
    const notes: string[] = [];
    if (m.ageMonths < RAMADAN_MIN_FASTING_MONTHS) {
      if (wantsFast) notes.push('under_7_no_fasting: join suhoor and iftar as family time instead');
      intent = 'not_fasting';
    } else {
      if (m.ageMonths < ADULT_MONTHS && p.intent === 'fasting') {
        notes.push('child: gentle practice fasts (for example until dhuhr), never forced');
        intent = 'practice_partial';
      }
      const diabetesRisk =
        m.medicationFlags.some((f) => FASTING_RISK_FLAGS.has(f)) || !!m.gestationalDiabetes;
      if (diabetesRisk && wantsFast) {
        notes.push('insulin_or_sulfonylurea: a clinician must decide before fasting');
        intent = 'clinician_decision_pending';
        escalate = true;
      }
    }
    if (m.pregnant || m.breastfeeding) {
      notes.push(
        'pregnancy_or_breastfeeding: recorded as the user chose; suggest checking with their clinician',
      );
    }
    out.push({
      familyMemberId: m.id,
      name: m.name,
      requested: p.intent,
      intent,
      ...(p.exemptionReason ? { exemptionReason: p.exemptionReason } : {}),
      notes,
    });
  }
  return { participation: out, escalate, unknownIds };
}
