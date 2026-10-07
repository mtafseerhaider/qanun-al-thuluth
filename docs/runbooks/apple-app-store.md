# Apple App Store: configuration runbook

> **Environments:** dev / staging / prod (App IDs for all three; App Store Connect records for staging and prod) · **Time:** enrolment 2 to 14 days of waiting, then ~90 min for prod and ~45 min for staging · **Needs:** a Mac or any browser, an Apple ID with two-factor authentication, a D-U-N-S number (organisation), a card for the 99 USD yearly fee, 1Password vault "Thuluth Platform" · **Related:** [eas-builds.md](eas-builds.md), [revenuecat.md](revenuecat.md), [onesignal-and-firebase.md](onesignal-and-firebase.md), [domain-and-dns.md](domain-and-dns.md), [auth-providers.md](auth-providers.md), [password-manager.md](password-manager.md), [`docs/store/`](../store/README.md), [`docs/ops/secrets.md`](../ops/secrets.md), [`docs/ops/production-environment.md`](../ops/production-environment.md)

## What this configures

The Apple Developer account, the App IDs the app is signed with, the App Store Connect app record "Thuluth: Family Nutrition", its subscriptions, TestFlight and the review information. Nothing on iOS can be built for a device, tested by others or sold without it. While it is missing, EAS cannot create iOS credentials, Sign in with Apple and push do not work, and RevenueCat has no products to sell, so the paywall shows its "store unavailable" state.

Menu names in Apple's consoles change often. They may differ slightly from the labels below.

## Before you start

- [ ] Decide **organisation or individual** enrolment (step 1). Organisation is strongly recommended.
- [ ] An Apple ID for the account holder (Tafseer), with two-factor authentication on. Use a shared role mailbox (for example `apple@thuluth.app`) if possible, not a personal address.
- [ ] Access to 1Password vault "Thuluth Platform".
- [ ] The app name is decided: **"Thuluth: Family Nutrition"** (PO decision of 2026-10-06).
- [ ] For the in-app purchase steps you also need [revenuecat.md](revenuecat.md) open in another tab.

## The three app variants (from `apps/mobile/app.config.ts`)

| Environment | `APP_ENV` | Bundle id | Home-screen name | Needs an App Store Connect record? |
|---|---|---|---|---|
| dev | `development` | `app.thuluth.mobile.dev` | Thuluth (Dev) | No. Internal (ad hoc) builds only. |
| staging | `staging` | `app.thuluth.mobile.staging` | Thuluth (Staging) | Yes, if you want TestFlight builds of staging (`staging-store` profile) or sandbox purchases against staging. |
| prod | `production` | `app.thuluth.mobile` | Thuluth | Yes |

The EAS build profile for staging is called `preview`, but the bundle id is `app.thuluth.mobile.staging` (19 §2).

## Steps

### 1. Enrol in the Apple Developer Program

Choose the account type:

| | Organisation (recommended) | Individual |
|---|---|---|
| Seller name on the App Store | The company's legal name | Tafseer's personal name |
| Needs | A registered legal entity, a D-U-N-S number for it, a website on the company domain, authority to sign for the company | Government ID only |
| Team members with roles | Yes | Limited |
| Health apps | Apple asks that apps in regulated fields such as health come from a legal entity (guideline 5.1.1). Thuluth is a wellness app, but an organisation account avoids the question. | Possible, but review may ask about it |

1. If you enrol as an organisation, check for a D-U-N-S number first at the Dun and Bradstreet lookup on developer.apple.com (Account > "Check D-U-N-S"). If the company has none, request one there. It is free and takes up to 5 working days for Pakistan.
2. Install the **Apple Developer** app on an iPhone (fastest), or open https://developer.apple.com/programs/enroll/ in a browser.
3. Sign in with the account holder's Apple ID. Choose **Organization** (or **Individual**). Enter the legal entity name exactly as on the D-U-N-S record.
4. Pay the 99 USD yearly fee. Apple may phone the account holder to confirm the company. Answer that call.
5. When the enrolment email arrives, sign in to https://developer.apple.com/account and note the **Team ID** (Membership details). Save it in 1Password as "shared apple-team-id". It is not secret, but every other runbook needs it, including the `apple-app-site-association` file in [domain-and-dns.md](domain-and-dns.md). That file lists all three bundle ids, because every variant uses `applinks:thuluth.app`.
6. In App Store Connect (https://appstoreconnect.apple.com) > **Business** (or "Agreements, Tax, and Banking"): accept the **Paid Applications Agreement**, add the bank account and fill in the tax forms. Subscriptions cannot be sold, or even tested in sandbox reliably, until this agreement shows "Active".
7. Users and Access > add the people who need access: a developer with role **Developer** for builds, and a finance person with **Finance** if someone else handles payouts. Never share the account holder's Apple ID.

### 2. Create the App IDs

Do this for each bundle id in the table above (three App IDs). EAS can create them automatically on the first `eas build`, but creating them by hand lets you check the capabilities.

1. developer.apple.com > Account > **Certificates, Identifiers & Profiles** > Identifiers > **+** > App IDs > App.
2. Description: `Thuluth Prod` (or `Thuluth Staging`, `Thuluth Dev`). Bundle ID: **Explicit**, `app.thuluth.mobile` (or `.staging`, `.dev`).
3. Tick only the capabilities the app uses:

| Capability | Why (from `app.config.ts`) |
|---|---|
| **Sign in with Apple** | `usesAppleSignIn: true` and the `expo-apple-authentication` plugin. Choose "Enable as a primary App ID". |
| **Associated Domains** | `associatedDomains: ['applinks:thuluth.app']` (household invite links `https://thuluth.app/invite/...`) |
| **Push Notifications** | Added by `onesignal-expo-plugin`. The plugin is only included when `EXPO_PUBLIC_ONESIGNAL_APP_ID` is set for the build, so builds without it carry no push entitlement. Tick it anyway. |
| **App Groups** | Added by `onesignal-expo-plugin` for its notification service extension (group `group.<bundle id>.onesignal`). EAS creates the group and the extension's App ID (`<bundle id>.OneSignalNotificationServiceExtension`) during `eas credentials` or the first build. Let it. |
| **In-App Purchase** | On by default for every explicit App ID. Leave it on. |

Also tick **Time Sensitive Notifications**: `app.config.ts` requests the entitlement `com.apple.developer.usernotifications.time-sensitive`, so suhoor and iftar reminders (sent with `ios_interruption_level: time_sensitive`, `_shared/integrations/onesignal.ts`) break through Focus. EAS capability sync normally turns it on during the build. Do not tick anything else (no HealthKit, no iCloud).

4. Click **Continue** and **Register**.

Note on Sign in with Apple (the Supabase side is in [auth-providers.md](auth-providers.md)): the app signs in natively, so Supabase checks the token audience against the bundle id. Each environment's Supabase Auth > Providers > Apple must list that environment's bundle id (`app.thuluth.mobile` for prod) as a client ID (`docs/ops/secrets.md` §3). An Apple Services ID is a separate identifier, needed only for web sign-in, and cannot reuse an App ID's identifier. [auth-providers.md](auth-providers.md) step 6 creates one as `app.thuluth.signin`.

### 3. Create the keys (one-time, team wide)

Keys > **+**. You can download each `.p8` file only once. Store it in 1Password straight away, then delete the downloaded file.

| Key name | Enable | Used by | 1Password item |
|---|---|---|---|
| `Thuluth APNs` | **Apple Push Notifications service (APNs)**, environment **Sandbox & Production**, team scoped | OneSignal apps (all environments), see [onesignal-and-firebase.md](onesignal-and-firebase.md) | "shared apns-p8-key" (the `.p8` in field "credential", plus the Key ID) |
| `Thuluth Sign in with Apple` | **Sign in with Apple**, primary App ID `app.thuluth.mobile` | Supabase Auth Apple provider secret, only if web sign-in is used (`APPLE_OAUTH_SECRET`, secrets.md §3; see [auth-providers.md](auth-providers.md)) | "prod apple-signin-p8-key" (plus the Key ID) |

Apple allows two APNs keys per team. Keep the second slot free for rotation. You do not need to upload the APNs key to EAS: the app sends pushes through OneSignal, not Expo push (`eas.json` has `promptToConfigurePushNotifications: false`).

### 4. Create the App Store Connect app records

1. App Store Connect > **Apps** > **+** > New App.
2. Fill in:

| Field | prod | staging (optional) |
|---|---|---|
| Platforms | iOS | iOS |
| Name | **Thuluth: Family Nutrition** | Thuluth Staging (any unique name; it is never released) |
| Primary language | English (U.K.) or English (U.S.), PO's choice | same |
| Bundle ID | `app.thuluth.mobile` | `app.thuluth.mobile.staging` |
| SKU | `thuluth-ios-prod` | `thuluth-ios-staging` |
| User access | Full access | Full access |

3. Open the new app > App Information. Note the **Apple ID** number (for example `6400000000`). This is the `ascAppId` that `eas submit` needs ([eas-builds.md](eas-builds.md) step 8). Save it in 1Password as "prod asc-app-id" (and "staging asc-app-id" for the staging record).
4. Set the fields from [`docs/store/app-store.en.md`](../store/app-store.en.md) ("Other App Store Connect fields"): categories Health & Fitness and Food & Drink, privacy policy URL `https://thuluth.app/legal/privacy`, age rating answers.
5. Add Urdu as a localization and paste the text from [`app-store.ur.md`](../store/app-store.ur.md) once the native review (S7-05) is done.

Note: [`docs/store/README.md`](../store/README.md) still says the PO has not confirmed the store title. The title "Thuluth: Family Nutrition" was decided on 2026-10-06; that README needs the same update.

### 5. Create the subscriptions

The ids must match `packages/shared/src/constants/products.ts`. The app finds the plans by RevenueCat package (`$rc_monthly`, `$rc_annual`), but the product ids must still be exactly these so RevenueCat, the store docs and reports agree.

1. In the prod app: **Monetization > Subscriptions** > Subscription Groups > **+**. Reference name: `Thuluth Premium`.
2. In the group, create two subscriptions:

| Reference name | Product ID | Duration | Group level | Free trial |
|---|---|---|---|---|
| Premium Annual | `thuluth_premium_annual` | 1 year | 1 (top) | Introductory offer: Free, 1 week, all territories |
| Premium Monthly | `thuluth_premium_monthly` | 1 month | 2 | none (17 §4.1: monthly starts immediately) |

3. For each subscription: set the price with **Pakistan (PKR) as the base country** using the targets in `17-subscription-architecture.md` §3 (PKR 699 monthly, PKR 4,999 annual), then review the other storefronts against the same table. Add an App Store localization (display name "Thuluth Premium Monthly" / "Thuluth Premium Annual" and a one-line description) in English and Urdu. Add the review screenshot (a screenshot of the paywall) once a build exists.
4. Group localization: display name "Thuluth Premium".
5. App > **App Information** > Billing Grace Period: **On, 16 days, all renewals** (17 §10.1).
6. App Information > **App Store Server Notifications**: paste the URL RevenueCat shows (Apps > the App Store app > "Apple Server to Server notification URL") into both Production and Sandbox, version 2. See [revenuecat.md](revenuecat.md) step 3.
7. Subscriptions created before the first build stay in "Missing Metadata" or "Ready to Submit". The **first** subscription must be submitted together with an app version (select them on the version page under "In-App Purchases and Subscriptions"). Products must be approved before launch (S7-08).

Staging record: Apple product ids are unique across the whole developer account, so the staging app cannot reuse the ids above. If you create the staging record, use `thuluth_premium_annual_staging` and `thuluth_premium_monthly_staging` in a group `Thuluth Premium Staging`. This works because the app selects packages by type, not by product id (`apps/mobile/src/lib/purchases/purchases.ts`).

### 6. Create the API keys

| Key | Where | Settings | Used by | 1Password item |
|---|---|---|---|---|
| App Store Connect API key for EAS | Users and Access > **Integrations** > App Store Connect API > Team Keys > **+** | Name `EAS Submit`, access **App Manager** | `eas submit` and `eas credentials` (uploaded to EAS, step 7) | "shared asc-api-key" (plus Key ID and Issuer ID) |
| In-App Purchase key for RevenueCat | Users and Access > Integrations > **In-App Purchase** > **+** | Name `RevenueCat` | RevenueCat validates StoreKit 2 transactions with it | "shared asc-iap-key-revenuecat" (plus Key ID and Issuer ID) |
| App Store Connect API key for RevenueCat (optional) | Team Keys > **+** | Name `RevenueCat`, access **App Manager** | lets RevenueCat import products and prices | "shared asc-api-key-revenuecat" |

Each `.p8` downloads once. Store it, then delete the download.

### 7. Hand the keys to EAS

From `apps/mobile`, after [eas-builds.md](eas-builds.md) steps 1 to 3:

```bash
eas credentials --platform ios
# choose the production build profile, then "App Store Connect: Manage your API Key" > "Add a new ASC API Key"
# give it the EAS Submit .p8 file, its Key ID and Issuer ID, then "use this key for EAS Submit"
```

Repeat for the `staging-store` profile if you created the staging record. Distribution certificates and provisioning profiles are made in the same menu ([eas-builds.md](eas-builds.md) step 6).

### 8. TestFlight groups

After the first build is uploaded ([eas-builds.md](eas-builds.md) step 7):

1. App > **TestFlight** > Internal Testing > **+** > group `Core`. Add the team (up to 100 App Store Connect users). Turn on "Automatic distribution".
2. External Testing > **+** > group `Family beta` (up to 200 testers, Pakistan and UK, per 19 §5). External builds need a short beta review: fill in "Test Information" with the beta description, feedback email `support@thuluth.app` and the demo account (step 10).
3. Sandbox testers for purchase tests: Users and Access > **Sandbox** > Testers > **+**. Use plus-addressed emails you control (for example `apple+sandbox1@thuluth.app`), region **Pakistan**. Save each in 1Password as "shared apple-sandbox-tester-1", "-2" and so on.

### 9. Privacy labels

App > **App Privacy**:

1. Privacy Policy URL: `https://thuluth.app/legal/privacy`.
2. **Get Started** > answer exactly as [`docs/store/privacy-and-data-safety.md`](../store/privacy-and-data-safety.md) "Apple App Privacy answers" says. Resolve its "Open questions for the PO and legal" first.
3. Publish. Labels are per app, not per version, so re-check them whenever a release adds data collection.

### 10. Review information and demo account

1. Create the reviewer account on `thuluth-prod` as described in [`docs/store/demo-account.md`](../store/demo-account.md). Premium comes from a RevenueCat promotional entitlement ([revenuecat.md](revenuecat.md) step 9).
2. On the version page > **App Review Information**: Sign-in required **on**, user name `reviewer@thuluth.app`, password from 1Password. Contact: the PO's name, phone and email.
3. Notes: paste the text block from [`docs/store/review-notes.md`](../store/review-notes.md).
4. Version Release: **Manually release this version**. Phased release for automatic updates: **on** (launch-runbook §2).

## Where the values go

| Value | Where it is set | Name |
|---|---|---|
| Team ID | `apple-app-site-association` file, OneSignal, RevenueCat | (not a secret) "shared apple-team-id" in 1Password |
| App Store Connect app id | `eas.json` submit profile `ios.ascAppId`, or typed when `eas submit` asks | not an env var |
| APNs key `.p8`, Key ID | OneSignal app settings (Apple iOS platform) | none in the repo |
| ASC API key (EAS) `.p8`, Key ID, Issuer ID | EAS credentials (`eas credentials`) | none in the repo |
| In-App Purchase key `.p8`, Key ID, Issuer ID | RevenueCat > App Store app | none in the repo |
| Sign in with Apple key `.p8` | Supabase Auth > Providers > Apple (only for web sign-in) | `APPLE_OAUTH_SECRET` (secrets.md §3) |
| Bundle ids | Supabase Auth > Providers > Apple > client IDs, one per environment | n/a |
| Reviewer password | App Review Information | 1Password only ("prod reviewer-account") |

## Verify

- developer.apple.com > Identifiers lists `app.thuluth.mobile`, `app.thuluth.mobile.staging` and `app.thuluth.mobile.dev`, each with Sign in with Apple, Associated Domains and Push Notifications.
- Keys lists one APNs key and the key names above.
- App Store Connect > Business shows the Paid Applications Agreement as **Active**.
- The prod app record shows the two subscriptions in group `Thuluth Premium` with prices set (status "Ready to Submit" before the first submission).
- `eas credentials --platform ios` (production profile) shows a distribution certificate, a provisioning profile and the App Store Connect API key.
- After the first TestFlight install, Sign in with Apple works and a household invite link `https://thuluth.app/invite/<token>` opens the app (needs the AASA file from [domain-and-dns.md](domain-and-dns.md)).

## Rotate or revoke

| Item | Cadence | How |
|---|---|---|
| Apple Developer membership | yearly | auto-renew on; check the card before the renewal date |
| Paid Applications Agreement | when Apple updates it | accept new terms in App Store Connect > Business; sales stop until you do |
| APNs key | on suspicion or staff change | create a new APNs key, upload it to every OneSignal app, send a test push, then revoke the old key |
| ASC API key (EAS) | on staff change, or yearly | create a new key, `eas credentials` > replace the key, run a test `eas submit`, revoke the old key |
| In-App Purchase key | on suspicion | create a new key, update RevenueCat, then revoke the old one |
| Sign in with Apple client secret | every 6 months at most (secrets.md §3) | regenerate the JWT from the key and update Supabase; add a calendar reminder |
| Distribution certificate | yearly (expires) | `eas credentials` > remove the old certificate and let EAS make a new one; installed apps keep working |
| Reviewer password | after approval and after any reviewer issue | change it on `thuluth-prod` and update the review fields |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `eas build` fails with "Provisioning profile doesn't support the Push Notifications capability" | The App ID was created without Push Notifications, and the build includes the OneSignal plugin because `EXPO_PUBLIC_ONESIGNAL_APP_ID` is set | Tick Push Notifications on the App ID, then `eas credentials` > remove the provisioning profile so EAS makes a new one |
| Sign in with Apple says "invalid audience" or Supabase returns an error | The environment's bundle id is not in that Supabase project's Apple client IDs | Add the bundle id (for example `app.thuluth.mobile.staging` for staging) in Supabase Auth > Providers > Apple |
| The paywall shows "store unavailable" on a TestFlight build | Paid Applications Agreement not active, products not in "Ready to Submit", or the RevenueCat key is missing from the build | Check Business > Agreements, the subscription status, and `EXPO_PUBLIC_RC_IOS_KEY` in the EAS environment ([revenuecat.md](revenuecat.md)) |
| Invite links open Safari instead of the app | AASA file missing or has the wrong Team ID | Fix `https://thuluth.app/.well-known/apple-app-site-association` per [domain-and-dns.md](domain-and-dns.md); reinstall the app (iOS caches the file) |
| Subscription stuck in "Developer Action Needed" | Missing review screenshot or localization | Add the paywall screenshot and both localizations, then resubmit with the next version |
