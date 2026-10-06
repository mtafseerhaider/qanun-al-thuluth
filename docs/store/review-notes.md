# Health-app review notes

Paste into App Store Connect > App Review Information > Notes and into the Play Console (App
content > Health apps, and the review notes field where offered). Reviewers read English, so this
file is English only. Based on `22-mvp-roadmap.md` §7.5, updated for what the app does at v1.0.0.

## Review notes (both stores)

```text
Thuluth is a wellness and education app for family meal planning, hydration, and meal and fasting tracking. It is not a medical device and does not diagnose or treat any condition. Plans and growth screens show a disclaimer advising users to consult a clinician.

Safety design:
- No calorie targets or weight-loss goals are ever shown for anyone under 18. Children's growth is shown on WHO growth charts, never as a weight goal.
- Users who report red-flag conditions (for example insulin-treated diabetes with an intention to fast, pregnancy complications, eating-disorder signals, faltering child growth) are referred to a clinician and get no plan for that issue.
- AI answers are generated on our server, grounded in a curated recipe catalog and verified sources, and checked by safety filters. Crisis messages get emergency numbers for the user's country first.
- Account holders must be 18 or older. Children are profiles that a parent manages; they never sign in.

Religious content: Qur'an and hadith citations are shown only after review by named, credentialed scholars (listed in About). The app does not issue religious rulings.

Permissions: camera and photo library are used only when the user chooses to photograph or pick a meal photo. The microphone is used only when a premium user asks the assistant a question by voice; the recording is transcribed and deleted.

Account deletion: More > Privacy and data > Delete account (a 30-day grace period with cancel; email confirmation). Web: https://thuluth.app/delete-account

Subscriptions: Thuluth Premium, monthly or annual (7-day free trial on annual), through in-app purchase. The paywall is reachable from More > Thuluth Premium.

Demo account: reviewer@thuluth.app. On the sign-in screen, type this exact address; a password field appears. The password is in the review information fields of this submission. The account has a sample household (two adults, two children) with Premium enabled through a promotional entitlement, so every feature is reachable without a purchase.
```

## Play Console: Health apps declaration (draft answers)

| Question | Answer |
| --- | --- |
| Health features | Nutrition and weight management; Health and fitness (activity, hydration); Women's health: No; Medical: No |
| Is the app a medical device or regulated as one? | No |
| Does it claim to diagnose, treat or prevent disease? | No |
| Does it access Health Connect? | No |
| Is it designed for children? | No. Target audience 18+; parents enter children's data |
| Clinical oversight | Content reviewed by a registered dietitian and by named scholars for religious content (PO to name them, L6) |

## App Store guideline notes (for the PO)

- 1.4.1: no treatment or diagnosis claims; disclaimers in place.
- 2.1: demo account with Premium; no feature hidden behind a purchase during review.
- 3.1.2: subscription terms in the description and on the paywall (auto-renewal, cancel in
  settings, links to terms and privacy).
- 4.8: Sign in with Apple is offered next to Google sign-in.
- 5.1.1(v): in-app account deletion.
- 5.1.1(i): purpose strings for camera, photos and microphone are specific (set in
  `apps/mobile/app.config.ts`, Urdu in `locales/ur/native.json`).
- 5.1.3: health data is not used for advertising or shared with data brokers.
