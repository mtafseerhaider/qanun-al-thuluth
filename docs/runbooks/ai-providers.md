# AI providers (Anthropic, OpenAI, Google Gemini): configuration runbook

> **Environments:** dev / staging / prod · **Time:** ~45 min for all three providers per environment · **Needs:** owner access to the Anthropic Console, the OpenAI Platform and Google Cloud / Google AI Studio, a company payment card, Supabase CLI, SQL access as `postgres`, access to vault "Thuluth Platform" · **Related:** `12-ai-agent-architecture.md` §5.3, §5.6 and §17, `19-deployment-architecture.md` §1, [`../ops/secrets.md`](../ops/secrets.md) §1, [`../ai/s7-cost-latency.md`](../ai/s7-cost-latency.md), [`supabase-secrets-and-vault.md`](supabase-secrets-and-vault.md), [`feature-flags-and-app-config.md`](feature-flags-and-app-config.md), [`password-manager.md`](password-manager.md)

The provider consoles change their menus often. The menu names in this runbook may differ slightly from what you see.

## What this configures

The AI features (chat, plan generation and adjustment, photo meal analysis, voice transcription, safety and intent classification, knowledge embeddings) call three providers from the Edge Functions through `packages/ai-core`. Each feature has a **route** in the table `ai_model_routes`: a primary model and fallbacks that are tried in order on retryable errors. Every call writes one row to `ai_usage` with its cost, and the cost caps and the daily cost alert read those rows. If a key is missing, the routes on that provider fail over to the next provider. If every provider on a route fails, the user gets `AI_UNAVAILABLE`. `embed.knowledge` has only an OpenAI route, and `speech.transcribe` starts on OpenAI, so OpenAI is needed for knowledge search and voice.

## Before you start

- [`supabase-projects.md`](supabase-projects.md) is done for this environment, including the catalog seeds (they create the routes and the `ai.caps` flag).
- You know your spend budget per environment. 19 §1 sets monthly caps of **$100 for dev** and **$300 for staging**. The PO sets prod (see step 4).

## Steps

### 1. Anthropic (primary for chat, plans, vision, classification)

1. Sign in to the Anthropic Console with the company organization.
2. Go to **Settings > Workspaces** and create one workspace per environment: `thuluth-dev`, `thuluth-staging`, `thuluth-prod`.
3. For each workspace, open **Limits** and set a **monthly spend limit** (step 4 table).
4. Under **Settings > Billing** (or Notifications), add spend notification emails for the owner.
5. In each workspace, go to **API keys > Create key**, name it `thuluth-<env>-functions`, and copy the key once. Save it in 1Password as `<env> ANTHROPIC_API_KEY`.

### 2. OpenAI (fallbacks, transcription, embeddings)

1. In the OpenAI Platform, create one **project** per environment: `thuluth-dev`, `thuluth-staging`, `thuluth-prod`.
2. In each project, open **Settings > Limits**:
   - Set the monthly **budget** and an email notification threshold at 80 percent of it.
   - If model allow-listing is offered, allow only the models the routes use: `gpt-5`, `gpt-4o-transcribe`, `text-embedding-3-large`.
3. Create the key in the project (**API keys > Create new secret key**, owned by the project, named `thuluth-<env>-functions`). Save it as `<env> OPENAI_API_KEY`.

### 3. Google Gemini (last fallback, cheap classification fallback)

1. In the Google Cloud console, create one project per environment, for example `thuluth-ai-dev`, `thuluth-ai-staging`, `thuluth-ai-prod`. Link each to the billing account. **Use the paid tier, not the free tier, for every environment that sees real or realistic family data**: Google may use free-tier prompts to improve its products.
2. In Google AI Studio, go to **Get API key > Create API key** and pick the matching Cloud project. In the Cloud console, under **APIs and services > Credentials**, restrict the key to the **Generative Language API**.
3. In **Billing > Budgets and alerts**, create a budget scoped to that project, with email alerts at 50, 90 and 100 percent. Google budgets alert but do not stop spend. To hard-stop, lower the project's Generative Language API quotas.
4. Save the key as `<env> GEMINI_API_KEY`.

The function secret is `GEMINI_API_KEY` (`packages/ai-core/src/providers/gemini.ts`, 19 §8).

### 4. Spend limits and alerts per environment

| Console setting | dev | staging | prod |
|---|---|---|---|
| Monthly limit across all three providers (19 §1) | $100 | $300 | PO decision (see below) |
| Alert | 80 percent of the limit | 80 percent | 80 percent, plus `AI_DAILY_COST_ALERT_USD` (step 7) |

For prod, the app's own cap stops chat at **$100 per day** across all users (`global_daily_usd_micros`, [`feature-flags-and-app-config.md`](feature-flags-and-app-config.md)). That cap covers chat only. Plans, photo analysis and voice are limited per user by `ai.caps`. A console limit far below roughly $3,000 per month for chat, plus a margin for the other features, can cut production off mid-month. If a provider limit is hit, its calls fail over to the next provider and the cost moves there, so set all three.

### 5. Put the keys into Supabase

Follow [`supabase-secrets-and-vault.md`](supabase-secrets-and-vault.md) steps 2 and 3. For a single key:

```bash
supabase secrets set --project-ref <ref> ANTHROPIC_API_KEY="$(op read 'op://Thuluth Platform/<env> ANTHROPIC_API_KEY/credential')"
```

The function secret names are exactly `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` and `GEMINI_API_KEY`. Never put them in EAS or GitHub. CI blocks them from the mobile bundle (`tooling/scripts/check-mobile-secrets.sh`).

### 6. Check the model routes and their prices

The catalog seed `supabase/seed/catalog/140_ai_model_routes.sql` creates these routes (priority 1 is the primary):

| Route key | Used for | 1 | 2 | 3 |
|---|---|---|---|---|
| `chat.default` | premium chat | anthropic `claude-sonnet-5-5` | openai `gpt-5` | google `gemini-2.5-pro` |
| `chat.free` | free chat, and premium over its daily cap | anthropic `claude-haiku-4-5-20251001` | google `gemini-2.5-flash` | |
| `plan.generate` | weekly plan | anthropic `claude-opus-5-5` | anthropic `claude-sonnet-5-5` | |
| `plan.adjust` | plan changes | anthropic `claude-sonnet-5-5` | openai `gpt-5` | |
| `vision.meal_analysis` | photo of a meal | anthropic `claude-sonnet-5-5` | google `gemini-2.5-pro` | |
| `classify.safety` | safety check | anthropic `claude-haiku-4-5-20251001` | google `gemini-2.5-flash` | |
| `classify.intent` | intent check | anthropic `claude-haiku-4-5-20251001` | google `gemini-2.5-flash` | |
| `speech.transcribe` | voice questions | openai `gpt-4o-transcribe` | google `gemini-2.5-flash` | |
| `embed.knowledge` | knowledge search | openai `text-embedding-3-large` | | |
| `chat.summarize` | chat memory | anthropic `claude-haiku-4-5-20251001` | | |
| `eval.judge` | evaluations | anthropic `claude-sonnet-5-5` | | |

The seed marks `gpt-5`, `gemini-2.5-pro`, `gemini-2.5-flash` and `gpt-4o-transcribe` as **placeholder ids to confirm before staging**. Check each one exists in the console. If one does not, the backend changes the seed file in a PR (see "How to change a route").

**Prices are required for the cost caps.** `ai_usage.cost_usd_micros` is computed from prices in each route's `params` (`packages/ai-core/src/metering/usage.ts`): `priceInPerMTokUsd`, `priceOutPerMTokUsd`, `priceCacheReadPerMTokUsd`, `priceCacheWritePerMTokUsd` (USD per million tokens), and `pricePerMinuteUsd` for `speech.transcribe`.

The prices live in the catalog seed, `supabase/seed/catalog/140_ai_model_routes.sql`, next to each route, and every deploy applies them (`deploy-prod.yml` runs the catalog seeds). The seed's header comment lists the numbers and where they come from: the Anthropic prices match the cost simulation (`packages/ai-core/scripts/cost-sim.ts`, 2026-09); the OpenAI and Google prices are public list prices for placeholder models and must be checked against the provider price pages before launch. `speech.transcribe` routes carry `pricePerMinuteUsd` (per audio minute) instead of token prices. The database test `supabase/tests/database/functions/170_ai_route_prices.test.sql` fails the build if a route has no price, and a route without a price logs `ai_route_unpriced` once per function instance.

Check the prices on a project:

```sql
select route_key, priority, provider, model,
       params->>'priceInPerMTokUsd' as usd_in, params->>'priceOutPerMTokUsd' as usd_out,
       params->>'pricePerMinuteUsd' as usd_per_min
  from public.ai_model_routes order by 1, 2;
```

**To change a price,** open a PR that edits the price in `140_ai_model_routes.sql` (and the table in its header comment), then deploy. Do not edit prices by hand in SQL: the seed overwrites `params` on every catalog-seed run, so a hand edit is lost at the next deploy.

### 7. Set the daily cost alert

`analytics-rollup` runs hourly. It logs the alert `ai_cost_daily_high` when today's total AI spend is above `AI_DAILY_COST_ALERT_USD` (default **50** USD). The alert reaches the on-call through the log alert E5 in [`../ops/sentry-alerts.md`](../ops/sentry-alerts.md).

```bash
supabase secrets set --project-ref <ref> AI_DAILY_COST_ALERT_USD=50
```

Keep 50 for prod at launch unless the PO picks another number. Keep it below the $100 global chat cap, so the alert fires before chat stops for free users. For dev and staging, any value works.

### How to change a route

Routes are cached for **60 seconds** per function instance, so a change takes up to a minute.

| Goal | Survives the next catalog-seed run? | How |
|---|---|---|
| Turn a model off during an incident (fall through to the next priority) | **yes** (the seed never changes `enabled`) | `update public.ai_model_routes set enabled = false where route_key = 'chat.default' and priority = 1;` and later `set enabled = true` |
| Change a model id, provider, timeout or price for good | **no** (the seed overwrites `provider`, `model`, `params`) | a PR to `supabase/seed/catalog/140_ai_model_routes.sql`, then a deploy |
| Try a model change on dev | no | `update public.ai_model_routes set model = '<new id>' where route_key = '<key>' and priority = <n>;`, then make the same change in a PR |
| Add a fallback | no | a PR to the seed (unique key is `route_key, priority`) |

Run route changes as `postgres` in the SQL editor, or as an admin user (`ai_model_routes` has an admin-only RLS policy). Every change is written to `audit_log`.

## Where the values go

| Value | Where it is set | Name |
|---|---|---|
| Anthropic key | function secret | `ANTHROPIC_API_KEY` |
| OpenAI key | function secret | `OPENAI_API_KEY` |
| Gemini key | function secret | `GEMINI_API_KEY` |
| Daily cost alert threshold (USD) | function secret | `AI_DAILY_COST_ALERT_USD` |
| Models, fallbacks, prices | table `ai_model_routes` (seed `140_ai_model_routes.sql`) | route keys above |
| Per-user and global caps | flag `ai.caps` | [`feature-flags-and-app-config.md`](feature-flags-and-app-config.md) |
| Spend limits | each provider console | (none) |

## Verify

1. `supabase secrets list --project-ref <ref>` shows the three key names.
2. In the app, sign in as a test account and send one chat message. Then run:

```sql
select created_at, route_key, provider, model, tokens_in, tokens_out, cost_usd_micros, status, latency_ms
  from public.ai_usage order by created_at desc limit 10;
```

Expect new rows with `status = 'ok'`. A free account uses `chat.free` on `claude-haiku-4-5-20251001`, and a premium account uses `chat.default` on `claude-sonnet-5-5`. You may also see `classify.*` and `embed.knowledge` rows. `cost_usd_micros` must be above 0. If it is 0, the prices are missing (step 6).

3. Today's spend in USD, the same number the alert uses:

```sql
select round(sum(cost_usd_micros) / 1e6, 4) as usd_today
  from public.ai_usage where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
```

4. In each provider console, the usage page shows the call within a few minutes, under the right workspace or project.

## Rotate or revoke

Every 90 days ([`../ops/secrets.md`](../ops/secrets.md) §1), and at once if a key may have leaked:

1. Create a new key in the same workspace or project.
2. Update 1Password and run `supabase secrets set` (step 5).
3. Send a chat message and check `ai_usage` (Verify step 2).
4. Revoke the old key in the console.

Each environment has its own keys, so rotating one never affects another.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `cost_usd_micros` is always 0, caps and cost alerts never fire | the catalog seeds were not applied to this project, so `ai_model_routes.params` has no prices | apply the seeds ([`supabase-projects.md`](supabase-projects.md) step 8), then check with the step 6 query |
| Chat returns `AI_UNAVAILABLE` | every provider on the route failed: keys missing or revoked, or console spend limits reached | check `supabase secrets list` and each console's limits |
| Many `ai_usage` rows with `status = 'fallback'` or `error` | the primary provider is failing, rate limiting, or over its spend limit | check that console; turn the primary off temporarily ("How to change a route") |
| Provider error "model not found" | a placeholder model id from the seed does not exist | confirm the id; fix it in the seed with a PR |
| Voice questions or knowledge citations fail while chat works | `OPENAI_API_KEY` missing (`speech.transcribe` primary, `embed.knowledge` only route) | step 2 and step 5 |
| A route change does nothing | the 60-second route cache, or the next deploy re-applied the seed | wait a minute; make lasting changes in the seed |
