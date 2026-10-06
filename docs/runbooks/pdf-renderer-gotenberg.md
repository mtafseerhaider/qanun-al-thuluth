# PDF renderer (Gotenberg on Cloud Run): configuration runbook

> **Environments:** dev / staging / prod (one Cloud Run service per environment, each in its own Google Cloud project) · **Time:** ~60 min the first time, ~20 min per extra environment · **Needs:** a Google account with billing, the `gcloud` CLI, the Supabase CLI, `openssl`, `curl`, 1Password vault "Thuluth Platform" · **Related:** [`tooling/gotenberg/README.md`](../../tooling/gotenberg/README.md) (the developer notes this runbook follows), [password-manager.md](password-manager.md), [uptime-and-status-page.md](uptime-and-status-page.md), [`docs/ops/secrets.md`](../ops/secrets.md) §1, [`18-exports-and-analytics.md`](../18-exports-and-analytics.md) §2, [`04-system-architecture.md`](../04-system-architecture.md) §4

## What this configures

Supabase Edge Functions cannot run a browser, and Urdu Nastaliq needs a real browser engine to shape correctly. So `export-pdf` builds the HTML for a meal plan, grocery list or growth report and sends it to **Gotenberg 8** (headless Chromium), which returns the PDF. Gotenberg runs as a private Cloud Run service called `thuluth-pdf` in `europe-west3` (Frankfurt), next to the Supabase projects in `eu-central-1`.

While `GOTENBERG_URL` or `GOTENBERG_TOKEN` is unset, `export-pdf` answers `FEATURE_DISABLED` with `reason: renderer_not_configured` and the app shows "Exports aren't available yet". `account-export` leaves the `pdf/` folder out of the data export and lists it as missing (`secrets.md` §1).

Menu names in the Google Cloud console may differ slightly from the labels below.

## How the code calls it (what you must match)

From `supabase/functions/export-pdf/renderer.ts`:

| Item | Value in code |
|---|---|
| Endpoint | `POST {GOTENBERG_URL}/forms/chromium/convert/html` (any trailing `/` on the URL is removed) |
| URL rule | `GOTENBERG_URL` must start with `https://`, or the renderer counts as not configured |
| Auth header | `Authorization: Basic base64("thuluth:" + GOTENBERG_TOKEN)`. The username is fixed in code as `thuluth` (`GOTENBERG_USERNAME`); the token is the basic-auth **password** |
| Body | multipart form: `files` = `index.html`, plus paper size, margins, `printBackground=true`, `emulatedMediaType=print`, `failOnConsoleExceptions=true`, `metadata` |
| Timeout | 20 s per render (`RENDER_TIMEOUT_MS`) |
| Callers | `export-pdf` and `account-export` (both import `rendererFromEnv`) |

So Gotenberg must run with basic auth on, username `thuluth`, password = `GOTENBERG_TOKEN`. That is exactly what `tooling/gotenberg/Dockerfile` (`--api-enable-basic-auth`) and `tooling/gotenberg/service.yaml` (`GOTENBERG_API_BASIC_AUTH_USERNAME=thuluth`, password from Secret Manager `gotenberg-token`) do.

`18-exports-and-analytics.md` §2 describes the same request: HTTP **Basic** auth and `preferCssPageSize=false`.

## Before you start

- [ ] A Google Cloud **billing account** (console.cloud.google.com > Billing). The backup project uses a separate billing account ([offsite-backups-gcp.md](offsite-backups-gcp.md)); this one can be the normal company card.
- [ ] `gcloud` installed and logged in: `gcloud auth login`.
- [ ] The Supabase CLI logged in (`supabase login`) and the project refs for each environment.
- [ ] A clone of this repo (you need `tooling/gotenberg/`).

## Steps

Run every step once per environment. Set these first (prod shown):

```bash
ENV=prod                       # dev | staging | prod
PROJECT_ID=thuluth-$ENV        # if the id is taken, add a suffix, e.g. thuluth-prod-7f3; use it everywhere below
REGION=europe-west3
SUPABASE_REF=<prod-ref>
```

### 1. Create the Google Cloud project

```bash
gcloud projects create "$PROJECT_ID" --name "Thuluth $ENV"
gcloud billing accounts list                         # copy the ACCOUNT_ID
gcloud billing projects link "$PROJECT_ID" --billing-account <ACCOUNT_ID>
gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com cloudbuild.googleapis.com
```

Note: `tooling/gotenberg/README.md` does not enable `cloudbuild.googleapis.com`, but step 2 (`gcloud builds submit`) needs it.

Billing > Budgets and alerts > **Create budget** for this project: 20 USD per month, alerts at 50, 90 and 100 percent to the PO's email.

### 2. Build the image

The image is `gotenberg/gotenberg:8` plus the fonts the export templates use (Noto Nastaliq Urdu, Noto Naskh Arabic, Noto Sans, Amiri, Inter), with JavaScript off, outbound fetches blocked and LibreOffice and webhooks off.

```bash
gcloud artifacts repositories create thuluth --repository-format=docker --location="$REGION"
gcloud builds submit tooling/gotenberg --tag "$REGION-docker.pkg.dev/$PROJECT_ID/thuluth/gotenberg:8"
DIGEST=$(gcloud artifacts docker images describe \
  "$REGION-docker.pkg.dev/$PROJECT_ID/thuluth/gotenberg:8" --format 'value(image_summary.digest)')
echo "$DIGEST"                                       # sha256:...
```

The service deploys the exact digest, so a later rebuild never changes production by accident.

### 3. Create the token and the service account

```bash
openssl rand -base64 48 | tr -d '\n' | gcloud secrets create gotenberg-token --data-file=-
gcloud iam service-accounts create thuluth-pdf --display-name "Thuluth PDF renderer"
gcloud secrets add-iam-policy-binding gotenberg-token \
  --member "serviceAccount:thuluth-pdf@$PROJECT_ID.iam.gserviceaccount.com" \
  --role roles/secretmanager.secretAccessor
```

Copy the token into 1Password as "<env> GOTENBERG_TOKEN" (for example "prod GOTENBERG_TOKEN") without printing it to the screen:

```bash
gcloud secrets versions access latest --secret gotenberg-token | pbcopy    # macOS; use xclip -sel clip on Linux
```

Paste it into the 1Password item, then clear the clipboard.

### 4. Deploy the Cloud Run service

Fill in the two placeholders in a copy of `service.yaml` (do not commit the filled copy):

```bash
sed -e "s/PROJECT_ID/$PROJECT_ID/g" -e "s/sha256:REPLACE_WITH_DIGEST/$DIGEST/" \
  tooling/gotenberg/service.yaml > /tmp/thuluth-pdf.yaml
gcloud run services replace /tmp/thuluth-pdf.yaml --region "$REGION"
gcloud run services add-iam-policy-binding thuluth-pdf --region "$REGION" \
  --member allUsers --role roles/run.invoker
rm /tmp/thuluth-pdf.yaml
```

The service settings come from `service.yaml`:

| Setting | Value | Why |
|---|---|---|
| Region | `europe-west3` (Frankfurt) | EU data, close to Supabase `eu-central-1` |
| CPU / memory | 2 vCPU / 2 GiB | Chromium with Urdu fonts needs about 1 GiB per render |
| Concurrency | 4 requests per instance | 19 §13 |
| Min / max instances | 0 / 5 | scale to zero; cold start about 3 s is fine for exports |
| Request timeout | 60 s (Gotenberg's own limit is 30 s, the function gives up at 20 s) | |
| CPU allocation | only during requests (`cpu-throttling: true`), startup CPU boost on | cost |
| Ingress | all, with **Gotenberg basic auth** guarding every conversion | Edge Functions have no Google identity, so Google IAM auth is not an option (`tooling/gotenberg/README.md`) |

The `allUsers` invoker binding is intended: Cloud Run lets the request in, and Gotenberg rejects any request without the right password.

### 5. Set the Supabase function secrets

```bash
URL=$(gcloud run services describe thuluth-pdf --region "$REGION" --format 'value(status.url)')
echo "$URL"                                          # https://thuluth-pdf-....run.app
supabase secrets set --project-ref "$SUPABASE_REF" GOTENBERG_URL="$URL"
gcloud secrets versions access latest --secret gotenberg-token \
  | xargs -I{} supabase secrets set --project-ref "$SUPABASE_REF" GOTENBERG_TOKEN={}
```

Save the URL in 1Password as "<env> GOTENBERG_URL" too (it is not secret, but the env file template in [supabase-secrets-and-vault.md](supabase-secrets-and-vault.md) reads it from there).

### 6. Make sure the exports flags allow it

`export-pdf` also checks two feature flags (`supabase/seed/catalog/160_feature_flags.sql`, applied by the deploy):

- `exports.kinds` lists the kinds that may render. The seed has `["meal_plan","grocery_list"]`.
- `exports.pdf.enabled` is a kill switch. It is not in the seed, and a missing flag counts as **on**. Insert it with `enabled = false` only to pause exports.

PDF export is a Premium feature. To test on dev or staging with a sandbox purchase, the `allow_sandbox_premium` flag must be on in that project (never in prod).

## Where the values go

| Value | Where it is set | Name |
|---|---|---|
| Cloud Run URL | Supabase function secrets | `GOTENBERG_URL` |
| Basic-auth password | Supabase function secrets | `GOTENBERG_TOKEN` |
| the same password | GCP Secret Manager (read by Cloud Run) | `gotenberg-token` |
| Basic-auth username | fixed in code and in `service.yaml` | `thuluth` |
| Both values | 1Password | "<env> GOTENBERG_URL", "<env> GOTENBERG_TOKEN" |

## Verify

1. **Render a test page** (from `tooling/gotenberg/README.md`):

   ```bash
   TOKEN=$(gcloud secrets versions access latest --secret gotenberg-token)
   printf '<html lang="ur" dir="rtl"><body style="font-family:Noto Nastaliq Urdu">ثلث</body></html>' > /tmp/index.html
   curl -sf -u "thuluth:$TOKEN" -F files=@/tmp/index.html "$URL/forms/chromium/convert/html" -o /tmp/out.pdf && echo rendered
   open /tmp/out.pdf          # the word ثلث in Nastaliq, right to left
   unset TOKEN
   ```

2. **Auth is enforced:** `curl -s -o /dev/null -w '%{http_code}\n' -X POST "$URL/forms/chromium/convert/html"` prints `401`.
3. **Secrets are present:** `supabase secrets list --project-ref "$SUPABASE_REF"` lists `GOTENBERG_URL` and `GOTENBERG_TOKEN`.
4. **From the app** (staging first): sign in with a Premium test account, go to More > **Exports**, create a meal plan PDF in English and one in Urdu. "Preparing your PDF…" turns into a shareable PDF. The Urdu one shows Nastaliq text, right to left.
5. **Data export:** request an account export with PDFs included. The ZIP has a `pdf/` folder.
6. **Logs:** Cloud Run > `thuluth-pdf` > Logs shows `POST /forms/chromium/convert/html` with status 200.

## Cost

Cloud Run bills only while a request runs (min instances 0). One render takes roughly 2 to 5 seconds at 2 vCPU and 2 GiB, which is a fraction of a US cent. Cloud Run's monthly free tier covers the first tens of thousands of renders. Add a few US cents a month for Artifact Registry (one image of about 1.5 GB) and Secret Manager. `04-system-architecture.md` budgets 10 to 40 USD a month in total. Expect less at launch. Dev and staging cost close to nothing while idle. Do not add an uptime monitor that calls this service every minute: each call would wake an instance.

## Rotate or revoke

Cadence: **180 days** (`secrets.md` §1), or at once on suspicion. Exports fail with `UPSTREAM_UNAVAILABLE` for the minute between steps 2 and 3, so do it at a quiet hour (Pakistan night).

1. Add a new version: `openssl rand -base64 48 | tr -d '\n' | gcloud secrets versions add gotenberg-token --data-file=-`.
2. Start a new revision so instances read it: `gcloud run services update thuluth-pdf --region "$REGION" --update-labels rotated=$(date +%Y%m%d)`.
3. Update Supabase: repeat the `GOTENBERG_TOKEN` line from step 5.
4. Update 1Password "<env> GOTENBERG_TOKEN". Run Verify 1 and 4.
5. Disable the old version: `gcloud secrets versions list gotenberg-token`, then `gcloud secrets versions disable <old-version> --secret gotenberg-token`.

To **upgrade Gotenberg**, rebuild (step 2), check the changelog for renamed flags in the Dockerfile, deploy the new digest (step 4), then run Verify 1 and 4.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| App says "Exports aren't available yet" | `GOTENBERG_URL` or `GOTENBERG_TOKEN` unset, or the URL does not start with `https://` (`renderer_not_configured`) | Step 5; check `supabase secrets list`. |
| App says "The PDF couldn't be created this time" and function logs show `renderer returned 401` | Token in Supabase differs from Secret Manager, or Cloud Run still runs a revision with the old secret | Repeat rotation steps 2 and 3. |
| `renderer unreachable` or timeouts after 20 s | Cold start plus a queue of renders on one instance, or the service is down | Check Cloud Run logs. Lower concurrency to 2 (`containerConcurrency`) or set min instances to 1 in busy periods (costs about 30 to 60 USD a month). |
| New revision never becomes ready; startup probe fails | Gotenberg answers `/health` with 401 when basic auth is on (version dependent), so the HTTP probe fails | Replace the `httpGet` probes in your copy of `service.yaml` with `tcpSocket: { port: 8080 }` and redeploy; tell a developer so `service.yaml` is updated. |
| `gcloud builds submit` fails with a permission error on Artifact Registry | New projects run Cloud Build as the Compute Engine default service account without push rights | Grant that account `roles/artifactregistry.writer` on the `thuluth` repository, then rebuild. |
| Urdu text renders as boxes or in the wrong font | A font package is missing in the image | Rebuild from `tooling/gotenberg/Dockerfile` unchanged; ask a developer if a template names a new font. |
