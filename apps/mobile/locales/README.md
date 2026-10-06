# Locales

i18next resources for `@thuluth/mobile`, one JSON file per namespace (docs/07 §4, docs/00 §9).

- `en/` is the source of truth for keys. Every key must exist in `ur/` with the same nesting; the Jest
  test `src/lib/i18n/__tests__/locales.test.ts` fails if the trees differ.
- `native.json` holds iOS display-name strings used by `app.config.ts` `locales`.
- Interpolations use `{{name}}`; keep them identical in both languages.

> **Urdu copy needs native review.** All `ur/*.json` strings were drafted during Sprint 0 and have not
> been reviewed by a native Urdu speaker or the content team. Treat them as placeholders until the
> reviewer signs off (docs/21-testing-strategy.md §12).
