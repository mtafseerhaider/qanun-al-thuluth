/** Bundled help article (S6-12). Content is a draft pending the content team's review. */
export const HELP_CATEGORIES = [
  'getting_started',
  'plans',
  'health',
  'ramadan',
  'privacy',
  'subscription',
  'safety',
] as const;
export type HelpCategory = (typeof HELP_CATEGORIES)[number];

export interface HelpArticle {
  slug: string;
  category: HelpCategory;
  title: string;
  /** Paragraphs; a paragraph starting with "• " renders as a bullet. */
  body: readonly string[];
  /** Extra search words (synonyms, common misspellings, transliterations). */
  keywords: readonly string[];
}

export interface HelpContent {
  locale: 'en' | 'ur';
  /** True while the translation has not been reviewed by a native speaker. */
  draft: boolean;
  articles: readonly HelpArticle[];
}
