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
-- Anthropic ids are exactly those named in 00 section 3. Prices (priceInPerMTokUsd etc.) are not
-- seeded; the admin fills them into params from the provider price pages (12 section 5.3).
--
-- Addition beyond 00-foundations: route key 'chat.free'. Product decision (00 section 11, open
-- decision #1, default taken): strict free-tier caps AND free-tier chat on the cheapest model.
-- ai-chat uses 'chat.free' for free users while feature flag 'chat.free_route' is enabled
-- (seed/catalog/160_feature_flags.sql). 'chat.summarize' and 'eval.judge' are additions from
-- 12-ai-agent-architecture.md section 21 (05 section 22.4 notes they are seed rows, not schema).

insert into public.ai_model_routes (route_key, provider, model, priority, enabled, params) values
  ('chat.default',         'anthropic', 'claude-sonnet-5-5',         1, true, '{"timeoutMs":45000,"maxOutputTokens":1500,"temperature":0.4}'),
  ('chat.default',         'openai',    'gpt-5',                     2, true, '{"timeoutMs":45000,"maxOutputTokens":1500,"temperature":0.4}'),
  ('chat.default',         'google',    'gemini-2.5-pro',            3, true, '{"timeoutMs":45000,"maxOutputTokens":1500,"temperature":0.4}'),
  ('chat.free',            'anthropic', 'claude-haiku-4-5-20251001', 1, true, '{"timeoutMs":30000,"maxOutputTokens":800,"temperature":0.4}'),
  ('chat.free',            'google',    'gemini-2.5-flash',          2, true, '{"timeoutMs":30000,"maxOutputTokens":800,"temperature":0.4}'),
  ('plan.generate',        'anthropic', 'claude-opus-5-5',           1, true, '{"timeoutMs":120000,"maxOutputTokens":8000,"temperature":0.3}'),
  ('plan.generate',        'anthropic', 'claude-sonnet-5-5',         2, true, '{"timeoutMs":90000,"maxOutputTokens":8000,"temperature":0.3}'),
  ('plan.adjust',          'anthropic', 'claude-sonnet-5-5',         1, true, '{"timeoutMs":60000,"maxOutputTokens":4000,"temperature":0.3}'),
  ('plan.adjust',          'openai',    'gpt-5',                     2, true, '{"timeoutMs":60000,"maxOutputTokens":4000,"temperature":0.3}'),
  ('vision.meal_analysis', 'anthropic', 'claude-sonnet-5-5',         1, true, '{"timeoutMs":30000,"maxOutputTokens":1200,"temperature":0.1}'),
  ('vision.meal_analysis', 'google',    'gemini-2.5-pro',            2, true, '{"timeoutMs":30000,"maxOutputTokens":1200,"temperature":0.1}'),
  ('classify.safety',      'anthropic', 'claude-haiku-4-5-20251001', 1, true, '{"timeoutMs":4000,"maxOutputTokens":200,"temperature":0}'),
  ('classify.safety',      'google',    'gemini-2.5-flash',          2, true, '{"timeoutMs":4000,"maxOutputTokens":200,"temperature":0}'),
  ('classify.intent',      'anthropic', 'claude-haiku-4-5-20251001', 1, true, '{"timeoutMs":3000,"maxOutputTokens":150,"temperature":0}'),
  ('classify.intent',      'google',    'gemini-2.5-flash',          2, true, '{"timeoutMs":3000,"maxOutputTokens":150,"temperature":0}'),
  ('speech.transcribe',    'openai',    'gpt-4o-transcribe',         1, true, '{"timeoutMs":20000}'),
  ('speech.transcribe',    'google',    'gemini-2.5-flash',          2, true, '{"timeoutMs":20000}'),
  ('embed.knowledge',      'openai',    'text-embedding-3-large',    1, true, '{"timeoutMs":10000,"dimensions":1536}'),
  ('chat.summarize',       'anthropic', 'claude-haiku-4-5-20251001', 1, true, '{"timeoutMs":15000,"maxOutputTokens":600,"temperature":0}'),
  ('eval.judge',           'anthropic', 'claude-sonnet-5-5',         1, true, '{"timeoutMs":60000,"maxOutputTokens":1000,"temperature":0}')
on conflict (route_key, priority) do update
  set provider = excluded.provider,
      model    = excluded.model,
      params   = excluded.params;
