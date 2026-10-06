import { describe, expect, it } from 'vitest';

import {
  embedTexts,
  KnowledgeRetriever,
  recommendationEmbeddingText,
  runKnowledgeEmbedJob,
  sourceEmbeddingText,
  traditionsFor,
  vectorLiteral,
} from '../src/knowledge/index.ts';
import type {
  KnowledgeEmbedStore,
  KnowledgeMatch,
  RecommendationForEmbedding,
  SourceForEmbedding,
} from '../src/knowledge/index.ts';
import type { AiUsageInsert } from '../src/metering/usage.ts';
import { FakeProvider } from '../src/providers/fake.ts';
import { OpenAiProvider } from '../src/providers/openai.ts';
import { RouteResolver } from '../src/router/route-resolver.ts';
import { jsonFetch, params } from './helpers.ts';

const resolver = (dimensions = 1536) =>
  new RouteResolver(async () => [
    {
      route_key: 'embed.knowledge',
      provider: 'openai',
      model: 'text-embedding-3-large',
      params: { timeoutMs: 10000, dimensions },
      priority: 1,
      enabled: true,
    },
  ]);

const metadata = {
  requestId: 'r1',
  userId: 'u1',
  householdId: null,
  promptKey: 'knowledge.embed',
  promptVersion: 1,
  tier: 'premium' as const,
};

const source = (over: Partial<SourceForEmbedding> = {}): SourceForEmbedding => ({
  id: 's1',
  code: 'hadith.tirmidhi.2380',
  citation_text: "Jami' al-Tirmidhi 2380",
  topic_tags: ['moderation', 'rule_of_thirds'],
  verification_status: 'verified',
  retracted_at: null,
  translation_en: 'A third for food, a third for drink and a third for breath.',
  food_labels: [],
  recommendation_titles: ['Eat to two-thirds full'],
  ...over,
});

const rec = (over: Partial<RecommendationForEmbedding> = {}): RecommendationForEmbedding => ({
  id: 'r1',
  code: 'hydration.pre_meal_water',
  review_status: 'verified',
  title_en: 'Water before meals',
  practical_en: 'Drink a glass of water 20 to 30 minutes before lunch and dinner.',
  applies_to: { life_stages: ['adult'] },
  ...over,
});

function memoryStore(sources: SourceForEmbedding[], recs: RecommendationForEmbedding[]) {
  const saved = new Map<string, number[]>();
  const store: KnowledgeEmbedStore = {
    pendingSources: async (limit) => sources.filter((s) => !saved.has(s.id)).slice(0, limit),
    pendingRecommendations: async (limit) => recs.filter((r) => !saved.has(r.id)).slice(0, limit),
    saveSourceEmbedding: async (id, v) => void saved.set(id, v),
    saveRecommendationEmbedding: async (id, v) => void saved.set(id, v),
  };
  return { store, saved };
}

describe('knowledge embedding job (S2-12)', () => {
  it('embeds only verified, unretracted sources and verified recommendations at 1536-d', async () => {
    const fake = new FakeProvider({ id: 'openai' });
    const usage: AiUsageInsert[] = [];
    const { store, saved } = memoryStore(
      [
        source(),
        source({ id: 's2', verification_status: 'in_review' }),
        source({ id: 's3', retracted_at: '2026-10-01T00:00:00Z' }),
      ],
      [rec(), rec({ id: 'r2', review_status: 'unverified' })],
    );
    const result = await runKnowledgeEmbedJob(
      store,
      {
        fallback: { resolver: resolver(), providers: { openai: fake } },
        writeUsage: async (r) => void usage.push(r),
      },
      metadata,
      { batchSize: 10 },
    );
    expect(result).toEqual({ sources: 1, recommendations: 1, skipped: 3 });
    expect([...saved.keys()].sort()).toEqual(['r1', 's1']);
    expect(saved.get('s1')).toHaveLength(1536);
    expect(usage.map((u) => u.route_key)).toEqual(['embed.knowledge', 'embed.knowledge']);
  });

  it('builds the 13 §9.3 embedding text', () => {
    expect(sourceEmbeddingText(source())).toBe(
      "Jami' al-Tirmidhi 2380\nmoderation, rule_of_thirds\nA third for food, a third for drink and a third for breath.\n\nEat to two-thirds full",
    );
    expect(sourceEmbeddingText(source({ translation_en: 'x'.repeat(5000) })).length).toBe(2000);
    expect(recommendationEmbeddingText(rec())).toContain('life_stages: adult');
  });

  it('refuses a route configured for other dimensions', async () => {
    await expect(
      embedTexts(['x'], metadata, {
        fallback: {
          resolver: resolver(3072),
          providers: { openai: new FakeProvider({ id: 'openai' }) },
        },
      }),
    ).rejects.toThrow(/ALL_ROUTES_FAILED|All routes failed/);
  });

  it('OpenAI adapter sends dimensions and orders vectors by index', async () => {
    const fetch = jsonFetch(200, {
      data: [
        { index: 1, embedding: [0, 1] },
        { index: 0, embedding: [1, 0] },
      ],
      usage: { prompt_tokens: 7 },
    });
    const p = new OpenAiProvider({ apiKey: 'test', fetch });
    const res = await p.embed(
      { route: 'embed.knowledge', inputs: ['a', 'b'], dimensions: 2, metadata },
      'text-embedding-3-large',
      params,
    );
    expect(res.vectors).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(res.usage.inputTokens).toBe(7);
    const body = JSON.parse(String(fetch.calls[0]?.init.body));
    expect(body).toMatchObject({
      model: 'text-embedding-3-large',
      dimensions: 2,
      input: ['a', 'b'],
    });
  });
});

describe('retrieval client', () => {
  it('tradition sets follow 12 §4.2', () => {
    expect(traditionsFor('shared')).toEqual(['shared']);
    expect(traditionsFor('sunni')).toEqual(['shared', 'sunni']);
    expect(traditionsFor('shia')).toEqual(['shared', 'shia']);
    expect(traditionsFor('shared', 'shia')).toEqual(['shared', 'shia']);
  });

  it('embeds the query once, calls match_knowledge and drops other traditions', async () => {
    const fake = new FakeProvider({ id: 'openai' });
    const calls: unknown[] = [];
    const rows: KnowledgeMatch[] = [
      {
        item_kind: 'source',
        item_id: 'a',
        code: 'quran.7.31',
        traditions: ['shared'],
        label: 'Q 7:31',
        similarity: 0.9,
      },
      {
        item_kind: 'source',
        item_id: 'b',
        code: 'imam.kafi.6.1',
        traditions: ['shia'],
        label: 'al-Kafi',
        similarity: 0.8,
      },
    ];
    const retriever = new KnowledgeRetriever(
      {
        matchKnowledge: async (args) => {
          calls.push(args);
          return rows;
        },
        searchIslamicSources: async () => [],
      },
      { fallback: { resolver: resolver(), providers: { openai: fake } } },
    );
    const hits = await retriever.match(
      { query: 'moderation in eating', preference: 'sunni' },
      metadata,
    );
    expect(hits.map((h) => h.item_id)).toEqual(['a']);
    await retriever.match({ query: 'Moderation in eating ', preference: 'sunni' }, metadata);
    expect(fake.embedCalls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ p_traditions: ['shared', 'sunni'], p_match_count: 8 });
    expect(
      String((calls[0] as { p_query_embedding: string }).p_query_embedding).startsWith('['),
    ).toBe(true);
  });

  it('vector literal', () => {
    expect(vectorLiteral([0.1, -0.25])).toBe('[0.1,-0.25]');
  });
});
