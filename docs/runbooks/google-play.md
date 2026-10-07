# Google Play: configuration runbook

> **Environments:** prod (required), staging (optional Play listing for `app.thuluth.mobile.staging`); dev builds are APKs and need no Play listing · **Time:** account verification 2 to 7 days, then ~90 min for prod · **Needs:** a Google account for the developer account, a D-U-N-S number (organisation), 25 USD one-time fee, a Google Cloud project, 1Password vault "Thuluth Platform" · **Related:** [eas-builds.md](eas-builds.md), [revenuecat.md](revenuecat.md), [onesignal-and-firebase.md](onesignal-and-firebase.md), [domain-and-dns.md](domain-and-dns.md), [auth-providers.md](auth-providers.md), [github-environments.md](github-environments.md), [password-manager.md](password-manager.md), [`docs/store/`](../store/README.md), [`docs/ops/secrets.md`](../ops/secrets.md)

## What this configures

The Play Console developer account, the app `app.thuluth.mobile`, its signing, testing tracks, subscriptions, the service accounts that let EAS upload builds and RevenueCat read purchases, and the Data safety form. Without it there is no Android release, `eas submit` has nothing to upload to, and RevenueCat cannot validate Android purchases, so the Android paywall shows "store unavailable". It also produces the signing fingerprints that Android App Links (`https://thuluth.app/invite/...`) and Google sign-in need.

Menu names in the Play Console change often. They may differ slightly from the labels below.

## Before you start

- [ ] Decide **organisation or personal** account. Use **organisation**: new personal accounts must run a closed test with at least 12 testers for 14 days before they may publish to production, which does not fit the launch plan (`launch-runbook.md`, launch on 1 February 2027). Organisation accounts need a D-U-N-S number (see [apple-app-store.md](apple-app-store.md) step 1; the same number works).
- [ ] A Google account for the developer account. Use a role mailbox such as `play@thuluth.app`, with two-step verification on.
- [ ] [eas-builds.md](eas-builds.md) steps 1 to 6 done, so you can make a production Android build (`.aab`).
- [ ] The Google Cloud project for Firebase from [onesignal-and-firebase.md](onesignal-and-firebase.md) step 1, or any Google Cloud project you own. The service accounts below live in a Google Cloud project.

## The app variants (from `apps/mobile/app.config.ts`)

| Environment | Package | Play listing? |
|---|---|---|
| dev | `app.thuluth.mobile.dev` | No (APK from the `development` profile) |
| staging | `app.thuluth.mobile.staging` | Optional, only if testers should install staging from Play (`staging-store` profile) |
| prod | `app.thuluth.mobile` | Yes |

The EAS build profile for staging is called `preview`, but the package is `app.thuluth.mobile.staging` (19 §2).

## Steps

### 1. Create the developer account

1. Go to https://play.google.com/console/signup and sign in with the role Google account.
2. Choose **An organisation**. Enter the D-U-N-S number, the legal name and address exactly as on the D-U-N-S record, a public developer email (`support@thuluth.app`) and phone.
3. Pay the 25 USD fee. Complete identity verification (ID of the account owner) and, for organisations, the organisation verification. This can take several days.
4. Payments profile: Play Console > Settings > **Payments profile**. Add the bank account for payouts. Subscriptions cannot be created without a merchant account.
5. Users and permissions > **Invite new users**: add developers with only the permissions they need. Never share the owner login.

### 2. Create the app

1. Play Console > **Create app**.
2. App name: **Thuluth: Family Nutrition**. Default language: English (United Kingdom) or English (United States), PO's choice. App or game: **App**. Free or paid: **Free** (subscriptions are in-app). Accept the declarations.
3. The package name is fixed by the first upload, not typed here. It will be `app.thuluth.mobile` because that is what the production build uses.
4. Main store listing: paste from [`docs/store/google-play.en.md`](../store/google-play.en.md) and add the Urdu translation from [`google-play.ur.md`](../store/google-play.ur.md) once reviewed.
5. Store settings: category, tags, contact details and website from "Store settings" in `google-play.en.md`.

### 3. Play App Signing and the first upload

Google Play requires the **first** build to be uploaded by hand. After that, `eas submit` can upload.

1. Make the build: in `apps/mobile`, `eas build --profile production --platform android` ([eas-builds.md](eas-builds.md) step 7). EAS creates and keeps the **upload key** the first time.
2. Download the `.aab` from the build page on expo.dev.
3. Play Console > the app > Test and release > Testing > **Internal testing** > **Create new release**.
4. Play App Signing: accept **"Use Google-generated key"** (the default). Google keeps the app signing key; EAS keeps the upload key.
5. Upload the `.aab`. Release name: leave the default (version code and version). Release notes: from `google-play.en.md`. **Save**, then **Review release** > **Start rollout to Internal testing**.
6. Testers: Internal testing > **Testers** tab > create the email list `Core` with the team's Google accounts. Copy the opt-in link and send it to them.

The upload contains the `com.android.vending.BILLING` permission (added by `react-native-purchases`). Play only lets you create subscriptions after such a build is uploaded, so step 5 must come before step 4 below.

### 4. Copy the signing fingerprints

1. Play Console > the app > Test and release > Setup > **App signing** (or "App integrity").
2. Copy both **SHA-256** fingerprints: the **App signing key certificate** and the **Upload key certificate**. Copy the two **SHA-1** fingerprints as well.
3. Cross-check the upload key with EAS: `eas credentials --platform android` > production profile shows the same SHA-256 and SHA-1.
4. Hand them on:
   - SHA-256 (both) go into `https://thuluth.app/.well-known/assetlinks.json` for `app.thuluth.mobile`. Follow [domain-and-dns.md](domain-and-dns.md). The dev and staging variants also verify `thuluth.app` (every variant has the same intent filter in `app.config.ts`), so their EAS keystore SHA-256 values (from `eas credentials` for the `development` and `preview` profiles) go in the same file.
   - SHA-1 (both) go on the Google Cloud **Android OAuth client** for Google sign-in. Follow [auth-providers.md](auth-providers.md).

These fingerprints are public. Save them in 1Password as "prod play-signing-fingerprints" only for convenience.

### 5. Subscriptions and base plans

The ids must match `packages/shared/src/constants/products.ts`.

1. Play Console > the app > Monetise with Play > Products > **Subscriptions** > **Create subscription**.
2. Create two subscriptions:

| Product ID | Name | Base plan ID | Billing period | Renewal type | Grace period | Account hold |
|---|---|---|---|---|---|---|
| `thuluth_premium_monthly` | Thuluth Premium Monthly | `monthly` | 1 month | Auto-renewing | 7 days | 30 days |
| `thuluth_premium_annual` | Thuluth Premium Annual | `annual` | 1 year | Auto-renewing | 14 days | 30 days |

3. For each base plan: **Set prices** with Pakistan in PKR (699 monthly, 4,999 annual) and review other countries against `17-subscription-architecture.md` §3. Then **Activate** the base plan.
4. On the annual base plan only: **Add offer** > offer ID `free-trial`, eligibility **New customer acquisition: never had this subscription**, phase **Free trial, 7 days**. Activate it. Monthly has no trial (17 §4.1).
5. Add benefits (up to four short lines) and the Urdu translation of the names.

In RevenueCat the products appear as `thuluth_premium_monthly:monthly` and `thuluth_premium_annual:annual` (subscription id, colon, base plan id). See [revenuecat.md](revenuecat.md) step 4.

This is the layout in `17-subscription-architecture.md` §2.1: two Play subscriptions with the same ids as the App Store. The app selects plans by package type, but do not change the layout after the first subscriber.

Staging listing (optional): Play product ids are per app, so a staging app `app.thuluth.mobile.staging` can reuse the same ids.

### 6. Service account for EAS Submit (and GitHub)

1. https://console.cloud.google.com > select the project > IAM and admin > **Service accounts** > **Create service account**. Name `eas-submit`. No project roles. **Done**.
2. Open it > **Keys** > Add key > Create new key > **JSON**. The file downloads once.
3. Save the whole JSON in 1Password as "prod PLAY_SERVICE_ACCOUNT_JSON" (field "credential"), then delete the downloaded file.
4. In the Google Cloud console, enable the **Google Play Android Developer API** for this project (APIs and services > Library).
5. Play Console (account level, not the app) > **Users and permissions** > **Invite new users** > paste the service account email (`eas-submit@<project>.iam.gserviceaccount.com`).
6. App permissions > add `Thuluth: Family Nutrition` > tick **Release apps to testing tracks**, **Release to production, exclude devices, and use Play App Signing**, and **Manage testing tracks and edit tester lists**. No account permissions. **Invite user**.
7. Give the key to EAS: `eas credentials --platform android` > production profile > **Google Service Account** > "Upload a Google Service Account Key" > pick the JSON file (export it from 1Password to a temporary file, then delete it).
8. Give it to GitHub: environment `production` > secret `PLAY_SERVICE_ACCOUNT_JSON` = the whole JSON. See [github-environments.md](github-environments.md).

`secrets.md` §4 marks `PLAY_SERVICE_ACCOUNT_JSON` as reserved: no workflow in `.github/workflows/` reads it yet (`deploy-prod.yml` deploys only the backend). It is for the future store-release job in `20-ci-cd-pipeline.md` §7. Until then EAS uses the key from step 7.

### 7. Service account for RevenueCat

Use a **separate** service account so revoking one does not break the other.

1. Same Google Cloud project > Create service account `revenuecat`. Grant it the project roles **Pub/Sub Editor** and **Monitoring Viewer** (RevenueCat uses them for real-time notifications).
2. Keys > JSON. Save it in 1Password as "prod play-service-account-revenuecat", then delete the download.
3. Enable the **Google Play Android Developer API** and **Google Play Developer Reporting API** in the project if not already on.
4. Play Console > Users and permissions > Invite > the `revenuecat@...` email. Account permissions: **View app information and download bulk reports (read only)**, **View financial data, orders, and cancellation survey responses**, **Manage orders and subscriptions**. **Invite user**.
5. Upload the JSON in RevenueCat ([revenuecat.md](revenuecat.md) step 3). New service account credentials can take up to 36 hours to start working in RevenueCat; this is normal.
6. Real-time developer notifications: in RevenueCat, the Play Store app > "Google developer notifications" > **Connect to Google** creates a Pub/Sub topic. Copy the topic name into Play Console > Monetise with Play > **Monetisation setup** > Real-time developer notifications > Topic name. Click **Send test notification**; RevenueCat shows it as received.

### 8. Data safety, app content and declarations

Play Console > the app > Policy and programmes > **App content**. Fill in each item:

| Item | Source |
|---|---|
| Privacy policy | `https://thuluth.app/legal/privacy` |
| App access | "All or some functionality is restricted", with the reviewer account, per [`docs/store/demo-account.md`](../store/demo-account.md) |
| Ads | No ads |
| Content rating | IARC questionnaire answers in `google-play.en.md` "Store settings" |
| Target audience | 18 and over only |
| Data safety | The answers in [`docs/store/privacy-and-data-safety.md`](../store/privacy-and-data-safety.md) "Google Play data safety answers". Resolve its open questions first. |
| Health apps | [`docs/store/review-notes.md`](../store/review-notes.md) "Play Console: Health apps declaration" |
| Financial features | None |
| Government app | No |
| Account deletion | URL `https://thuluth.app/delete-account` |

## Where the values go

| Value | Where it is set | Name |
|---|---|---|
| EAS submit service account JSON | EAS credentials (Android, production) and GitHub environment `production` secret | `PLAY_SERVICE_ACCOUNT_JSON` |
| RevenueCat service account JSON | RevenueCat > Play Store app > Service account credentials | none in the repo |
| App signing and upload SHA-256 | `https://thuluth.app/.well-known/assetlinks.json` | see [domain-and-dns.md](domain-and-dns.md) |
| App signing and upload SHA-1 | Google Cloud Android OAuth client | see [auth-providers.md](auth-providers.md) |
| Pub/Sub topic | Play Console > Monetisation setup | none |
| Reviewer password | App content > App access | 1Password only ("prod reviewer-account") |

## Verify

- Play Console > the app > Internal testing shows release 1 as "Available to internal testers". A tester can install from the opt-in link.
- Subscriptions shows `thuluth_premium_monthly` and `thuluth_premium_annual`, each with an **Active** base plan, and the annual plan has the active `free-trial` offer.
- `eas submit --platform android --profile production --latest` uploads without asking for a key ([eas-builds.md](eas-builds.md) step 8).
- RevenueCat > Play Store app shows the service account credentials as valid (green) and the test notification as received.
- After the assetlinks file is published: `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://thuluth.app&relation=delegate_permission/common.handle_all_urls` lists `app.thuluth.mobile`. On a device, `adb shell pm get-app-links app.thuluth.mobile` shows `thuluth.app: verified`.

## Rotate or revoke

| Item | Cadence | How |
|---|---|---|
| `PLAY_SERVICE_ACCOUNT_JSON` (EAS submit) | on staff change or suspicion, else yearly | create a new JSON key on `eas-submit`, update EAS credentials and the GitHub secret, run a test `eas submit`, then delete the old key in Google Cloud |
| RevenueCat service account key | on suspicion | new key, upload to RevenueCat, wait until it shows valid, delete the old key |
| Upload key | only if lost or leaked | Play Console > App signing > **Request upload key reset**; EAS can generate a new keystore. Update assetlinks and the OAuth client with the new fingerprints. |
| App signing key | never (Google holds it) | n/a |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `eas submit` fails with "Google Api Error: ... The caller does not have permission" | Service account not invited in Play Console, or missing release permissions | Step 6 points 5 and 6; wait a few minutes after the invite |
| `eas submit` fails with "Package not found: app.thuluth.mobile" | No build was uploaded by hand yet | Do step 3 once by hand |
| "Create subscription" is greyed out | No uploaded build with the BILLING permission, or no payments profile | Do step 3 and step 1 point 4 |
| Paywall on Android shows "store unavailable" | Base plans not activated, the tester's account is not a license tester, or `EXPO_PUBLIC_RC_ANDROID_KEY` is missing from the build | Activate the base plans; Play Console > Settings > **License testing** > add the tester; check the EAS environment ([revenuecat.md](revenuecat.md)) |
| Invite links open the browser, not the app | assetlinks.json is missing the fingerprint of the key that signed the installed build | Internal and production installs are signed by the Play app signing key; APKs from EAS by the EAS keystore. Add the missing SHA-256 per [domain-and-dns.md](domain-and-dns.md) |
| Google sign-in fails with `DEVELOPER_ERROR` on Play installs only | The Play app signing SHA-1 is not on the Android OAuth client | Add it per [auth-providers.md](auth-providers.md) |
