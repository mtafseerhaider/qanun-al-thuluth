/**
 * `pnpm knowledge:embed` (13 §9.3, S2-12): embeds verified islamic_sources and verified
 * recommendations whose embedding is null, through the `embed.knowledge` route (1536-d).
 * Runs with the service role against one environment; also run nightly by a scheduled workflow.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY (the route's provider key).
 * Flags: --dry-run (list what would be embedded), --fake (FakeProvider vectors, for local stacks).
 */
import { randomUUID } from 'node:crypto';

import { postgrestKnowledgeStore, postgrestRouteLoader } from '../src/knowledge/postgrest-store.ts';
import { runKnowledgeEmbedJob } from '../src/knowledge/job.ts';
import { FakeProvider } from '../src/providers/fake.ts';
import { OpenAiProvider } from '../src/providers/openai.ts';
import { RouteResolver } from '../src/router/route-resolver.ts';
import { requireEnv } from '../src/runtime/env.ts';

const args = process.argv.slice(2);
const cfg = {
  url: requireEnv('SUPABASE_URL'),
  serviceKey: requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
};
const store = postgrestKnowledgeStore(cfg);

if (args.includes('--dry-run')) {
  const [sources, recs] = await Promise.all([
    store.pendingSources(1000),
    store.pendingRecommendations(1000),
  ]);
  console.log(`Would embed ${sources.length} sources and ${recs.length} recommendations.`);
  process.exit(0);
}

const provider = args.includes('--fake')
  ? new FakeProvider({ id: 'openai' })
  : new OpenAiProvider();
const result = await runKnowledgeEmbedJob(
  store,
  {
    fallback: {
      resolver: new RouteResolver(postgrestRouteLoader(cfg)),
      providers: { openai: provider },
    },
  },
  {
    requestId: randomUUID(),
    userId: 'system:knowledge-embed',
    householdId: null,
    promptKey: 'knowledge.embed',
    promptVersion: 1,
    tier: 'premium',
  },
);
console.log(
  `Embedded ${result.sources} sources and ${result.recommendations} recommendations (${result.skipped} skipped).`,
);
