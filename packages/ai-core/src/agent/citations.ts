import { sentences } from '../guardrails/text.ts';

/**
 * Grounded citations (FR-AI-05, FR-CHAT-07, 12 §13.6, 13 §11). The model cites by token:
 * `[[src:CODE]]` for an Islamic source, `[[rec:CODE]]` for a recommendation and `[[ev:CODE]]` for
 * scientific evidence. A token resolves only when the item was retrieved by a tool in this turn
 * (the retrieval set holds verified rows only: `citable_islamic_sources`, verified
 * recommendations), so a memorised or invented code never reaches the user. Resolved tokens
 * become `[n]` markers with one `citation` event each; anything else is stripped:
 * - unresolved tokens (flag `citation_unresolved`),
 * - `[n]` markers the model typed itself (no backing citation),
 * - sentences that quote or reference scripture without a resolved token
 *   (flag `uncited_scripture_removed`).
 */

export type CitationKind = 'islamic_source' | 'scientific_evidence' | 'recommendation';

export interface CitableItem {
  kind: CitationKind;
  /** islamic_sources.id | scientific_evidence.id | recommendations.id */
  refId: string;
  label: string;
  tradition?: 'shared' | 'sunni' | 'shia' | undefined;
  hadithGrade?: string | undefined;
  scienceGrade?: string | undefined;
}

export interface ResolvedCitation extends CitableItem {
  marker: number;
}

export type TokenPrefix = 'src' | 'rec' | 'ev';

const PREFIX_KIND: Record<TokenPrefix, CitationKind> = {
  src: 'islamic_source',
  rec: 'recommendation',
  ev: 'scientific_evidence',
};

/** Items retrieved in the current turn, keyed by `prefix:code`. */
export class CitationRegistry {
  readonly #items = new Map<string, CitableItem>();

  add(prefix: TokenPrefix, code: string, item: CitableItem): void {
    if (item.kind !== PREFIX_KIND[prefix]) throw new Error(`Citation kind mismatch for ${prefix}`);
    this.#items.set(`${prefix}:${code.toLowerCase()}`, item);
  }

  get(prefix: TokenPrefix, code: string): CitableItem | undefined {
    return this.#items.get(`${prefix}:${code.toLowerCase()}`);
  }

  get size(): number {
    return this.#items.size;
  }

  codes(): string[] {
    return [...this.#items.keys()];
  }
}

const TOKEN = /\s?\[\[(src|rec|ev):([a-z0-9_.:-]+)\]\]/giu;
/** Bare numeric markers the model typed: [1], [12], [^3]. */
const BARE_MARKER = /\s?\[\^?\d{1,3}\]/gu;
const PLACEHOLDER = (i: number) => `\uE000${i}\uE000`;
const PLACEHOLDER_RE = /\uE000(\d+)\uE000/gu;

/** Scripture referenced without a card: quotes near scripture words, or reference numbers. */
const SCRIPTURE_WORD =
  /\b(hadith|ahadith|narrat\w*|the prophet|prophet muhammad|rasul ?allah|rasulullah|messenger of allah|allah (says|said)|qur'?an|surah?|ayah|verse|imam \w+ (said|says)|sunan|sahih|bukhari|tirmidhi|abu dawud|ibn majah|nasa'?i|muwatta|al-kafi|kafi|bihar)\b|(حدیث|قرآن|آیت|سورہ|رسول اللہ|نبی کریم|ارشاد)/iu;
const QUOTE = /["“”«»]|(^|\s)'[^']{12,}'/u;
const REFERENCE_NUMBER =
  /\b(bukhari|muslim|tirmidhi|abu dawud|ibn majah|nasa'?i|ahmad|muwatta|al-kafi|kafi|bihar(?: al-anwar)?)\s*(no\.?|#|hadith)?\s*\d{1,5}\b|\b(qur'?an|surah?|sura|ayah|verse)\D{0,25}\d{1,3}\s*[:.]\s*\d{1,3}\b|\(\s*\d{1,3}\s*:\s*\d{1,3}\s*\)/iu;

export interface CitationResult {
  text: string;
  citations: ResolvedCitation[];
  /** Tokens that did not resolve (`src:code`). */
  unresolved: string[];
  /** Model-typed `[n]` markers removed. */
  strippedMarkers: number;
  removedSentences: string[];
  safetyFlags: string[];
}

export function resolveCitations(draft: string, registry: CitationRegistry): CitationResult {
  const unresolved: string[] = [];
  const flags = new Set<string>();
  let strippedMarkers = 0;

  // 1. Model-typed markers have no backing: remove before inserting ours.
  let text = draft.replace(/\uE000/gu, '').replace(BARE_MARKER, () => {
    strippedMarkers++;
    return '';
  });

  // 2. Tokens -> placeholders for resolved items (one marker per distinct item).
  const order: CitableItem[] = [];
  const indexOf = new Map<CitableItem, number>();
  text = text.replace(TOKEN, (_m, prefix: string, code: string) => {
    const item = registry.get(prefix.toLowerCase() as TokenPrefix, code);
    if (!item) {
      unresolved.push(`${prefix.toLowerCase()}:${code}`);
      return '';
    }
    let i = indexOf.get(item);
    if (i === undefined) {
      i = order.length;
      order.push(item);
      indexOf.set(item, i);
    }
    return PLACEHOLDER(i);
  });
  if (unresolved.length) flags.add('citation_unresolved');

  // 3. Remove sentences that reference scripture without a resolved token.
  const removed: string[] = [];
  const kept: string[] = [];
  for (const paragraph of text.split(/\n{2,}/u)) {
    const lines: string[] = [];
    for (const line of paragraph.split('\n')) {
      const out: string[] = [];
      for (const s of sentences(line)) {
        const cited = /\uE000\d+\uE000/u.test(s);
        const scripture = REFERENCE_NUMBER.test(s) || (SCRIPTURE_WORD.test(s) && QUOTE.test(s));
        if (scripture && !cited) {
          removed.push(s);
          continue;
        }
        out.push(s);
      }
      if (out.length) lines.push(out.join(' '));
    }
    if (lines.length) kept.push(lines.join('\n'));
  }
  if (removed.length) flags.add('uncited_scripture_removed');
  text = kept.join('\n\n');

  // 4. Number markers in reading order; items whose sentence was removed are dropped.
  const markerOf = new Map<number, number>();
  const citations: ResolvedCitation[] = [];
  text = text.replace(PLACEHOLDER_RE, (_m, idx: string) => {
    const i = Number(idx);
    let marker = markerOf.get(i);
    if (marker === undefined) {
      marker = citations.length + 1;
      markerOf.set(i, marker);
      const item = order[i];
      if (item) citations.push({ ...item, marker });
    }
    return ` [${marker}]`;
  });
  text = text
    .replace(/[ \t]+([.,;:!?۔؟])/gu, '$1')
    .replace(/[ \t]{2,}/gu, ' ')
    .trim();
  return {
    text,
    citations,
    unresolved,
    strippedMarkers,
    removedSentences: removed,
    safetyFlags: [...flags],
  };
}

/** Every `[n]` marker in the final text has a citation and every citation has a marker. */
export function citationsConsistent(
  text: string,
  citations: readonly { marker: number }[],
): boolean {
  const markers = new Set([...text.matchAll(/\[(\d{1,3})\]/gu)].map((m) => Number(m[1])));
  const cited = new Set(citations.map((c) => c.marker));
  return [...markers].every((m) => cited.has(m)) && [...cited].every((m) => markers.has(m));
}
