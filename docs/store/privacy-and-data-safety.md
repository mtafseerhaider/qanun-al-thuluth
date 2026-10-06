# Privacy nutrition label and Play data safety answers

Draft answers for App Store Connect "App Privacy" and the Play Console "Data safety" form,
checked against the code on 2026-10-06 (apps/mobile, supabase/migrations, supabase/functions).
They refine `22-mvp-roadmap.md` §7.3 and §7.4; the differences are listed at the end. **PO and
legal confirm before submission.** The forms are answered in English.

## What the app actually collects (evidence)

| Data | Where it comes from in the code | Sent off the device to |
| --- | --- | --- |
| Email address | Email OTP, Apple and Google sign-in (`features/auth`); `users.email` | Supabase (auth, database) |
| Name | `users.display_name`; family member names `family_members.name`; household name | Supabase |
| Date of birth, sex at birth, height, weight, blood group, activity level, sleep and work schedule | Intake and family editor (`features/intake`, `features/family`); `family_members` | Supabase; AI providers receive the plan inputs with names replaced by aliases |
| Health conditions, allergies, pregnancy, special modules (autism, picky eating, ADHD) | Intake (`features/intake`) | Supabase; AI providers (aliased) |
| Child growth measurements | `features/growth`, `growth-compute` | Supabase |
| Weight and waist logs (adults only) | `features/tracking` | Supabase |
| Meal, hydration and fasting logs, food exposures, daily reflection | `features/meal-log`, `hydration`, `fasting`, `exposures`, `tracking` | Supabase |
| Meal photos | `features/meal-log` (camera or library), bucket `meal-photos` | Supabase Storage; AI vision provider for analysis |
| Voice questions (premium) | `features/chat` voice input, `ai-transcribe` | AI speech-to-text provider; the `voice-notes` object is deleted after transcription |
| Chat messages and assistant memories | `features/chat` | Supabase; AI providers (aliased) |
| Grocery lists, prices paid, food budget amounts | `features/grocery`, `features/budget` | Supabase |
| Country, region and city typed by the user, timezone, currency | Household setup | Supabase (prayer and meal times, prices). No device location API is used |
| Religious source tradition (shared, Sunni, Shia), language, units | Settings | Supabase |
| Consents (terms, privacy, health data, child data, AI processing) | `consents` | Supabase |
| User ID | Supabase user id; RevenueCat App User ID is the same id | Supabase, RevenueCat |
| Push subscription ID | OneSignal (`lib/push`), `devices` table | OneSignal, Supabase. OneSignal gets no health data |
| Purchase history | RevenueCat entitlements, `subscriptions` | Apple / Google, RevenueCat, Supabase |
| Product interaction events | First-party analytics `track_events` (`lib/analytics`), opt-out in Privacy settings | Supabase only (no third-party analytics SDK) |
| Crash logs and performance data | Sentry (`lib/sentry`), PII scrubbed, user id only | Sentry |

Not collected: precise or coarse device location, contacts, browsing history, search history
(help search runs on the device), advertising ID (no ad SDKs; App Tracking Transparency is not
needed), SMS, calendar, files outside the photos the user picks.

## Apple App Privacy answers

"Do you or your third-party partners collect data from this app?" **Yes.**
Tracking: **No data is used to track** (no data is linked with third-party data for advertising,
and no data broker sharing).

For every type below: **Linked to the user: Yes. Used for tracking: No.**

| Apple data type | Collect? | Purposes |
| --- | --- | --- |
| Contact Info: Name | Yes | App Functionality |
| Contact Info: Email Address | Yes | App Functionality |
| Contact Info: Phone, Physical Address, Other | No | |
| Health & Fitness: Health | Yes | App Functionality |
| Health & Fitness: Fitness | Yes (activity level, weight logs) | App Functionality |
| Financial Info: Payment Info, Credit Info | No (Apple handles payment) | |
| Financial Info: Other Financial Info | **Open question 2** (food budget amounts) | App Functionality |
| Location: Precise, Coarse | No (city is typed, not read from the device) | |
| Sensitive Info | **Open question 1** (religious source tradition) | App Functionality |
| Contacts | No | |
| User Content: Photos or Videos | Yes (meal photos) | App Functionality |
| User Content: Audio Data | Yes (voice questions, deleted after transcription) | App Functionality |
| User Content: Customer Support | Yes (contact support and alpha feedback forms) | App Functionality |
| User Content: Other User Content | Yes (chat messages, notes, reflections) | App Functionality |
| Browsing History, Search History | No | |
| Identifiers: User ID | Yes | App Functionality |
| Identifiers: Device ID | Yes (OneSignal push subscription id) | App Functionality |
| Purchases: Purchase History | Yes | App Functionality |
| Usage Data: Product Interaction | Yes (first-party, can be turned off) | Analytics, App Functionality |
| Usage Data: Advertising Data, Other | No | |
| Diagnostics: Crash Data | Yes | App Functionality |
| Diagnostics: Performance Data | Yes | App Functionality |
| Diagnostics: Other Diagnostic Data | No | |
| Other Data | Yes (date of birth and sex of family members if Apple's reviewer reads them outside Health) | App Functionality |

Privacy manifest: `app.config.ts` declares `NSPrivacyAccessedAPICategoryUserDefaults` (CA92.1).
Third-party SDK manifests (Sentry, RevenueCat, OneSignal, Expo) ship inside their pods.

## Google Play data safety answers

**Data collection and security**

| Question | Answer |
| --- | --- |
| Does your app collect or share any of the required user data types? | Yes |
| Is all of the user data collected by your app encrypted in transit? | Yes (HTTPS / TLS 1.2+ to Supabase, Sentry, OneSignal, RevenueCat) |
| Do you provide a way for users to request that their data is deleted? | Yes: in the app (More > Privacy and data > Delete account) and at https://thuluth.app/delete-account |
| Shared with third parties | No. Supabase, AI providers, OneSignal, Sentry and RevenueCat are service providers acting for Thuluth, which Play does not count as sharing |

**Data types** (all: Collected yes, Shared no, Processed ephemerally no unless stated)

| Play category: type | Collected | Required or optional | Purposes |
| --- | --- | --- | --- |
| Personal info: Name | Yes | Required | App functionality, Account management |
| Personal info: Email address | Yes | Required | App functionality, Account management |
| Personal info: Other info (date of birth, sex at birth of family members) | Yes | Required | App functionality |
| Personal info: Religious or philosophical beliefs | **Open question 1** | Optional (defaults to "shared sources") | App functionality |
| Financial info: Purchase history | Yes | Optional | App functionality |
| Financial info: Other financial info (food budget amounts) | **Open question 2** | Optional | App functionality |
| Health and fitness: Health info | Yes | Required | App functionality |
| Health and fitness: Fitness info | Yes | Optional | App functionality |
| Photos and videos: Photos | Yes | Optional | App functionality |
| Audio: Voice or sound recordings | Yes, **processed ephemerally** (deleted after transcription) | Optional | App functionality |
| Messages: Other in-app messages (assistant chat) | Yes | Optional | App functionality |
| App activity: App interactions | Yes | Optional (opt-out in settings) | Analytics |
| App activity: In-app search history | No (help search stays on the device) | | |
| App activity: Other user-generated content (notes, reflections, feedback) | Yes | Optional | App functionality |
| App info and performance: Crash logs | Yes | Required | App functionality, Analytics |
| App info and performance: Diagnostics | Yes | Required | App functionality, Analytics |
| Device or other IDs | Yes (push subscription id) | Optional (only when notifications are on) | App functionality |
| Location: Approximate, Precise | No | | |
| Contacts, Calendar, Files and docs, Web browsing, SMS | No | | |

## Open questions for the PO and legal

1. **Religious source tradition.** `users.tradition_preference` stores shared, Sunni or Shia
   sources. Apple counts religious beliefs as Sensitive Info and Play has "Religious or
   philosophical beliefs". The launch checklist (§7.3) proposed "Other Data". Recommendation:
   declare it as Sensitive Info (Apple) and Religious or philosophical beliefs (Play); a stricter
   declaration costs nothing and avoids a review dispute.
2. **Food budget amounts.** Users type what they spent on groceries (`budget_entries`,
   `grocery_items.actual_minor`). This is not payment data, but reviewers sometimes read it as
   "Other financial info". Recommendation: declare it (App Functionality, optional).
3. **Customer support content.** The contact support and alpha feedback forms send free text and
   an optional screen name. Declared above as User Content: Customer Support.

## Differences from the launch checklist draft (22 §7.3 and §7.4)

- Added: Audio processed ephemerally on Play; Customer Support content; Other Data for date of
  birth and sex; the two open questions above.
- Confirmed: no location, no contacts, no tracking, no ads SDKs, processors not counted as sharing.
- In-app search: not collected (the checklist's wording was ambiguous).
