# Locales

i18next resources for `@thuluth/mobile`, one JSON file per namespace (docs/07 §4, docs/00 §9).

- `en/` is the source of truth for keys. Every key must exist in `ur/` with the same nesting; the Jest
  test `src/lib/i18n/__tests__/locales.test.ts` fails if the trees differ.
- `native.json` holds iOS display-name strings used by `app.config.ts` `locales`.
- Interpolations use `{{name}}`; keep them identical in both languages.

> **Urdu copy needs native review.** All `ur/*.json` strings were drafted during Sprint 0 and have not
> been reviewed by a native Urdu speaker or the content team. Treat them as placeholders until the
> reviewer signs off (docs/21-testing-strategy.md §12).

> **Sprint 1 additions needing review.** `household.json` and `family.json` are new namespaces. The
> Urdu rendering of the Tirmidhi 2380 narration (`onboarding:philosophy.hadith.translation`) is a
> draft translation of the English text in docs/00 §2 and must be checked by the Islamic content
> reviewer before release (docs/13). Plural keys use i18next `_one` / `_other` suffixes in both
> languages so the trees stay identical.

> **Sprint 2 additions needing review.** `intake.json` (health intake, modules, goals, assessment
> results) and `knowledge.json` (recommendation cards, source detail sheet, hadith grade labels) are
> new namespaces. Their Urdu strings are drafts: the medical safety copy (red flags, clinician card,
> fasting with insulin) needs clinical review, and the grade and tradition labels (صحیح، حسن، موثق،
> سنی ماخذ، شیعہ ماخذ) need the Islamic content reviewer (docs/13).

> **Sprint 3 additions needing review.** `meals.json` (meal cards, logging, acceptance labels from
> docs/02 §8.2, Thuluth guidance adult and child variants, swap sheet), `plan.json` (plan list, plan
> detail, generation progress and tips), `today.json` (dashboard), `recipes.json` (recipe detail) and
> `help.json` (alpha feedback form) are new namespaces; `navigation.json` and `settings.json` gained
> keys. Their Urdu strings are drafts for a native reviewer. The guidance lines (water timing, the
> 70 to 80 percent stop point, the children's "seconds welcome" framing) also need the content team,
> and "Sunnah food" / "Bismillah" wording needs the Islamic content reviewer (docs/13).

> **Sprint 4 additions needing review.** `hydration.json` (tracker, kid cup view, dehydration check
> and red-flag sheet), `fasting.json` (fasting tracker, Ramadan grid, qada and fidya notes, child
> rules, the clinician card for insulin or sulfonylurea), `grocery.json`, `budget.json`,
> `notifications.json` (inbox, settings, every notification kind, the push pre-prompt) and
> `tracking.json` (adult weight log, daily reflection) are new namespaces; `today.json`,
> `settings.json`, `plan.json` and `navigation.json` gained keys. All Urdu strings are drafts. The
> red-flag and break-the-fast copy and the 1122 emergency line need clinical review; the fasting,
> qada, fidya, adab of drinking and "May Allah accept it" wording need the Islamic content reviewer
> (docs/13); aisle and unit names (سبزی، گٹھی، ڈھیری) need a native speaker familiar with local
> markets.

> **Sprint 6 additions needing review.** `growth.json` (growth dashboard, add measurement, the eight
> growth alert texts and the plan-paused banner), `picky.json` (picky-eating hub, division of
> responsibility guide and its parent scripts, exposure log, acceptance analytics), `autism.json`
> (safe foods, sensory profile, exposure ladders, food chaining, first-then cards), `exports.json`,
> `insights.json` and `privacy.json` (consents, analytics opt-out, account deletion and its grace
> countdown, the email code step-up) are new namespaces. `help.json`, `chat.json`, `knowledge.json`
> (report a source), `family.json`, `settings.json`, `navigation.json` and `errors.json` gained keys.
> All Urdu strings are drafts. The 30 help articles are bundled TypeScript content, not JSON
> (`src/features/help/content/en.ts` and `ur.ts`). The Urdu set is flagged `draft: true`, and the
> app shows a "draft translation" notice until a native reviewer signs it off. Reviews needed:
> clinical review of the growth alert copy, the "see a doctor" wording and the emergency numbers in
> the `emergency-help` article; content-team review of the DoR scripts, ladder stage criteria and
> first-then activities; Islamic content review of the Ramadan and fasting help articles (docs/13).
