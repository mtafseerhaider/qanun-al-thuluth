import type { ChatCitation } from './chat-stream';

/**
 * Citation chips (FR-CHAT-09, 13 §5.4, 02 §7.7.2): a chip renders only when its row resolves as
 * verified on the client at render time. Islamic sources must come back from
 * `islamic_sources_public`, recommendations must be `review_status = 'verified'`, and scientific
 * evidence must exist. Anything else (unverified, retracted, unknown id, still loading) shows no
 * chip, and its `[n]` marker is removed from the text so the answer never points at nothing.
 */

export interface VerifiedRefs {
  islamicSources: ReadonlySet<string>;
  recommendations: ReadonlySet<string>;
  evidence: ReadonlySet<string>;
}

export function isVerifiedCitation(c: Pick<ChatCitation, 'kind' | 'ref_id'>, v: VerifiedRefs) {
  switch (c.kind) {
    case 'islamic_source':
      return v.islamicSources.has(c.ref_id);
    case 'recommendation':
      return v.recommendations.has(c.ref_id);
    case 'scientific_evidence':
      return v.evidence.has(c.ref_id);
    default:
      return false;
  }
}

/** Verified chips, one per source (lowest marker wins), ordered by marker. */
export function visibleCitations(
  citations: readonly ChatCitation[],
  verified: VerifiedRefs,
): ChatCitation[] {
  const seen = new Set<string>();
  return [...citations]
    .sort((a, b) => a.marker - b.marker)
    .filter((c) => {
      const key = `${c.kind}:${c.ref_id}`;
      if (seen.has(key) || !isVerifiedCitation(c, verified)) return false;
      seen.add(key);
      return true;
    });
}

/** Ids to verify, grouped by kind. */
export function citationIds(citations: readonly ChatCitation[]) {
  const ids = (kind: ChatCitation['kind']) => [
    ...new Set(citations.filter((c) => c.kind === kind).map((c) => c.ref_id)),
  ];
  return {
    islamicSources: ids('islamic_source'),
    recommendations: ids('recommendation'),
    evidence: ids('scientific_evidence'),
  };
}

/**
 * Removes `[n]` markers whose citation has no verified chip. Markers of chips that do show stay, so
 * the reader can match text to source.
 */
export function stripUnverifiedMarkers(text: string, shownMarkers: ReadonlySet<number>): string {
  return text
    .replace(/\s?\[(\d{1,3})\]/g, (whole, n: string) => (shownMarkers.has(Number(n)) ? whole : ''))
    .replace(/ {2,}/g, ' ');
}

/** Source detail sheet params for a chip (the Sprint 2 sheet, X19). */
export function sourceSheetParams(c: Pick<ChatCitation, 'kind' | 'ref_id'>) {
  switch (c.kind) {
    case 'islamic_source':
      return { islamicSourceId: c.ref_id };
    case 'recommendation':
      return { recommendationId: c.ref_id };
    case 'scientific_evidence':
      return { scientificEvidenceId: c.ref_id };
  }
}
