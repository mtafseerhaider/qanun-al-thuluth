import { screen } from '@testing-library/react-native';
import type { ComponentProps } from 'react';

import { AiAnalyzeMealResponse } from '@shared/contracts';

import { renderWithProviders } from '@/test/render';

import { MealAnalysisResultScreen } from '../screens/meal-analysis-result-screen';
import { useMealAnalysisStore } from '../store/use-meal-analysis-store';
import {
  encodeWithinLimit,
  mealPhotoPath,
  PHOTO_MAX_BYTES,
  resizedDimensions,
  resizeFor,
} from '../utils/image-rules';
import {
  analysisView,
  describeItems,
  editableItems,
  estimatedNutrition,
  fullnessFor,
  mealTypeForMinutes,
} from '../utils/meal-log-rules';
import { memberAge } from '../utils/member-age';

jest.mock('expo-crypto', () => ({ randomUUID: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));

const H = '11111111-1111-4111-8111-111111111111';
const M = '22222222-2222-4222-8222-222222222222';
const LOG = '33333333-3333-4333-8333-333333333333';
const ANALYSIS = '44444444-4444-4444-8444-444444444444';

const RESULT = AiAnalyzeMealResponse.parse({
  analysis_id: ANALYSIS,
  items: [
    {
      label: 'Chapati',
      ingredient_id: null,
      recipe_id: null,
      estimated_grams: 80,
      confidence: 0.9,
    },
    {
      label: 'Chicken karahi',
      ingredient_id: null,
      recipe_id: null,
      estimated_grams: 120,
      confidence: 0.8,
    },
    { label: 'Raita?', ingredient_id: null, recipe_id: null, estimated_grams: 50, confidence: 0.3 },
  ],
  nutrition: { kcal: 640, protein_g: 32, carbs_g: 60, fiber_g: 6, fat_g: 28 },
  show_numbers: true,
  plate_split: { veg_fruit: 0.1, protein: 0.4, carb: 0.5 },
  thuluth_feedback: {
    headline: 'A hearty plate',
    points: ['Add a salad'],
    tone: 'gentle_suggestion',
  },
  overall_confidence: 0.7,
  meal_log_id: null,
});

describe('photo preparation', () => {
  it('resizes the long edge to 1280 px and leaves small photos alone', () => {
    expect(resizeFor(4032, 3024)).toEqual({ width: 1280 });
    expect(resizeFor(3024, 4032)).toEqual({ height: 1280 });
    expect(resizeFor(1000, 800)).toBeNull();
    expect(resizedDimensions(4032, 3024)).toEqual({ width: 1280, height: 960 });
  });

  it('steps JPEG quality down until the file is at most 4 MB', async () => {
    const sizes: Record<number, number> = { 0.8: 6e6, 0.7: 4.5e6, 0.6: 3.9e6 };
    const r = await encodeWithinLimit(
      async (q) => q,
      (q) => sizes[q] ?? 1,
    );
    expect(r?.quality).toBe(0.6);
    expect(
      await encodeWithinLimit(
        async (q) => q,
        () => PHOTO_MAX_BYTES + 1,
      ),
    ).toBeNull();
  });

  it('builds the meal-photos path relative to the bucket', () => {
    expect(mealPhotoPath(H, M, LOG, new Date('2027-02-10T14:00:00Z'))).toBe(
      `${H}/${M}/2027/02/${LOG}.jpg`,
    );
  });
});

describe('analysis rules', () => {
  it('starts low-confidence items unchecked', () => {
    expect(editableItems(RESULT).map((i) => i.included)).toEqual([true, true, false]);
  });

  it('never exposes numbers for children, even if the server sends them', () => {
    const view = analysisView(RESULT, true);
    expect(view.showNumbers).toBe(false);
    expect(view.nutrition).toBeNull();
    const stored = estimatedNutrition(RESULT, editableItems(RESULT), true);
    expect(stored).not.toHaveProperty('kcal');
    expect(stored).not.toHaveProperty('protein_g');
    expect(JSON.stringify(stored)).not.toMatch(/grams/);
    expect(fullnessFor(true, 6)).toBeNull();
  });

  it('respects the server flag for adults too', () => {
    expect(analysisView({ ...RESULT, show_numbers: false }, false).nutrition).toBeNull();
  });

  it('scales adult numbers by the corrected grams', () => {
    const items = editableItems(RESULT).map((i) => (i.key === 'item-1' ? { ...i, grams: 60 } : i));
    const stored = estimatedNutrition(RESULT, items, false);
    // Kept: 80 + 60 = 140 g of an original 250 g.
    expect(stored.kcal).toBeCloseTo(640 * (140 / 250), 1);
    expect(fullnessFor(false, 12)).toBe(10);
  });

  it('describes the kept foods and the note', () => {
    expect(describeItems(editableItems(RESULT), 'home-made')).toBe(
      'Chapati, Chicken karahi · home-made',
    );
  });

  it('defaults the meal type by time', () => {
    expect(mealTypeForMinutes(8 * 60)).toBe('breakfast');
    expect(mealTypeForMinutes(13 * 60)).toBe('lunch');
    expect(mealTypeForMinutes(20 * 60)).toBe('dinner');
    expect(mealTypeForMinutes(4 * 60, true)).toBe('suhoor');
  });

  it('computes minor status from the date of birth', () => {
    expect(memberAge({ date_of_birth: '2016-05-01', life_stage: 'child' }, '2026-10-06')).toEqual({
      ageYears: 10,
      minor: true,
    });
  });
});

describe('MealAnalysisResultScreen', () => {
  const props = {
    route: { params: { analysisId: ANALYSIS } },
    navigation: { goBack: jest.fn(), navigate: jest.fn() },
  } as unknown as ComponentProps<typeof MealAnalysisResultScreen>;

  const put = (minor: boolean) =>
    useMealAnalysisStore.getState().put({
      analysisId: ANALYSIS,
      mealLogId: LOG,
      householdId: H,
      memberId: M,
      minor,
      mealType: 'lunch',
      eatenAt: '2026-10-06T08:00:00.000Z',
      note: '',
      photoUri: 'file:///photo.jpg',
      photoPath: `${H}/${M}/2026/10/${LOG}.jpg`,
      result: RESULT,
      sessionId: null,
    });

  beforeEach(() => useMealAnalysisStore.getState().reset());

  it('shows no kcal, macros, grams or fullness for a child', async () => {
    put(true);
    await renderWithProviders(<MealAnalysisResultScreen {...props} />);
    expect(screen.getByText('Chapati')).toBeTruthy();
    expect(screen.queryByText(/kcal/)).toBeNull();
    expect(screen.queryByText(/Protein/)).toBeNull();
    expect(screen.queryByText(/About \d+ g/)).toBeNull();
    expect(screen.queryByTestId('meal-analysis.item-0.grams')).toBeNull();
    expect(screen.queryByText('How full after?')).toBeNull();
    expect(screen.getByText(/we show the foods, not numbers/)).toBeTruthy();
  });

  it('shows the estimate for an adult', async () => {
    put(false);
    await renderWithProviders(<MealAnalysisResultScreen {...props} />);
    expect(screen.getByText(/kcal/)).toBeTruthy();
  });
});
