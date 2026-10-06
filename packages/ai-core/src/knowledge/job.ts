import type { RequestMetadata } from '../types.ts';
import { embedTexts, MAX_EMBED_CHARS } from './embed.ts';
import type { EmbedDeps } from './embed.ts';

/**
 * `pnpm knowledge:embed` (13 §9.3, S2-12): embeds verified `islamic_sources` and verified
 * `recommendations` whose embedding is null (a trigger nulls it when an embedded field changes).
 * Unverified, in-review, rejected and retracted rows are never embedded.
 */

export interface SourceForEmbedding {
  id: string;
  code: string;
  citation_text: string;
  topic_tags: string[];
  verification_status: string;
  retracted_at: string | null;
  /** English translation of the underlying text (Arabic is not embedded in v1). */
  translation_en: string | null;
  food_labels: string[];
  recommendation_titles: string[];
}

export interface RecommendationForEmbedding {
  id: string;
  code: string;
  review_status: string;
  title_en: string;
  practical_en: string;
  applies_to: Record<string, unknown>;
}

export interface KnowledgeEmbedStore {
  pendingSources(limit: number): Promise<SourceForEmbedding[]>;
  pendingRecommendations(limit: number): Promise<RecommendationForEmbedding[]>;
  saveSourceEmbedding(id: string, vector: number[]): Promise<void>;
  saveRecommendationEmbedding(id: string, vector: number[]): Promise<void>;
}

/** 13 §9.3: citation, topic tags, English translation, food labels, linked recommendation titles. */
export function sourceEmbeddingText(s: SourceForEmbedding): string {
  return [
    s.citation_text,
    s.topic_tags.join(', '),
    s.translation_en ?? '',
    s.food_labels.join(', '),
    s.recommendation_titles.join('; '),
  ]
    .join('\n')
    .slice(0, MAX_EMBED_CHARS);
}

/** Same shape for recommendations: title, practical text and who it applies to. */
export function recommendationEmbeddingText(r: RecommendationForEmbedding): string {
  const applies = Object.entries(r.applies_to)
    .filter(([, v]) => Array.isArray(v) && v.length)
    .map(([k, v]) => `${k}: ${(v as unknown[]).join(', ')}`)
    .join('; ');
  return [r.title_en, r.practical_en, applies].join('\n').slice(0, MAX_EMBED_CHARS);
}

export function isEmbeddableSource(s: SourceForEmbedding): boolean {
  return s.verification_status === 'verified' && s.retracted_at === null;
}

export function isEmbeddableRecommendation(r: RecommendationForEmbedding): boolean {
  return r.review_status === 'verified';
}

export interface EmbedJobResult {
  sources: number;
  recommendations: number;
  skipped: number;
}

function at(vectors: number[][], i: number): number[] {
  const v = vectors[i];
  if (!v) throw new Error(`Missing embedding for input ${i}`);
  return v;
}

export async function runKnowledgeEmbedJob(
  store: KnowledgeEmbedStore,
  deps: EmbedDeps,
  metadata: RequestMetadata,
  opts: { batchSize?: number; maxBatches?: number } = {},
): Promise<EmbedJobResult> {
  const batchSize = opts.batchSize ?? 64;
  const maxBatches = opts.maxBatches ?? 100;
  const result: EmbedJobResult = { sources: 0, recommendations: 0, skipped: 0 };

  for (let i = 0; i < maxBatches; i++) {
    const rows = await store.pendingSources(batchSize);
    const ok = rows.filter(isEmbeddableSource);
    result.skipped += rows.length - ok.length;
    if (!ok.length) break;
    const { vectors } = await embedTexts(ok.map(sourceEmbeddingText), metadata, deps);
    for (const [j, row] of ok.entries()) await store.saveSourceEmbedding(row.id, at(vectors, j));
    result.sources += ok.length;
    if (rows.length < batchSize) break;
  }

  for (let i = 0; i < maxBatches; i++) {
    const rows = await store.pendingRecommendations(batchSize);
    const ok = rows.filter(isEmbeddableRecommendation);
    result.skipped += rows.length - ok.length;
    if (!ok.length) break;
    const { vectors } = await embedTexts(ok.map(recommendationEmbeddingText), metadata, deps);
    for (const [j, row] of ok.entries())
      await store.saveRecommendationEmbedding(row.id, at(vectors, j));
    result.recommendations += ok.length;
    if (rows.length < batchSize) break;
  }
  return result;
}
