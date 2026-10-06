import { HELP_EN } from './en';
import type { HelpArticle, HelpContent } from './types';
import { HELP_UR } from './ur';

export { HELP_CATEGORIES, type HelpArticle, type HelpCategory, type HelpContent } from './types';

/** Bundled help content for a locale (English is the fallback for any missing slug). */
export function helpContent(locale: string): HelpContent {
  return locale === 'ur' ? HELP_UR : HELP_EN;
}

export function findArticle(
  locale: string,
  slug: string,
): { article: HelpArticle; draft: boolean } | null {
  const content = helpContent(locale);
  const own = content.articles.find((a) => a.slug === slug);
  if (own) return { article: own, draft: content.draft };
  const en = HELP_EN.articles.find((a) => a.slug === slug);
  return en ? { article: en, draft: false } : null;
}

export const ALL_HELP = [HELP_EN, HELP_UR] as const;
