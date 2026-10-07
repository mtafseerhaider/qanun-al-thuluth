# EAS (Expo Application Services): configuration runbook

> **Environments:** dev / staging / prod · **Time:** ~60 min first setup, then ~20 min per environment plus build time (15 to 40 min per build) · **Needs:** an Expo account, Node 22 and pnpm 10 on a laptop (or any machine with the repo), `eas-cli` 16 or newer, the Apple and Google accounts from [apple-app-store.md](apple-app-store.md) and [google-play.md](google-play.md), 1Password vault "Thuluth Platform" · **Related:** [apple-app-store.md](apple-app-store.md), [google-play.md](google-play.md), [revenuecat.md](revenuecat.md), [onesignal-and-firebase.md](onesignal-and-firebase.md), [sentry.md](sentry.md), [auth-providers.md](auth-providers.md), [supabase-projects.md](supabase-projects.md), [github-environments.md](github-environments.md), [password-manager.md](password-manager.md), [`docs/ops/launch-runbook.md`](../ops/launch-runbook.md), [`docs/ops/secrets.md`](../ops/secrets.md) §5

## What this configures

EAS builds the iOS and Android apps in the cloud, keeps the signing credentials, uploads builds to the stores (`eas submit`) and ships JavaScript-only fixes over the air (EAS Update). Every public setting the app reads (Supabase URL and key, Sentry DSN, OneSignal, RevenueCat and Google ids) is an EAS environment variable. While EAS is not set up, there are no installable builds, `deploy-dev.yml` skips its "EAS Update" job with the notice "EAS project not connected yet", and `rollback-prod.yml` fails with "EXPO_TOKEN missing". A build made without a variable still starts, but that feature is switched off: no Supabase means no sign-in, no RevenueCat key means "store unavailable", no OneSignal id means no push.

Menu names on expo.dev change from time to time. They may differ slightly from the labels below.

## Before you start

- [ ] The Supabase projects exist and you have each project's URL and publishable (anon) key ([supabase-projects.md](supabase-projects.md)).
- [ ] For iOS device or store builds: Apple Developer enrolment done ([apple-app-store.md](apple-app-store.md) steps 1 to 3).
- [ ] For Android store builds: a Play Console app exists ([google-play.md](google-play.md) steps 1 and 2).
- [ ] Optional values can come later. Each one switches a feature on in the next build: Sentry ([sentry.md](sentry.md)), OneSignal ([onesignal-and-firebase.md](onesignal-and-firebase.md)), RevenueCat ([revenuecat.md](revenuecat.md)), Google sign-in ([auth-providers.md](auth-providers.md)).
- [ ] Install the CLI: `npm install -g eas-cli` and check `eas --version` is 16 or newer (`eas.json` requires `>= 16.0.0`).

## How the profiles map to environments (from `apps/mobile/eas.json`)

| Build profile | `APP_ENV` | Bundle id / package | EAS environment (variables) | Update channel | Distribution | Use it for |
|---|---|---|---|---|---|---|
| `development` | `development` | `app.thuluth.mobile.dev` | `development` | `development` | internal (APK, ad hoc iOS), dev client | developers' phones |
| `development-simulator` | `development` | `app.thuluth.mobile.dev` | `development` | `development` | iOS simulator | simulator work |
| `preview` | `staging` | `app.thuluth.mobile.staging` | `preview` | `staging` | internal | PO, QA, family beta |
| `internal` | `staging` | `app.thuluth.mobile.staging` | `preview` | `internal` | internal, auto-increment | internal testers on their own channel |
| `e2e` | `staging` | `app.thuluth.mobile.staging` | `preview` | `staging` | simulator / APK, no credentials | Maestro tests |
| `staging-store` | `staging` | `app.thuluth.mobile.staging` | `preview` | `staging` | store (TestFlight, Play internal) | optional |
| `production` | `production` | `app.thuluth.mobile` | `production` | `production` | store (`.aab` on Android) | the public app |

Every profile sets `SENTRY_ORG=thuluth` (from `base`). The EAS environment called `preview` holds the **staging** values.

## Steps

### 1. Create the Expo account and organisation

1. Sign up at https://expo.dev/signup with a role mailbox (for example `expo@thuluth.app`). Turn on two-factor authentication (Account settings > Security).
2. Create an organisation: avatar menu > **Create organization**, name `thuluth`. Invite the developers with role **Developer**; keep **Owner** for Tafseer only.
3. Billing: the free plan works for setup. Before launch, move the organisation to a paid plan (Production or Enterprise) so builds are not queued for hours and EAS Update has enough monthly users.
4. Save the login in 1Password as "shared expo-account".

### 2. Create the EAS project and note its id

```bash
cd apps/mobile
eas login                      # the role account
eas init                       # choose owner "thuluth", project slug "thuluth"
```

`app.config.ts` is a dynamic config, so `eas init` cannot write the id into it and prints the project id (a UUID) for you to add by hand. That is expected. The config reads it from the `EAS_PROJECT_ID` environment variable instead. If `eas init` fails, create the project on expo.dev (organisation `thuluth` > Projects > **Create project**, slug `thuluth`) and copy the id from the project's overview page.

The project id is not secret. Save it in 1Password as "shared EAS_PROJECT_ID". From now on, every `eas` command on a laptop needs it in the shell:

```bash
export EAS_PROJECT_ID=<eas-project-id>
eas project:info               # expect: fullName @thuluth/thuluth and the same ID
```

Note: `app.config.ts` has no `owner` field. If `eas` reports that the owner of the project does not match (this happens when the project belongs to the `thuluth` organisation and you are logged in as a person, and always with a robot token), add `owner: 'thuluth'` to `app.config.ts` in a small PR.

### 3. Create the EAS environment variables

The names below are every variable `app.config.ts` reads (checked against the code on 2026-10-06). Use `eas env:create`, or expo.dev > the project > **Environment variables** > Add.

| Name | Visibility | development | preview (staging) | production |
|---|---|---|---|---|
| `EAS_PROJECT_ID` | Plain text | the project id | same | same |
| `EXPO_PUBLIC_SUPABASE_URL` | Plain text | `https://<dev-ref>.supabase.co` | `https://<staging-ref>.supabase.co` (or `https://api.staging.thuluth.app` once its custom domain exists) | `https://api.thuluth.app` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Plain text | dev publishable key | staging publishable key | prod publishable key |
| `EXPO_PUBLIC_SENTRY_DSN` | Plain text | `thuluth-mobile` DSN ([sentry.md](sentry.md)) | same DSN | same DSN |
| `EXPO_PUBLIC_ONESIGNAL_APP_ID` | Plain text | "Thuluth Dev" app id | "Thuluth Staging" app id ([onesignal-and-firebase.md](onesignal-and-firebase.md)) | "Thuluth Prod" app id |
| `EXPO_PUBLIC_RC_IOS_KEY` | Plain text | RevenueCat iOS public key for `app.thuluth.mobile.dev` | for `.staging` | for `app.thuluth.mobile` ([revenuecat.md](revenuecat.md)) |
| `EXPO_PUBLIC_RC_ANDROID_KEY` | Plain text | Android public key for `.dev` | for `.staging` | for `app.thuluth.mobile` |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | Plain text | dev web client id | staging | prod ([auth-providers.md](auth-providers.md)) |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | Plain text | dev iOS client id | staging | prod |
| `EXPO_PUBLIC_HCAPTCHA_SITE_KEY` | Plain text | leave empty unless CAPTCHA is on for `thuluth-dev` | staging site key | prod site key ([auth-providers.md](auth-providers.md) step 4) |
| `SENTRY_AUTH_TOKEN` | **Secret** | optional | yes | yes ([sentry.md](sentry.md)) |

Example for one value:

```bash
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL \
  --value https://api.thuluth.app --visibility plaintext
eas env:create --environment production --name SENTRY_AUTH_TOKEN \
  --value "$SENTRY_AUTH_TOKEN" --visibility secret      # export it from 1Password first, never type it inline
eas env:list --environment production
```

Rules:

- Only `EXPO_PUBLIC_*` values, the project id and the Sentry token go here. Never a Supabase secret or service-role key, an AI key or a webhook secret: every `EXPO_PUBLIC_*` value is visible inside the app.
- Do not set `APP_ENV` or `APP_VARIANT` in EAS. `eas.json` sets them per profile.
- Two things are optional switches. Leaving `EXPO_PUBLIC_ONESIGNAL_APP_ID` empty leaves the OneSignal plugin out of the build (no push entitlement). Leaving `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` empty leaves the Google sign-in plugin out and hides the Google button. Both change the native build, so set them **before** the build, not in an OTA update.
- `secrets.md` §5 shows the production values. Dev and staging use the same names with their own values, as in the table above.

### 4. Create the update channels and branches

`eas.json` already maps profiles to channels. The channels must exist on EAS:

```bash
eas channel:create development
eas channel:create staging
eas channel:create internal
eas channel:create production
eas channel:list                       # each channel points to the branch of the same name
```

The `internal` profile uses its own channel `internal` (19 §4.1). Create it, or the internal builds get no updates.

### 5. Create the Expo access token for GitHub (`EXPO_TOKEN`)

1. expo.dev > organisation `thuluth` > Settings > **Access tokens** > **Robot users** > add robot `github-actions` with role **Developer**.
2. Create a token for the robot. Copy it once.
3. Save it in 1Password as "shared EXPO_TOKEN".
4. GitHub > Settings > Environments: add secret `EXPO_TOKEN` to `development` and to `production` (secrets.md §4), and variable `EAS_PROJECT_ID` to `development`. See [github-environments.md](github-environments.md).

### 6. Signing credentials (`eas credentials`)

Run from `apps/mobile` with `EAS_PROJECT_ID` exported.

**iOS** (once per bundle id):

```bash
eas credentials --platform ios
# pick the build profile (development, preview, production, staging-store)
# "Build Credentials: Manage everything needed to build your project" > "Set up ..." > sign in with the Apple ID
```

EAS creates the distribution certificate (shared by all bundle ids), an ad hoc provisioning profile for `development` and `preview` (it asks you to register test devices with `eas device:create`), and an App Store profile for `production` and `staging-store`. When the OneSignal plugin is active, EAS also creates the profile for the `OneSignalNotificationServiceExtension` target. Then add the App Store Connect API key ([apple-app-store.md](apple-app-store.md) step 7) for `production` (and `staging-store`).

**Android** (once per package):

```bash
eas credentials --platform android
# pick the profile > "Keystore: Manage everything needed to build your project" > "Set up a new keystore"
```

Then, for `production`, "Google Service Account" > upload the EAS submit key ([google-play.md](google-play.md) step 6). Copy the SHA-256 and SHA-1 fingerprints shown for every profile; [google-play.md](google-play.md) step 4 says where they go.

Back up the credentials: `eas credentials` > "credentials.json: Download credentials from EAS to credentials.json". Store the files in 1Password ("prod android-upload-keystore", "shared apple-distribution-certificate"), then delete them from the laptop. Never commit them.

You do not need to give EAS an APNs push key: the app uses OneSignal, not Expo push notifications, so the APNs key goes to OneSignal ([onesignal-and-firebase.md](onesignal-and-firebase.md)).

### 7. First builds

From `apps/mobile`, with `EAS_PROJECT_ID` exported:

```bash
# dev client on your phone (talks to thuluth-dev)
eas build --profile development --platform android
eas build --profile development --platform ios      # register your iPhone first: eas device:create

# staging, for the PO and testers
eas build --profile preview --platform all

# production (store binaries)
eas build --profile production --platform all
```

Each build page on expo.dev shows the variables it used under "Environment variables". Check that the right environment was loaded before you install. `appVersionSource` is `remote`, so EAS owns the build number and version code; `autoIncrement` raises them for store profiles.

### 8. Submit to the stores (`eas submit`)

```bash
eas submit --platform ios --profile production --latest
eas submit --platform android --profile production --latest
```

- iOS: the first time, EAS asks for the App Store Connect app id (the `ascAppId`, [apple-app-store.md](apple-app-store.md) step 4) and uses the API key from step 6. The build appears in TestFlight after Apple's processing (10 to 30 minutes).
- Android: the very first upload must be done by hand in the Play Console ([google-play.md](google-play.md) step 3). After that EAS uploads with the service account.
- Note: the `submit` profiles in `eas.json` are empty (`"production": {}`), so `eas submit` asks questions and cannot run in CI with `--non-interactive`. Before automating submission (20 §7), add `ios.ascAppId`, and `android.track` (`internal`) and `android.releaseStatus` (`draft`) to the `production` submit profile in a PR. If you add `serviceAccountKeyPath`, keep the file under `secrets/`, which `.gitignore` ignores (19 §3). Keeping the key in EAS credentials (step 6) avoids the file entirely.

### 9. OTA updates and channel pinning

A JavaScript-only change can ship as an update. Updates reach only binaries with the same runtime version (policy `fingerprint` in `app.config.ts`), so an update can never require a native module the binary lacks.

Always publish with `--environment` so the update carries that environment's `EXPO_PUBLIC_*` values:

```bash
eas update --branch staging --environment preview --message "v1.0.1+ota.1: fix copy"
eas update --branch production --environment production --message "v1.0.1+ota.1: fix copy" --rollout-percentage 10
```

Why this matters: the values the app reads (`Constants.expoConfig.extra` in `src/lib/env.ts`) come from the update when an update is running. An update published without a variable switches that feature off on every phone that downloads it. `deploy-dev.yml` publishes to the `development` channel with `--environment development`, so keep every variable in the EAS `development` environment: a missing one is missing from every dev update.

Rollout, rollback and channel pinning on production run through `rollback-prod.yml` (Actions > **Production rollout and rollback**, actions `advance-ota`, `republish-ota`, `pin-channel`). The commands and when to use them are in [`launch-runbook.md`](../ops/launch-runbook.md) §5 and §6. Never publish an update to `production` during the iftar window (17:00 to 20:00 PKT in Ramadan).

## Where the values go

| Value | Where it is set | Name |
|---|---|---|
| EAS project id | EAS env (all three), GitHub `development` variable, local shell | `EAS_PROJECT_ID` |
| Public app config | EAS env per environment | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_ONESIGNAL_APP_ID`, `EXPO_PUBLIC_RC_IOS_KEY`, `EXPO_PUBLIC_RC_ANDROID_KEY`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`, `EXPO_PUBLIC_HCAPTCHA_SITE_KEY` |
| Sentry upload token | EAS env, secret visibility | `SENTRY_AUTH_TOKEN` |
| Robot token | GitHub environments `development` and `production` | `EXPO_TOKEN` |
| Apple certificate, profiles, ASC API key | EAS credentials | n/a |
| Android keystore, Play service account | EAS credentials | n/a (GitHub copy: `PLAY_SERVICE_ACCOUNT_JSON`) |
| Local development values | `apps/mobile/.env` (git-ignored; template `apps/mobile/.env.example`) | same names |

## Verify

```bash
cd apps/mobile && export EAS_PROJECT_ID=<eas-project-id>
eas project:info                                  # @thuluth/thuluth
eas env:list --environment production             # all names from the table, SENTRY_AUTH_TOKEN shown as secret
eas channel:list                                  # development, staging, internal, production
eas credentials --platform ios                    # production: certificate, profile, ASC API key all set
npx expo config --type public | grep -E 'bundleIdentifier|package|projectId'
```

- Install the `preview` build. It signs in against staging, and More > Thuluth Premium shows prices (not "store unavailable") once RevenueCat is set.
- In GitHub, run **Deploy dev** (push to `main`): the "EAS Update (development channel)" job runs instead of printing "EAS project not connected yet".
- `eas update:list --branch production --limit 1` after the first production update shows the update group and runtime version.

## Rotate or revoke

| Item | Cadence | How |
|---|---|---|
| `EXPO_TOKEN` | 180 days, and at once when someone with access leaves | expo.dev > Robot users > create a new token, update both GitHub environments, run a workflow, delete the old token |
| `SENTRY_AUTH_TOKEN` | per [sentry.md](sentry.md) | `eas env:update` (or delete and create) in each environment |
| Public `EXPO_PUBLIC_*` values | when the source changes (new Supabase key, new OneSignal app) | update the EAS variable, then make a new build if the plugin set changes, or publish an update with `--environment` |
| Apple distribution certificate | yearly, when it expires | `eas credentials` > remove it; the next build creates a new one |
| Android upload keystore | only if leaked | see [google-play.md](google-play.md) "Rotate or revoke" |
| Expo account login | on staff change | change the password and revoke sessions in Account settings |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `eas build` says the project is not configured, or asks to create a new project | `EAS_PROJECT_ID` is not exported in the shell (`app.config.ts` reads it from the environment) | `export EAS_PROJECT_ID=<eas-project-id>` and run again |
| The app starts but nothing loads, sign-in does nothing | The build had no `EXPO_PUBLIC_SUPABASE_URL` / `_ANON_KEY` (the client is null and features degrade, `src/lib/supabase/client.ts`) | Check the build page's environment variables; fix the EAS environment and rebuild, or publish an update with `--environment` |
| Push or purchases stopped working on dev phones after a merge to `main` | the EAS `development` environment lacks those variables, so `deploy-dev.yml` published an update without them (step 9) | Add them to the EAS `development` environment and run **Deploy dev** again |
| An update never reaches the phones | Runtime version (fingerprint) differs: the update was built from code with native changes | Make a new store or internal build; updates only reach binaries with the same fingerprint |
| iOS build fails on the provisioning profile after adding OneSignal | The App ID lacks Push Notifications or App Groups | [apple-app-store.md](apple-app-store.md) step 2, then `eas credentials` > remove the profile and build again |
| Source maps are not uploaded (Sentry shows minified stacks) | `SENTRY_AUTH_TOKEN` missing from that EAS environment | [sentry.md](sentry.md) step 4 |
