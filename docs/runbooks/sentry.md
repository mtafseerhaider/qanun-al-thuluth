# Sentry: configuration runbook

> **Environments:** one Sentry organisation for dev / staging / prod, separated by the Sentry `environment` tag · **Time:** ~45 min · **Needs:** a Sentry account (Team plan or higher before launch), access to EAS and GitHub settings, 1Password vault "Thuluth Platform" · **Related:** [eas-builds.md](eas-builds.md), [github-environments.md](github-environments.md), [password-manager.md](password-manager.md), [`docs/ops/sentry-alerts.md`](../ops/sentry-alerts.md), [`docs/ops/secrets.md`](../ops/secrets.md), [`docs/ops/production-environment.md`](../ops/production-environment.md) Step 7, [`docs/ops/launch-runbook.md`](../ops/launch-runbook.md)

## What this configures

Sentry collects crashes, errors and performance traces from the mobile app, and gives the crash-free session rate that the launch gate G-QUAL-1 (at least 99.5 percent) and the rollout pause rules depend on. The app only starts Sentry when `EXPO_PUBLIC_SENTRY_DSN` is set (`apps/mobile/src/lib/sentry/init.ts`); without it, crashes are not reported at all and the go/no-go sheet has no crash-free number. Without `SENTRY_AUTH_TOKEN` in the EAS build environment, builds still succeed but source maps are not uploaded, so stack traces are unreadable.

The Edge Functions have no Sentry SDK yet. Their alerting runs through the uptime monitor and a log drain (`sentry-alerts.md` §2). You still create the `thuluth-edge` project now so the name is reserved, but there is no edge DSN to set.

Menu names in Sentry change from time to time. They may differ slightly from the labels below.

## Before you start

- [ ] The EAS project and its environments exist ([eas-builds.md](eas-builds.md) steps 1 to 3).
- [ ] The GitHub environment `production` exists ([github-environments.md](github-environments.md)).
- [ ] The on-call channel (WhatsApp or Slack group) and the on-call email are known (`docs/ops/on-call-rota.md`).

## What the code already decides

| Setting | Value in the code | Where |
|---|---|---|
| Organisation slug | `thuluth` | `SENTRY_ORG` in `apps/mobile/eas.json` (`build.base.env`) |
| Mobile project slug | `thuluth-mobile` | `@sentry/react-native/expo` plugin in `app.config.ts` |
| Upload URL | `https://sentry.io/` | same plugin |
| Environment tag | `development`, `staging` or `production` (the build's `APP_ENV`) | `src/app/bootstrap.ts` |
| Release name | `thuluth-mobile@<version>`, for example `thuluth-mobile@1.0.0` | `src/app/bootstrap.ts` |
| Tags | `eas_update_id`, `eas_channel` on every event | `src/lib/sentry/init.ts` |
| Personal data | `sendDefaultPii: false`, no screenshots, no view hierarchy, user id only (never email), PII scrubber in `src/lib/sentry/scrub.ts` | `init.ts` |
| Traces | 10 percent in production, 100 percent elsewhere | `init.ts` |
| Session replay and user feedback | not used; the replay and feedback modules are replaced by stubs in native bundles | `apps/mobile/metro/native-stubs.js` |

The release name has no build number, so every build of version 1.0.0 reports to release `thuluth-mobile@1.0.0`. `sentry-alerts.md`, `19-deployment-architecture.md` §1 and `20-ci-cd-pipeline.md` §12 use the same names. Because the `eas_update_id` and `eas_channel` tags are set, rule M5 in `sentry-alerts.md` can be created as written.

## Steps

### 1. Create the organisation in the EU region

1. Sign up at https://sentry.io/signup/ with a role mailbox (for example `sentry@thuluth.app`). Turn on two-factor authentication.
2. When asked for the **data storage location**, choose **European Union (EU)**. This cannot be changed later; an organisation created in the US region has to be recreated.
3. Organisation name `Thuluth`, slug **`thuluth`** (must match `SENTRY_ORG`). If the slug is taken, pick another and change `SENTRY_ORG` in `eas.json` and the GitHub variable in step 5 to match.
4. Settings > **Members**: invite developers as **Member**. Keep **Owner** for Tafseer. Settings > Security & Privacy > **Require Two-Factor Authentication**: on.
5. Before launch, move to the **Team** plan (or higher): release health alerts and 90-day retention need a paid plan.

### 2. Create the projects

1. Projects > **Create Project** > platform **React Native** > name **`thuluth-mobile`** > team `#thuluth`. Skip the SDK set-up wizard: the app is already instrumented.
2. Projects > Create Project > platform **Deno** (or "Other") > name **`thuluth-edge`**.
3. `thuluth-mobile` > Settings > **Client Keys (DSN)**: copy the DSN. It is public. Save it in 1Password as "shared EXPO_PUBLIC_SENTRY_DSN".

One DSN serves all three environments. The app tags each event with its environment, so filter by `environment:production` in Sentry.

### 3. Privacy settings

Organisation Settings > **Security & Privacy** (applies to both projects), from `sentry-alerts.md` §4:

1. **Require Data Scrubber**: on. **Require Using Default Scrubbers**: on.
2. **Prevent Storing of IP Addresses**: on.
3. **Global Sensitive Fields**: add `email`, `name`, `display_name`, `notes`, `text`, `body`, `description`, `allergies`, `conditions`, `weight`, `height`, `token`, `authorization`, `apikey`.
4. Session Replay: do not enable it and do not add the replay integration. The app ships without the replay code (metro stubs), so there is nothing to switch off in the app.
5. User Feedback widget: leave unused for the same reason.
6. Data retention: 90 days (plan setting, organisation Settings > Subscription).

Each project also has Settings > **Security & Privacy**. Leave its scrubbing settings at "inherit".

### 4. Auth token for source maps (EAS builds)

1. Organisation Settings > **Developer Settings** > **Organization Tokens** (or "Auth Tokens") > **Create New Token**. Name `eas-build`. Organisation tokens carry the scope needed to create releases and upload source maps (`org:ci`). If you use a personal token instead, give it `project:releases` and `org:read`.
2. Copy it once. Save it in 1Password as "shared SENTRY_AUTH_TOKEN".
3. Put it in EAS with **secret** visibility, for each environment whose builds should upload maps (at least `preview` and `production`):

```bash
export SENTRY_AUTH_TOKEN=...   # from 1Password, never typed inline
eas env:create --environment production --name SENTRY_AUTH_TOKEN --value "$SENTRY_AUTH_TOKEN" --visibility secret
eas env:create --environment preview    --name SENTRY_AUTH_TOKEN --value "$SENTRY_AUTH_TOKEN" --visibility secret
```

4. Put the DSN in EAS, all three environments ([eas-builds.md](eas-builds.md) step 3):

```bash
eas env:create --environment production --name EXPO_PUBLIC_SENTRY_DSN --value <thuluth-mobile-dsn> --visibility plaintext
# repeat for preview and development
```

During an EAS build, the `@sentry/react-native/expo` plugin uploads the Hermes bundle and its source maps to `thuluth/thuluth-mobile` whenever `SENTRY_AUTH_TOKEN` is present. Nothing else is needed for store and internal builds.

For OTA updates, maps are not uploaded automatically. After an `eas update`, run from `apps/mobile` with `SENTRY_AUTH_TOKEN`, `SENTRY_ORG=thuluth` and `SENTRY_PROJECT=thuluth-mobile` exported:

```bash
npx sentry-expo-upload-sourcemaps dist
```

### 5. GitHub

In GitHub > Settings > Environments > `production` (secrets.md §4; [github-environments.md](github-environments.md)):

- Secret `SENTRY_AUTH_TOKEN` = the token from step 4.
- Variable `SENTRY_ORG` = `thuluth`.

Note: no workflow in `.github/workflows/` reads `SENTRY_AUTH_TOKEN` or `SENTRY_ORG` yet. They are for the future mobile release job and edge release step (`20-ci-cd-pipeline.md` §7 and §12). Set them now so that job works when it lands.

### 6. Alert rules

Create the rules exactly as written in [`docs/ops/sentry-alerts.md`](../ops/sentry-alerts.md) §1 (M1 to M6 on `thuluth-mobile`, environment `production`).

1. Settings > **Integrations**: connect Slack if the on-call channel is Slack. For WhatsApp, use email alerts to the on-call address and the phone app's push.
2. Alerts > **Create Alert** > for each rule, pick the type (metric or issue), copy the condition, filter and action from the table.
3. Name each rule with its id, for example `M1 Crash-free sessions below gate`, so it matches the doc.
4. Edge rules E1 to E6 are **not** Sentry rules today. They live in the uptime monitor and the log drain.

## Where the values go

| Value | Where it is set | Name |
|---|---|---|
| `thuluth-mobile` DSN | EAS env, all three environments | `EXPO_PUBLIC_SENTRY_DSN` |
| Org auth token | EAS env (secret visibility), `preview` and `production` | `SENTRY_AUTH_TOKEN` |
| Org auth token | GitHub environment `production` secret | `SENTRY_AUTH_TOKEN` |
| Org slug | `eas.json` (already `thuluth`), GitHub `production` variable | `SENTRY_ORG` |
| Edge DSN | nowhere yet; do **not** set `SENTRY_DSN` until the functions read it (secrets.md §1) | `SENTRY_DSN` (future) |

## Verify

1. `eas env:list --environment production` shows `EXPO_PUBLIC_SENTRY_DSN` and `SENTRY_AUTH_TOKEN` (secret).
2. Build `preview` ([eas-builds.md](eas-builds.md) step 7). In the build log, the iOS "Bundle React Native code and images" phase and the Android `createBundleReleaseJsAndAssets` / Sentry upload task print that source maps were uploaded, with no "auth token" warning.
3. Open the app on the build and use it for a minute. In Sentry > **Releases**, filter environment `staging`: release `thuluth-mobile@1.0.0` appears with sessions.
4. Throw a test error from a development build (for example a temporary button that calls `captureException(new Error('sentry test'))`, never committed). The issue appears in `thuluth-mobile` with environment `development`, a readable stack trace, tags `eas_update_id` and `eas_channel`, and no email or name in the event (check the JSON).
5. Organisation Settings > General shows the data region **EU**.

## Rotate or revoke

| Item | Cadence | How |
|---|---|---|
| `SENTRY_AUTH_TOKEN` | 180 days, and at once on staff change or leak | Create a new organisation token, update EAS (`preview`, `production`) and the GitHub secret, run a build and check the upload, then revoke the old token |
| DSN | only if it is abused (spam events) | `thuluth-mobile` > Client Keys > create a new key, update `EXPO_PUBLIC_SENTRY_DSN` in EAS, ship a build or an update with `--environment`, then disable the old key after the old versions fade out |
| Members | on staff change | remove them in Settings > Members |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No events at all from a build | `EXPO_PUBLIC_SENTRY_DSN` missing for that EAS environment, so `initSentry` does nothing | Set it and rebuild, or publish an update with `--environment` |
| Stack traces are minified (`index.android.bundle:1:23456`) | No `SENTRY_AUTH_TOKEN` in that EAS environment, or an OTA update whose maps were not uploaded | Step 4; run `npx sentry-expo-upload-sourcemaps dist` after each update |
| Build log: "organization not found" or 401 from Sentry | Slug is not `thuluth`, or the token belongs to another organisation | Make `SENTRY_ORG` match the real slug; create the token in the right organisation |
| Upload fails with a region or URL error | The plugin's `url` is `https://sentry.io/` and the organisation is in the EU region | Use an organisation token (it carries the EU region). If it still fails, change `url` in `app.config.ts` to `https://de.sentry.io/` in a PR |
| Crash-free rate missing on the release page | Looking for a release named after the bundle id (`app.thuluth.mobile@...`) | The release is `thuluth-mobile@<version>` (see "What the code already decides") |
| Events contain personal data | A new field name the scrubber does not know | Add it to Global Sensitive Fields now, and to `SENSITIVE_KEY` in `src/lib/sentry/scrub.ts` in a PR |
