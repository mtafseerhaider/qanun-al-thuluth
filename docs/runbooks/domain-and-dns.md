# Domain and DNS: configuration runbook

> **Environments:** one domain for all (`thuluth.app`); per-environment records for `api` (prod) and `api.staging` (staging) · **Time:** ~30 min for the domain and zone, ~60 min for the website files, plus waiting for DNS and Apple's CDN · **Needs:** a Cloudflare account with two-factor authentication, a card for the yearly domain fee, Node 22 with `npx` (for `wrangler`), the Apple Team ID, the Android signing fingerprints, 1Password vault "Thuluth Platform" · **Related:** [postmark-email.md](postmark-email.md), [uptime-and-status-page.md](uptime-and-status-page.md), [apple-app-store.md](apple-app-store.md), [eas-builds.md](eas-builds.md), [auth-providers.md](auth-providers.md), [password-manager.md](password-manager.md), [`19-deployment-architecture.md`](../19-deployment-architecture.md) §9, [`docs/ops/production-environment.md`](../ops/production-environment.md) Step 1, [`docs/ops/secrets.md`](../ops/secrets.md)

## What this configures

The domain `thuluth.app`, its Cloudflare DNS zone and the small static website on Cloudflare Pages that serves the link-verification files (`apple-app-site-association`, `assetlinks.json`), the invite landing page and the legal pages. The API custom domain `api.thuluth.app` also lives here.

**Household invites depend on this runbook.** On 2026-10-06 the PO decided that invite links work only as `https` universal links (iOS) and app links (Android). The `thuluth://` custom-scheme form is being dropped. The backend always builds invite links as `https://thuluth.app/invite/<token>` (`packages/shared/src/contracts/household-invite.ts`, `inviteShareUrl`). Until the two `.well-known` files below are live and correct, tapping an invite link opens a web page instead of the app, and nobody can join a household.

While `api.thuluth.app` is missing, the production app has no stable API address. `EXPO_PUBLIC_SUPABASE_URL`, the Vault `project_url`, the RevenueCat webhook and the OAuth callbacks all expect it (`secrets.md` §2, §5, §6).

Menu names in Cloudflare, Supabase and the registrar dashboards may differ slightly from the labels below.

## Before you start

- [ ] A Cloudflare account for Thuluth, owned by a role address you control, with two-factor authentication on. Save the login in 1Password as "shared cloudflare-login".
- [ ] The Apple **Team ID** (1Password "shared apple-team-id", from [apple-app-store.md](apple-app-store.md) step 1).
- [ ] The Android **SHA-256 signing fingerprints**: the Play App Signing key and the upload key from Play Console, and the EAS keystore fingerprint for each variant (`eas credentials -p android`, see [eas-builds.md](eas-builds.md)). You can publish the files first with the fingerprints you have and add the rest later.
- [ ] The `thuluth-prod` Supabase project exists with the custom domain add-on available (Pro plan), for step 6. The `thuluth-staging` project exists for the staging record.
- [ ] Decide which status page provider you use ([uptime-and-status-page.md](uptime-and-status-page.md)) before step 7. You can add that record later.

## Steps

### 1. Register or transfer the domain

1. If `thuluth.app` is not registered yet, register it at **Cloudflare Registrar** (Domain Registration > Register Domains). Cloudflare sells `.app` at cost and puts the DNS zone in the same account, which saves step 2. Any registrar works if you prefer another one.
2. If it is already registered elsewhere, either transfer it to Cloudflare (Domain Registration > Transfer Domains, needs the auth code from the old registrar) or keep it there and only point its nameservers at Cloudflare in step 2.
3. Turn on **auto-renew** and the **registrar lock** (transfer lock). Add the renewal date to the calendar in [password-manager.md](password-manager.md) step 8 anyway, so a failed card does not lose the domain.
4. Registrant contact: use a role address (for example `domains@thuluth.app`, see step 8) and turn on WHOIS privacy (free on Cloudflare).

**About `.app`:** the whole `.app` top-level domain is on the browsers' HSTS preload list. Every browser refuses plain `http://` for `thuluth.app` and all its subdomains. There is nothing to configure, but it means every name you create under `thuluth.app` (`status`, `api`, `www`) must have a valid TLS certificate before anyone can open it. Cloudflare Pages, Supabase custom domains and Better Stack all issue certificates automatically; it can take up to 15 minutes after the DNS record appears.

### 2. Create the Cloudflare zone

1. Cloudflare dashboard > **Add a domain** > `thuluth.app` > Free plan.
2. If the domain is not at Cloudflare Registrar, copy the two Cloudflare nameservers to your registrar and wait until Cloudflare shows the zone as **Active**.
3. DNS > Settings > **DNSSEC** > Enable. At Cloudflare Registrar this is one click. At another registrar, copy the DS record Cloudflare shows into the registrar.
4. SSL/TLS > Overview > mode **Full (strict)**. SSL/TLS > Edge Certificates > **Always Use HTTPS** on (the HSTS preload already forces this in browsers; this covers other clients).
5. Do **not** add CAA records. Pages, Supabase and the status page each use a different certificate authority, and a wrong CAA record silently stops certificate renewal.

### 3. Create the website project on Cloudflare Pages (`thuluth-web`)

This repo has no website app. The site is a folder of static files. Keep it in its own small repository (for example `thuluth-web`) or in a folder on your machine, and deploy it with Wrangler. Do not put it inside this repo unless a developer adds it as an app.

Create this folder layout (the file contents follow in steps 4 and 5):

```text
site/
  _headers
  _redirects
  .well-known/
    apple-app-site-association      (no file extension)
    assetlinks.json
    security.txt
  invite/
    index.html
  legal/
    privacy/index.html
    terms/index.html
  support/index.html
  delete-account/index.html
  index.html
```

`site/_headers`:

```text
/.well-known/apple-app-site-association
  Content-Type: application/json
  Cache-Control: public, max-age=3600

/.well-known/assetlinks.json
  Content-Type: application/json
  Cache-Control: public, max-age=3600

/invite/*
  Cache-Control: no-store
  Referrer-Policy: no-referrer
  X-Robots-Tag: noindex, nofollow
```

`site/_redirects`:

```text
/invite/*   /invite/index.html   200
/terms      /legal/terms         301
/privacy    /legal/privacy       301
```

The first line serves the same landing page for every token without redirecting, so the address bar keeps the token. The last two exist because the app's paywall links to `https://thuluth.app/terms` and `https://thuluth.app/privacy` (`apps/mobile/src/features/subscription/screens/paywall-screen.tsx`), while the store listings in `docs/store/` use `/legal/terms` and `/legal/privacy`. Note: the code and the store docs disagree on these paths; the redirects make both work.

Deploy:

```bash
npx wrangler login
npx wrangler pages project create thuluth-web --production-branch main
npx wrangler pages deploy site --project-name thuluth-web --branch main
```

Then in the dashboard: Workers & Pages > `thuluth-web` > **Custom domains** > Set up a custom domain > `thuluth.app`. Cloudflare creates the flattened apex CNAME for you. Add `www.thuluth.app` the same way, then Rules > **Redirect Rules** > Create rule: hostname equals `www.thuluth.app`, static redirect to `https://thuluth.app${uri path}` (dynamic), status 301, preserve query string.

Do **not** turn on Cloudflare Web Analytics for this project. The invite page URL contains the invite token, and 19 §9.4 says the website must never log it.

### 4. Publish the link-verification files

The values come from `apps/mobile/app.config.ts`:

- iOS: `associatedDomains: ['applinks:thuluth.app']` for **every** variant (no `webcredentials` entry).
- Android: one `intentFilters` entry with `autoVerify: true`, host `thuluth.app`, `pathPrefix: '/invite'`, for **every** variant.
- Bundle ids and packages: `app.thuluth.mobile` (prod), `app.thuluth.mobile.staging` (staging), `app.thuluth.mobile.dev` (dev).

So the one domain `thuluth.app` must list all three apps, or dev and staging builds can never open invite links. Only `/invite` is claimed today. The app's navigation also accepts `https://thuluth.app` links for other screens (`apps/mobile/src/navigation/linking.ts`), but the operating systems only hand a link to the app for paths listed in these files and in the intent filter, so add a path here only after a developer adds it to `app.config.ts`.

19 §9.2 and §9.3 show the same files.

`site/.well-known/apple-app-site-association` (replace `<APPLE_TEAM_ID>` with the 10-character Team ID; keep prod first, because iOS uses the first matching entry when more than one variant is installed):

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": [
          "<APPLE_TEAM_ID>.app.thuluth.mobile",
          "<APPLE_TEAM_ID>.app.thuluth.mobile.staging",
          "<APPLE_TEAM_ID>.app.thuluth.mobile.dev"
        ],
        "components": [
          { "/": "/invite/*", "comment": "Household invitation acceptance" }
        ]
      }
    ]
  }
}
```

`site/.well-known/assetlinks.json` (replace each fingerprint placeholder with the colon-separated SHA-256 value, for example the format `AB:CD:...`; remove a placeholder line if that key does not exist yet):

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "app.thuluth.mobile",
      "sha256_cert_fingerprints": [
        "<PLAY_APP_SIGNING_KEY_SHA256>",
        "<PLAY_UPLOAD_KEY_SHA256>"
      ]
    }
  },
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "app.thuluth.mobile.staging",
      "sha256_cert_fingerprints": ["<EAS_STAGING_KEYSTORE_SHA256>"]
    }
  },
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "app.thuluth.mobile.dev",
      "sha256_cert_fingerprints": ["<EAS_DEV_KEYSTORE_SHA256>"]
    }
  }
]
```

Where the fingerprints come from:

| Fingerprint | Where to read it |
|---|---|
| Play App Signing key (prod installs from Google Play) | Play Console > Thuluth > Test and release > Setup > **App signing** > "App signing key certificate" > SHA-256 |
| Upload key (prod internal and EAS-signed builds) | the same page, "Upload key certificate", or `eas credentials -p android` > production |
| Staging and dev keystores | `eas credentials -p android`, choose the build profile (`preview`, `development`), read "SHA256 Fingerprint" |

`site/.well-known/security.txt` (16 §17 names a published `security.txt`; set `Expires` to at most one year ahead and add it to the calendar):

```text
Contact: mailto:security@thuluth.app
Expires: 2027-10-01T00:00:00.000Z
Preferred-Languages: en, ur
Canonical: https://thuluth.app/.well-known/security.txt
```

Redeploy with `npx wrangler pages deploy site --project-name thuluth-web --branch main` after every change.

Rules both platforms enforce: the files must be served over `https` with status 200, **no redirect**, `Content-Type: application/json`, and under 128 KB. Apple fetches the file through its own CDN, which caches it for up to a day or more. A fresh install picks up a change only after that cache refreshes.

### 5. Build the invite landing page and the legal pages

**Invite landing page** (`site/invite/index.html`, served for every `https://thuluth.app/invite/<token>`). People see it only when the app is not installed, when they open the link in a browser directly, or before the `.well-known` files work. Keep it static and simple:

- The Thuluth name and one line in English and Urdu: "You have been invited to a family on Thuluth" / "آپ کو ثلث پر ایک خاندان میں شامل ہونے کی دعوت دی گئی ہے" (Urdu pending native review).
- App Store and Google Play badges. Google Play: `https://play.google.com/store/apps/details?id=app.thuluth.mobile`. App Store: `https://apps.apple.com/app/id<asc-app-id>` (1Password "prod asc-app-id").
- The instruction "After installing, open this invitation link again from WhatsApp or your email" (and the Urdu line). The app does not read the clipboard (no clipboard code in `apps/mobile/src`), so the person must tap the original link again after installing (19 §9.4). Do not build a clipboard button until the app supports it.
- No scripts that send the URL anywhere: no analytics, no chat widget, no external fonts. The page must not log or forward the token.
- Do not add a `thuluth://` "Open in app" button: invite links over the custom scheme are being dropped (PO decision of 2026-10-06).

**Legal and support pages.** The code and store docs link to these addresses. Each must return 200 before store submission:

| URL | Linked from |
|---|---|
| `https://thuluth.app/legal/privacy` | App Store and Play listings (`docs/store/*.md`), privacy policy URL field |
| `https://thuluth.app/legal/terms` | store listings |
| `https://thuluth.app/privacy`, `https://thuluth.app/terms` | in-app paywall (redirects to the two above, step 3) |
| `https://thuluth.app/support` | App Store support URL (`docs/store/app-store.en.md`) |
| `https://thuluth.app/delete-account` | Play "account deletion URL" and App Store review notes (`docs/store/`) |

The legal text itself (terms, privacy policy, medical disclaimer, content sources, 22 §L3) comes from the PO. The `delete-account` page must explain the in-app path (More > Privacy and data > Delete account) and give a way to ask without the app, for example an email to `privacy@thuluth.app`. Google accepts a page that explains how to request deletion.

### 6. Add the API custom domains (Supabase)

Prod (`api.thuluth.app`) first; repeat for staging with `api.staging.thuluth.app` and the staging project ref. Dev has no custom domain and uses `https://<dev-ref>.supabase.co`.

1. Supabase dashboard > `thuluth-prod` > Settings > Add-ons > **Custom domain** > enable. Or use the CLI:

   ```bash
   supabase domains create --project-ref <prod-ref> --custom-hostname api.thuluth.app
   ```

2. Supabase shows (or the CLI prints) a **CNAME** target (`<prod-ref>.supabase.co`) and one or more **TXT** verification records. In Cloudflare > DNS > Records, add them exactly as shown:

   | Name | Type | Content | Proxy status |
   |---|---|---|---|
   | `api` | CNAME | `<prod-ref>.supabase.co` | **DNS only** (grey cloud) |
   | the TXT name Supabase shows (under `api`) | TXT | the value Supabase shows | n/a |

   The record must be **DNS only**. A proxied (orange cloud) record breaks Supabase's certificate and Realtime connections (19 §9.1).

3. Wait a few minutes, then:

   ```bash
   supabase domains reverify --project-ref <prod-ref>
   supabase domains activate --project-ref <prod-ref>
   ```

4. After activation, `https://api.thuluth.app` serves Auth, REST, Storage and Functions. The old `https://<prod-ref>.supabase.co` keeps working too.
5. Register the new OAuth callback `https://api.thuluth.app/auth/v1/callback` with Google and Apple ([auth-providers.md](auth-providers.md)). Keep the old callback in the list until all builds use the custom domain.
6. Set the Vault `project_url` to `https://api.thuluth.app` (`tooling/scripts/ops/vault-secrets.sh`, `production-environment.md` Step 3), and use it for `EXPO_PUBLIC_SUPABASE_URL` and the GitHub variable `API_BASE_URL`.

### 7. Add the email and status records

| Name | Type | Content | Proxy | Where the value comes from |
|---|---|---|---|---|
| `<selector>._domainkey` (for example `20261006120000pm._domainkey`) | TXT | the DKIM key Postmark shows | n/a | [postmark-email.md](postmark-email.md) step 3 |
| `mail` | CNAME | `pm.mtasv.net` | DNS only | Postmark custom Return-Path, [postmark-email.md](postmark-email.md) step 3 |
| `@` | TXT | `v=spf1 include:spf.mtasv.net -all` (merge with step 8 if you add Email Routing) | n/a | 19 §9.1 |
| `_dmarc` | TXT | `v=DMARC1; p=quarantine; rua=mailto:dmarc@thuluth.app` | n/a | 19 §9.1 |
| `status` | CNAME | the target your status page provider gives (Better Stack: `statuspage.betteruptime.com`) | **DNS only** | [uptime-and-status-page.md](uptime-and-status-page.md) step 5 |
| `api.staging` | CNAME | `<staging-ref>.supabase.co` plus its TXT records | DNS only | step 6 for staging |

These match 19 §9.1. Postmark's DKIM record is a TXT record under `<selector>._domainkey`; only the Return-Path CNAME uses `mail`. There are no `dev` or `staging` link domains: every variant uses `thuluth.app`.

There is only ever **one** SPF record at `@`. If you add another mail service, add its `include:` to the same record.

### 8. Receive mail at the role addresses

The code and docs send to or show these addresses. Without an MX record (19 §9.1) nothing can receive them:

| Address | Used by |
|---|---|
| `hello@thuluth.app` | sender of every Postmark email (`_shared/integrations/email.ts`, `account-emails.ts`); replies come here |
| `support@thuluth.app` | account emails, in-app help (`apps/mobile/src/features/help/utils/diagnostics.ts`), on-call rota |
| `privacy@thuluth.app` | account deletion and export emails, data export README |
| `security@thuluth.app` | `security.txt` (step 4) |
| `dmarc@thuluth.app` | DMARC reports (step 7) |

The simplest setup is **Cloudflare Email Routing** (free): Email > Email Routing > Get started. It adds its own MX records and an SPF include. Add a route for each address above to the PO's inbox (or a catch-all). Then merge the SPF record into one:

```text
v=spf1 include:spf.mtasv.net include:_spf.mx.cloudflare.net -all
```

Email Routing can only forward. To reply as `support@thuluth.app`, use a mailbox provider instead (Google Workspace or Zoho) and add its MX and SPF include in place of Cloudflare's.

## Where the values go

| Value | Where it is set | Name |
|---|---|---|
| Apple Team ID | `apple-app-site-association` on Pages | `<APPLE_TEAM_ID>` in the file |
| Android SHA-256 fingerprints | `assetlinks.json` on Pages | `sha256_cert_fingerprints` |
| API base URL | Vault, EAS env, GitHub env | Vault `project_url`, EAS `EXPO_PUBLIC_SUPABASE_URL`, GitHub `production` variable `API_BASE_URL` (`secrets.md` §2, §4, §5) |
| OAuth callback | Google Cloud console, Apple developer | `https://api.thuluth.app/auth/v1/callback` |
| Cloudflare login | 1Password | "shared cloudflare-login" |
| Registrar login (if not Cloudflare) | 1Password | "shared registrar-login" |

No secret value is stored in DNS or on the website.

## Verify

```bash
# 1. The AASA file: 200, JSON, no redirect, lists the prod app id.
curl -sS -o /dev/null -w '%{http_code} %{content_type} %{redirect_url}\n' https://thuluth.app/.well-known/apple-app-site-association
# expect: 200 application/json   (and an empty redirect_url)
curl -sS https://thuluth.app/.well-known/apple-app-site-association | python3 -m json.tool | grep app.thuluth.mobile

# 2. What Apple's CDN has (can lag a day behind):
curl -sS https://app-site-association.cdn-apple.com/a/v1/thuluth.app

# 3. assetlinks.json: 200 and JSON, then Google's checker:
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' https://thuluth.app/.well-known/assetlinks.json
curl -sS 'https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://thuluth.app&relation=delegate_permission/common.handle_all_urls'
# expect: one statement per package_name

# 4. Invite page: 200, no-store, the token stays in the URL.
curl -sS -D - -o /dev/null https://thuluth.app/invite/TESTtokenTESTtokenTESTtokenTEST12 | grep -i -E '^HTTP|cache-control|referrer-policy'

# 5. API custom domain:
curl -sS https://api.thuluth.app/functions/v1/health
# expect: {"status":"ok",...} (after the first deploy)

# 6. DNS records:
dig +short TXT thuluth.app; dig +short TXT _dmarc.thuluth.app; dig +short CNAME mail.thuluth.app; dig +short CNAME status.thuluth.app
```

On devices, with a production build installed:

- **Android:** `adb shell pm get-app-links app.thuluth.mobile` shows `thuluth.app: verified`. If it says `none` or `1024`, run `adb shell pm verify-app-links --re-verify app.thuluth.mobile` and check again after a minute.
- **iOS:** send yourself `https://thuluth.app/invite/<token>` from a real invite in WhatsApp or Notes and tap it. The app opens on the accept-invite screen. A link typed into Safari's address bar always opens the web page; that is normal iOS behaviour.
- End to end: create an invite in the app on staging (the household's caregivers screen > "Invite someone"), send the link to a second phone with the staging build, tap it, sign in with the invited email and accept.

## Rotate or revoke

- **Domain:** renews yearly. Keep auto-renew on and check the card two weeks before the date in [password-manager.md](password-manager.md) step 8.
- **Android signing keys:** if Google or EAS ever issues a new key (key upgrade or a new upload key), add the new fingerprint to `assetlinks.json` **before** shipping a build signed with it, and keep the old one until no installed build uses it.
- **Apple Team ID** never changes unless the app moves to another developer account. If it does, both IDs must be in the file during the move.
- **`security.txt`:** renew `Expires` every year.
- **Cloudflare API tokens** (if you create any for Wrangler in CI): 180 days, or on suspicion. `wrangler login` uses an OAuth session instead and needs no stored token.
- If the Cloudflare account is compromised: change the password, revoke all API tokens and sessions, then compare every DNS record with the tables above.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Tapping an invite link opens the web page, not the app (iOS) | The AASA file is wrong or Apple's CDN still has the old one; or the build's bundle id is not in `appIDs` | Check Verify 1 and 2. If the CDN copy is old, wait up to 48 h or reinstall the app after it updates. Check the Team ID prefix. |
| Same on Android | `assetlinks.json` lacks the fingerprint of the key that signed this install | Compare `adb shell pm get-app-links` output and the fingerprint of the installed build (Play App Signing key for Play installs, EAS keystore for internal APKs). Add it, redeploy, re-verify. |
| AASA URL downloads a file or shows `application/octet-stream` | `_headers` was not deployed or the path has a typo | Check `site/_headers` and redeploy. The file name has no extension. |
| `https://thuluth.app/.well-known/...` returns 404 after deploy | The `.well-known` folder was skipped by the upload | List the deployment's files in the Pages dashboard (Deployments > the latest > Files). Make sure the folder is inside `site/`, then redeploy. |
| `api.thuluth.app` gives a certificate error or 525 | The `api` record is proxied (orange cloud), or Supabase has not finished verification | Set it to DNS only, then `supabase domains reverify` and `activate`. |
| Invite opens the app but says the invite is not valid | A dev or staging link opened in a different variant (all variants claim the same links) | Keep only one variant installed while testing invites, or send links from the same environment as the installed build. |
