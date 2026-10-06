import { RamadanGenerateRequest } from '@shared/contracts';

import { fastingEligibility, NO_SAFETY, type FastingMember } from '@/features/fasting';

import {
  buildParticipants,
  countFasting,
  formatHms,
  participationRule,
  ramadanDay,
  ramadanEndDate,
  ramadanMoment,
  upcomingRamadanYear,
  validateChoice,
  validateDates,
  withIntention,
  type ParticipationChoice,
} from '../utils/ramadan-rules';

const TODAY = '2026-10-06';
const id = (n: number) => `0000000${n}-0000-4000-8000-000000000000`;

const member = (
  n: number,
  dob: string | null,
  extra: Partial<FastingMember> = {},
): FastingMember => ({
  id: id(n),
  name: `M${n}`,
  dateOfBirth: dob,
  lifeStage: 'adult',
  specialModules: [],
  linkedUserId: null,
  ...extra,
});

const ruleFor = (m: FastingMember, safety = NO_SAFETY) =>
  participationRule(m, fastingEligibility(m, safety, TODAY));

describe('Ramadan participation rules', () => {
  it('never lets a child under 7 fast', () => {
    const rule = ruleFor(member(1, '2021-03-01', { lifeStage: 'child' }));
    expect(rule.fixed).toBe(true);
    expect(rule.options).toEqual(['not_fasting']);
    expect(rule.notice).toBe('under_7');
    const fasting: ParticipationChoice = { ...rule.defaultChoice, intention: 'fasting' };
    expect(validateChoice(rule, fasting)).toBe('not_allowed');
    // Even a tampered choice map cannot make them fast.
    expect(buildParticipants([rule], { [rule.memberId]: fasting })[0]?.intention).toBe(
      'not_fasting',
    );
  });

  it('treats a child with no birth date as under 7', () => {
    expect(ruleFor(member(2, null, { lifeStage: 'toddler' })).fixed).toBe(true);
  });

  it('offers only practice fasts or not fasting from 7 to 12', () => {
    const rule = ruleFor(member(3, '2017-01-01', { lifeStage: 'child' }));
    expect(rule.options).toEqual(['practice_fast', 'not_fasting']);
    expect(rule.defaultChoice.intention).toBe('practice_fast');
    expect(validateChoice(rule, { ...rule.defaultChoice, intention: 'fasting' })).toBe(
      'not_allowed',
    );
    const [p] = buildParticipants([rule], {});
    expect(p).toMatchObject({
      intention: 'practice_fast',
      practice_fast: { days_per_week: 2, until: 'dhuhr' },
    });
  });

  it('lets teens choose fasting or practice, and adults full fasting', () => {
    expect(ruleFor(member(4, '2011-01-01', { lifeStage: 'teen' })).options).toContain(
      'practice_fast',
    );
    const adult = ruleFor(member(5, '1990-01-01'));
    expect(adult.options).toEqual(['fasting', 'not_fasting', 'exempt']);
    expect(adult.defaultChoice.intention).toBe('fasting');
  });

  it('requires a clinician confirmation before a red-flag member is planned as fasting', () => {
    const rule = ruleFor(member(6, '1985-01-01'), {
      ...NO_SAFETY,
      reasons: ['insulin_or_sulfonylurea'],
    });
    expect(rule.notice).toBe('blocked');
    expect(rule.defaultChoice).toMatchObject({ intention: 'exempt', exemptionReason: 'illness' });
    const fasting = withIntention(rule.defaultChoice, 'fasting');
    expect(validateChoice(rule, fasting)).toBe('clinician_ack');
    expect(() => buildParticipants([rule], { [rule.memberId]: fasting })).toThrow();
    expect(validateChoice(rule, { ...fasting, clinicianAck: true })).toBeNull();
  });

  it('asks pregnant members to decide with their clinician, defaulting to not fasting', () => {
    const rule = ruleFor(member(7, '1994-01-01', { specialModules: ['pregnancy'] }));
    expect(rule.notice).toBe('pregnancy');
    expect(rule.defaultChoice.intention).toBe('not_fasting');
    expect(rule.options).toContain('fasting');
  });

  it('requires an exemption reason and resets details when the intention changes', () => {
    const rule = ruleFor(member(8, '1990-01-01'));
    const exempt = withIntention(rule.defaultChoice, 'exempt');
    expect(validateChoice(rule, exempt)).toBe('exemption_reason');
    const withReason = { ...exempt, exemptionReason: 'travel' as const };
    expect(validateChoice(rule, withReason)).toBeNull();
    expect(withIntention(withReason, 'fasting')).toMatchObject({
      exemptionReason: null,
      practice: null,
    });
  });

  it('builds contract-valid participants for the generate request', () => {
    const rules = [
      ruleFor(member(1, '2021-03-01', { lifeStage: 'child' })),
      ruleFor(member(3, '2017-01-01', { lifeStage: 'child' })),
      ruleFor(member(5, '1990-01-01')),
    ];
    const participants = buildParticipants(rules, {});
    expect(countFasting(participants)).toEqual({ fasting: 1, practice: 1 });
    expect(() =>
      RamadanGenerateRequest.parse({
        household_id: id(9),
        hijri_year: 1448,
        location: { city: 'Lahore', country_code: 'PK' },
        participants,
      }),
    ).not.toThrow();
  });
});

describe('Ramadan dates', () => {
  it('plans this Ramadan until it ends, then next year', () => {
    // 2026-10-06 falls after Ramadan 1447, so the next one to plan is 1448.
    expect(upcomingRamadanYear(TODAY)).toBe(1448);
  });

  it('accepts 29 or 30 days that have not ended', () => {
    const start = '2027-02-08';
    const v = (hijriYear: number, startDate: string, endDate: string) =>
      validateDates({ hijriYear, startDate, endDate }, TODAY);
    expect(v(1448, start, ramadanEndDate(start, 30))).toBeNull();
    expect(v(1448, start, ramadanEndDate(start, 29))).toBeNull();
    expect(v(1448, start, '2027-02-20')).toBe('length');
    expect(v(1446, '2025-03-01', '2025-03-30')).toBe('year');
    expect(v(1447, '2026-02-18', '2026-03-19')).toBe('past');
  });

  it('counts the Ramadan day', () => {
    const plan = { startDate: '2027-02-08', endDate: '2027-03-09' };
    expect(ramadanDay('2027-02-08', plan)).toBe(1);
    expect(ramadanDay('2027-03-09', plan)).toBe(30);
    expect(ramadanDay('2027-03-10', plan)).toBeNull();
    expect(ramadanDay('2027-02-08', null)).toBeNull();
  });
});

describe('Ramadan Today countdown', () => {
  const times = { fajrIso: '2027-02-10T00:30:00.000Z', maghribIso: '2027-02-10T12:55:00.000Z' };

  it('counts down to suhoor end, then to iftar, then stops', () => {
    expect(ramadanMoment(times, Date.parse('2027-02-10T00:00:00Z'))).toEqual({
      phase: 'before_fajr',
      targetMs: Date.parse(times.fajrIso),
    });
    expect(ramadanMoment(times, Date.parse('2027-02-10T08:00:00Z'))).toEqual({
      phase: 'fasting',
      targetMs: Date.parse(times.maghribIso),
    });
    expect(ramadanMoment(times, Date.parse('2027-02-10T13:00:00Z')).phase).toBe('after_iftar');
  });

  it('formats hours, minutes and seconds', () => {
    expect(formatHms(4 * 3600 + 55 * 60 + 7)).toBe('4:55:07');
    expect(formatHms(59)).toBe('0:00:59');
  });
});
