# Uptime monitoring and status page: configuration runbook

> **Environments:** prod (required), staging (optional, no paging) · **Time:** ~45 min · **Needs:** a Better Stack account (or an equivalent such as UptimeRobot or Instatus), Cloudflare access for `thuluth.app`, the on-call phone number, 1Password vault "Thuluth Platform" · **Related:** [domain-and-dns.md](domain-and-dns.md), [`docs/ops/sentry-alerts.md`](../ops/sentry-alerts.md) §2 (alerts E1, E2, E6), [`docs/ops/incident-templates.md`](../ops/incident-templates.md), [`docs/ops/on-call-rota.md`](../ops/on-call-rota.md), [`docs/ops/production-environment.md`](../ops/production-environment.md) Step 9, [`docs/ops/launch-runbook.md`](../ops/launch-runbook.md)

## What this configures

An outside service that calls Thuluth's public health endpoint every minute, pages the on-call person when the API is down, and runs the public status page at `https://status.thuluth.app`. Sentry only sees errors from apps that are running; this catches the case where the backend is unreachable. While it is missing, nobody is told when the API goes down at 3 a.m. in Ramadan, and users have nowhere to check whether the problem is on their side.

Menu names in Better Stack may differ slightly from the labels below. The steps work the same way in any provider that has HTTP monitors with a keyword check, phone alerts and a status page on a custom domain.

## What the health endpoint returns

`GET https://api.thuluth.app/functions/v1/health` (`supabase/functions/health`, public, no JWT or API key needed, `verify_jwt = false` in `supabase/config.toml`). It answers within about 3 seconds and caches its database check for 20 seconds per instance.

| HTTP | Body `status` | Meaning |
|---|---|---|
| 200 | `ok` | database reachable, feature flags readable, no cron failure in the last hour, no push stuck for 10 minutes, maintenance flag off |
| 200 | `degraded` | database reachable but one of the other checks failed. `checks` says which (`cron`, `feature_flags` or `maintenance`) |
| 503 | `down` | the database query failed or took over 3 seconds |

Example body (one line, no spaces, so a keyword match on `"status":"ok"` works):

```json
{"status":"ok","checks":{"database":"ok","feature_flags":"ok","cron":"ok","maintenance":"ok"},"env":"production","release":"<git sha>","time":"2027-02-01T10:00:00.000Z","duration_ms":41}
```

It never contains counts, hosts or error text, so it is safe to make public.

## Before you start

- [ ] Production is deployed and `curl -s https://api.thuluth.app/functions/v1/health` returns `"status":"ok"` ([domain-and-dns.md](domain-and-dns.md) step 6, `production-environment.md` Step 4).
- [ ] The `.well-known` files are live ([domain-and-dns.md](domain-and-dns.md) step 4).
- [ ] The on-call rota names the primary and secondary ([`on-call-rota.md`](../ops/on-call-rota.md)).

## Steps

### 1. Create the account and the on-call people

1. Sign up at https://betterstack.com (Uptime) with a role address. Turn on two-factor authentication. Save the login in 1Password as "shared betterstack-login".
2. Team > invite the secondary on-call person, if there is one.
3. Each person: Profile > **Notification settings** > add and verify the phone number (Pakistan numbers start `+92`) for **phone call** and **SMS**, and the email. Install the Better Stack mobile app for push alerts.
4. On-call > **Escalation policies** > create two:

   | Policy | Steps |
   |---|---|
   | `SEV1 page` | at once: phone call + SMS + push to the current primary; after 15 min without acknowledgement: phone call to the secondary (or the primary again if there is none) |
   | `Low priority` | push + email to the primary only, no phone call |

   The acknowledge times match `on-call-rota.md` §2. Add the on-call WhatsApp or Slack channel as an extra target if your plan supports it (Integrations).

### 2. Monitor the production API (alerts E1 and E2)

`sentry-alerts.md` §2 asks for two alerts on the same endpoint: a **page** when the API is down and a **message** when it is degraded. Build them as two monitors.

**Monitor A: `API (prod)`** (alert E1, pages):

| Field | Value |
|---|---|
| Type | Status / HTTP: alert when the URL "becomes unavailable" |
| URL | `https://api.thuluth.app/functions/v1/health` |
| Method | GET, no headers |
| Check frequency | 1 minute |
| Regions | Europe only (two or more EU locations) |
| Request timeout | 10 seconds |
| Expected status codes | 200 |
| Confirmation period | 3 minutes (3 failed checks in a row) |
| Escalation | `SEV1 page` |

**Monitor B: `API degraded (prod)`** (alert E2, no page):

| Field | Value |
|---|---|
| Type | Keyword: alert when the keyword **does not exist** |
| URL | the same |
| Keyword | `"status":"ok"` |
| Check frequency | 1 minute |
| Confirmation period | 10 minutes |
| Escalation | `Low priority` |

When Monitor B fires, look at `checks` in the body: `cron: fail` means a cron failure or stuck pushes (alert E6 in `sentry-alerts.md`), `maintenance: fail` means the `app.maintenance` flag is on (expected during a planned maintenance).

`production-environment.md` Step 9 and `sentry-alerts.md` E1 and E2 describe the same two monitors.

### 3. Monitor the universal-link file

Invites work only through universal links (PO decision of 2026-10-06), so a missing or broken AASA file silently breaks every invite.

**Monitor C: `Universal links file`**:

| Field | Value |
|---|---|
| Type | Keyword: alert when the keyword does not exist |
| URL | `https://thuluth.app/.well-known/apple-app-site-association` |
| Keyword | `app.thuluth.mobile` |
| Follow redirects | **off** (Apple rejects redirects, so a redirect is a failure) |
| Expected status codes | 200 |
| Check frequency | 5 minutes |
| Confirmation period | 15 minutes |
| Escalation | `Low priority` |

**Monitor D: `Android app links file`**: the same, with URL `https://thuluth.app/.well-known/assetlinks.json` and keyword `app.thuluth.mobile`.

### 4. Staging (optional)

Copy Monitor A for `https://api.staging.thuluth.app/functions/v1/health`, frequency 5 minutes, escalation `Low priority`. Do not page anyone for staging. Dev needs no monitor. Do not monitor the PDF renderer: each call would wake a Cloud Run instance ([pdf-renderer-gotenberg.md](pdf-renderer-gotenberg.md), Cost).

### 5. Create the status page

1. Status pages > **Create status page**. Company name `Thuluth`, subdomain any (for example `thuluth`). Homepage URL `https://thuluth.app`. Support contact `support@thuluth.app`.
2. **Components** (the names `incident-templates.md` §2 uses; keep them exactly):

   | Component | Linked monitor | Updated by |
   |---|---|---|
   | App and sync | Monitor A `API (prod)` (automatic) | automatic, plus manual notes |
   | AI assistant | none | manual (provider outages, `ai.chat.enabled` off) |
   | Notifications | none | manual (OneSignal outage, alert E6 or `push_lag`) |

   Do not show Monitors B, C and D on the public page.
3. Settings > **Custom domain** > `status.thuluth.app`. Better Stack shows a CNAME target (for Better Stack it is `statuspage.betteruptime.com`). In Cloudflare > DNS, add **CNAME** `status` to that target with proxy status **DNS only**. Wait until Better Stack shows the domain and certificate as active (up to 15 minutes; `.app` is HTTPS only, see [domain-and-dns.md](domain-and-dns.md) step 1).
4. Turn on **subscriptions** (email updates) if you want users to subscribe. Do not import any user list.
5. Language: the page chrome is English. Write every incident update in English first and Urdu second, using the texts below.

### 6. Prepare incident texts (English and Urdu)

Use the four stage texts in [`incident-templates.md`](../ops/incident-templates.md) §2 (Investigating, Identified, Monitoring, Resolved), replacing `{component}` with the component name. In Better Stack, save them as **incident templates** (Status page > Templates, if your plan has them) so you can post in one click. For example, the Investigating update for "Notifications" reads:

```text
We are looking into a problem with Notifications. Your data is safe. We will update here within 30 minutes.

ہم Notifications میں ایک مسئلے کی جانچ کر رہے ہیں۔ آپ کا ڈیٹا محفوظ ہے۔ ہم 30 منٹ میں یہاں اپ ڈیٹ دیں گے۔
```

The Urdu texts are pending native review. Never put user data (emails, names, health values) in a status update (`incident-templates.md`).

### 7. Link the status page from the app

`production-environment.md` Step 9 says to link the status page from the app's help section. The help content (`apps/mobile/src/features/help/content/`) does not mention `status.thuluth.app` yet. This is an open PO decision ([README.md](README.md) "Decisions still needed"); nothing is configured here for it.

## Where the values go

| Value | Where it is set | Name |
|---|---|---|
| Health URL | Better Stack Monitors A and B | `https://api.thuluth.app/functions/v1/health` |
| Status page CNAME | Cloudflare DNS | `status` |
| Better Stack login | 1Password | "shared betterstack-login" |
| On-call phone numbers | Better Stack profiles | (not stored elsewhere) |

The health endpoint is public, so no secret is involved (`secrets.md` §6).

## Verify

```bash
curl -s -w '\n%{http_code}\n' https://api.thuluth.app/functions/v1/health
# expect: a body with "status":"ok" and 200
dig +short CNAME status.thuluth.app
# expect: the provider's target
curl -sI https://status.thuluth.app | head -1
# expect: HTTP/2 200
```

Then test each alert path once before launch:

1. **Page test:** in Better Stack, send a test alert for Monitor A (Monitor > "Send test alert", or temporarily change its URL to `https://api.thuluth.app/functions/v1/health-missing`). The primary's phone rings within about 4 minutes. Acknowledge it, then restore the URL.
2. **Degraded test (staging):** on staging, set the `app.maintenance` flag on for 15 minutes (the staging app shows its maintenance screen and user-facing functions refuse requests meanwhile, so warn testers). The staging copy of Monitor B (if you made one) alerts with low priority; the body shows `"maintenance":"fail"`. Turn the flag off.
3. **Status page:** open `https://status.thuluth.app` on a phone over mobile data. The three components show as operational.

## Rotate or revoke

- No secrets to rotate. Review the escalation policy and phone numbers every time the rota changes (`on-call-rota.md`).
- Before each Ramadan, run the page test again: the first Ramadan week is the highest-risk period.
- When someone leaves, remove them from the Better Stack team and the escalation policies the same day, and change the shared login in 1Password.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Monitor A is red with 503 | The health check cannot reach the database (`"status":"down"`) | Declare an incident (`incident-templates.md` §1). Check Supabase status and the project's database health in the dashboard. |
| Monitor B is red but the app works | `checks.cron` is `fail` (a cron job failed in the last hour, or a push is stuck) or `maintenance` is on | Run `select * from cron.job_run_details where status = 'failed' order by start_time desc limit 20;` (`sentry-alerts.md` E6). Check the `app.maintenance` flag. |
| Monitor A is red with 401 | The function was deployed with JWT verification on | Check `[functions.health] verify_jwt = false` is in `supabase/config.toml` and redeploy the function. |
| Monitor C is red with 404 or a redirect | The website deploy lost the `.well-known` folder, or a redirect rule now catches it | See [domain-and-dns.md](domain-and-dns.md) Troubleshooting. Invites are broken until it is fixed. |
| `status.thuluth.app` shows a certificate error | The CNAME is proxied (orange cloud) or the provider has not issued the certificate yet | Set it to DNS only and wait 15 minutes. |
| No phone call during a test | Phone number not verified, or the escalation policy is not attached to the monitor | Verify the number in the profile; check the monitor's escalation setting. |
