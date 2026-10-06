import { assertEquals } from 'jsr:@std/assert@1';
import {
  analyticsCatalog,
  catalogSeedSql,
  catalogViolations,
} from '@thuluth/shared/analytics/catalog.ts';
import { EventSchemas } from '@thuluth/shared/analytics/events.ts';
import { TrackEventsArgs } from '@thuluth/shared/contracts/track-events.ts';

/** Prop keys per event of a registry, for comparing the shared and app copies. */
function shape(reg: Record<string, unknown>): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(reg)
      .map(([k, v]) => [k, Object.keys((v as { shape: Record<string, unknown> }).shape).sort()])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
  );
}

Deno.test('analytics catalog: the allow-list matches the shared registry', () => {
  const catalog = Object.fromEntries(analyticsCatalog().map((e) => [e.event, e.allowed_props]));
  assertEquals(catalog, shape(EventSchemas));
});

Deno.test('analytics catalog: names and props follow the 18 §14 privacy rules', () => {
  assertEquals(catalogViolations(), []);
  assertEquals(
    catalogViolations([
      { event: 'Bad-Name', allowed_props: [] },
      { event: 'x_logged', allowed_props: ['weight_kg', 'has_notes', 'child_condition'] },
    ]),
    [
      'Bad-Name: invalid event name',
      'x_logged.weight_kg: forbidden prop name (weight)',
      'x_logged.child_condition: forbidden prop name (condition)',
    ],
  );
});

// The committed seed is compared with catalogSeedSql() by `gen-analytics-catalog.ts --check` (CI step
// "Analytics catalog seed is current"), since this suite runs without --allow-read.
Deno.test(
  'analytics catalog: the seed SQL upserts every event and disables removed app events',
  () => {
    const sql = catalogSeedSql([{ event: 'app_opened', allowed_props: ['cold_start'] }]);
    assertEquals(sql.includes("('app_opened', array['cold_start']::text[], true, 'app')"), true);
    assertEquals(sql.includes("where owner = 'app' and event not in (\n  'app_opened'\n);"), true);
  },
);

Deno.test('track_events contract: batch limits and scalar props', () => {
  const ev = {
    event_id: crypto.randomUUID(),
    event: 'app_opened',
    props: { cold_start: true },
    occurred_at: '2026-10-06T08:00:00Z',
  };
  assertEquals(TrackEventsArgs.safeParse({ p_events: [ev] }).success, true);
  assertEquals(TrackEventsArgs.safeParse({ p_events: [] }).success, false);
  assertEquals(TrackEventsArgs.safeParse({ p_events: Array(51).fill(ev) }).success, false);
  assertEquals(
    TrackEventsArgs.safeParse({ p_events: [{ ...ev, props: { nested: { a: 1 } } }] }).success,
    false,
  );
});
