/**
 * Dehydration symptom check (24 S4-09, FR-HYD-05, 15 §6.5, 15 §5.5 stop rules). Pure so the
 * red-flag decision is unit-tested. The app never diagnoses: any red-flag sign shows urgent
 * guidance, the stop-the-fast message on a fast day and clinician advice.
 */

export const SYMPTOMS = [
  'dizziness',
  'dark_urine',
  'fainting',
  'little_urine',
  'confusion',
  'vomiting',
  'headache',
  'dry_mouth',
  'tiredness',
] as const;
/** Extra signs shown for infants and toddlers (under 5, 15 §6.5). */
export const YOUNG_CHILD_SYMPTOMS = [
  'fewer_wet_nappies',
  'no_tears',
  'sunken_eyes',
  'lethargy',
] as const;
export type Symptom = (typeof SYMPTOMS)[number] | (typeof YOUNG_CHILD_SYMPTOMS)[number];

const RED_FLAGS: ReadonlySet<Symptom> = new Set<Symptom>([
  'dizziness',
  'dark_urine',
  'fainting',
  'little_urine',
  'confusion',
  'vomiting',
  'fewer_wet_nappies',
  'no_tears',
  'sunken_eyes',
  'lethargy',
]);
const EMERGENCY: ReadonlySet<Symptom> = new Set<Symptom>(['fainting', 'confusion', 'lethargy']);

export const SYMPTOM_CHECK_KIND = 'safety.symptom_check';
/** Own outbox lane: no server path exists yet (S4 report), so it must not hold back other writes. */
export const SYMPTOM_CHECK_SCOPE = 'safety';

export interface SymptomAssessment {
  level: 'none' | 'mild' | 'red_flag';
  /** `emergency_now` for fainting, confusion or a floppy child; `same_day` otherwise. */
  urgency: 'emergency_now' | 'same_day' | null;
  /** Under 5: always see a clinician urgently (15 §6.5). */
  youngChild: boolean;
}

export function symptomsFor(ageMonths: number | null): readonly Symptom[] {
  return ageMonths !== null && ageMonths < 60 ? [...SYMPTOMS, ...YOUNG_CHILD_SYMPTOMS] : SYMPTOMS;
}

export function assessSymptoms(
  symptoms: readonly Symptom[],
  ageMonths: number | null,
): SymptomAssessment {
  const youngChild = ageMonths !== null && ageMonths < 60;
  if (symptoms.length === 0) return { level: 'none', urgency: null, youngChild };
  const red = symptoms.some((s) => RED_FLAGS.has(s));
  if (!red) return { level: 'mild', urgency: null, youngChild };
  const emergency = symptoms.some((s) => EMERGENCY.has(s));
  return { level: 'red_flag', urgency: emergency ? 'emergency_now' : 'same_day', youngChild };
}

/** Payload queued for the server record (`audit_log` / `safety_events`); codes only, no free text. */
export interface SymptomCheckRecord {
  householdId: string;
  familyMemberId: string | null;
  symptoms: Symptom[];
  level: SymptomAssessment['level'];
  urgency: SymptomAssessment['urgency'];
  fasting: boolean;
  checkedAt: string;
}
