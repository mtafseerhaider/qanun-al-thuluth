import { parseInsights, pct, trend } from '../utils/insights-rules';

describe('insights rules', () => {
  it('parses and sorts view rows, dropping malformed ones', () => {
    const rows = parseInsights([
      {
        week: '2026-10-05T00:00:00Z',
        meal_adherence: '0.8',
        hydration_ratio: null,
        new_foods_accepted: 2,
      },
      { week: '2026-09-28', meal_adherence: 0.6 },
      { nope: true },
      null,
    ]);
    expect(rows.map((r) => r.week)).toEqual(['2026-09-28', '2026-10-05']);
    expect(rows[1]).toEqual({
      week: '2026-10-05',
      mealAdherence: 0.8,
      hydrationRatio: null,
      adultThuluthAvg: null,
      newFoodsAccepted: 2,
    });
    expect(rows[0]?.newFoodsAccepted).toBe(0);
    expect(parseInsights('x')).toEqual([]);
  });

  it('formats percentages and trends', () => {
    expect(pct(0.456)).toBe(46);
    expect(pct(1.4)).toBe(100);
    expect(pct(null)).toBeNull();
    expect(trend([0.5, 0.5, 0.7])).toBe('up');
    expect(trend([0.7, 0.72])).toBe('flat');
    expect(trend([60, 40])).toBe('down');
    expect(trend([null, 0.5])).toBe('unknown');
  });
});
