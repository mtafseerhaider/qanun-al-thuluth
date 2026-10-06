import type { SourceTradition } from '@thuluth/shared';

import type { RequestMetadata } from '../types.ts';
import { embedTexts, vectorLiteral } from './embed.ts';
import type { EmbedDeps } from './embed.ts';

/**
 * Knowledge retrieval client (FR-ISL-02, FR-AI-05, 12 §4.2). Hard filters live in SQL:
 * `match_knowledge()` returns only citable sources (verified, two approvals, not retracted) and
 * verified recommendations; `search_islamic_sources()` is the hybrid source search. This client
 * embeds the query and picks the tradition set.
 */

export type TraditionPreference = 'shared' | 'sunni' | 'shia';

/**
 * 12 §4.2 table: `shared` users see shared rows only, plus a tradition's rows when they explicitly
 * ask for that tradition; `sunni` and `shia` users see shared plus their own.
 */
export function traditionsFor(
  preference: TraditionPreference,
  override?: 'sunni' | 'shia' | undefined,
): SourceTradition[] {
  if (override) return ['shared', override];
  return preference === 'shared' ? ['shared'] : ['shared', preference];
}

export type KnowledgeItemKind = 'source' | 'recommendation';

/** A `match_knowledge()` row (DB lane, S2-12). */
export interface KnowledgeMatch {
  item_kind: KnowledgeItemKind;
  item_id: string;
  code: string;
  traditions: SourceTradition[];
  label: string;
  similarity: number;
}

/** A `search_islamic_sources()` row (05 §22.5). */
export interface SourceHit {
  islamic_source_id: string;
  code: string;
  kind: 'quran' | 'hadith' | 'imam_narration' | 'scholarly';
  tradition: SourceTradition;
  citation_text: string;
  score: number;
}

/** RPC calls, made with the caller's JWT client so RLS applies. */
export interface KnowledgeRpc {
  matchKnowledge(args: {
    p_query_embedding: string;
    p_traditions: SourceTradition[];
    p_match_count: number;
    p_item_kinds: KnowledgeItemKind[] | null;
  }): Promise<KnowledgeMatch[]>;
  searchIslamicSources(args: {
    p_query_embedding: string;
    p_query_text: string;
    p_traditions: SourceTradition[];
    p_kinds: SourceHit['kind'][] | null;
    p_limit: number;
  }): Promise<SourceHit[]>;
}

export interface RetrieveArgs {
  query: string;
  preference: TraditionPreference;
  traditionOverride?: 'sunni' | 'shia' | undefined;
  limit?: number | undefined;
}

export class KnowledgeRetriever {
  readonly #rpc: KnowledgeRpc;
  readonly #deps: EmbedDeps;
  readonly #cache = new Map<string, string>();

  constructor(rpc: KnowledgeRpc, deps: EmbedDeps) {
    this.#rpc = rpc;
    this.#deps = deps;
  }

  /** Query embedding, cached per isolate (cost lever "embedding cache", 01 §9.8). */
  async #embed(query: string, metadata: RequestMetadata): Promise<string> {
    const key = query.trim().toLowerCase();
    const hit = this.#cache.get(key);
    if (hit) return hit;
    const { vectors } = await embedTexts([query], metadata, this.#deps);
    const literal = vectorLiteral(vectors[0] ?? []);
    if (this.#cache.size > 500) this.#cache.clear();
    this.#cache.set(key, literal);
    return literal;
  }

  /** Semantic match over sources and recommendations. */
  async match(
    args: RetrieveArgs & { itemKinds?: KnowledgeItemKind[] | undefined },
    metadata: RequestMetadata,
  ): Promise<KnowledgeMatch[]> {
    const allowed = traditionsFor(args.preference, args.traditionOverride);
    const rows = await this.#rpc.matchKnowledge({
      p_query_embedding: await this.#embed(args.query, metadata),
      p_traditions: allowed,
      p_match_count: Math.min(Math.max(args.limit ?? 8, 1), 20),
      p_item_kinds: args.itemKinds ?? null,
    });
    // Defence in depth: drop anything outside the allowed traditions even if SQL changes.
    return rows.filter((r) => r.traditions.some((t) => allowed.includes(t)));
  }

  /** Hybrid (semantic + lexical, RRF) source search for the `search_islamic_sources` tool. */
  async searchSources(
    args: RetrieveArgs & { kinds?: SourceHit['kind'][] | undefined },
    metadata: RequestMetadata,
  ): Promise<SourceHit[]> {
    const allowed = traditionsFor(args.preference, args.traditionOverride);
    const rows = await this.#rpc.searchIslamicSources({
      p_query_embedding: await this.#embed(args.query, metadata),
      p_query_text: args.query,
      p_traditions: allowed,
      p_kinds: args.kinds ?? null,
      p_limit: Math.min(Math.max(args.limit ?? 5, 1), 8),
    });
    return rows.filter((r) => allowed.includes(r.tradition));
  }
}
