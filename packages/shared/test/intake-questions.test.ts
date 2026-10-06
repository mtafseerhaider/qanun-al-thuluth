import { describe, expect, it } from 'vitest';

import { searchConditions, CONDITION_OPTIONS } from '../src/intake/catalog.ts';
import {
  checkWeightTarget,
  completeness,
  defaultGoalFor,
  goalOptionsFor,
  householdCompleteness,
  intakeContext,
  intakeRedFlags,
  isQuestionVisible,
  moduleOptionsFor,
  nextIntakeStep,
  onInsulinOrSulfonylurea,
  previousIntakeStep,
  QUESTION_IDS,
  QUESTIONS,
  sanitizeGoals,
  screeningFor,
  toggleModule,
  visibleSteps,
  type MemberIntakeAnswers,
} from '../src/intake/questions.ts';

const TODAY = '2026-11-09';
// The Usman fixture household (01 §3.2 persona 1)
const usman = { date_of_birth: '1988-03-14', sex_at_birth: 'male' as const };
const hina = { date_of_birth: '1992-06-02', sex_at_birth: 'female' as const };
const ibrahim = { date_of_birth: '2018-04-20', sex_at_birth: 'male' as const };
const maryam = { date_of_birth: '2022-01-10', sex_at_birth: 'female' as const };
const teenGirl = { date_of_birth: '2012-02-01', sex_at_birth: 'female' as const };
const baby = { date_of_birth: '2026-06-01', sex_at_birth: 'female' as const };

const T2 = CONDITION_OPTIONS.find((c) => c.key === 'type_2_diabetes')!.snomed;
const T1 = CONDITION_OPTIONS.find((c) => c.key === 'type_1_diabetes')!.snomed;

describe('question registry', () => {
  it('defines every question id exactly once', () => {
    expect(QUESTIONS.map((q) => q.id).sort()).toEqual([...QUESTION_IDS].sort());
  });
});

describe('module eligibility', () => {
  it('offers pregnancy only to females 12 to 55 and breastfeeding to adult females', () => {
    expect(moduleOptionsFor({ ageMonths: 34 * 12, sex: 'female' })).toEqual([
      'pregnancy',
      'breastfeeding',
      'autism',
      'picky_eater',
      'adhd',
    ]);
    expect(moduleOptionsFor({ ageMonths: 38 * 12, sex: 'male' })).not.toContain('pregnancy');
    expect(moduleOptionsFor({ ageMonths: 14 * 12, sex: 'female' })).toContain('pregnancy');
    expect(moduleOptionsFor({ ageMonths: 14 * 12, sex: 'female' })).not.toContain('breastfeeding');
    expect(moduleOptionsFor({ ageMonths: 11 * 12, sex: 'female' })).not.toContain('pregnancy');
    expect(moduleOptionsFor({ ageMonths: 56 * 12, sex: 'female' })).not.toContain('pregnancy');
    expect(moduleOptionsFor({ ageMonths: 30 * 12, sex: 'unspecified' })).not.toContain('pregnancy');
  });

  it('gates autism at 18 months, picky eater at 12 months and ADHD at 3 years', () => {
    expect(moduleOptionsFor({ ageMonths: 10, sex: 'male' })).toEqual([]);
    expect(moduleOptionsFor({ ageMonths: 12, sex: 'male' })).toEqual(['picky_eater']);
    expect(moduleOptionsFor({ ageMonths: 18, sex: 'male' })).toEqual(['autism', 'picky_eater']);
    expect(moduleOptionsFor({ ageMonths: 36, sex: 'male' })).toContain('adhd');
  });

  it('keeps pregnancy and breastfeeding mutually exclusive', () => {
    expect(toggleModule(['pregnancy', 'autism'], 'breastfeeding')).toEqual([
      'autism',
      'breastfeeding',
    ]);
    expect(toggleModule(['autism'], 'autism')).toEqual([]);
  });

  it('drops stale module picks the member is no longer eligible for', () => {
    const ctx = intakeContext(usman, { modules: ['pregnancy', 'adhd'] }, TODAY);
    expect(ctx.modules).toEqual(['adhd']);
  });
});

describe('adaptive questions', () => {
  it('asks the eating-disorder question from 12 only', () => {
    expect(isQuestionVisible('screen.eating_concern', intakeContext(ibrahim, {}, TODAY))).toBe(
      false,
    );
    expect(isQuestionVisible('screen.eating_concern', intakeContext(teenGirl, {}, TODAY))).toBe(
      true,
    );
    expect(isQuestionVisible('screen.eating_concern', intakeContext(usman, {}, TODAY))).toBe(true);
  });

  it('asks about fasting intent from 7 and fasting symptoms only for those who fast', () => {
    expect(isQuestionVisible('screen.intends_to_fast', intakeContext(maryam, {}, TODAY))).toBe(
      false,
    );
    expect(isQuestionVisible('screen.intends_to_fast', intakeContext(ibrahim, {}, TODAY))).toBe(
      true,
    );
    expect(isQuestionVisible('screen.fasting_symptoms', intakeContext(usman, {}, TODAY))).toBe(
      false,
    );
    const fasting: MemberIntakeAnswers = { lifestyle: { fasting_practice: ['ramadan'] } };
    expect(
      isQuestionVisible('screen.fasting_symptoms', intakeContext(usman, fasting, TODAY), fasting),
    ).toBe(true);
  });

  it('shows module steps only for selected modules', () => {
    expect(visibleSteps(intakeContext(usman, {}, TODAY))).toEqual([
      'health',
      'allergies',
      'food',
      'lifestyle',
      'modules',
      'goals',
    ]);
    const a: MemberIntakeAnswers = { modules: ['autism'] };
    expect(visibleSteps(intakeContext(maryam, a, TODAY), a)).toEqual([
      'health',
      'allergies',
      'food',
      'lifestyle',
      'modules',
      'sensory',
      'picky',
      'goals',
    ]);
    const h: MemberIntakeAnswers = { modules: ['breastfeeding'] };
    expect(visibleSteps(intakeContext(hina, h, TODAY), h)).toContain('pregnancy');
  });

  it('hides the modules step for a young infant with no eligible module', () => {
    expect(visibleSteps(intakeContext(baby, {}, TODAY))).not.toContain('modules');
  });

  it('walks forward and back over visible steps only', () => {
    const a: MemberIntakeAnswers = { modules: ['picky_eater'] };
    const ctx = intakeContext(ibrahim, a, TODAY);
    expect(nextIntakeStep(ctx, a, 'modules')).toBe('picky');
    expect(nextIntakeStep(ctx, a, 'picky')).toBe('goals');
    expect(nextIntakeStep(ctx, a, 'goals')).toBeNull();
    expect(previousIntakeStep(ctx, a, 'goals')).toBe('picky');
    expect(previousIntakeStep(ctx, a, 'health')).toBeNull();
  });

  it('asks for the ADHD dose time only when a stimulant is taken', () => {
    const a: MemberIntakeAnswers = { modules: ['adhd'], adhd: { stimulant: 'no' } };
    const ctx = intakeContext(ibrahim, a, TODAY);
    expect(isQuestionVisible('adhd.dose_time', ctx, a)).toBe(false);
    const b: MemberIntakeAnswers = { ...a, adhd: { stimulant: 'yes' } };
    expect(isQuestionVisible('adhd.dose_time', ctx, b)).toBe(true);
  });
});

describe('goals', () => {
  it('never offers weight goals under 18 and defaults children to growth', () => {
    for (const child of [ibrahim, maryam, teenGirl]) {
      const ctx = intakeContext(child, {}, TODAY);
      expect(goalOptionsFor(ctx)).not.toContain('weight_loss');
      expect(goalOptionsFor(ctx)).not.toContain('weight_gain');
      expect(defaultGoalFor(ctx)).toBe('child_growth');
    }
  });

  it('offers adults weight loss but not child growth', () => {
    const ctx = intakeContext(usman, {}, TODAY);
    expect(goalOptionsFor(ctx)).toContain('weight_loss');
    expect(goalOptionsFor(ctx)).not.toContain('child_growth');
    expect(goalOptionsFor(ctx)).not.toContain('pregnancy_support');
  });

  it('hides weight loss while pregnant, breastfeeding or with an eating concern', () => {
    const bf: MemberIntakeAnswers = { modules: ['breastfeeding'] };
    expect(goalOptionsFor(intakeContext(hina, bf, TODAY))).not.toContain('weight_loss');
    expect(goalOptionsFor(intakeContext(hina, bf, TODAY))).toContain('breastfeeding_support');
    const ed: MemberIntakeAnswers = { screening: { eating_disorder_history: 'yes' } };
    const opts = goalOptionsFor(intakeContext(usman, ed, TODAY));
    expect(opts).not.toContain('weight_loss');
    expect(opts).not.toContain('weight_gain');
  });

  it('sanitises stale goals and keeps exactly one primary', () => {
    const ctx = intakeContext(ibrahim, {}, TODAY);
    const goals = sanitizeGoals(
      [
        { id: 'a', goal_type: 'weight_loss', is_primary: true },
        { id: 'b', goal_type: 'energy' },
        { id: 'c', goal_type: 'child_growth' },
      ],
      ctx,
    );
    expect(goals.map((g) => g.goal_type)).toEqual(['energy', 'child_growth']);
    expect(goals.filter((g) => g.is_primary)).toHaveLength(1);
  });

  it('blocks targets under BMI 18.5 and warns above 1 percent a week', () => {
    expect(checkWeightTarget({ heightCm: 175, weightKg: 84, targetKg: 70 }).belowBmiFloor).toBe(
      false,
    );
    expect(checkWeightTarget({ heightCm: 175, weightKg: 84, targetKg: 55 }).belowBmiFloor).toBe(
      true,
    );
    const fast = checkWeightTarget({
      heightCm: 175,
      weightKg: 84,
      targetKg: 70,
      targetDate: '2026-12-09',
      today: TODAY,
    });
    expect(fast.tooFast).toBe(true);
    const steady = checkWeightTarget({
      heightCm: 175,
      weightKg: 84,
      targetKg: 70,
      targetDate: '2027-08-09',
      today: TODAY,
    });
    expect(steady.tooFast).toBe(false);
  });
});

describe('completeness', () => {
  it('scores answered questions and lists missing required ones', () => {
    const ctx = intakeContext(usman, {}, TODAY);
    const empty = completeness(ctx, {});
    expect(empty.score).toBe(0);
    expect(empty.complete).toBe(false);
    expect(empty.requiredMissing).toEqual([
      'health.conditions',
      'screen.weight_change',
      'screen.eating_concern',
      'allergies.list',
      'goals.select',
    ]);

    const a: MemberIntakeAnswers = {
      conditions: { none: true, items: [] },
      allergies: { none: true, items: [] },
      screening: { unintended_weight_change: null, eating_disorder_history: 'no' },
      goals: [{ id: 'g', goal_type: 'weight_loss', is_primary: true }],
    };
    const done = completeness(intakeContext(usman, a, TODAY), a);
    expect(done.complete).toBe(true);
    expect(done.score).toBeGreaterThan(40);
    expect(done.score).toBeLessThan(100);
  });

  it('averages member scores for the household', () => {
    expect(householdCompleteness([100, 50])).toBe(75);
    expect(householdCompleteness([])).toBe(0);
  });
});

describe('red flags', () => {
  const insulinFaster: MemberIntakeAnswers = {
    conditions: { none: false, items: [{ id: 'c', label: 'Type 2 diabetes', condition_code: T2 }] },
    medications: {
      none: false,
      items: [{ id: 'm', name: 'Lantus', food_interaction_flags: ['insulin'] }],
    },
    screening: { intends_to_fast: true },
  };

  it('flags insulin with intent to fast (the red-flag fixture)', () => {
    const ctx = intakeContext(usman, insulinFaster, TODAY);
    expect(intakeRedFlags(ctx, insulinFaster)).toContain('insulin_or_sulfonylurea_fasting');
    const noFast = { ...insulinFaster, screening: { intends_to_fast: false } };
    expect(intakeRedFlags(intakeContext(usman, noFast, TODAY), noFast)).toEqual([]);
  });

  it('sets on_insulin_or_sulfonylurea for type 1, or type 2 with a flagged medication', () => {
    expect(onInsulinOrSulfonylurea({ condition_code: T1 }, [])).toBe(true);
    expect(onInsulinOrSulfonylurea({ condition_code: T2 }, [])).toBe(false);
    expect(
      onInsulinOrSulfonylurea({ condition_code: T2 }, [
        { food_interaction_flags: ['sulfonylurea'] },
      ]),
    ).toBe(true);
    expect(
      onInsulinOrSulfonylurea({ condition_code: T2 }, [{ food_interaction_flags: ['metformin'] }]),
    ).toBe(false);
    expect(onInsulinOrSulfonylurea({ condition_code: null }, [])).toBe(false);
  });

  it('flags eating concerns, child weight loss, anaphylaxis and gagging', () => {
    const a: MemberIntakeAnswers = {
      screening: {
        unintended_weight_change: { kg: -2, months: 3 },
        gags_on_most_textures: true,
      },
      allergies: {
        none: false,
        items: [
          {
            id: 'x',
            allergen_id: '00000000-0000-4000-8000-000000000001',
            severity: 'anaphylactic',
          },
        ],
      },
    };
    expect(intakeRedFlags(intakeContext(ibrahim, a, TODAY), a).sort()).toEqual(
      ['feeding_gagging', 'rapid_child_weight_loss', 'severe_allergy_reaction'].sort(),
    );
    const ed: MemberIntakeAnswers = { screening: { eating_disorder_history: 'yes' } };
    expect(intakeRedFlags(intakeContext(teenGirl, ed, TODAY), ed)).toEqual([
      'eating_disorder_signals',
    ]);
  });

  it('builds the request screening with defaults', () => {
    expect(screeningFor({ screening: { intends_to_fast: true } })).toMatchObject({
      intends_to_fast: true,
      unintended_weight_change: null,
      gags_on_most_textures: false,
    });
  });
});

describe('condition search', () => {
  it('matches English labels, keys and translated labels', () => {
    expect(searchConditions('diab').map((c) => c.key)).toEqual([
      'type_1_diabetes',
      'type_2_diabetes',
      'prediabetes',
      'gestational_diabetes',
    ]);
    expect(searchConditions('').length).toBe(CONDITION_OPTIONS.length);
    expect(
      searchConditions('شوگر', (c) => (c.key === 'type_2_diabetes' ? 'ٹائپ 2 شوگر' : '')).map(
        (c) => c.key,
      ),
    ).toEqual(['type_2_diabetes']);
  });
});
