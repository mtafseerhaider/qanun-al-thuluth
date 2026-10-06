// tooling/scripts/gen-analytics-catalog.ts
//
// Writes supabase/seed/catalog/170_analytics_event_catalog.sql from the shared event registry
// (packages/shared/src/analytics/events.ts, 18 section 10). Fails when an event name or prop name breaks
// the 18 section 14 privacy rules.
//
//   deno run --config supabase/functions/deno.json --allow-read --allow-write tooling/scripts/gen-analytics-catalog.ts
//   ... --check   exit 1 if the committed seed is stale (CI)
import { catalogSeedSql, catalogViolations } from '../../packages/shared/src/analytics/catalog.ts';

const out = new URL('../../supabase/seed/catalog/170_analytics_event_catalog.sql', import.meta.url);
const problems = catalogViolations();
if (problems.length) {
  console.error(problems.join('\n'));
  Deno.exit(1);
}
const sql = catalogSeedSql();
if (Deno.args.includes('--check')) {
  const current = await Deno.readTextFile(out).catch(() => '');
  if (current !== sql) {
    console.error(
      '170_analytics_event_catalog.sql is stale: run tooling/scripts/gen-analytics-catalog.ts',
    );
    Deno.exit(1);
  }
  console.log('analytics catalog seed is up to date');
} else {
  await Deno.writeTextFile(out, sql);
  console.log(`wrote ${out.pathname}`);
}
