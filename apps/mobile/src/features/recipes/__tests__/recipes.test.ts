import { parseNutrition, parseSteps, toRecipeView } from '../api/recipes-api';
import {
  clampServings,
  defaultServings,
  formatQuantity,
  roundQuantity,
  scaleFactor,
  scaleQuantity,
} from '../utils/scaling';

describe('recipe scaling (24 S3-09)', () => {
  it('defaults to the family size and scales linearly (4 to 6 is x1.5)', () => {
    expect(defaultServings(6, 4)).toBe(6);
    expect(defaultServings(0, 4)).toBe(4);
    expect(scaleFactor(4, 6)).toBe(1.5);
    expect(scaleQuantity(2, 1.5)).toBe(3);
    expect(scaleQuantity(1, 1.5)).toBe(1.5);
    expect(scaleQuantity(250, 1.5)).toBe(375);
  });

  it('rounds to kitchen-friendly amounts', () => {
    expect(roundQuantity(0.1)).toBe(0.25);
    expect(roundQuantity(1.3)).toBe(1.25);
    expect(roundQuantity(12.4)).toBe(12);
    expect(roundQuantity(123)).toBe(125);
    expect(formatQuantity(1.5)).toBe('1½');
    expect(formatQuantity(0.75)).toBe('¾');
    expect(formatQuantity(3)).toBe('3');
  });

  it('keeps the stepper within bounds', () => {
    expect(clampServings(0)).toBe(1);
    expect(clampServings(99)).toBe(24);
    expect(clampServings(Number.NaN)).toBe(1);
    expect(scaleFactor(0, 4)).toBe(1);
  });
});

describe('recipe parsing', () => {
  it('orders steps and reads the nutrition json', () => {
    const steps = parseSteps([
      { n: 2, text_i18n: { en: 'Simmer' } },
      { n: 1, text_i18n: { en: 'Boil' }, timer_min: 25 },
      'junk',
    ]);
    expect(steps.map((s) => s.n)).toEqual([1, 2]);
    expect(steps[0]?.timerMin).toBe(25);
    expect(parseNutrition({ kcal: 261.5, protein_g: 12.5 })).toMatchObject({
      kcal: 261.5,
      proteinG: 12.5,
      fatG: null,
    });
  });

  it('sorts ingredients and defaults unknown halal states safely', () => {
    const view = toRecipeView({
      id: 'r',
      title: 'Masoor daal',
      title_i18n: {},
      servings: 4,
      prep_min: 10,
      cook_min: 30,
      steps: [],
      per_serving_nutrition: {},
      kid_friendly: true,
      autism_friendly: false,
      ramadan_suitable: false,
      review_status: 'verified',
      source: 'curated',
      recipe_ingredients: [
        {
          id: 'b',
          ingredient_id: 'i2',
          quantity: 1,
          unit: 'tsp',
          grams: 3,
          optional: false,
          prep_note: null,
          sort_order: 2,
          ingredient: { name: 'Salt', name_i18n: {}, halal_status: 'odd', is_sunnah_food: false },
        },
        {
          id: 'a',
          ingredient_id: 'i1',
          quantity: 1,
          unit: 'cup',
          grams: 200,
          optional: false,
          prep_note: null,
          sort_order: 1,
          ingredient: {
            name: 'Lentils',
            name_i18n: {},
            halal_status: 'halal',
            is_sunnah_food: false,
          },
        },
      ],
      portions: [],
    });
    expect(view.ingredients.map((i) => i.name)).toEqual(['Lentils', 'Salt']);
    expect(view.ingredients[1]?.halalStatus).toBe('halal');
  });
});
