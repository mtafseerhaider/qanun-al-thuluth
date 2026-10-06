/**
 * Lenient parsers for catalog jsonb columns (05 §7.8 `meals.components`, `meals.plate_split`).
 * Unknown shapes degrade to "nothing to show" rather than crashing a screen.
 */
export type MealComponent =
  | { kind: 'recipe'; recipeId: string; role: string }
  | { kind: 'item'; label: string; labelI18n: unknown; ingredientIds: string[]; role: string };

export function parseComponents(json: unknown): MealComponent[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((c): MealComponent[] => {
    if (!c || typeof c !== 'object') return [];
    const o = c as Record<string, unknown>;
    const role = typeof o.role === 'string' ? o.role : 'side';
    if (typeof o.recipe_id === 'string') return [{ kind: 'recipe', recipeId: o.recipe_id, role }];
    if (typeof o.label === 'string')
      return [
        {
          kind: 'item',
          label: o.label,
          labelI18n: o.label_i18n ?? null,
          ingredientIds: Array.isArray(o.ingredient_ids)
            ? o.ingredient_ids.filter((x): x is string => typeof x === 'string')
            : [],
          role,
        },
      ];
    return [];
  });
}

export function parsePlateSplit(
  json: unknown,
): { veg_fruit: number; protein: number; carb: number } | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  const n = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN);
  const split = { veg_fruit: n(o.veg_fruit), protein: n(o.protein), carb: n(o.carb) };
  return Object.values(split).every((v) => Number.isFinite(v) && v >= 0) ? split : null;
}

/** Picks the user's locale from an i18n jsonb, then English, then the fallback text. */
export function localized(json: unknown, locale: string, fallback: string): string {
  if (json && typeof json === 'object') {
    const map = json as Record<string, unknown>;
    const v = map[locale] ?? map.en;
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return fallback;
}
