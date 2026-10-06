import { describe, expect, it } from 'vitest';

import {
  adjustedHeightCm,
  ageInDays,
  childBmi,
  evaluateGrowthRules,
  growthDirection,
  indicatorsFor,
  isImplausibleZ,
  linesCrossedDownward,
  lmsAt,
  lmsValueAt,
  lmsZ,
  normalCdf,
  selectGrowthReference,
  zToPercentile,
} from '../src/calculators/index.ts';
import type { GrowthPoint, Lms } from '../src/calculators/index.ts';

// WHO Child Growth Standards 2006, published LMS and SD tables (birth, day 0).
const BOYS_WFA_0: Lms = { l: 0.3487, m: 3.3464, s: 0.14602 };
const GIRLS_WFA_0: Lms = { l: 0.3809, m: 3.2322, s: 0.14171 };
const BOYS_LHFA_0: Lms = { l: 1, m: 49.8842, s: 0.03795 };
// Published SD columns (-3..+3), rounded to 0.1 in the WHO tables.
const BOYS_WFA_0_SD = [2.1, 2.5, 2.9, 3.3, 3.9, 4.4, 5.0];
const GIRLS_WFA_0_SD = [2.0, 2.4, 2.8, 3.2, 3.7, 4.2, 4.8];
const BOYS_LHFA_0_SD = [44.2, 46.1, 48.0, 49.9, 51.8, 53.7, 55.6];

describe('LMS z-scores against WHO 2006 reference points', () => {
  it('the median has z = 0 and percentile 50', () => {
    expect(lmsZ(3.3464, BOYS_WFA_0, true)).toBeCloseTo(0, 10);
    expect(zToPercentile(0)).toBe(50);
  });

  for (const [name, lms, sds, restricted] of [
    ['boys weight-for-age at birth', BOYS_WFA_0, BOYS_WFA_0_SD, true],
    ['girls weight-for-age at birth', GIRLS_WFA_0, GIRLS_WFA_0_SD, true],
    ['boys length-for-age at birth', BOYS_LHFA_0, BOYS_LHFA_0_SD, false],
  ] as const) {
    it(`${name}: published SD values give z = -3..+3 (table rounding)`, () => {
      sds.forEach((x, i) => {
        expect(Math.abs(lmsZ(x, lms, restricted) - (i - 3))).toBeLessThan(0.16);
      });
    });
    it(`${name}: SD curves computed from LMS round to the published table`, () => {
      sds.forEach((x, i) => {
        expect(Math.round(lmsValueAt(i - 3, lms) * 10) / 10).toBeCloseTo(x, 5);
      });
    });
  }

  it('inverse LMS round-trips inside |z| <= 3', () => {
    for (const z of [-2.7, -1.88, -1, 0, 0.5, 1.88, 2.9]) {
      expect(lmsZ(lmsValueAt(z, BOYS_WFA_0), BOYS_WFA_0, true)).toBeCloseTo(z, 9);
    }
  });

  it('restricted tails are linear beyond 3 SD (WHO restricted application)', () => {
    const sd3 = lmsValueAt(3, BOYS_WFA_0);
    const sd23 = sd3 - lmsValueAt(2, BOYS_WFA_0);
    expect(lmsZ(sd3 + sd23, BOYS_WFA_0, true)).toBeCloseTo(4, 9);
    const sdm3 = lmsValueAt(-3, BOYS_WFA_0);
    const sdm23 = lmsValueAt(-2, BOYS_WFA_0) - sdm3;
    expect(lmsZ(sdm3 - sdm23, BOYS_WFA_0, true)).toBeCloseTo(-4, 9);
    // Height is never restricted: L = 1 makes it a plain normal z.
    expect(lmsZ(60, BOYS_LHFA_0, false)).toBeCloseTo((60 / 49.8842 - 1) / 0.03795, 9);
  });

  it('L = 0 uses the log form', () => {
    expect(lmsZ(Math.E * 10, { l: 0, m: 10, s: 0.5 }, false)).toBeCloseTo(2, 9);
  });

  it('rejects non-positive inputs', () => {
    expect(() => lmsZ(0, BOYS_WFA_0, true)).toThrow(RangeError);
  });
});

describe('normal CDF and percentiles', () => {
  it('matches standard values', () => {
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 4);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 4);
    expect(zToPercentile(1.88)).toBeCloseTo(96.99, 1);
    expect(zToPercentile(-1.88)).toBeCloseTo(3.01, 1);
    expect(zToPercentile(-1.04)).toBeCloseTo(14.92, 1);
  });
});

describe('ages, reference selection and indicators', () => {
  it('counts days and months', () => {
    expect(ageInDays('2020-01-01', '2021-01-01')).toBe(366);
    expect(ageInDays('2026-10-01', '2026-10-06')).toBe(5);
  });

  it('WHO 2006 to 60 months, WHO 2007 to 228 months, CDC only when opted in from 24 months', () => {
    expect(selectGrowthReference(0)).toBe('who_2006');
    expect(selectGrowthReference(1826)).toBe('who_2006');
    expect(selectGrowthReference(1827)).toBe('who_2007');
    expect(selectGrowthReference(Math.floor(228 * 30.4375))).toBe('who_2007');
    expect(selectGrowthReference(Math.ceil(228.1 * 30.4375))).toBeNull();
    expect(selectGrowthReference(400, { preferCdc: true })).toBe('who_2006');
    expect(selectGrowthReference(800, { preferCdc: true })).toBe('cdc_2000');
    expect(selectGrowthReference(-1)).toBeNull();
  });

  it('WHO 2007 has no weight-for-age after 120 months', () => {
    expect(indicatorsFor('who_2006', 30)).toEqual(['wfa', 'lhfa', 'bmifa', 'hcfa']);
    expect(indicatorsFor('who_2007', 120)).toEqual(['wfa', 'lhfa', 'bmifa']);
    expect(indicatorsFor('who_2007', 121)).toEqual(['lhfa', 'bmifa']);
  });

  it('applies the 0.7 cm length/height adjustment', () => {
    expect(adjustedHeightCm(80, 500, 'standing')).toBeCloseTo(80.7, 9);
    expect(adjustedHeightCm(90, 800, 'recumbent')).toBeCloseTo(89.3, 9);
    expect(adjustedHeightCm(90, 800, 'standing')).toBe(90);
    expect(adjustedHeightCm(80, 500)).toBe(80);
  });

  it('computes BMI to one decimal', () => {
    expect(childBmi(20, 115)).toBe(15.1);
  });
});

describe('LMS lookup', () => {
  const daily = [
    { ageDays: 0, ageMonths: 0, l: 0.3487, m: 3.3464, s: 0.14602 },
    { ageDays: 1, ageMonths: 0.03, l: 0.3127, m: 3.3174, s: 0.14693 },
  ];
  const monthly = [
    { ageMonths: 61, l: -0.7387, m: 15.2641, s: 0.0839 },
    { ageMonths: 62, l: -0.7621, m: 15.2616, s: 0.08414 },
  ];
  it('matches daily rows exactly', () => {
    expect(lmsAt(daily, { ageDays: 1, ageMonths: 0.03 })?.m).toBe(3.3174);
  });
  it('interpolates monthly rows linearly', () => {
    const at = lmsAt(monthly, { ageDays: 1872, ageMonths: 61.5 })!;
    expect(at.m).toBeCloseTo((15.2641 + 15.2616) / 2, 9);
    expect(at.s).toBeCloseTo((0.0839 + 0.08414) / 2, 9);
  });
  it('bridges the 60 to 61 month gap with the first row, else out of range', () => {
    expect(lmsAt(monthly, { ageDays: 1840, ageMonths: 60.45 })?.m).toBe(15.2641);
    expect(lmsAt(monthly, { ageDays: 1700, ageMonths: 55.8 })).toBeNull();
    expect(lmsAt(monthly, { ageDays: 1900, ageMonths: 63 })).toBeNull();
    expect(lmsAt([], { ageDays: 0, ageMonths: 0 })).toBeNull();
  });
});

describe('alert rules (15 §2.8)', () => {
  const pt = (measuredOn: string, z: GrowthPoint['z'], weightKg = 12, ageDays = 1000) => ({
    measuredOn,
    ageDays,
    weightKg,
    heightCm: 88,
    z,
  });

  it('no alerts for a healthy child', () => {
    expect(evaluateGrowthRules(pt('2026-10-01', { wfa: 0.2, lhfa: 0.1, bmifa: 0.2 }), [])).toEqual(
      [],
    );
  });

  it('weight-for-age below the 3rd percentile is a red flag', () => {
    const [hit] = evaluateGrowthRules(pt('2026-10-01', { wfa: -2.1, bmifa: -1 }), []);
    expect(hit).toMatchObject({
      code: 'weight_for_age_below_p3',
      severity: 'see_clinician',
      stopsPlanning: true,
      escalation: 'faltering_growth',
    });
  });

  it('two major lines crossed downward within 12 months pauses planning', () => {
    const hits = evaluateGrowthRules(pt('2026-10-01', { wfa: -1.2, bmifa: -0.5 }), [
      pt('2026-04-01', { wfa: 0.3, bmifa: 0 }),
    ]);
    expect(hits.map((h) => h.code)).toEqual(['crossed_two_major_percentiles']);
    expect(hits[0]!.evidence).toMatchObject({ indicator: 'wfa', lines: 2 });
    expect(linesCrossedDownward(0.3, -1.2)).toBe(2);
    expect(linesCrossedDownward(-1.2, 0.3)).toBe(0);
  });

  it('crossings older than 12 months do not count', () => {
    const hits = evaluateGrowthRules(pt('2026-10-01', { wfa: -1.2 }), [
      pt('2025-09-01', { wfa: 0.3 }),
    ]);
    expect(hits).toEqual([]);
  });

  it('weight down more than 5 percent in 90 days', () => {
    const hits = evaluateGrowthRules(pt('2026-10-01', { wfa: -0.5 }, 11.3), [
      pt('2026-08-01', { wfa: -0.2 }, 12),
    ]);
    expect(hits[0]).toMatchObject({ code: 'rapid_weight_loss', stopsPlanning: true });
    expect(hits[0]!.escalation).toBe('rapid_child_weight_loss');
  });

  it('any weight decrease under 24 months over 30+ days', () => {
    const hits = evaluateGrowthRules(pt('2026-10-01', { wfa: 0 }, 9.9, 400), [
      pt('2026-08-25', { wfa: 0.1 }, 10, 363),
    ]);
    expect(hits.map((h) => h.code)).toEqual(['rapid_weight_loss']);
  });

  it('high BMI-for-age is info only and never stops planning', () => {
    const hits = evaluateGrowthRules(pt('2026-10-01', { wfa: 1.5, bmifa: 2.4 }), []);
    expect(hits).toEqual([
      expect.objectContaining({
        code: 'bmi_for_age_above_p97',
        severity: 'info',
        stopsPlanning: false,
        escalation: null,
      }),
    ]);
  });

  it('short stature is a watch alert, severe stunting sees a clinician, neither stops plans', () => {
    expect(evaluateGrowthRules(pt('2026-10-01', { lhfa: -2.2 }), [])[0]).toMatchObject({
      code: 'height_for_age_below_p3',
      severity: 'watch',
      stopsPlanning: false,
    });
    expect(evaluateGrowthRules(pt('2026-10-01', { lhfa: -3.4 }), [])[0]).toMatchObject({
      severity: 'see_clinician',
      stopsPlanning: false,
    });
  });

  it('severe thinness and head circumference are flagged', () => {
    const codes = evaluateGrowthRules(pt('2026-10-01', { bmifa: -3.2, hcfa: 2.5 }), []).map(
      (h) => h.code,
    );
    expect(codes).toEqual(['severe_thinness', 'head_circumference_out_of_range']);
  });

  it('implausible measurements raise only the re-measure prompt', () => {
    expect(isImplausibleZ('wfa', 5.5)).toBe(true);
    expect(isImplausibleZ('lhfa', 5.5)).toBe(false);
    const hits = evaluateGrowthRules({ ...pt('2026-10-01', { wfa: -7 }), implausible: true }, []);
    expect(hits.map((h) => h.code)).toEqual(['implausible_measurement']);
  });

  it('direction over the last three points', () => {
    expect(growthDirection([0, 0.1, 0.2])).toBe('stable');
    expect(growthDirection([0, 0.3, 0.8])).toBe('rising');
    expect(growthDirection([0.5, -0.5])).toBe('falling');
    expect(growthDirection([1])).toBe('stable');
  });
});
