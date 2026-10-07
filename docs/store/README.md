# Store listing drafts (S7-07)

Text drafts for the App Store and Google Play submission (`24-sprint-plan.md` S7-07, launch
checklist `22-mvp-roadmap.md` §7.2 to §7.5). Screenshots and the preview video are not in this
folder: they need a device or simulator run and are listed under "Still to do".

| File | What it holds |
| --- | --- |
| [app-store.en.md](app-store.en.md) / [app-store.ur.md](app-store.ur.md) | App Store name, subtitle, promotional text, description, keywords, What's New |
| [google-play.en.md](google-play.en.md) / [google-play.ur.md](google-play.ur.md) | Play title, short and full description, release notes |
| [privacy-and-data-safety.md](privacy-and-data-safety.md) | Apple privacy nutrition label answers and the Play data safety form, derived from the code |
| [review-notes.md](review-notes.md) | Health-app review notes for both stores, Play health apps declaration answers |
| [demo-account.md](demo-account.md) | How to set up and hand over the reviewer account |

## Status and open decisions

- **App name.** The project uses "Thuluth" and the store title "Thuluth: Family Nutrition"
  (launch checklist S1). The product owner confirmed the store title on 2026-10-06, so the L1
  fallback "Thuluth: Family Meal Planner" is not needed. Every draft uses "Thuluth: Family
  Nutrition".
- **Urdu.** The `.ur.md` files are drafts for native review in S7-05. They have not been reviewed
  by a native speaker. Store consoles take the review notes and data forms in English only, so
  those files are English.
- **Claims.** The copy follows S2: it says plan, track and learn and never treat, cure, diagnose,
  lose weight or similar. There are no calorie or weight-loss claims, and nothing about children's
  weight.
- **Prices.** Prices are not quoted in the copy. The stores show localized prices from the
  subscription products `thuluth_premium_monthly` and `thuluth_premium_annual`.
- **Character limits.** Each field lists its limit and the draft's length. Recount after edits.

## Still to do (humans)

1. PO: approve the copy in both languages (the store title is confirmed, 2026-10-06).
2. Native Urdu reviewer: review the `.ur.md` files (S7-05).
3. Design: capture screenshots in en and ur (6.7" and 5.5" iPhone, Play phone). The device list,
   captions and data set are in `22-mvp-roadmap.md` §7.2 S3.
4. PO: create the reviewer account and enter its password in App Store Connect and the Play
   Console (see `demo-account.md`). Never put the password in this repository.
5. Legal: confirm the label answers in `privacy-and-data-safety.md` before filling in the forms.
   The PO decided the two former open questions on 2026-10-06 (religious source tradition as
   Sensitive Info / Religious or philosophical beliefs; food budget amounts as Other financial
   info).
6. PO: fill in the Play health apps declaration, target audience, content rating questionnaires
   and the account deletion URL, using the answers in `review-notes.md`.
