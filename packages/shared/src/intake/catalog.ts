/**
 * Curated pick lists for the intake health screens (01 §7.3, 02 §7.3.5). Labels live in the app's
 * i18n resources under the `key`; the stored `label` is the English name so rows stay readable in
 * exports and for the assessment prompt.
 */

/** Diabetes kinds that make insulin or sulfonylurea use with fasting a red flag (00 §10.2). */
export const DIABETES_CONDITION_KEYS = ['type_1_diabetes', 'type_2_diabetes'] as const;

export interface ConditionOption {
  key: string;
  /** SNOMED CT concept id (Clinical Finding). */
  snomed: string;
  label: string;
}

export const CONDITION_OPTIONS = [
  { key: 'type_1_diabetes', snomed: '46635009', label: 'Type 1 diabetes' },
  { key: 'type_2_diabetes', snomed: '44054006', label: 'Type 2 diabetes' },
  { key: 'prediabetes', snomed: '714628002', label: 'Prediabetes' },
  { key: 'hypertension', snomed: '38341003', label: 'High blood pressure' },
  { key: 'high_cholesterol', snomed: '55822004', label: 'High cholesterol' },
  { key: 'pcos', snomed: '69878008', label: 'PCOS' },
  { key: 'hypothyroidism', snomed: '40930008', label: 'Hypothyroidism' },
  { key: 'ibs', snomed: '10743008', label: 'Irritable bowel syndrome' },
  { key: 'gerd', snomed: '235595009', label: 'Acid reflux (GERD)' },
  { key: 'celiac', snomed: '396331005', label: 'Celiac disease' },
  { key: 'anaemia', snomed: '271737000', label: 'Anaemia' },
  { key: 'kidney_disease', snomed: '709044004', label: 'Kidney disease' },
  { key: 'gestational_diabetes', snomed: '11687002', label: 'Gestational diabetes' },
] as const satisfies readonly ConditionOption[];
export type ConditionKey = (typeof CONDITION_OPTIONS)[number]['key'];

export function conditionByCode(code: string | null | undefined): ConditionOption | undefined {
  return code ? CONDITION_OPTIONS.find((c) => c.snomed === code) : undefined;
}

/** Case- and accent-insensitive search over keys and English labels; translated labels are matched by the caller. */
export function searchConditions(
  query: string,
  labelFor: (c: ConditionOption) => string = (c) => c.label,
): ConditionOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...CONDITION_OPTIONS];
  return CONDITION_OPTIONS.filter(
    (c) =>
      c.label.toLowerCase().includes(q) ||
      labelFor(c).toLowerCase().includes(q) ||
      c.key.replace(/_/g, ' ').includes(q),
  );
}

export const MEDICATION_FREQUENCIES = [
  'once_daily',
  'twice_daily',
  'with_meals',
  'as_needed',
  'other',
] as const;
export type MedicationFrequency = (typeof MEDICATION_FREQUENCIES)[number];

export const COMMON_SUPPLEMENTS = [
  { key: 'vitamin_d', label: 'Vitamin D' },
  { key: 'iron', label: 'Iron' },
  { key: 'folic_acid', label: 'Folic acid' },
  { key: 'multivitamin', label: 'Multivitamin' },
  { key: 'omega_3', label: 'Omega-3' },
  { key: 'calcium', label: 'Calcium' },
] as const;

/** Region-popular suggestions for the likes / dislikes / safe-food pickers (02 §7.3.7). */
export const FOOD_SUGGESTIONS = [
  { key: 'daal', label: 'Daal' },
  { key: 'roti', label: 'Roti' },
  { key: 'chicken', label: 'Chicken' },
  { key: 'eggs', label: 'Eggs' },
  { key: 'rice', label: 'Rice' },
  { key: 'yogurt', label: 'Yogurt' },
  { key: 'banana', label: 'Banana' },
  { key: 'guava', label: 'Guava' },
  { key: 'lauki', label: 'Lauki' },
  { key: 'spinach', label: 'Spinach' },
  { key: 'pumpkin', label: 'Pumpkin' },
  { key: 'paratha', label: 'Paratha' },
] as const;

/** Colour chips for the sensory profile, stored as `avoid:<colour>` (15 §3.2). */
export const FOOD_COLOURS = ['green', 'red', 'orange', 'white', 'brown', 'mixed'] as const;
export type FoodColour = (typeof FOOD_COLOURS)[number];
