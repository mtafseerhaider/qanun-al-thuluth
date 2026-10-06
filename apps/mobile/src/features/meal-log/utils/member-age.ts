import { ageInYears, CHILD_AGE_YEARS, type LifeStage } from '@shared';

const MINOR_STAGES: readonly LifeStage[] = ['infant', 'toddler', 'child', 'teen'];

/**
 * Age facts for child rules. Without a birth date the life stage decides, and an unknown member is
 * treated as a minor (the safest rule: no numbers).
 */
export function memberAge(
  m: { date_of_birth: string | null; life_stage: LifeStage | null } | null | undefined,
  today: string,
): { ageYears: number | null; minor: boolean } {
  if (!m) return { ageYears: null, minor: true };
  let ageYears: number | null = null;
  if (m.date_of_birth) {
    try {
      ageYears = ageInYears(m.date_of_birth, today);
    } catch {
      ageYears = null;
    }
  }
  const minor =
    ageYears !== null
      ? ageYears < CHILD_AGE_YEARS
      : m.life_stage
        ? MINOR_STAGES.includes(m.life_stage)
        : true;
  return { ageYears, minor };
}
