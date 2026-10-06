import { CHILD_AGE_YEARS } from '../constants/safety.ts';
import type { LifeStage } from '../enums.ts';

/** Accepts `YYYY-MM-DD` or a Date; dates are compared as calendar dates in UTC. */
function toUtcParts(value: string | Date): { y: number; m: number; d: number } {
  if (typeof value === 'string') {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new Error(`Invalid date: ${value}`);
    return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  }
  return { y: value.getUTCFullYear(), m: value.getUTCMonth() + 1, d: value.getUTCDate() };
}

/** Completed months between date of birth and `onDate` (0 if `onDate` is before birth). */
export function ageInMonths(
  dateOfBirth: string | Date,
  onDate: string | Date = new Date(),
): number {
  const dob = toUtcParts(dateOfBirth);
  const on = toUtcParts(onDate);
  let months = (on.y - dob.y) * 12 + (on.m - dob.m);
  if (on.d < dob.d) months -= 1;
  return Math.max(0, months);
}

export function ageInYears(dateOfBirth: string | Date, onDate: string | Date = new Date()): number {
  return Math.floor(ageInMonths(dateOfBirth, onDate) / 12);
}

/**
 * Mirrors `derive_life_stage()` in 05-database-schema.md (00 §11): infant under 12 months,
 * toddler 12 to 35 months, child 3 to 12 years, teen 13 to 17, adult 18 to 64, older adult 65+.
 */
export function lifeStageFor(
  dateOfBirth: string | Date,
  onDate: string | Date = new Date(),
): LifeStage {
  const months = ageInMonths(dateOfBirth, onDate);
  if (months < 12) return 'infant';
  if (months < 36) return 'toddler';
  const years = Math.floor(months / 12);
  if (years <= 12) return 'child';
  if (years < CHILD_AGE_YEARS) return 'teen';
  if (years < 65) return 'adult';
  return 'older_adult';
}

export function isMinor(dateOfBirth: string | Date, onDate: string | Date = new Date()): boolean {
  return ageInYears(dateOfBirth, onDate) < CHILD_AGE_YEARS;
}
