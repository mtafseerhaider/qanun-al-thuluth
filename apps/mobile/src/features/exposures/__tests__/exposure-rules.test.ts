import type { AcceptanceScore } from '@shared';

import {
  acceptanceIndex,
  ageInMonths,
  avoidColours,
  chainLadderSteps,
  exposureLadderSteps,
  foodLifecycle,
  moveLadder,
  moveStep,
  nextLadderAction,
  parseExposurePairs,
  parseLadderProposal,
  pairsThisWeek,
  stageForAcceptance,
  suggestChain,
  weeklyAcceptance,
  type FoodFeatures,
} from '../utils/exposure-rules';

const TODAY = '2026-10-06'; // a Tuesday
const MEMBER = '44444444-4444-4444-8444-444444444444';
const tries = (...scores: Array<[string, AcceptanceScore]>) =>
  scores.map(([exposedOn, acceptance]) => ({ exposedOn, acceptance }));
const criteria = (s: string) => `c:${s}`;

describe('ladder progression', () => {
  it('advances after 3 calm passes, steps back after two "not today", else stays', () => {
    expect(
      nextLadderAction(
        'touch',
        tries(['2026-10-01', '2_touched'], ['2026-10-02', '3_tasted'], ['2026-10-03', '2_touched']),
      ),
    ).toBe('advance');
    expect(
      nextLadderAction('touch', tries(['2026-10-01', '0_refused'], ['2026-10-02', '0_refused'])),
    ).toBe('step_back');
    expect(
      nextLadderAction(
        'taste',
        tries(['2026-10-01', '3_tasted'], ['2026-10-02', '2_touched'], ['2026-10-03', '3_tasted']),
      ),
    ).toBe('stay');
  });

  it('infers a stage from a score', () => {
    expect(stageForAcceptance('0_refused')).toBe('tolerate_on_table');
    expect(stageForAcceptance('4_ate_some')).toBe('eat_small');
  });

  it('builds a nine-stage ladder and a chain with short link stages', () => {
    expect(exposureLadderSteps('Peas', criteria)).toHaveLength(9);
    const chain = chainLadderSteps(
      [
        { label: 'Fries', ingredientId: 'i-fries' },
        { label: 'Roast potato', ingredientId: 'i-roast' },
      ],
      { label: 'Sweet potato' },
      criteria,
    );
    expect(chain).toHaveLength(4 + 4 + 9);
    expect(chain.map((s) => s.stepNo)).toEqual(chain.map((_, i) => i + 1));
    expect(chain[4]?.bridgeFromIngredientId).toBe('i-fries');
    expect(chain[8]?.foodLabel).toBe('Sweet potato');
    expect(chain[8]?.bridgeFromIngredientId).toBe('i-roast');
  });

  it('reorders and renumbers steps, and completes a ladder on its last step', () => {
    const steps = exposureLadderSteps('Peas', criteria)
      .slice(0, 3)
      .map((s, i) => ({ ...s, id: `s${i}` }));
    const moved = moveStep(steps, 0, 1);
    expect(moved.map((s) => s.stage)).toEqual(['look', 'tolerate_on_table', 'touch']);
    expect(moved.map((s) => s.stepNo)).toEqual([1, 2, 3]);
    expect(moveStep(steps, 0, -1)).toEqual(steps);
    expect(moveLadder({ currentStep: 3, steps }, 'up')).toEqual({
      currentStep: 3,
      status: 'completed',
    });
    expect(moveLadder({ currentStep: 1, steps }, 'down')).toEqual({
      currentStep: 1,
      status: 'active',
    });
  });
});

describe('new-food lifecycle', () => {
  it('moves from introduced to accepted, and pauses after many tries without tasting', () => {
    expect(foodLifecycle([], TODAY)).toBe('introduced');
    expect(foodLifecycle(tries(['2026-10-01', '1_tolerated']), TODAY)).toBe('introduced');
    expect(
      foodLifecycle(tries(['2026-10-01', '1_tolerated'], ['2026-10-02', '2_touched']), TODAY),
    ).toBe('exposing');
    expect(
      foodLifecycle(tries(['2026-10-01', '3_tasted'], ['2026-10-02', '3_tasted']), TODAY),
    ).toBe('tasting');
    expect(
      foodLifecycle(
        tries(
          ['2026-09-20', '4_ate_some'],
          ['2026-09-27', '5_ate_well'],
          ['2026-10-04', '4_ate_some'],
        ),
        TODAY,
      ),
    ).toBe('accepted');
    const many = Array.from({ length: 15 }, (_, i) => ({
      exposedOn: `2026-09-${String(i + 1).padStart(2, '0')}`,
      acceptance: '1_tolerated' as AcceptanceScore,
    }));
    expect(foodLifecycle(many, TODAY)).toBe('paused');
  });
});

describe('acceptance analytics', () => {
  it('buckets scores into ISO weeks ending this week', () => {
    const weeks = weeklyAcceptance(
      [
        { date: '2026-10-05', acceptance: '3_tasted' },
        { date: '2026-10-06', acceptance: '3_tasted' },
        { date: '2026-09-30', acceptance: '0_refused' },
        { date: '2026-01-01', acceptance: '5_ate_well' },
      ],
      TODAY,
      2,
    );
    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-09-28', '2026-10-05']);
    expect(weeks[0]?.counts).toEqual([1, 0, 0, 0, 0, 0]);
    expect(weeks[1]?.counts).toEqual([0, 0, 0, 2, 0, 0]);
  });

  it('weights recent tries more and is null without data', () => {
    expect(acceptanceIndex([], TODAY)).toBeNull();
    expect(acceptanceIndex(tries([TODAY, '5_ate_well']), TODAY)).toBe(100);
    const improving = acceptanceIndex(
      tries(['2026-07-20', '0_refused'], [TODAY, '5_ate_well']),
      TODAY,
    );
    expect(improving).toBeGreaterThan(50);
  });

  it('computes whole months of age', () => {
    expect(ageInMonths('2024-10-07', TODAY)).toBe(23);
    expect(ageInMonths('2024-10-06', TODAY)).toBe(24);
  });
});

describe('food chaining', () => {
  const f = (
    id: string,
    textures: FoodFeatures['textures'],
    color: string | null,
  ): FoodFeatures => ({
    id,
    label: id,
    textures,
    color,
  });
  it('returns no links when the target is already close', () => {
    expect(suggestChain(f('a', ['crunchy'], 'beige'), f('b', ['crunchy'], 'beige'), [])).toEqual(
      [],
    );
  });
  it('finds a bridge food between distant foods, or null when none fits', () => {
    const start = f('fries', ['crunchy'], 'beige');
    const target = f('peas', ['soft'], 'green');
    const bridge = f('roast', ['crunchy', 'soft'], 'yellow');
    const bridge2 = f('mash', ['soft'], 'orange');
    const result = suggestChain(start, target, [bridge, bridge2]);
    expect(result?.length).toBeGreaterThan(0);
    expect(suggestChain(start, target, [])).toBeNull();
  });
  it('strips the avoid: prefix from colour sensitivities', () => {
    expect([...avoidColours(['avoid:green', 'red'])]).toEqual(['green', 'red']);
  });
});

describe('plan exposure pairs', () => {
  const meta = {
    exposure_pairs: [
      {
        family_member_id: MEMBER,
        week: 1,
        new_food: 'Peas',
        familiar_label: 'Rice',
        slots: [{ plan_date: '2026-10-07', meal_type: 'lunch' }],
      },
      {
        family_member_id: MEMBER,
        week: 2,
        new_food: 'Okra',
        slots: [{ plan_date: '2026-10-14', meal_type: 'dinner' }],
      },
      { family_member_id: 3 },
    ],
  };
  it('parses pairs, dropping malformed ones, and picks this week', () => {
    const pairs = parseExposurePairs(meta);
    expect(pairs).toHaveLength(2);
    expect(pairs[0]?.newIngredientId).toBeNull();
    expect(pairsThisWeek(pairs, MEMBER, TODAY).map((p) => p.newFood)).toEqual(['Peas']);
    expect(pairsThisWeek(pairs, 'someone-else', TODAY)).toEqual([]);
    expect(parseExposurePairs(null)).toEqual([]);
  });
});

describe('chat ladder proposals', () => {
  const card = {
    kind: 'exposure_ladder_proposal',
    family_member_id: MEMBER,
    target_food: 'Peas',
    target_ingredient_id: null,
    strategy: 'exposure_ladder',
    steps: [
      {
        step_no: 2,
        stage: 'touch',
        food_label: 'Peas',
        bridge_from_ingredient_id: null,
        criteria: 'x',
      },
      { step_no: 1, stage: 'look', food_label: '', bridge_from_ingredient_id: null, criteria: 'y' },
      {
        step_no: 3,
        stage: 'juggle',
        food_label: 'Peas',
        bridge_from_ingredient_id: null,
        criteria: 'z',
      },
    ],
  };
  it('parses objects and JSON strings, sorts, drops unknown stages and renumbers', () => {
    const p = parseLadderProposal(JSON.stringify(card));
    expect(p?.steps.map((s) => [s.stepNo, s.stage, s.foodLabel])).toEqual([
      [1, 'look', 'Peas'],
      [2, 'touch', 'Peas'],
    ]);
    expect(p?.targetIngredientId).toBeNull();
    expect(parseLadderProposal(card)?.strategy).toBe('exposure_ladder');
  });
  it('rejects malformed proposals', () => {
    expect(parseLadderProposal('{not json')).toBeNull();
    expect(parseLadderProposal({ ...card, kind: 'log_proposal' })).toBeNull();
    expect(parseLadderProposal({ ...card, steps: [] })).toBeNull();
    expect(parseLadderProposal({ ...card, target_food: 4 })).toBeNull();
  });
});
