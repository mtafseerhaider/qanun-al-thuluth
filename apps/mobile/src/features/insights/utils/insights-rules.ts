/**
 * Family insights (02 §7.12.6, 18 Part B; FR-INS-01; premium). Rows come from the DB lane's
 * `get_family_insights` view. Pure helpers for parsing and trend wording; tested.
 */
export interface WeeklyInsight {
  week: string;
  mealAdherence: number | null;
  hydrationRatio: number | null;
  adultThuluthAvg: number | null;
  newFoodsAccepted: number;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function parseInsights(rows: unknown): WeeklyInsight[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .flatMap((r: unknown) => {
      if (!r || typeof r !== 'object') return [];
      const o = r as Record<string, unknown>;
      if (typeof o.week !== 'string') return [];
      return [
        {
          week: o.week.slice(0, 10),
          mealAdherence: num(o.meal_adherence),
          hydrationRatio: num(o.hydration_ratio),
          adultThuluthAvg: num(o.adult_thuluth_avg),
          newFoodsAccepted: num(o.new_foods_accepted) ?? 0,
        },
      ];
    })
    .sort((a, b) => a.week.localeCompare(b.week));
}

/** Percent 0..100 from a 0..1 ratio (clamped), or null. */
export function pct(ratio: number | null): number | null {
  return ratio === null ? null : Math.round(Math.min(1, Math.max(0, ratio)) * 100);
}

export type Trend = 'up' | 'down' | 'flat' | 'unknown';

/** Last week against the mean of the earlier weeks; a change under 5 points is flat. */
export function trend(values: ReadonlyArray<number | null>): Trend {
  const v = values.filter((x): x is number => x !== null);
  if (v.length < 2) return 'unknown';
  const last = v[v.length - 1] as number;
  const before = v.slice(0, -1);
  const mean = before.reduce((a, b) => a + b, 0) / before.length;
  const diff = (last - mean) * (Math.abs(mean) <= 1 && Math.abs(last) <= 1 ? 100 : 1);
  if (Math.abs(diff) < 5) return 'flat';
  return diff > 0 ? 'up' : 'down';
}
