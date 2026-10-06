import {
  ageInYears,
  cmToIn,
  FamilyMemberInput,
  inToCm,
  isMinor,
  kgToLb,
  lbToKg,
  lifeStageFor,
  type ActivityLevel,
  type LifeStage,
  type SexAtBirth,
} from '@shared';

/**
 * Pure model for the member form (onboarding step 4 and AddFamilyMemberModal, 02 §7.3.2-7.3.3).
 * Strings in, a validated `FamilyMemberInput` out. Storage is always metric (FR-L10N-04).
 */
export type Units = 'metric' | 'imperial';

export interface MemberFormValues {
  name: string;
  dobDay: string;
  dobMonth: string;
  dobYear: string;
  sex: SexAtBirth;
  height: string;
  weight: string;
  activity: ActivityLevel;
  isMe: boolean;
}

export type MemberField = 'name' | 'dob' | 'height' | 'weight';
/** i18n keys under `family:form.errors`. */
export type MemberErrorKey =
  | 'nameRequired'
  | 'nameTooLong'
  | 'dobRequired'
  | 'dobInvalid'
  | 'dobFuture'
  | 'dobTooOld'
  | 'heightRange'
  | 'weightRange'
  | 'meMustBeAdult';

export type MemberFormErrors = Partial<Record<MemberField, MemberErrorKey>>;

export const emptyMemberForm: MemberFormValues = {
  name: '',
  dobDay: '',
  dobMonth: '',
  dobYear: '',
  sex: 'unspecified',
  height: '',
  weight: '',
  activity: 'moderate',
  isMe: false,
};

const todayIso = () => new Date().toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, '0');

/** `YYYY-MM-DD` for a real calendar date, else null (rejects 31 February). */
export function dobFromParts(day: string, month: string, year: string): string | null {
  if (
    !/^\d{1,2}$/.test(day.trim()) ||
    !/^\d{1,2}$/.test(month.trim()) ||
    !/^\d{4}$/.test(year.trim())
  )
    return null;
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

function parseDecimal(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (normalized === '') return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : NaN;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** How the form presents a member of this age (FR-ONB-05, 02 §1.1 child rules). */
export interface MemberFraming {
  lifeStage: LifeStage | null;
  minor: boolean;
  /** Activity level is hidden for infants and toddlers (02 §7.3.3). */
  showActivity: boolean;
  /** Only adults can be linked to the signed-in account ("This is me"). */
  canBeMe: boolean;
  /** Key under `family:form` for the weight helper; children get growth framing, never restriction. */
  weightHelperKey: 'weightHelperChild' | 'weightHelperAdult';
}

export function memberFraming(dob: string | null, today: string = todayIso()): MemberFraming {
  if (!dob || dob > today)
    return {
      lifeStage: null,
      minor: false,
      showActivity: true,
      canBeMe: false,
      weightHelperKey: 'weightHelperAdult',
    };
  const lifeStage = lifeStageFor(dob, today);
  const minor = isMinor(dob, today);
  return {
    lifeStage,
    minor,
    showActivity: lifeStage !== 'infant' && lifeStage !== 'toddler',
    canBeMe: !minor,
    weightHelperKey: minor ? 'weightHelperChild' : 'weightHelperAdult',
  };
}

export type ValidationResult =
  | { ok: true; input: FamilyMemberInput; framing: MemberFraming }
  | { ok: false; errors: MemberFormErrors };

export function validateMemberForm(
  values: MemberFormValues,
  opts: { units: Units; today?: string; linkedUserId?: string | null },
): ValidationResult {
  const today = opts.today ?? todayIso();
  const errors: MemberFormErrors = {};
  const name = values.name.trim();
  if (!name) errors.name = 'nameRequired';
  else if (name.length > 60) errors.name = 'nameTooLong';

  const anyDob = values.dobDay || values.dobMonth || values.dobYear;
  const dob = dobFromParts(values.dobDay, values.dobMonth, values.dobYear);
  if (!anyDob) errors.dob = 'dobRequired';
  else if (!dob) errors.dob = 'dobInvalid';
  else if (dob > today) errors.dob = 'dobFuture';
  else if (ageInYears(dob, today) > 120) errors.dob = 'dobTooOld';

  const rawHeight = parseDecimal(values.height);
  const heightCm =
    rawHeight === null ? null : opts.units === 'imperial' ? inToCm(rawHeight) : rawHeight;
  if (heightCm !== null && (Number.isNaN(heightCm) || heightCm < 30 || heightCm > 260))
    errors.height = 'heightRange';

  const rawWeight = parseDecimal(values.weight);
  const weightKg =
    rawWeight === null ? null : opts.units === 'imperial' ? lbToKg(rawWeight) : rawWeight;
  if (weightKg !== null && (Number.isNaN(weightKg) || weightKg < 1 || weightKg > 400))
    errors.weight = 'weightRange';

  const framing = memberFraming(dob, today);
  if (values.isMe && dob && !framing.canBeMe && !errors.dob) errors.dob = 'meMustBeAdult';

  if (Object.keys(errors).length > 0 || !dob) return { ok: false, errors };

  const parsed = FamilyMemberInput.safeParse({
    name,
    date_of_birth: dob,
    sex_at_birth: values.sex,
    height_cm: heightCm === null ? null : round1(heightCm),
    weight_kg: weightKg === null ? null : round2(weightKg),
    activity_level: framing.showActivity ? values.activity : 'moderate',
    linked_user_id: values.isMe ? (opts.linkedUserId ?? null) : null,
  });
  if (!parsed.success) return { ok: false, errors: { dob: 'dobInvalid' } };
  return { ok: true, input: parsed.data, framing };
}

/** Existing row to form strings, converting to the display unit. */
export function toFormValues(
  row: {
    name: string;
    date_of_birth: string | null;
    sex_at_birth: SexAtBirth;
    height_cm: number | null;
    weight_kg: number | null;
    activity_level: ActivityLevel;
    linked_user_id: string | null;
  },
  units: Units,
  currentUserId: string | null,
): MemberFormValues {
  const [y = '', m = '', d = ''] = (row.date_of_birth ?? '').split('-');
  const fmt = (n: number | null, toDisplay: (v: number) => number) =>
    n === null ? '' : String(round1(units === 'imperial' ? toDisplay(Number(n)) : Number(n)));
  return {
    name: row.name,
    dobDay: d ? String(Number(d)) : '',
    dobMonth: m ? String(Number(m)) : '',
    dobYear: y,
    sex: row.sex_at_birth,
    height: fmt(row.height_cm, cmToIn),
    weight: fmt(row.weight_kg, kgToLb),
    activity: row.activity_level,
    isMe: currentUserId !== null && row.linked_user_id === currentUserId,
  };
}
