import { fireEvent, screen } from '@testing-library/react-native';

import { renderWithProviders } from '@/test/render';

import type { DailyMealView, ServingView } from '../api/meals-api';
import { MealCard } from '../components/meal-card';
import { MealServingsEditor } from '../components/meal-servings-editor';
import { ThuluthGuidance } from '../components/thuluth-guidance';
import {
  applyPendingServingWrites,
  cardServings,
  isFullyLogged,
  pendingServingWrites,
  pickNextMeal,
  portionLabel,
  servingsForBulkLog,
  sortMeals,
  type MemberLite,
} from '../utils/meal-rules';
import { swapAccess } from '../utils/swap-rules';

const ADULT: MemberLite = { id: 'm-adult', name: 'Ayesha', lifeStage: 'adult', specialModules: [] };
const CHILD: MemberLite = {
  id: 'm-child',
  name: 'Ibrahim',
  lifeStage: 'child',
  specialModules: [],
};
const MEMBERS = new Map([
  [ADULT.id, ADULT],
  [CHILD.id, CHILD],
]);

function serving(patch: Partial<ServingView>): ServingView {
  return {
    id: 's',
    dailyMealId: 'dm',
    familyMemberId: ADULT.id,
    status: 'planned',
    acceptance: null,
    adaptation: 'none',
    adaptedMeal: null,
    portion: null,
    loggedAt: null,
    updatedAt: '2026-10-06T00:00:00Z',
    ...patch,
  };
}

function meal(patch: Partial<DailyMealView>): DailyMealView {
  return {
    id: 'dm',
    mealPlanId: 'p',
    householdId: 'h',
    planDate: '2026-10-06',
    mealType: 'lunch',
    slot: 1,
    scheduledTime: '13:00:00',
    notes: null,
    swappedFromMealId: null,
    meal: {
      id: 'meal',
      title: 'Masoor daal with rice',
      titleI18n: { en: 'Masoor daal with rice' },
      mealType: 'lunch',
      plateSplit: { veg_fruit: 50, protein: 25, carb: 25 },
      components: [],
    },
    servings: [
      serving({ id: 's-adult', familyMemberId: ADULT.id }),
      serving({ id: 's-child', familyMemberId: CHILD.id }),
    ],
    ...patch,
  };
}

const NUMBERS = /\d/;
const NUMERIC_NUTRITION = /\d+\s*(g|kcal|cal|%)\b|kcal|calorie|percent|full\b/i;

type JsonNode = { children?: Array<JsonNode | string> | null } | string | null;

function collect(node: JsonNode | JsonNode[], out: string[]): string[] {
  if (Array.isArray(node)) node.forEach((n) => collect(n, out));
  else if (typeof node === 'string') out.push(node);
  else if (node?.children) collect(node.children, out);
  return out;
}

/** Every rendered string, joined. */
function allText(): string {
  return collect(screen.toJSON() as JsonNode | JsonNode[], []).join(' | ');
}

describe('ThuluthGuidance (24 S3-10)', () => {
  it('adult variant carries water timing, pace and the stop point', async () => {
    const view = await renderWithProviders(<ThuluthGuidance variant="adult" />);
    expect(screen.getByTestId('guidance.adult')).toBeTruthy();
    expect(allText()).toMatch(/20 to 30 minutes before/);
    expect(allText()).toMatch(/70 to 80 percent full/);
    expect(view.toJSON()).toMatchSnapshot();
  });

  it('child variant never mentions restriction or numbers', async () => {
    const view = await renderWithProviders(<ThuluthGuidance variant="child" />);
    const text = allText();
    expect(text).not.toMatch(NUMBERS);
    expect(text).not.toMatch(/stop|full|percent|limit|less|restrict|calorie|kcal/i);
    expect(text).toMatch(/Seconds are welcome/);
    expect(view.toJSON()).toMatchSnapshot();
  });

  it('child variant has no numbers in Urdu either', async () => {
    await renderWithProviders(<ThuluthGuidance variant="child" />, { locale: 'ur' });
    expect(allText()).not.toMatch(/[\d۰-۹٠-٩]/);
  });
});

describe('children never see numbers (02 §1.1)', () => {
  const portion = (lifeStage: 'adult' | 'child') => ({
    householdMeasure: lifeStage === 'child' ? 'Half a katori' : 'One katori',
    householdMeasureI18n: {},
    grams: lifeStage === 'child' ? 85 : 180,
    kcal: lifeStage === 'child' ? 120 : 260,
    lifeStage,
  });

  it('serving rows show household measures only, never grams or kcal', async () => {
    const m = meal({
      servings: [
        serving({ id: 's-adult', familyMemberId: ADULT.id, portion: portion('adult') }),
        serving({
          id: 's-child',
          familyMemberId: CHILD.id,
          portion: portion('child'),
          status: 'eaten',
          loggedAt: '2026-10-06T08:00:00Z',
        }),
      ],
    });
    await renderWithProviders(
      <MealServingsEditor
        meal={m}
        members={MEMBERS}
        queuedIds={new Set()}
        disabled={false}
        onStatus={jest.fn()}
        onAcceptance={jest.fn()}
        testID="servings"
      />,
    );
    const text = allText();
    expect(text).toContain('Half a katori');
    expect(text).not.toMatch(NUMERIC_NUTRITION);
    expect(text).not.toMatch(/85|120|180|260/);
    expect(screen.getByText('Seconds welcome')).toBeTruthy();
    // Acceptance words, not scores, for the logged child.
    expect(screen.getByText('Not today')).toBeTruthy();
    expect(screen.getByText('Ate well')).toBeTruthy();
  });

  it('portionLabel never formats grams or kcal', () => {
    expect(portionLabel(portion('child'), 'en')).toBe('Half a katori');
    expect(
      portionLabel({ householdMeasure: 'x', householdMeasureI18n: { ur: 'آدھی کٹوری' } }, 'ur'),
    ).toBe('آدھی کٹوری');
    expect(portionLabel(null, 'en')).toBeNull();
  });

  it('meal cards carry no nutrition numbers', async () => {
    const m = meal({});
    await renderWithProviders(
      <MealCard
        mealType={m.mealType}
        title={m.meal.title}
        scheduledTime={m.scheduledTime}
        plateSplit={m.meal.plateSplit}
        servings={cardServings(m, MEMBERS, new Map())}
        onPress={jest.fn()}
        testID="card"
      />,
    );
    expect(allText()).not.toMatch(NUMERIC_NUTRITION);
  });
});

describe('meal logging (24 S3-12)', () => {
  it('acceptance picker only appears for children', async () => {
    const m = meal({
      servings: [
        serving({ id: 's-adult', familyMemberId: ADULT.id, status: 'eaten', loggedAt: 'x' }),
        serving({ id: 's-child', familyMemberId: CHILD.id, status: 'eaten', loggedAt: 'x' }),
      ],
    });
    const onAcceptance = jest.fn();
    await renderWithProviders(
      <MealServingsEditor
        meal={m}
        members={MEMBERS}
        queuedIds={new Set()}
        disabled={false}
        onStatus={jest.fn()}
        onAcceptance={onAcceptance}
        testID="servings"
      />,
    );
    await fireEvent.press(await screen.findByTestId('servings.row-1.acceptance.3_tasted'));
    expect(screen.queryByTestId('servings.row-0.acceptance')).toBeNull();
    expect(onAcceptance).toHaveBeenCalledWith(m.servings[1], CHILD, '3_tasted');
  });

  it('status chips call back with the picked status and revert on a second tap', async () => {
    const onStatus = jest.fn();
    const m = meal({
      servings: [
        serving({ id: 's-adult', familyMemberId: ADULT.id, status: 'eaten', loggedAt: 'x' }),
      ],
    });
    await renderWithProviders(
      <MealServingsEditor
        meal={m}
        members={MEMBERS}
        queuedIds={new Set(['s-adult'])}
        disabled={false}
        onStatus={onStatus}
        onAcceptance={jest.fn()}
        testID="servings"
      />,
    );
    expect(screen.getByTestId('servings.row-0.queued')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('servings.row-0.status.skipped'));
    expect(onStatus).toHaveBeenLastCalledWith(m.servings[0], ADULT, 'skipped');
    await fireEvent.press(screen.getByTestId('servings.row-0.status.eaten'));
    expect(onStatus).toHaveBeenLastCalledWith(m.servings[0], ADULT, 'planned');
  });

  it('overlays queued writes on server rows', () => {
    const m = meal({});
    const pending = pendingServingWrites([
      {
        id: 'k1',
        kind: 'serving.status',
        scope: 'household:h',
        dedupeKey: 's-child',
        payload: {
          servingId: 's-child',
          householdId: 'h',
          status: 'eaten',
          acceptance: '4_ate_some',
          at: '2026-10-06T12:00:00Z',
        },
        createdAt: 0,
        attempts: 0,
        nextAttemptAt: 0,
        lastErrorCode: null,
      },
    ]);
    const [out] = applyPendingServingWrites([m], pending);
    expect(out?.servings[1]).toMatchObject({ status: 'eaten', acceptance: '4_ate_some' });
    expect(out?.servings[0]?.status).toBe('planned');
    expect(m.servings[1]?.status).toBe('planned'); // input untouched
    expect(cardServings(out as DailyMealView, MEMBERS, pending).map((s) => s.queued)).toEqual([
      false,
      true,
    ]);
  });

  it('"Everyone ate" targets only servings not logged yet', () => {
    const m = meal({
      servings: [serving({ id: 'a', status: 'skipped', loggedAt: 'x' }), serving({ id: 'b' })],
    });
    expect(servingsForBulkLog(m).map((s) => s.id)).toEqual(['b']);
    expect(isFullyLogged(m)).toBe(false);
  });

  it('orders the day and picks the next meal', () => {
    const breakfast = meal({ id: 'b', mealType: 'breakfast', scheduledTime: '08:00:00' });
    const lunch = meal({ id: 'l', mealType: 'lunch', scheduledTime: '13:00:00' });
    const dinner = meal({ id: 'd', mealType: 'dinner', scheduledTime: null });
    expect(sortMeals([dinner, lunch, breakfast]).map((m) => m.id)).toEqual(['b', 'l', 'd']);
    expect(pickNextMeal([breakfast, lunch, dinner], 7 * 60)?.id).toBe('b');
    expect(pickNextMeal([breakfast, lunch, dinner], 12 * 60 + 30)?.id).toBe('l');
    // Breakfast was missed long ago: the next upcoming meal wins.
    expect(pickNextMeal([breakfast, lunch, dinner], 15 * 60)?.id).toBe('d');
  });
});

describe('swap gating (24 S3-13)', () => {
  it('free users get the upsell, premium users get AI, the flag is a kill switch', () => {
    expect(swapAccess({ premium: false, aiFlag: true, serverSaidPremiumRequired: false })).toBe(
      'upsell',
    );
    expect(swapAccess({ premium: true, aiFlag: true, serverSaidPremiumRequired: false })).toBe(
      'ai',
    );
    expect(swapAccess({ premium: true, aiFlag: false, serverSaidPremiumRequired: false })).toBe(
      'disabled',
    );
  });

  it('a PREMIUM_REQUIRED answer from the server wins over the client', () => {
    expect(swapAccess({ premium: true, aiFlag: true, serverSaidPremiumRequired: true })).toBe(
      'upsell',
    );
  });
});
