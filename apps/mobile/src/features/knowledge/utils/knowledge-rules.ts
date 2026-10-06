import type {
  EvidenceGradeHadith,
  EvidenceGradeScience,
  SourceKind,
  SourceTradition,
} from '@shared';

/**
 * Display rules for the three-part recommendation (13 §5 to §7). Pure so they are unit-tested.
 * Only rows read from `islamic_sources_public` (verified, two approvals, not retracted) ever reach
 * these functions; the rules below narrow further by tradition and grade.
 */

export type Relationship = 'supports' | 'context' | 'caution';

export interface SourceView {
  id: string;
  kind: SourceKind;
  tradition: SourceTradition;
  citationText: string;
  relationship: Relationship;
  grade: EvidenceGradeHadith | null;
  gradedBy: string | null;
  arabicText: string | null;
  translation: string | null;
  translator: string | null;
  verifiedBy: { name: string; on: string } | null;
}

export interface EvidenceView {
  id: string;
  title: string;
  citation: string;
  studyType: string;
  grade: EvidenceGradeScience;
  summary: string;
  population: string | null;
  doi: string | null;
  pmid: string | null;
  relationship: Relationship;
}

export interface RecommendationView {
  id: string;
  code: string;
  title: string;
  practical: string;
  sources: SourceView[];
  evidence: EvidenceView[];
}

/** Which traditions a user sees (13 §7.1): shared always, plus their own tradition. */
export function visibleTraditions(pref: SourceTradition | null | undefined): SourceTradition[] {
  if (pref === 'sunni') return ['shared', 'sunni'];
  if (pref === 'shia') return ['shared', 'shia'];
  return ['shared'];
}

const WEAK: readonly EvidenceGradeHadith[] = ['daif', 'daif_shia', 'ungraded'];

/**
 * Fabricated narrations are never shown; weak or ungraded ones only as context (13 §5.1, §5.2).
 * Qur'an and scholarly sources carry no hadith grade.
 */
export function isDisplayable(s: Pick<SourceView, 'grade' | 'relationship'>): boolean {
  if (s.grade === 'mawdu') return false;
  if (s.grade && WEAK.includes(s.grade)) return s.relationship === 'context';
  return true;
}

const KIND_ORDER: Record<SourceKind, number> = {
  quran: 0,
  hadith: 1,
  imam_narration: 1,
  scholarly: 2,
};
const REL_ORDER: Record<Relationship, number> = { supports: 0, context: 1, caution: 2 };
const SCIENCE_ORDER: Record<EvidenceGradeScience, number> = {
  high: 0,
  moderate: 1,
  low: 2,
  very_low: 3,
  expert_opinion: 4,
};

/** "From the tradition": supports first, then context; Qur'an first; at most three (13 §6). */
export function sourcesForDisplay(
  sources: readonly SourceView[],
  pref: SourceTradition | null | undefined,
  max = 3,
): SourceView[] {
  const allowed = visibleTraditions(pref);
  return sources
    .filter((s) => allowed.includes(s.tradition) && isDisplayable(s))
    .sort(
      (a, b) =>
        REL_ORDER[a.relationship] - REL_ORDER[b.relationship] ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind],
    )
    .slice(0, max);
}

/** "What research says": one or two blocks, highest GRADE first (13 §6). */
export function evidenceForDisplay(evidence: readonly EvidenceView[], max = 2): EvidenceView[] {
  return [...evidence]
    .sort((a, b) => SCIENCE_ORDER[a.grade] - SCIENCE_ORDER[b.grade])
    .slice(0, max);
}

/** GRADE dots (13 §5.3): 4 to 1, none for expert opinion. */
export function gradeDots(grade: EvidenceGradeScience): number {
  return { high: 4, moderate: 3, low: 2, very_low: 1, expert_opinion: 0 }[grade];
}

/** Picks the user's locale from an i18n jsonb, falling back to English. */
export function pickLocale(json: unknown, locale: string): string {
  if (!json || typeof json !== 'object') return '';
  const map = json as Record<string, unknown>;
  const v = map[locale] ?? map.en;
  return typeof v === 'string' ? v : '';
}
