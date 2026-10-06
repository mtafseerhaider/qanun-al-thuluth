import type {
  EvidenceGradeHadith,
  EvidenceGradeScience,
  SourceKind,
  SourceTradition,
} from '@shared';

import { AppError } from '@/lib/supabase/app-error';
import { supabase } from '@/lib/supabase/client';
import { toDbAppError } from '@/lib/supabase/error-mapping';

import {
  pickLocale,
  type EvidenceView,
  type RecommendationView,
  type Relationship,
  type SourceView,
} from '../utils/knowledge-rules';

/**
 * Knowledge reads (13 §5.4, 02 §7.7.5). Islamic sources are read only through the verified view
 * `islamic_sources_public`; text rows (Qur'an, hadith, Imam narrations) are fetched by the ref ids
 * the view returned, so an unverified or withdrawn source never renders.
 */
function client() {
  if (!supabase) throw new AppError('NOT_CONFIGURED', 'Supabase is not configured.');
  return supabase;
}

interface PublicSourceRow {
  id: string;
  kind: SourceKind;
  ref_id: string | null;
  tradition: SourceTradition;
  citation_text: string;
}

interface TextRow {
  id: string;
  arabic_text: string;
  translation_i18n: unknown;
  translator?: string | null;
  grade?: EvidenceGradeHadith | null;
  graded_by?: string | null;
}

const TEXT_TABLE = {
  quran: 'quran_references',
  hadith: 'hadith_references',
  imam_narration: 'imam_narrations',
} as const;

const TEXT_COLUMNS = {
  quran: 'id, arabic_text, translation_i18n, translator',
  hadith: 'id, arabic_text, translation_i18n, grade, graded_by',
  imam_narration: 'id, arabic_text, translation_i18n, grade, graded_by',
} as const;

/** Verified sources by id with their text and latest verification, in the given locale. */
export async function fetchPublicSources(
  links: ReadonlyArray<{ id: string; relationship: Relationship }>,
  locale: string,
): Promise<SourceView[]> {
  if (links.length === 0) return [];
  const ids = links.map((l) => l.id);
  const { data, error } = await client()
    .from('islamic_sources_public')
    .select('id, kind, ref_id, tradition, citation_text')
    .in('id', ids);
  if (error) throw toDbAppError(error);
  const rows = (data ?? []) as unknown as PublicSourceRow[];

  const texts = new Map<string, TextRow>();
  for (const kind of ['quran', 'hadith', 'imam_narration'] as const) {
    const refIds = rows.filter((r) => r.kind === kind && r.ref_id).map((r) => r.ref_id as string);
    if (refIds.length === 0) continue;
    const res = await client().from(TEXT_TABLE[kind]).select(TEXT_COLUMNS[kind]).in('id', refIds);
    if (res.error) throw toDbAppError(res.error);
    for (const t of (res.data ?? []) as unknown as TextRow[]) texts.set(t.id, t);
  }

  const { data: verData, error: verError } = await client()
    .from('source_verifications')
    .select('islamic_source_id, reviewer_name, reviewed_on')
    .eq('status', 'verified')
    .in('islamic_source_id', ids)
    .order('reviewed_on', { ascending: false });
  if (verError) throw toDbAppError(verError);
  const verified = new Map<string, { name: string; on: string }>();
  for (const v of (verData ?? []) as Array<{
    islamic_source_id: string;
    reviewer_name: string;
    reviewed_on: string;
  }>)
    if (!verified.has(v.islamic_source_id))
      verified.set(v.islamic_source_id, { name: v.reviewer_name, on: v.reviewed_on });

  return rows.map((r) => {
    const text = r.ref_id ? texts.get(r.ref_id) : undefined;
    return {
      id: r.id,
      kind: r.kind,
      tradition: r.tradition,
      citationText: r.citation_text,
      relationship: links.find((l) => l.id === r.id)?.relationship ?? 'supports',
      grade: text?.grade ?? null,
      gradedBy: text?.graded_by ?? null,
      arabicText: text?.arabic_text ?? null,
      translation: text ? pickLocale(text.translation_i18n, locale) || null : null,
      translator: text?.translator ?? null,
      verifiedBy: verified.get(r.id) ?? null,
    };
  });
}

interface EvidenceRow {
  id: string;
  title: string;
  citation: string;
  study_type: string;
  grade: EvidenceGradeScience;
  summary: string;
  population: string | null;
  doi: string | null;
  pmid: string | null;
}

export async function fetchEvidence(
  links: ReadonlyArray<{ id: string; relationship: Relationship }>,
): Promise<EvidenceView[]> {
  if (links.length === 0) return [];
  const { data, error } = await client()
    .from('scientific_evidence')
    .select('id, title, citation, study_type, grade, summary, population, doi, pmid')
    .in(
      'id',
      links.map((l) => l.id),
    );
  if (error) throw toDbAppError(error);
  return ((data ?? []) as unknown as EvidenceRow[]).map((e) => ({
    id: e.id,
    title: e.title,
    citation: e.citation,
    studyType: e.study_type,
    grade: e.grade,
    summary: e.summary,
    population: e.population,
    doi: e.doi,
    pmid: e.pmid,
    relationship: links.find((l) => l.id === e.id)?.relationship ?? 'supports',
  }));
}

/**
 * A published recommendation with its three parts, or null when it is not verified (RLS hides it)
 * or does not exist.
 */
export async function fetchRecommendation(
  id: string,
  locale: string,
): Promise<RecommendationView | null> {
  const { data, error } = await client()
    .from('recommendations')
    .select('id, code, title_i18n, practical_text_i18n')
    .eq('id', id)
    .eq('review_status', 'verified')
    .maybeSingle();
  if (error) throw toDbAppError(error);
  if (!data) return null;
  const rec = data as unknown as {
    id: string;
    code: string;
    title_i18n: unknown;
    practical_text_i18n: unknown;
  };
  const { data: linkData, error: linkError } = await client()
    .from('recommendation_evidence')
    .select('islamic_source_id, scientific_evidence_id, relationship')
    .eq('recommendation_id', id);
  if (linkError) throw toDbAppError(linkError);
  const links = (linkData ?? []) as Array<{
    islamic_source_id: string | null;
    scientific_evidence_id: string | null;
    relationship: Relationship;
  }>;
  const [sources, evidence] = await Promise.all([
    fetchPublicSources(
      links
        .filter((l) => l.islamic_source_id)
        .map((l) => ({ id: l.islamic_source_id as string, relationship: l.relationship })),
      locale,
    ),
    fetchEvidence(
      links
        .filter((l) => l.scientific_evidence_id)
        .map((l) => ({ id: l.scientific_evidence_id as string, relationship: l.relationship })),
    ),
  ]);
  return {
    id: rec.id,
    code: rec.code,
    title: pickLocale(rec.title_i18n, locale),
    practical: pickLocale(rec.practical_text_i18n, locale),
    sources,
    evidence,
  };
}
