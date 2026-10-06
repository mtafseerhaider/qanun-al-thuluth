import type { HelpArticle } from '../content';

/**
 * Offline help search (S6-12). Lower-cases, strips Arabic-script diacritics and unifies common
 * Arabic/Urdu letter variants, then requires every query word to appear somewhere. Title hits rank
 * above keyword hits, which rank above body hits.
 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ًͯ-ٰٟ]/g, '')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/ه/g, 'ہ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function searchHelp(articles: readonly HelpArticle[], query: string): HelpArticle[] {
  const words = normalize(query)
    .split(' ')
    .filter((w) => w.length >= 2);
  if (words.length === 0) return [];
  const scored = articles.flatMap((a) => {
    const title = normalize(a.title);
    const keywords = normalize(a.keywords.join(' '));
    const body = normalize(a.body.join(' '));
    let score = 0;
    for (const w of words) {
      const s =
        (title.includes(w) ? 3 : 0) + (keywords.includes(w) ? 2 : 0) + (body.includes(w) ? 1 : 0);
      if (s === 0) return [];
      score += s;
    }
    return [{ a, score }];
  });
  return scored.sort((x, y) => y.score - x.score).map((x) => x.a);
}
