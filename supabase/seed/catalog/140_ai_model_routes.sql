-- supabase/seed/catalog/140_ai_model_routes.sql
-- Default AI model routing (00-foundations section 3; params from 12-ai-agent-architecture.md 5.3).
-- priority 1 = primary, 2+ = fallbacks walked in order on retryable errors.
-- Idempotent: re-running updates provider/model/params but never flips `enabled`, so an
-- admin who disables a route during an incident is not overridden by the next catalog-sync.
--
-- Provider names follow the 05 check constraint ('anthropic','openai','google').
--
-- PLACEHOLDER MODEL IDS TO CONFIRM (owner / ai lane, before staging):
--   openai  'gpt-5'                  -> "OpenAI flagship" in 00 section 3
--   google  'gemini-2.5-pro'         -> "Gemini Pro"
--   google  'gemini-2.5-flash'       -> "Gemini Flash" / "Gemini audio"
--   openai  'gpt-4o-transcribe'      -> "OpenAI transcription model"
-- Anthropic ids are exactly those named in 00 section 3.
--
-- PRICES (12 section 5.3/5.6). Every route carries list prices in params, USD per million tokens
-- (numerically micro-USD per token, which is what ai_usage.cost_usd_micros is summed from):
--   priceInPerMTokUsd, priceOutPerMTokUsd, and on Anthropic routes priceCacheReadPerMTokUsd and
--   priceCacheWritePerMTokUsd (5-minute cache write = 1.25x input).
-- Without them every call meters $0 and the per-user daily caps (ai.caps daily_hard_usd_micros,
-- free $0.10 / premium $0.60), monthly caps, the $100 global cap and AI_DAILY_COST_ALERT_USD never
-- trigger; the route resolver logs `ai_route_unpriced` once per route when a price is missing, and
-- supabase/tests/database/functions/170_ai_route_prices.test.sql fails the build.
--   Anthropic (claude-api reference, 2026-09; same table as packages/ai-core/scripts/cost-sim.ts):
--     claude-opus-5-5            in 4    out 20   cache read 0.20  cache write 5
--     claude-sonnet-5-5          in 2    out 10   cache read 0.20  cache write 2.50
--     claude-haiku-4-5-20251001  in 1    out 5    cache read 0.10  cache write 1.25
--   OpenAI / Google: public list prices for the placeholder models. VERIFY AGAINST THE PROVIDER
--   PRICE PAGE BEFORE LAUNCH (and again whenever a placeholder model id above changes):
--     gpt-5                      in 1.25 out 10
--     gemini-2.5-pro             in 1.25 out 10   (prompts <= 200k tokens; ours are far smaller)
--     gemini-2.5-flash           in 0.30 out 2.50 (text/image input)
--     text-embedding-3-large     in 0.13 out 0    (embeddings have no output tokens)
--   speech.transcribe is metered per audio second, not per token (12 section 15,
--   packages/ai-core/src/speech/transcribe.ts): the route carries `pricePerMinuteUsd` and the
--   transcriber derives the per-second price from it (priceIn/Out on those rows are ignored).
--     gpt-4o-transcribe          0.006 USD per audio minute (OpenAI estimated per-minute price)
--     gemini-2.5-flash (audio)   0.003 USD per audio minute: an upper estimate (audio input
--                                $1.00/MTok at ~32 tokens per second, plus transcript output)
-- Seed re-runs overwrite params, so a price an admin edits in the dashboard must also be changed
-- here or the next catalog-sync puts the seeded value back.
--
-- Addition beyond 00-foundations: route key 'chat.free'. Product decision (00 section 11, open
-- decision #1, default taken): strict free-tier caps AND free-tier chat on the cheapest model.
-- ai-chat uses 'chat.free' for free users while feature flag 'chat.free_route' is enabled
-- (seed/catalog/160_feature_flags.sql). 'chat.summarize' and 'eval.judge' are additions from
-- 12-ai-agent-architecture.md section 21 (05 section 22.4 notes they are seed rows, not schema).
--
-- S7-02 (docs/ai/s7-cost-latency.md): chat.default on Sonnet 5.5 runs with "effort":"low" and
-- "thinking":"between_tools" (no extended thinking), so thinking tokens neither count against the
-- 1500-token reply cap nor bill as output on every chat turn. The Anthropic adapter only sends these
-- to models that accept them and drops "temperature" for models that reject sampling parameters
-- (Sonnet 5.x, Opus 4.7+/5.x); other providers keep using it. Revert by removing the two keys.

insert into public.ai_model_routes (route_key, provider, model, priority, enabled, params) values
  ('chat.default',         'anthropic', 'claude-sonnet-5-5',         1, true, '{"timeoutMs":45000,"maxOutputTokens":1500,"temperature":0.4,"effort":"low","thinking":"between_tools","priceInPerMTokUsd":2,"priceOutPerMTokUsd":10,"priceCacheReadPerMTokUsd":0.2,"priceCacheWritePerMTokUsd":2.5}'),
  ('chat.default',         'openai',    'gpt-5',                     2, true, '{"timeoutMs":45000,"maxOutputTokens":1500,"temperature":0.4,"priceInPerMTokUsd":1.25,"priceOutPerMTokUsd":10}'),
  ('chat.default',         'google',    'gemini-2.5-pro',            3, true, '{"timeoutMs":45000,"maxOutputTokens":1500,"temperature":0.4,"priceInPerMTokUsd":1.25,"priceOutPerMTokUsd":10}'),
  ('chat.free',            'anthropic', 'claude-haiku-4-5-20251001', 1, true, '{"timeoutMs":30000,"maxOutputTokens":800,"temperature":0.4,"priceInPerMTokUsd":1,"priceOutPerMTokUsd":5,"priceCacheReadPerMTokUsd":0.1,"priceCacheWritePerMTokUsd":1.25}'),
  ('chat.free',            'google',    'gemini-2.5-flash',          2, true, '{"timeoutMs":30000,"maxOutputTokens":800,"temperature":0.4,"priceInPerMTokUsd":0.3,"priceOutPerMTokUsd":2.5}'),
  ('plan.generate',        'anthropic', 'claude-opus-5-5',           1, true, '{"timeoutMs":120000,"maxOutputTokens":8000,"temperature":0.3,"priceInPerMTokUsd":4,"priceOutPerMTokUsd":20,"priceCacheReadPerMTokUsd":0.2,"priceCacheWritePerMTokUsd":5}'),
  ('plan.generate',        'anthropic', 'claude-sonnet-5-5',         2, true, '{"timeoutMs":90000,"maxOutputTokens":8000,"temperature":0.3,"priceInPerMTokUsd":2,"priceOutPerMTokUsd":10,"priceCacheReadPerMTokUsd":0.2,"priceCacheWritePerMTokUsd":2.5}'),
  ('plan.adjust',          'anthropic', 'claude-sonnet-5-5',         1, true, '{"timeoutMs":60000,"maxOutputTokens":4000,"temperature":0.3,"priceInPerMTokUsd":2,"priceOutPerMTokUsd":10,"priceCacheReadPerMTokUsd":0.2,"priceCacheWritePerMTokUsd":2.5}'),
  ('plan.adjust',          'openai',    'gpt-5',                     2, true, '{"timeoutMs":60000,"maxOutputTokens":4000,"temperature":0.3,"priceInPerMTokUsd":1.25,"priceOutPerMTokUsd":10}'),
  ('vision.meal_analysis', 'anthropic', 'claude-sonnet-5-5',         1, true, '{"timeoutMs":30000,"maxOutputTokens":1200,"temperature":0.1,"priceInPerMTokUsd":2,"priceOutPerMTokUsd":10,"priceCacheReadPerMTokUsd":0.2,"priceCacheWritePerMTokUsd":2.5}'),
  ('vision.meal_analysis', 'google',    'gemini-2.5-pro',            2, true, '{"timeoutMs":30000,"maxOutputTokens":1200,"temperature":0.1,"priceInPerMTokUsd":1.25,"priceOutPerMTokUsd":10}'),
  ('classify.safety',      'anthropic', 'claude-haiku-4-5-20251001', 1, true, '{"timeoutMs":4000,"maxOutputTokens":200,"temperature":0,"priceInPerMTokUsd":1,"priceOutPerMTokUsd":5,"priceCacheReadPerMTokUsd":0.1,"priceCacheWritePerMTokUsd":1.25}'),
  ('classify.safety',      'google',    'gemini-2.5-flash',          2, true, '{"timeoutMs":4000,"maxOutputTokens":200,"temperature":0,"priceInPerMTokUsd":0.3,"priceOutPerMTokUsd":2.5}'),
  ('classify.intent',      'anthropic', 'claude-haiku-4-5-20251001', 1, true, '{"timeoutMs":3000,"maxOutputTokens":150,"temperature":0,"priceInPerMTokUsd":1,"priceOutPerMTokUsd":5,"priceCacheReadPerMTokUsd":0.1,"priceCacheWritePerMTokUsd":1.25}'),
  ('classify.intent',      'google',    'gemini-2.5-flash',          2, true, '{"timeoutMs":3000,"maxOutputTokens":150,"temperature":0,"priceInPerMTokUsd":0.3,"priceOutPerMTokUsd":2.5}'),
  ('speech.transcribe',    'openai',    'gpt-4o-transcribe',         1, true, '{"timeoutMs":20000,"pricePerMinuteUsd":0.006}'),
  ('speech.transcribe',    'google',    'gemini-2.5-flash',          2, true, '{"timeoutMs":20000,"pricePerMinuteUsd":0.003}'),
  ('embed.knowledge',      'openai',    'text-embedding-3-large',    1, true, '{"timeoutMs":10000,"dimensions":1536,"priceInPerMTokUsd":0.13,"priceOutPerMTokUsd":0}'),
  ('chat.summarize',       'anthropic', 'claude-haiku-4-5-20251001', 1, true, '{"timeoutMs":15000,"maxOutputTokens":600,"temperature":0,"priceInPerMTokUsd":1,"priceOutPerMTokUsd":5,"priceCacheReadPerMTokUsd":0.1,"priceCacheWritePerMTokUsd":1.25}'),
  ('eval.judge',           'anthropic', 'claude-sonnet-5-5',         1, true, '{"timeoutMs":60000,"maxOutputTokens":1000,"temperature":0,"priceInPerMTokUsd":2,"priceOutPerMTokUsd":10,"priceCacheReadPerMTokUsd":0.2,"priceCacheWritePerMTokUsd":2.5}')
on conflict (route_key, priority) do update
  set provider = excluded.provider,
      model    = excluded.model,
      params   = excluded.params;
