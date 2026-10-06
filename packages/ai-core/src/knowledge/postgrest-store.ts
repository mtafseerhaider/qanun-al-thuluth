import type { AiModelRouteRow } from '../router/route-resolver.ts';
import type { RouteKey } from '../types.ts';
import { vectorLiteral } from './embed.ts';
import type { KnowledgeEmbedStore, RecommendationForEmbedding, SourceForEmbedding } from './job.ts';

/**
 * Service-role PostgREST access for the `knowledge:embed` script (Node, no supabase-js
 * dependency). Selection filters mirror the job's own checks: verified and not retracted.
 */

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export interface PostgrestConfig {
  url: string;
  serviceKey: string;
  fetch?: Fetch;
}

type I18n = Record<string, string | { text?: string } | undefined> | null;

function en(v: I18n): string {
  const value = v?.en;
  if (typeof value === 'string') return value;
  return value?.text ?? '';
}

export function postgrest(cfg: PostgrestConfig) {
  const doFetch = cfg.fetch ?? fetch;
  const headers = {
    apikey: cfg.serviceKey,
    authorization: `Bearer ${cfg.serviceKey}`,
    'content-type': 'application/json',
  };
  async function get<T>(path: string): Promise<T> {
    const res = await doFetch(`${cfg.url}/rest/v1/${path}`, { method: 'GET', headers });
    if (!res.ok)
      throw new Error(`GET ${path.split('?')[0]} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }
  async function patch(path: string, body: unknown): Promise<void> {
    const res = await doFetch(`${cfg.url}/rest/v1/${path}`, {
      method: 'PATCH',
      headers: { ...headers, prefer: 'return=minimal' },
      body: JSON.stringify(body),
    });
    if (!res.ok)
      throw new Error(`PATCH ${path.split('?')[0]} failed: ${res.status} ${await res.text()}`);
  }
  return { get, patch };
}

const inList = (ids: readonly string[]) => `in.(${ids.join(',')})`;

export function postgrestKnowledgeStore(cfg: PostgrestConfig): KnowledgeEmbedStore {
  const db = postgrest(cfg);
  return {
    async pendingSources(limit) {
      const rows = await db.get<
        Array<{
          id: string;
          code: string;
          kind: string;
          ref_id: string | null;
          citation_text: string;
          topic_tags: string[] | null;
          verification_status: string;
          retracted_at: string | null;
        }>
      >(
        `islamic_sources?select=id,code,kind,ref_id,citation_text,topic_tags,verification_status,retracted_at` +
          `&verification_status=eq.verified&retracted_at=is.null&embedding=is.null&order=code&limit=${limit}`,
      );
      if (!rows.length) return [];
      const ids = rows.map((r) => r.id);
      const refTable: Record<string, string> = {
        quran: 'quran_references',
        hadith: 'hadith_references',
        imam_narration: 'imam_narrations',
        scholarly: 'scholarly_notes',
      };
      const translations = new Map<string, string>();
      for (const [kind, table] of Object.entries(refTable)) {
        const refIds = rows
          .filter((r) => r.kind === kind && r.ref_id)
          .map((r) => r.ref_id as string);
        if (!refIds.length) continue;
        const col = kind === 'scholarly' ? 'body_i18n' : 'translation_i18n';
        const refs = await db.get<Array<Record<string, unknown> & { id: string }>>(
          `${table}?select=id,${col}&id=${inList(refIds)}`,
        );
        for (const r of refs) translations.set(r.id, en(r[col] as I18n));
      }
      const foods = await db.get<Array<{ islamic_source_id: string; food_label: string }>>(
        `foods_in_narrations?select=islamic_source_id,food_label&islamic_source_id=${inList(ids)}`,
      );
      const links = await db.get<
        Array<{ islamic_source_id: string; recommendations: { title_i18n: I18n } | null }>
      >(
        `recommendation_evidence?select=islamic_source_id,recommendations(title_i18n)&islamic_source_id=${inList(ids)}`,
      );
      return rows.map((r): SourceForEmbedding => ({
        id: r.id,
        code: r.code,
        citation_text: r.citation_text,
        topic_tags: r.topic_tags ?? [],
        verification_status: r.verification_status,
        retracted_at: r.retracted_at,
        translation_en: r.ref_id ? (translations.get(r.ref_id) ?? null) : null,
        food_labels: foods.filter((f) => f.islamic_source_id === r.id).map((f) => f.food_label),
        recommendation_titles: links
          .filter((l) => l.islamic_source_id === r.id && l.recommendations)
          .map((l) => en(l.recommendations?.title_i18n ?? null)),
      }));
    },
    async pendingRecommendations(limit) {
      const rows = await db.get<
        Array<{
          id: string;
          code: string;
          review_status: string;
          title_i18n: I18n;
          practical_text_i18n: I18n;
          applies_to: Record<string, unknown> | null;
        }>
      >(
        `recommendations?select=id,code,review_status,title_i18n,practical_text_i18n,applies_to` +
          `&review_status=eq.verified&embedding=is.null&order=code&limit=${limit}`,
      );
      return rows.map((r): RecommendationForEmbedding => ({
        id: r.id,
        code: r.code,
        review_status: r.review_status,
        title_en: en(r.title_i18n),
        practical_en: en(r.practical_text_i18n),
        applies_to: r.applies_to ?? {},
      }));
    },
    async saveSourceEmbedding(id, vector) {
      await db.patch(`islamic_sources?id=eq.${id}`, { embedding: vectorLiteral(vector) });
    },
    async saveRecommendationEmbedding(id, vector) {
      await db.patch(`recommendations?id=eq.${id}`, { embedding: vectorLiteral(vector) });
    },
  };
}

/** Route loader for `RouteResolver` over PostgREST. */
export function postgrestRouteLoader(cfg: PostgrestConfig) {
  const db = postgrest(cfg);
  return (routeKey: RouteKey) =>
    db.get<AiModelRouteRow[]>(
      `ai_model_routes?select=route_key,provider,model,params,priority,enabled&route_key=eq.${routeKey}&enabled=eq.true&order=priority`,
    );
}
