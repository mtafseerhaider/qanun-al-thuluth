# Sign-in providers (Google, Apple, hCaptcha): configuration runbook

> **Environments:** dev / staging / prod · **Time:** ~60 min for the first environment, ~20 min for each further one · **Needs:** Google Cloud owner access, Apple Developer account (Account Holder or Admin), an hCaptcha account, Supabase project owner, the EAS CLI (`eas env:*`), access to vault "Thuluth Platform" · **Related:** `11-authentication.md` §2 to §5, [`../ops/secrets.md`](../ops/secrets.md) §3 and §5, [`supabase-projects.md`](supabase-projects.md), [`eas-builds.md`](eas-builds.md), [`apple-app-store.md`](apple-app-store.md), [`google-play.md`](google-play.md), [`password-manager.md`](password-manager.md)

Console menu names (Google Cloud, Apple Developer, hCaptcha, Supabase) change often. The menu names in this runbook may differ slightly from what you see.

## What this configures

Thuluth users sign in three ways: a 6-digit email code, Google (native, both platforms) or Apple (native, iOS only). Google and Apple sign-in happen inside the app with the platform SDK. The app then hands the provider's ID token to Supabase (`signInWithIdToken` in `apps/mobile/src/lib/auth/google.ts` and `apple.ts`), and Supabase checks that the token was issued for one of the client IDs you list. Each environment has its own bundle id, so each environment needs its own client IDs. While Google is not configured, the app hides the Google button. While Apple is not configured, Apple sign-in fails on iOS. That blocks App Review, because Apple requires Sign in with Apple whenever Google sign-in is offered.

App identifiers per environment (from `apps/mobile/app.config.ts`):

| Environment | iOS bundle id and Android package | Supabase project | EAS environment (`eas.json`) |
|---|---|---|---|
| dev | `app.thuluth.mobile.dev` | `thuluth-dev` | `development` |
| staging | `app.thuluth.mobile.staging` | `thuluth-staging` | `preview` |
| prod | `app.thuluth.mobile` | `thuluth-prod` | `production` |

The Supabase callback URL for each environment is `https://<ref>.supabase.co/auth/v1/callback`. Prod also uses `https://api.thuluth.app/auth/v1/callback`, and staging uses `https://api.staging.thuluth.app/auth/v1/callback` if that custom domain is active.

## Before you start

- The Supabase project for this environment exists ([`supabase-projects.md`](supabase-projects.md) steps 1 to 5).
- The Apple Developer team ID is known (Apple Developer > Membership details). It is not secret.
- For Android Google sign-in you need the SHA-1 fingerprint of each signing key: run `eas credentials -p android` and pick the build profile. For prod you also need the Play App Signing SHA-1 from Play Console > Test and release > App integrity ([`google-play.md`](google-play.md)).
- The legal pages exist: `https://thuluth.app/legal/privacy` and `https://thuluth.app/legal/terms`.

## Steps

### 1. Google: project and consent screen (once for all environments)

1. In the Google Cloud console, create one project for sign-in, for example "Thuluth Sign-in". One project keeps one consent screen that users recognise. Each environment gets its own clients inside it.
2. Open **Google Auth Platform > Branding** (formerly "OAuth consent screen"):
   - App name `Thuluth`, user support email `support@thuluth.app`, the app logo.
   - App home page `https://thuluth.app`, privacy policy `https://thuluth.app/legal/privacy`, terms `https://thuluth.app/legal/terms`.
   - Authorized domains: `thuluth.app` and `supabase.co`.
   - Developer contact: the PO's address.
3. **Audience:** user type **External**, then **Publish app** (status "In production"). While the status is "Testing", only listed test users can sign in.
4. **Data access (scopes):** `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`. The app asks only for `email` and `profile`. These scopes are not sensitive, so no Google review is needed beyond the brand check.

### 2. Google: clients for each environment

In **Google Auth Platform > Clients > Create client**, create these three clients for each environment. Name them so the environment is obvious, for example "Thuluth prod web".

| Client type | Values to enter | What you copy |
|---|---|---|
| **Web application** | Authorized redirect URIs: `https://<ref>.supabase.co/auth/v1/callback`. Prod: also `https://api.thuluth.app/auth/v1/callback`. Staging: also `https://api.staging.thuluth.app/auth/v1/callback` if active | client ID and **client secret** |
| **iOS** | Bundle ID from the table above (for example `app.thuluth.mobile`), Team ID | client ID |
| **Android** | Package name from the table above, SHA-1 of the signing key. Prod: create a second Android client with the Play App Signing SHA-1 | nothing; Google matches it by package and SHA-1 |

Save in 1Password:

- `<env> GOOGLE_OAUTH_CLIENT_ID` = the web client ID (not secret, but kept together).
- `<env> GOOGLE_OAUTH_SECRET` = the web client secret.
- `<env> google-ios-client-id` = the iOS client ID.

### 3. Google: Supabase and EAS

**Supabase** (that environment's project): **Authentication > Sign In / Providers > Google**:

- Enable **Sign in with Google**.
- **Client IDs:** `<web client ID>,<iOS client ID>` (web first, comma-separated, no spaces).
- **Client Secret (for OAuth):** the web client secret.
- **Skip nonce checks:** **on**. The iOS Google SDK puts a nonce in the token that the app cannot read (`config.toml` `skip_nonce_check = true`, 11 §4.3).

> **Note:** `config.toml` takes a single `GOOGLE_OAUTH_CLIENT_ID` for the local stack. 11 §2 lists web, iOS and Android IDs together. On hosted projects, list the web and iOS IDs as above. The Android client ID is never sent anywhere: the app passes the **web** ID as `webClientId`, so Android tokens carry the web ID as their audience.

**EAS** (the public IDs go into the app; never the secret):

```bash
cd apps/mobile
eas env:create --environment production --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID --value <web client ID> --visibility plaintext
eas env:create --environment production --name EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID --value <iOS client ID> --visibility plaintext
```

Use `--environment development` for dev and `--environment preview` for staging. `app.config.ts` turns the iOS client ID into the reversed URL scheme for the Google plugin. This is native configuration, so a **new build** is needed after you set or change `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`. An OTA update is not enough ([`eas-builds.md`](eas-builds.md)).

Dev OTA updates from `deploy-dev.yml` use `eas update --environment development`, so they carry the Google client IDs from the EAS `development` environment ([`github-environments.md`](github-environments.md)).

### 4. hCaptcha (keys first, Supabase last)

CAPTCHA protects the email-code request. The app sends a `captchaToken` with `signInWithOtp` only when the build was made with `EXPO_PUBLIC_HCAPTCHA_SITE_KEY` set (`apps/mobile/app.config.ts`). Once CAPTCHA is on in Supabase, every request **without** a token is refused, so any build without the CAPTCHA code (or without the site key) can no longer sign in. Do the steps in this order, per environment:

1. In the hCaptcha dashboard, add a site for the environment (for example "Thuluth prod"). Copy the **site key**. The account **secret** is under the account settings. Save them in 1Password as `<env> hcaptcha-site-key` and `<env> HCAPTCHA_SECRET`.
2. Set the site key in EAS for that environment (`development`, `preview` or `production`):

   ```bash
   eas env:create --environment production --name EXPO_PUBLIC_HCAPTCHA_SITE_KEY --value <site key> --visibility plaintext
   ```

3. Ship a **new build** made with that variable ([`eas-builds.md`](eas-builds.md) step 7). The CAPTCHA widget adds native modules (`@hcaptcha/react-native-hcaptcha`, `react-native-webview`), so an OTA update cannot add it to an older binary. Check on a phone that email sign-in still works with CAPTCHA still off in Supabase.
4. Only when that build is the **minimum supported version** (`app.min_supported_version`, [`feature-flags-and-app-config.md`](feature-flags-and-app-config.md)), so every phone that can still sign in sends a token, turn CAPTCHA on in Supabase: **Authentication > Attack Protection**, enable CAPTCHA, choose **hCaptcha**, paste the secret. Do it on staging first, then prod. Never turn it on before that build is the minimum supported version. Even then, a signed-out person on an older build sees a sign-in error rather than the update screen, because the app reads `app.min_supported_version` only after sign-in; so wait until few active installs run older builds.
5. Test at once: request an email code on the new build (it arrives), and check the store reviewer can still sign in.

For the launch, set the site key in EAS before the first store build, so the launch build (`1.0.0`, the minimum supported version) already sends tokens. CAPTCHA can then be turned on right after launch.

### 5. Apple: App IDs (every environment)

1. In Apple Developer > **Certificates, Identifiers & Profiles > Identifiers**, find the App ID for the environment's bundle id (`app.thuluth.mobile`, `.staging` or `.dev`). EAS creates it on the first build; if it does not exist yet, create it as an explicit App ID.
2. Open it and tick **Sign In with Apple**. Choose **Enable as a primary App ID**. Save. EAS also turns this capability on during a build, because `app.config.ts` sets `usesAppleSignIn: true`. Checking it by hand is still worth it.
3. In Supabase (that environment's project), **Authentication > Sign In / Providers > Apple**: enable it and set **Client IDs** to that environment's bundle id. For example, `thuluth-dev` gets `app.thuluth.mobile.dev`.

That is all that native Sign in with Apple needs. Supabase checks that the token's audience is in the Client IDs list and that the nonce matches.

> **Note:** `config.toml` lists only `app.thuluth.mobile`, so a local dev build (`app.thuluth.mobile.dev`) cannot use Apple sign-in against the local stack. 11 §2 lists all three bundle ids in one project. On hosted projects, list each environment's own bundle id.

### 6. Apple: key, Services ID and client secret (prod; optional for dev and staging)

The native flow above does not need a client secret. You need a key and a Services ID for two things: a future web or Android Apple sign-in, and Apple's token revocation when a user deletes their account (App Store rule for apps with Sign in with Apple). [`../ops/secrets.md`](../ops/secrets.md) §3 lists the secret for prod. Create the key now. It also covers revocation later.

> **Note:** `supabase/functions/account-delete` has a `revokeApple` hook, but nothing wires it up and no function reads an Apple key or secret. Account deletion logs `apple_revoke_not_configured` today. This is an open PO decision before App Review ([README.md](README.md) "Decisions still needed").

1. **Key:** **Keys > +**, name "Thuluth Sign in with Apple", tick **Sign in with Apple**, **Configure** with primary App ID `app.thuluth.mobile`, then **Continue > Register > Download**. You can download the `.p8` file only once. Save it in 1Password as `prod apple-signin-p8-key` (attach the file) and note the **Key ID**.
2. **Services ID:** **Identifiers > + > Services IDs**. Give it a description and a **new** identifier, for example `app.thuluth.signin`. It cannot reuse the bundle id `app.thuluth.mobile`, because Apple identifiers must be unique.
3. Open the Services ID, tick **Sign In with Apple > Configure**: primary App ID `app.thuluth.mobile`. Domains: `api.thuluth.app` and `<prod-ref>.supabase.co`. Return URLs: `https://api.thuluth.app/auth/v1/callback` and `https://<prod-ref>.supabase.co/auth/v1/callback`. Save.

Apple will not accept a Services ID with the same identifier as the App ID, so use a separate identifier and record it in the 1Password item (`secrets.md` §3).

4. **Client secret JWT.** Apple's "client secret" is a JWT that you sign with the `.p8` key. **It expires after 6 months at most.** Generate it on your own laptop. Save this script outside the repo as `~/thuluth-secrets/apple-secret.js`:

```js
// usage: node apple-secret.js <TEAM_ID> <KEY_ID> <SERVICES_ID> <path to .p8>
const fs = require('fs');
const crypto = require('crypto');
const [teamId, keyId, clientId, p8] = process.argv.slice(2);
const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const head = enc({ alg: 'ES256', kid: keyId });
const body = enc({ iss: teamId, iat: now, exp: now + 15777000, aud: 'https://appleid.apple.com', sub: clientId });
const sig = crypto
  .sign('sha256', Buffer.from(`${head}.${body}`), { key: fs.readFileSync(p8), dsaEncoding: 'ieee-p1363' })
  .toString('base64url');
process.stdout.write(`${head}.${body}.${sig}`);
```

```bash
node ~/thuluth-secrets/apple-secret.js <TEAM_ID> <KEY_ID> app.thuluth.signin ~/Downloads/AuthKey_<KEY_ID>.p8 | pbcopy
```

`15777000` seconds is Apple's maximum, about 182 days. Paste the result into 1Password as `prod APPLE_OAUTH_SECRET` and note the expiry date. Delete the downloaded `.p8` file once it is attached in 1Password.

5. In Supabase prod, **Authentication > Sign In / Providers > Apple**: set **Client IDs** to `app.thuluth.mobile,app.thuluth.signin` (bundle id first) and paste the JWT into **Secret Key (for OAuth)**. Save.
6. Add a calendar reminder **5 months** from today: "Regenerate Apple client secret (Thuluth prod)".

### 7. Redirect URLs (every environment)

These are set in [`supabase-projects.md`](supabase-projects.md) step 4: Site URL `https://thuluth.app`, Redirect URLs `thuluth://auth-callback` and `https://thuluth.app/auth/callback` (dev also `exp+thuluth://auth-callback`). The provider consoles need only the Supabase callback URLs from steps 2 and 6.

## Where the values go

| Value | Where it is set | Name |
|---|---|---|
| Google web client ID | Supabase Google provider "Client IDs" (first); EAS env | `GOOGLE_OAUTH_CLIENT_ID` (config.toml terms); `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` |
| Google iOS client ID | Supabase Google provider "Client IDs" (second); EAS env | `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` |
| Google web client secret | Supabase Google provider "Client Secret" only | `GOOGLE_OAUTH_SECRET` (config.toml terms) |
| Google Android client | Google Cloud only | (none) |
| Apple bundle id | Supabase Apple provider "Client IDs" | `app.thuluth.mobile` / `.staging` / `.dev` |
| Apple Services ID | Supabase Apple provider "Client IDs" (prod) | for example `app.thuluth.signin` |
| Apple client secret JWT | Supabase Apple provider "Secret Key (for OAuth)" | `APPLE_OAUTH_SECRET` (config.toml terms) |
| Apple `.p8` key | 1Password only | `prod apple-signin-p8-key` |
| hCaptcha secret | Supabase Attack Protection (step 4.4, last) | `HCAPTCHA_SECRET` |
| hCaptcha site key | EAS env, per environment | `EXPO_PUBLIC_HCAPTCHA_SITE_KEY` |

## Verify

1. Build or install the environment's app ([`eas-builds.md`](eas-builds.md)).
2. **Google on Android and iOS:** tap Continue with Google, pick an account. You land in onboarding or Today.
3. **Apple on iOS:** tap Sign in with Apple. You land in the app. Signing in with Apple and then Google with the same email gives the same account (automatic linking, 11 §6.1).
4. In the SQL editor:

```sql
select u.email, i.provider, i.last_sign_in_at
  from auth.identities i join auth.users u on u.id = i.user_id
 order by i.last_sign_in_at desc limit 5;
```

You should see `google` and `apple` rows for your test account.

5. **Email code:** request a code. You should receive a 6-digit code, not a link.

## Rotate or revoke

| Item | Cadence | How |
|---|---|---|
| Apple client secret JWT | **before 6 months** | step 6.4 and 6.5 with the same key; update 1Password and the reminder |
| Apple `.p8` key | yearly (19 §8), or at once if leaked | create a new key (step 6.1), regenerate the JWT, update Supabase, then revoke the old key in Apple Developer |
| Google web client secret | on suspicion | Google Auth Platform > Clients > the web client > **Add secret**, paste the new one in Supabase, then disable and delete the old secret |
| hCaptcha secret | on suspicion | rotate in hCaptcha, update Supabase |
| Client IDs | never (they are identifiers) | a new client means a new app build for the iOS ID |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| No Google button in the app | `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` missing, or on iOS `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` missing (`isGoogleSignInConfigured`) | step 3, then a new build |
| Google sign-in error "Unacceptable audience in id_token" | the web or iOS client ID is not in the Supabase "Client IDs" list, or belongs to another environment | step 3 |
| Android Google sign-in fails with `DEVELOPER_ERROR` | package name or SHA-1 does not match an Android client (prod builds from Play are signed by the Play App Signing key) | add an Android client with the right SHA-1 (step 2) |
| Only some testers can use Google | consent screen still in "Testing" | step 1.3: publish the app |
| Apple sign-in fails with an audience error on dev or staging | the Apple "Client IDs" field holds the prod bundle id | step 5.3: use that environment's bundle id |
| Every email code request fails right after CAPTCHA was turned on | the build in use has no CAPTCHA code or was made without `EXPO_PUBLIC_HCAPTCHA_SITE_KEY`, so it sends no `captchaToken` | turn CAPTCHA off in Supabase, then follow step 4 in order |
