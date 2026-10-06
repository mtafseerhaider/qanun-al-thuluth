# PDF renderer (Gotenberg on Cloud Run)

`export-pdf` (S6-08, docs/18 §2) sends HTML to a private Gotenberg 8 service and stores the PDF in
the `exports` bucket. Without this service the function answers `FEATURE_DISABLED`
(`details.reason = "renderer_not_configured"`). Nothing here is deployed by CI. A person with access
to the GCP project runs the steps below once per environment (dev, staging, prod).

## What is here

| File           | Purpose                                                                                                                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile`   | `gotenberg/gotenberg:8` plus Noto Nastaliq Urdu, Noto Naskh Arabic, Noto Sans, Amiri and Inter. Basic auth on, JavaScript off, Chromium limited to the request's own files, LibreOffice and webhooks off |
| `service.yaml` | Cloud Run service `thuluth-pdf` in `europe-west3`: min 0, max 5 instances, concurrency 4, 2 vCPU / 2 GiB, password from Secret Manager                                                                   |

## Security model

- **Auth.** Gotenberg basic auth with username `thuluth`. The password is a random secret held in
  GCP Secret Manager (`gotenberg-token`) and also in the Supabase function secret `GOTENBERG_TOKEN`
  (docs/19 secrets table, rotation every 180 days). Docs/04 §4 allows either a Google-signed ID token
  or a static bearer secret. A static secret is used because Edge Functions have no GCP identity.
- **No data persistence.** Gotenberg writes request files to `/tmp` inside the instance and deletes
  them after each conversion. Cloud Run has no persistent disk.
- **No outbound fetches from documents.** `--chromium-allow-list=^file:///tmp/.*` plus JavaScript
  off means rendered HTML cannot load remote URLs. All fonts are baked into the image and the
  templates inline everything else (AC-E7). Optional hardening: route all egress through a
  Serverless VPC connector with no NAT (`run.googleapis.com/vpc-access-egress: all-traffic`), so the
  container has no internet at all.
- **Region.** `europe-west3` (Frankfurt), the same region as the Supabase projects (00 §11, EU data).

## Deploy (manual, per environment)

```sh
PROJECT_ID=thuluth-<env>
REGION=europe-west3
gcloud config set project "$PROJECT_ID"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com

# 1. Image
gcloud artifacts repositories create thuluth --repository-format=docker --location="$REGION" || true
gcloud builds submit tooling/gotenberg --tag "$REGION-docker.pkg.dev/$PROJECT_ID/thuluth/gotenberg:8"

# 2. Secret (never commit or paste it anywhere else)
openssl rand -base64 48 | tr -d '\n' | gcloud secrets create gotenberg-token --data-file=-
gcloud iam service-accounts create thuluth-pdf --display-name "Thuluth PDF renderer"
gcloud secrets add-iam-policy-binding gotenberg-token \
  --member "serviceAccount:thuluth-pdf@$PROJECT_ID.iam.gserviceaccount.com" \
  --role roles/secretmanager.secretAccessor

# 3. Service: put PROJECT_ID and the image digest from step 1 into service.yaml, then
gcloud run services replace tooling/gotenberg/service.yaml --region "$REGION"
gcloud run services add-iam-policy-binding thuluth-pdf --region "$REGION" \
  --member allUsers --role roles/run.invoker     # the gateway is open; Gotenberg basic auth guards it

# 4. Supabase function secrets (same token value as step 2)
URL=$(gcloud run services describe thuluth-pdf --region "$REGION" --format 'value(status.url)')
supabase secrets set --project-ref <ref> GOTENBERG_URL="$URL"
gcloud secrets versions access latest --secret gotenberg-token \
  | xargs -I{} supabase secrets set --project-ref <ref> GOTENBERG_TOKEN={}
```

## Smoke test

```sh
TOKEN=$(gcloud secrets versions access latest --secret gotenberg-token)
printf '<html lang="ur" dir="rtl"><body style="font-family:Noto Nastaliq Urdu">ثلث</body></html>' > /tmp/index.html
curl -sf -u "thuluth:$TOKEN" -F files=@/tmp/index.html "$URL/forms/chromium/convert/html" -o /tmp/out.pdf
curl -s -o /dev/null -w '%{http_code}\n' "$URL/forms/chromium/convert/html"   # expect 401 without auth
```

## Rotation

Add a new secret version, redeploy the service (`gcloud run services update thuluth-pdf
--region $REGION`) so new instances read it, then update `GOTENBERG_TOKEN` in Supabase. Exports
fail with `UPSTREAM_UNAVAILABLE` between those two steps, so rotate at a quiet hour.
