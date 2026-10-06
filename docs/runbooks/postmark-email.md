# Postmark email: configuration runbook

> **Environments:** dev / staging / prod (one Postmark server each) · **Time:** ~45 min for the account and domain, then 1 to 2 working days for Postmark's approval, then ~20 min per environment · **Needs:** a Postmark account, Cloudflare access for `thuluth.app`, the Supabase CLI logged in, access to each Supabase project's dashboard, 1Password vault "Thuluth Platform" · **Related:** [domain-and-dns.md](domain-and-dns.md), [password-manager.md](password-manager.md), [`docs/ops/secrets.md`](../ops/secrets.md) §1 and §3, [`docs/ops/production-environment.md`](../ops/production-environment.md) Step 8, [`11-authentication.md`](../11-authentication.md) §3, [`19-deployment-architecture.md`](../19-deployment-architecture.md) §6 and §9.1

## What this configures

Postmark sends every email Thuluth sends. There are two paths:

1. **Supabase Auth** sends the 6-digit sign-in code (email OTP) through Postmark's SMTP service. Without custom SMTP, Supabase's built-in mailer sends only a few emails per hour to team addresses, so real users cannot sign in.
2. **Edge Functions** call Postmark's API with the function secret `POSTMARK_SERVER_TOKEN`: the household invite email (`household-invite`) and four account emails (`account-export`, `account-delete`). While the token is unset, invites fall back to the share link and account emails are skipped and logged (`secrets.md` §1).

Menu names in Postmark and Supabase may differ slightly from the labels below.

## Before you start

- [ ] [domain-and-dns.md](domain-and-dns.md) steps 1, 2 and 8 are done: the Cloudflare zone is active and `hello@thuluth.app` can receive mail (needed to confirm the sender and to read replies).
- [ ] The Supabase projects `thuluth-dev`, `thuluth-staging` and `thuluth-prod` exist.
- [ ] You are logged in to the Supabase CLI (`supabase login`) on a trusted machine.

## What the code sends

| Email | Sent by | How | Postmark setup needed |
|---|---|---|---|
| Sign-in code (new and returning users, and the step-up code before account deletion) | Supabase Auth (`signInWithOtp` in `apps/mobile/src/features/auth/api/otp-api.ts` and `features/privacy/api/privacy-api.ts`) | SMTP | Auth SMTP settings (step 6) and the Supabase email templates (step 7) |
| Household invite | `household-invite` (`supabase/functions/_shared/integrations/email.ts`) | `POST https://api.postmarkapp.com/email/withTemplate`, `TemplateAlias` = `household-invite-en` or `household-invite-ur`, stream `outbound` | **Two Postmark templates you create by hand** (step 5) |
| "Your Thuluth data is ready to download" (`export_ready`) | `account-export` (`_shared/integrations/account-emails.ts`) | `POST https://api.postmarkapp.com/email`, body rendered in code, stream `outbound`, open and link tracking off | none |
| "Your Thuluth account is scheduled for deletion" (`deletion_requested`) | `account-delete` | same | none |
| "Your Thuluth account deletion was cancelled" (`deletion_cancelled`) | `account-delete` | same | none |
| "Your Thuluth account has been deleted" (`deletion_completed`) | `account-delete` | same | none |

All function emails are sent from `Thuluth <hello@thuluth.app>` with the header `X-Postmark-Server-Token`. The account emails exist in English and Urdu in code (Urdu pending native review, S7-05).

## Steps

### 1. Create the account and the three servers

1. Sign up at https://postmarkapp.com with a role address (for example `postmark@thuluth.app` forwarded by Email Routing). Turn on two-factor authentication. Save the login in 1Password as "shared postmark-login".
2. Servers > **Create server**, three times:

   | Server name | Type | Used by |
   |---|---|---|
   | `Thuluth Prod` | Live | `thuluth-prod` |
   | `Thuluth Staging` | Live | `thuluth-staging` |
   | `Thuluth Dev` | Live | `thuluth-dev` |

   Dev uses a Live server too (19 §6): a Postmark sandbox server accepts mail but never delivers it, so nobody could receive a sign-in code on dev. Local development does not use Postmark at all: the local stack catches mail in Mailpit at `http://127.0.0.1:54324` (`supabase/config.toml` `[local_smtp]`).

3. In each server: Settings > **Tracking** (or the "Default message stream" settings): open tracking **off**, link tracking **off**. The invite call does not set `TrackLinks`, so server-level link tracking would rewrite the invite link to a Postmark redirect. Universal links would then stop opening the app, and the invite token would pass through a tracking URL.

### 2. Add the sending domain

1. Sender Signatures > **Add Domain or Signature** > Domain > `thuluth.app`.
2. Postmark shows two records. Keep the page open for step 3.
3. Also add a **sender signature** for `hello@thuluth.app` (Sender Signatures > Add > Signature, name `Thuluth`). Postmark sends a confirmation email to that address. Open it and confirm. With a verified domain, any address on `thuluth.app` can send, but the signature makes the "from" name consistent and is what the approval team looks at.

### 3. Add the DKIM and Return-Path records in Cloudflare

In Postmark, open the domain `thuluth.app`:

1. **DKIM:** copy the hostname (it looks like `20261006120000pm._domainkey`) and the TXT value. In Cloudflare > DNS > Records, add a **TXT** record with that name and value.
2. **Return-Path:** click Edit next to Return-Path and set the custom Return-Path to `mail.thuluth.app` (19 §9.1 uses `mail`). Add a **CNAME** `mail` to `pm.mtasv.net`, proxy status **DNS only**.
3. SPF and DMARC: add the `@` TXT `v=spf1 include:spf.mtasv.net -all` (merged with Email Routing, see [domain-and-dns.md](domain-and-dns.md) step 8) and the `_dmarc` TXT from step 7 there.
4. Back in Postmark, click **Verify** next to DKIM and Return-Path. Both turn green within minutes. If they do not, wait 30 minutes and verify again.

Postmark's DKIM is a TXT record under `<selector>._domainkey`; only the Return-Path CNAME uses `mail` (19 §9.1).

### 4. Ask Postmark to approve the account

New Postmark accounts are in **test mode**: they can send only to addresses on your own verified domain. Account > **Request approval** (a banner in the dashboard). Write a short, honest description:

> Thuluth is a family nutrition app for Pakistani families. We send transactional email only: one-time sign-in codes, household invitations sent at a user's request, and account notices (data export ready, account deletion requested, cancelled or completed). No marketing email. Users sign up in our mobile app. Expected volume at launch: under 20,000 emails per month.

Approval usually takes one or two working days. Until then, test with `@thuluth.app` addresses only.

### 5. Create the invite templates (every server)

`household-invite` sends with `TemplateAlias` `household-invite-en` or `household-invite-ur` and this model (`_shared/integrations/email.ts`):

| Variable | Content |
|---|---|
| `inviter_name` | the inviter's display name |
| `household_name` | the household name |
| `role` | `caregiver` or `viewer` (English codes, not translated) |
| `action_url` | `https://thuluth.app/invite/<token>` |
| `message` | the inviter's optional note, or an empty string |

In each server: Templates > **Add template** > Standard template (or a layout of your choice). Set the **Template alias** exactly as below; the name can be anything. Create both templates on all three servers, because the alias is looked up per server.

Template alias `household-invite-en`:

- Subject: `{{inviter_name}} invited you to {{household_name}} on Thuluth`
- Body (HTML and text):

  ```text
  Assalamu alaikum,

  {{inviter_name}} has invited you to help plan meals for "{{household_name}}" on Thuluth.
  {{#message}}
  Their note: {{message}}
  {{/message}}

  Accept the invitation: {{action_url}}

  Open the link on your phone. If you do not have Thuluth yet, install it, then open this link again.
  Sign in with this email address to accept. The invitation expires in 7 days.

  If you were not expecting this, you can ignore this email.
  Thuluth, thuluth.app
  ```

Template alias `household-invite-ur` (Urdu draft, pending native review; set `dir="rtl"` and `lang="ur"` on the HTML body):

- Subject: `{{inviter_name}} نے آپ کو ثلث پر {{household_name}} میں مدعو کیا ہے`
- Body:

  ```text
  السلام علیکم،

  {{inviter_name}} نے آپ کو ثلث پر "{{household_name}}" کے کھانوں کی منصوبہ بندی میں مدد کے لیے مدعو کیا ہے۔
  {{#message}}
  ان کا پیغام: {{message}}
  {{/message}}

  دعوت قبول کریں: {{action_url}}

  یہ لنک اپنے فون پر کھولیں۔ اگر آپ کے پاس ثلث نہیں ہے تو اسے انسٹال کریں، پھر یہ لنک دوبارہ کھولیں۔
  قبول کرنے کے لیے اسی ای میل سے سائن اِن کریں۔ یہ دعوت 7 دن میں ختم ہو جائے گی۔

  اگر آپ کو اس کی توقع نہیں تھی تو اس ای میل کو نظر انداز کر دیں۔
  ثلث، thuluth.app
  ```

The 7 days match `INVITE_TTL_DAYS = 7` in `packages/shared/src/contracts/household-invite.ts`. Change the text if that constant changes. Keep the link as plain `{{action_url}}` text or a plain `<a href="{{action_url}}">`; do not wrap it in any redirect.

If a template alias is missing, Postmark returns an error, `household-invite` logs `invite email failed`, and the invite still succeeds with the share link. So a missing template shows up only in the logs.

### 6. Point Supabase Auth at Postmark (every project)

For each project, take the matching server's token: Postmark > Servers > the server > **API Tokens** > copy the Server API token. Save it in 1Password as "<env> POSTMARK_SERVER_TOKEN" (for example "prod POSTMARK_SERVER_TOKEN").

Supabase dashboard > the project > Authentication > Emails > **SMTP Settings** > Enable custom SMTP:

| Field | Value |
|---|---|
| Sender email | `hello@thuluth.app` |
| Sender name | `Thuluth` |
| Host | `smtp.postmarkapp.com` |
| Port | `587` |
| Minimum interval between emails | `60` seconds (matches `max_frequency = "60s"` in `supabase/config.toml`) |
| Username | the Server API token |
| Password | the same Server API token |

Save. Supabase uses Postmark's default transactional stream (`outbound`), the same stream the functions use.

Then Authentication > **Rate Limits** > "Rate limit for sending emails": set **1000 per hour**, the value of `email_sent` in `supabase/config.toml`. The limit is project-wide (every sign-in and sign-up code for all users together), and Supabase lets you raise it only after custom SMTP is on, so do it right after saving the SMTP settings. Raise it again before any campaign that could bring more than about 1000 sign-ins an hour (Postmark itself allows far more).

### 7. Set the sign-in code templates (every project)

The app asks for a **6-digit code**, not a link. The repo holds the two templates: `supabase/templates/auth/magic-link.html` (returning users and step-up codes) and `supabase/templates/auth/confirmation.html` (first sign-in of a new user, because `enable_confirmations = true`). Each shows the code (`{{ .Token }}`) in English and Urdu in one email, with no link. `supabase/config.toml` applies them only to the local stack, so on hosted projects paste them by hand. Until you do, hosted projects use Supabase's default templates, which send a **link** the app cannot use.

Authentication > Emails > **Templates**:

| Template | Subject | Body (Source view) |
|---|---|---|
| **Magic Link** | `Your Thuluth code / ثلث کوڈ` | the whole of `supabase/templates/auth/magic-link.html` |
| **Confirm signup** | `Your Thuluth code / ثلث کوڈ` | the whole of `supabase/templates/auth/confirmation.html` |

The subjects are the ones in `config.toml` (`[auth.email.template.magic_link]` and `[auth.email.template.confirmation]`). Whenever a developer changes those files, paste them again on every project.

The comment block at the top of each file is an HTML comment and is harmless if pasted. The code length (6) and expiry (600 s) come from `supabase/config.toml`; set them in Authentication > Providers > Email if they differ. The Urdu text is a draft pending native review.

### 8. Set the function secret (every project)

Put the token in the env file you build from 1Password ([supabase-secrets-and-vault.md](supabase-secrets-and-vault.md), using the item names in [password-manager.md](password-manager.md) step 3), then:

```bash
supabase secrets set --project-ref <prod-ref> --env-file ./.env.functions.prod
rm ./.env.functions.prod
```

Or, for this one value:

```bash
op read "op://Thuluth Platform/prod POSTMARK_SERVER_TOKEN/credential" \
  | xargs -I{} supabase secrets set --project-ref <prod-ref> POSTMARK_SERVER_TOKEN={}
```

Functions read secrets at cold start, so new values apply to new requests within a minute or two. No redeploy is needed.

## Where the values go

| Value | Where it is set | Name |
|---|---|---|
| Server API token (per environment) | Supabase function secrets | `POSTMARK_SERVER_TOKEN` (`secrets.md` §1) |
| the same token | Supabase Auth > SMTP Settings, username and password | (dashboard field) |
| Sender | Supabase Auth SMTP; hard-coded in functions | `hello@thuluth.app` |
| DKIM TXT, Return-Path CNAME | Cloudflare DNS | `<selector>._domainkey`, `mail` |
| Postmark login | 1Password | "shared postmark-login" |
| Tokens | 1Password | "dev POSTMARK_SERVER_TOKEN", "staging POSTMARK_SERVER_TOKEN", "prod POSTMARK_SERVER_TOKEN" |

Note: the S7 brief calls the secret `POSTMARK_TOKEN`; the code reads `POSTMARK_SERVER_TOKEN` (`secrets.md` §1).

## Verify

1. **DNS:** Postmark > Sender Signatures > `thuluth.app` shows DKIM and Return-Path **Verified**.
2. **Token works:**

   ```bash
   curl -sS https://api.postmarkapp.com/server \
     -H "Accept: application/json" \
     -H "X-Postmark-Server-Token: $(op read 'op://Thuluth Platform/prod POSTMARK_SERVER_TOKEN/credential')"
   # expect: JSON with "Name": "Thuluth Prod"
   ```

3. **Sign-in code, English:** on a build for the environment, set the app language to English, sign in with a test address. The email has a 6-digit code (not a link), comes from `Thuluth <hello@thuluth.app>`, and the code signs you in.
4. **Sign-in code, Urdu:** every code email carries the Urdu text below the English, right to left. Check that the Urdu part renders and that the code is the same in both.
5. **Invite:** create an invite to a test address from an inviter whose app language is English, then from one in Urdu (the email language follows the **inviter's** saved locale, `household-invite/handler.ts`). The email arrives with the subject from step 5, and the link is exactly `https://thuluth.app/invite/...` (hover or long-press to check; no `track.` or `click.` redirect).
6. **Account email:** with a test account, request an account export (Settings > Privacy > Download my data). "Your Thuluth data is ready to download" arrives in English; repeat with an Urdu account (`production-environment.md` Step 8).
7. **Headers:** in the received email, "Show original" shows `dkim=pass header.d=thuluth.app`, `spf=pass` and `dmarc=pass`.
8. Postmark > the server > **Activity** shows each message as Delivered.

## Rotate or revoke

Cadence: **180 days** (`secrets.md` §1), or at once on suspicion.

1. Postmark > the server > API Tokens > **Generate another token** (a server can hold more than one).
2. Update 1Password "<env> POSTMARK_SERVER_TOKEN".
3. Set the new token in the function secrets (step 8) and in Auth > SMTP Settings (step 6).
4. Sign in once and send one invite to confirm both paths work.
5. Delete the old token in Postmark.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Sign-in email contains a link, not a code | The hosted templates are still Supabase's defaults | Step 7: paste both repo templates. |
| No sign-in email at all; Auth logs show an SMTP error | Wrong token in SMTP Settings, or the account is still in test mode and the address is outside `thuluth.app` | Re-paste the token as both username and password; check the approval status (step 4). |
| Sign-in requests fail with "email rate limit exceeded" | The project-wide Auth email rate limit is still at the default 30 per hour, or 1000 per hour was reached | Set it to 1000 per hour (step 6), or higher during a campaign. |
| Invite succeeds but no email arrives; function logs say `invite email failed` with `Postmark 422` | Template alias `household-invite-en` or `-ur` missing on that server | Create both templates on that server (step 5). |
| Function logs say `POSTMARK_SERVER_TOKEN not set; invite email skipped` or `account-email ... email skipped` | Function secret not set in this project | Step 8. Check with `supabase secrets list --project-ref <ref>`. |
| Invite email arrives, but tapping the link opens a browser and not the app | Link tracking rewrote the URL, or the `.well-known` files are not live | Turn link tracking off (step 1.3); check [domain-and-dns.md](domain-and-dns.md) Verify. |
| Emails land in spam | DKIM or Return-Path not verified, or two SPF records at `@` | Step 3, and keep a single merged SPF record. |
