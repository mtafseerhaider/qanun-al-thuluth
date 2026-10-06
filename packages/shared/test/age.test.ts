import { describe, expect, it } from 'vitest';

import { ageInMonths, isMinor, lifeStageFor } from '../src/utils/age.ts';

describe('ageInMonths', () => {
  it('counts completed months', () => {
    expect(ageInMonths('2020-03-15', '2020-04-14')).toBe(0);
    expect(ageInMonths('2020-03-15', '2020-04-15')).toBe(1);
    expect(ageInMonths('2018-10-06', '2026-10-06')).toBe(96);
  });

  it('never goes negative', () => {
    expect(ageInMonths('2030-01-01', '2026-01-01')).toBe(0);
  });
});

describe('lifeStageFor', () => {
  const on = '2026-10-06';
  it.each([
    ['2026-01-01', 'infant'],
    ['2025-10-06', 'toddler'],
    ['2023-10-07', 'toddler'],
    ['2023-10-06', 'child'],
    ['2022-10-06', 'child'], // Eliyya, 4
    ['2018-10-06', 'child'], // Abbas, 8
    ['2013-10-06', 'teen'],
    ['2008-10-07', 'teen'],
    ['2008-10-06', 'adult'],
    ['1989-01-01', 'adult'],
    ['1961-10-06', 'older_adult'],
  ] as const)('%s → %s', (dob, stage) => {
    expect(lifeStageFor(dob, on)).toBe(stage);
  });
});

describe('isMinor', () => {
  it('treats anyone under 18 as a minor', () => {
    expect(isMinor('2008-10-07', '2026-10-06')).toBe(true);
    expect(isMinor('2008-10-06', '2026-10-06')).toBe(false);
  });
});
