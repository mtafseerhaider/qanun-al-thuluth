import { HELP_CATEGORIES, findArticle, helpContent } from '../content';
import { HELP_EN } from '../content/en';
import { HELP_UR } from '../content/ur';
import { diagnosticsText, supportMailto } from '../utils/diagnostics';
import { normalize, searchHelp } from '../utils/help-search';

describe('help content', () => {
  it('has 30 English articles with unique slugs and an Urdu draft for each', () => {
    const en = HELP_EN.articles.map((a) => a.slug);
    expect(en).toHaveLength(30);
    expect(new Set(en).size).toBe(30);
    expect(HELP_UR.articles.map((a) => a.slug)).toEqual(en);
    expect(HELP_UR.draft).toBe(true);
    expect(HELP_EN.draft).toBe(false);
  });

  it('keeps every article non-empty and in a known category', () => {
    for (const c of [HELP_EN, HELP_UR])
      for (const a of c.articles) {
        expect(HELP_CATEGORIES).toContain(a.category);
        expect(a.title.trim()).not.toBe('');
        expect(a.body.length).toBeGreaterThan(0);
        expect(a.body.every((p) => p.trim().length > 0)).toBe(true);
      }
    for (const c of HELP_CATEGORIES)
      expect(HELP_EN.articles.some((a) => a.category === c)).toBe(true);
  });

  it('finds articles by locale and flags Urdu as draft', () => {
    expect(helpContent('ur')).toBe(HELP_UR);
    expect(findArticle('ur', 'delete-my-account')?.draft).toBe(true);
    expect(findArticle('en', 'delete-my-account')?.article.title).toMatch(/delet/i);
    expect(findArticle('en', 'nope')).toBeNull();
  });
});

describe('help search', () => {
  it('matches English titles first and needs every word', () => {
    const r = searchHelp(HELP_EN.articles, 'Delete account');
    expect(r[0]?.slug).toBe('delete-my-account');
    expect(searchHelp(HELP_EN.articles, 'delete zzzzqqq')).toEqual([]);
    expect(searchHelp(HELP_EN.articles, 'a')).toEqual([]);
  });

  it('searches Urdu text, ignoring Arabic letter variants', () => {
    expect(searchHelp(HELP_UR.articles, 'رمضان').map((a) => a.slug)).toContain('ramadan-planner');
    // Arabic yeh and kaf normalize to the Urdu forms.
    expect(normalize('يك')).toBe(normalize('یک'));
  });
});

describe('support diagnostics', () => {
  const text = diagnosticsText({
    appVersion: '1.0.0',
    platform: 'ios',
    osVersion: '18',
    locale: 'ur',
    role: 'owner',
    userRef: 'abc123def456',
    pendingSync: 2,
    failedSync: 0,
  });

  it('contains only technical context', () => {
    expect(text).toContain('app: 1.0.0');
    expect(text).toContain('user ref: abc123def456');
    expect(text).not.toMatch(/@|name|email|weight|height/i);
  });

  it('builds a mailto that includes diagnostics only when chosen', () => {
    expect(supportMailto('Help', 'Hi', null)).toBe(
      'mailto:support@thuluth.app?subject=Help&body=Hi',
    );
    expect(decodeURIComponent(supportMailto('Help', 'Hi', text))).toContain('pending sync: 2');
  });
});
