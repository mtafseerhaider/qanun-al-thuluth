import { describe, expect, it } from 'vitest';

import {
  extractQuantities,
  findUngroundedNumbers,
  CHILD_GROWTH_FIRST,
  classifyInput,
  classifyInputRules,
  DISCLAIMER_TEXT,
  detectChildWeightRequest,
  detectFiqhQuestion,
  detectRedFlagText,
  escalationFor,
  evaluateIntakeRedFlags,
  findChildRestrictionViolations,
  findCureClaims,
  findRulingAssertions,
  guardOutput,
  hasScholarReferral,
  injectDisclaimer,
  riskFlagStrings,
  runGuardedTurn,
  SCHOLAR_REFERRAL,
  validateMinorAssessment,
} from '../src/guardrails/index.ts';
import type { IntakeRedFlagInput } from '../src/guardrails/index.ts';
import { FakeProvider } from '../src/providers/fake.ts';
import { RouteResolver } from '../src/router/route-resolver.ts';
import type { AiUsageInsert } from '../src/metering/usage.ts';

describe('child-restriction validator (FR-AI-03)', () => {
  it.each([
    'Give him 1,200 kcal a day.',
    'A 1200 calorie diet will help her.',
    'Put your daughter on a diet plan.',
    'Try smaller portions so he can lose weight.',
    "Don't worry, just cut down on his snacks.",
    'She should eat less rice at dinner.',
    'No seconds at dinner for him.',
    'A small calorie deficit is fine for a 12-year-old.',
    'بچے کا وزن کم کرنے کے لیے رات کا کھانا کم کر دیں۔',
    'Beti ko kam khilayein aur wazan kam karein.',
  ])('flags %s', (text) => {
    expect(findChildRestrictionViolations(text).length).toBeGreaterThan(0);
  });

  it.each([
    CHILD_GROWTH_FIRST.en,
    CHILD_GROWTH_FIRST.ur,
    'Growing children should never be put on a diet.',
    'Seconds are always allowed when she is hungry.',
    'Offer a balanced diet with vegetables at every meal.',
  ])('passes safe text: %s', (text) => {
    expect(findChildRestrictionViolations(text)).toEqual([]);
  });

  it('catches a leaked internal estimate', () => {
    const hits = findChildRestrictionViolations('Ibrahim needs about 1911 each day.', {
      internalKcalValues: [1911],
    });
    expect(hits.map((h) => h.code)).toContain('internal_estimate_leaked');
  });

  it('rejects a minor assessment with targets', () => {
    const hits = validateMinorAssessment({
      life_stage: 'child',
      energy_targets: { kcal_per_day: 1900, method: 'x' },
      macro_targets: null,
      summary: 'Growing well.',
    });
    expect(hits.map((h) => h.code)).toEqual(['minor_energy_targets']);
    expect(
      validateMinorAssessment({
        life_stage: 'adult',
        energy_targets: { kcal_per_day: 2300, method: 'x' },
        macro_targets: {},
        summary: 'Eat 2300 kcal.',
      }),
    ).toEqual([]);
  });

  it('detects child weight requests in en, ur and roman Urdu', () => {
    expect(detectChildWeightRequest('Help my 12-year-old lose weight')).toBe(true);
    expect(detectChildWeightRequest('میرے بیٹے کا وزن کم کرنا ہے')).toBe(true);
    expect(detectChildWeightRequest('beta mota ho gaya hai, diet batao')).toBe(true);
    expect(detectChildWeightRequest('What should I cook for dinner tonight?')).toBe(false);
  });
});

describe('fiqh detector (FR-AI-06)', () => {
  it('detects ruling questions', () => {
    expect(detectFiqhQuestion('Is gelatin halal?')).toBe(true);
    expect(detectFiqhQuestion('Does an injection break my fast?')).toBe(true);
    expect(detectFiqhQuestion('کیا روزے میں انجکشن سے روزہ ٹوٹ جاتا ہے؟')).toBe(true);
    expect(detectFiqhQuestion('What is a good suhoor for a teenager?')).toBe(false);
  });

  it('flags rulings in the assistant voice but not the referral template', () => {
    expect(findRulingAssertions('Yes, it is halal.').length).toBeGreaterThan(0);
    expect(findRulingAssertions('An eye drop does not break your fast.').length).toBeGreaterThan(0);
    expect(findRulingAssertions('آپ کا روزہ نہیں ٹوٹتا۔').length).toBeGreaterThan(0);
    expect(findRulingAssertions(SCHOLAR_REFERRAL.en)).toEqual([]);
    expect(findRulingAssertions(SCHOLAR_REFERRAL.ur)).toEqual([]);
    expect(hasScholarReferral(SCHOLAR_REFERRAL.ur)).toBe(true);
  });
});

describe('cure claims', () => {
  it('flags claims and passes tradition framing', () => {
    expect(findCureClaims('Black seed cures every disease except death.').length).toBeGreaterThan(
      0,
    );
    expect(findCureClaims('Honey treats diabetes.').length).toBe(1);
    expect(findCureClaims('کلونجی ہر بیماری کا علاج ہے۔').length).toBeGreaterThan(0);
    expect(
      findCureClaims(
        'In the tradition, dates are valued at iftar; research suggests they are a good source of fibre.',
      ),
    ).toEqual([]);
    expect(findCureClaims('Dates are sweet treats for the family.')).toEqual([]);
  });
});

describe('guardOutput', () => {
  it('replaces restriction for a minor with the growth-first template and adds the disclaimer', () => {
    const r = guardOutput('Sure, 1200 kcal and smaller portions.', {
      locale: 'en',
      aboutMinor: true,
      disclaimer: true,
    });
    expect(r.replaced).toBe(true);
    expect(r.text.startsWith(CHILD_GROWTH_FIRST.en)).toBe(true);
    expect(r.text).toContain(DISCLAIMER_TEXT.en);
    expect(r.safetyFlags).toContain('child_restriction_blocked');
  });

  it('turns a ruling into the scholar referral and appends a missing referral', () => {
    expect(guardOutput('It is haram.', { locale: 'ur' }).text).toBe(SCHOLAR_REFERRAL.ur);
    const appended = guardOutput('Dates and water are a gentle way to open the fast.', {
      locale: 'en',
      fiqhQuestion: true,
    });
    expect(appended.text).toContain('please ask a qualified scholar');
  });

  it('injects the disclaimer once', () => {
    const once = injectDisclaimer('Drink water before lunch.', 'en');
    expect(injectDisclaimer(once, 'en')).toBe(once);
    expect(injectDisclaimer('Salaam!', 'en')).toBe('Salaam!');
  });
});

const member = (over: Partial<IntakeRedFlagInput> = {}): IntakeRedFlagInput => ({
  ageMonths: 38 * 12,
  weightKg: 84,
  pregnant: false,
  gestationalDiabetes: false,
  breastfeeding: false,
  conditions: [],
  medicationFlags: [],
  allergySeverities: [],
  goals: [],
  fastingPractice: [],
  ...over,
});

describe('intake red flags (FR-AI-04, 00 §10.2)', () => {
  it('insulin plus intent to fast escalates and blocks fasting only', () => {
    const flags = evaluateIntakeRedFlags(
      member({ medicationFlags: ['insulin'], screening: { intends_to_fast: true } }),
    );
    expect(flags[0]).toMatchObject({
      code: 'diabetes_fasting_high_risk',
      hard: true,
      stops: 'fasting',
      reason: 'insulin_or_sulfonylurea_fasting',
    });
    const esc = escalationFor(flags, 'm1', 'en');
    expect(esc?.reason).toBe('insulin_or_sulfonylurea_fasting');
    expect(riskFlagStrings(flags)).toEqual(['red_flag.diabetes_fasting_high_risk']);
  });

  it('fasting practice in the lifestyle counts as intent; sulfonylurea via the condition flag', () => {
    const flags = evaluateIntakeRedFlags(
      member({
        conditions: [{ label: 'Type 2 diabetes', onInsulinOrSulfonylurea: true }],
        fastingPractice: ['ramadan'],
      }),
    );
    expect(flags.map((f) => f.code)).toContain('diabetes_fasting_high_risk');
  });

  it('insulin without fasting is info only', () => {
    const flags = evaluateIntakeRedFlags(member({ medicationFlags: ['insulin'] }));
    expect(flags.every((f) => !f.hard)).toBe(true);
    expect(escalationFor(flags, 'm1', 'en')).toBeNull();
  });

  it('rapid child weight loss is urgent', () => {
    const flags = evaluateIntakeRedFlags(
      member({
        ageMonths: 8 * 12,
        weightKg: 22,
        screening: { unintended_weight_change: { kg: -2, months: 2 } },
      }),
    );
    expect(flags[0]).toMatchObject({ code: 'child_rapid_weight_loss', severity: 'urgent' });
    expect(escalationFor(flags, 'c1', 'ur')?.recommend).toBe('see_pediatrician');
  });

  it('gagging, eating-disorder history, dehydration, pregnancy vomiting', () => {
    const codes = (o: Partial<IntakeRedFlagInput>) =>
      evaluateIntakeRedFlags(member(o)).map((f) => f.code);
    expect(codes({ ageMonths: 50, screening: { gags_on_most_textures: true } })).toContain(
      'feeding_choking_gagging_vomiting',
    );
    expect(codes({ screening: { eating_disorder_history: 'yes' } })).toContain(
      'eating_disorder_signal',
    );
    expect(codes({ conditions: [{ label: 'Anorexia nervosa' }] })).toContain(
      'eating_disorder_signal',
    );
    expect(codes({ screening: { faint_or_dark_urine_when_fasting: true } })).toContain(
      'dehydration_signs',
    );
    expect(
      codes({ pregnant: true, screening: { pregnancy_vomiting_cannot_keep_fluids: true } }),
    ).toContain('pregnancy_warning_sign');
  });

  it('anaphylaxis continues planning with a banner flag', () => {
    const flags = evaluateIntakeRedFlags(member({ allergySeverities: ['anaphylactic'] }));
    expect(flags).toEqual([expect.objectContaining({ code: 'anaphylactic_allergy', hard: false })]);
  });

  it('no flags for a healthy adult', () => {
    expect(evaluateIntakeRedFlags(member())).toEqual([]);
  });
});

describe('text red flags and the two-layer classifier', () => {
  it('rules', () => {
    expect(detectRedFlagText("My son's lips are swelling after peanuts").safety).toBe('emergency');
    expect(detectRedFlagText('I take insulin and want to fast this Ramadan').categories).toContain(
      'insulin_or_sulfonylurea_fasting',
    );
    expect(detectRedFlagText('Ideas for a quick lunchbox?').safety).toBe('ok');
  });

  const routes = new RouteResolver(async () => [
    {
      route_key: 'classify.safety',
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      params: {},
      priority: 1,
      enabled: true,
    },
  ]);
  const metadata = {
    requestId: 'r1',
    userId: 'u1',
    householdId: null,
    promptKey: 'x',
    promptVersion: 1,
    tier: 'free' as const,
  };

  it('the model layer can add flags but never clears rule flags, and meters usage', async () => {
    const usage: AiUsageInsert[] = [];
    const provider = new FakeProvider({
      script: () => ({
        content: [
          {
            type: 'text',
            text: '{"safety":"ok","categories":[],"fiqh_question":true,"child_weight_request":false,"confidence":0.9}',
          },
        ],
      }),
    });
    const c = await classifyInput('Help my 10 year old lose weight', {
      fallback: { resolver: routes, providers: { anthropic: provider } },
      writeUsage: async (r) => void usage.push(r),
      metadata,
    });
    expect(c.child_weight_request).toBe(true);
    expect(c.fiqh_question).toBe(true);
    expect(c.source).toBe('rules+model');
    expect(usage).toHaveLength(1);
    expect(usage[0]?.route_key).toBe('classify.safety');
  });

  it('falls back to rules when the model output is invalid', async () => {
    const provider = new FakeProvider({
      script: () => ({ content: [{ type: 'text', text: 'nope' }] }),
    });
    const c = await classifyInput('Is shrimp halal?', {
      fallback: { resolver: routes, providers: { anthropic: provider } },
      writeUsage: async () => {},
      metadata,
    });
    expect(c).toEqual(classifyInputRules('Is shrimp halal?'));
  });

  it('runGuardedTurn: emergencies bypass the model; unsafe drafts are replaced', async () => {
    let called = 0;
    const emergency = await runGuardedTurn({
      text: 'My baby is unresponsive',
      locale: 'en',
      generate: async () => {
        called++;
        return 'x';
      },
    });
    expect(emergency.bypassedModel).toBe(true);
    expect(emergency.text).toContain('1122');
    expect(called).toBe(0);

    const child = await runGuardedTurn({
      text: 'Give my 9 year old daughter a 1000 calorie diet',
      locale: 'en',
      generate: async (instruction) => {
        expect(instruction).toContain('Never give a child a calorie number');
        return 'Here is a 1000 kcal diet with smaller portions.';
      },
    });
    expect(findChildRestrictionViolations(child.text)).toEqual([]);
    expect(child.safetyFlags).toContain('child_restriction_blocked');
  });
});

describe('numeric grounding (12 §13.5)', () => {
  it('extracts quantities with units, converting litres to ml', () => {
    const q = extractQuantities('Aim for 2,300 kcal, 89 g protein and 2.7 litres of water.');
    expect(q.map((x) => [x.value, x.unit])).toEqual([
      [2300, 'kcal'],
      [89, 'g'],
      [2700, 'ml'],
    ]);
  });

  it('accepts engine values within rounding and rejects invented ones', () => {
    const allowed = { kcal: [2300, 2711], g: [89], ml: [2650] };
    expect(
      findUngroundedNumbers('Your target is 2,300 kcal (maintenance 2711 kcal).', allowed),
    ).toEqual([]);
    expect(findUngroundedNumbers('About 2.6 litres a day.', allowed)).toEqual([]);
    expect(findUngroundedNumbers('Fill a third of the stomach: 33% food.', allowed)).toEqual([]);
    const bad = findUngroundedNumbers('Try 1,800 kcal with 120 g protein.', allowed);
    expect(bad.map((x) => x.value)).toEqual([1800, 120]);
  });
});
