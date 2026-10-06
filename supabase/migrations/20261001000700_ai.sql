-- supabase/migrations/20261001000700_ai.sql
-- 0007 AI (05-database-schema.md section 10), Sprint 0 subset (S0-09):
-- ai_usage, ai_model_routes, prompt_templates (verbatim DDL).
-- ai_assessments, chat_sessions, chat_messages, ai_memories land in Sprint 2 / Sprint 5
-- with the features that use them; see migrations/README.md.
--
-- Provider vocabulary is ('anthropic','openai','google'). 12-ai-agent-architecture.md
-- section 5.3 writes 'gemini' in its seed sketch; 05 is the reference DDL, so Gemini
-- routes are stored as provider 'google'.

-- 10.5 ai_usage (metering; written by Edge Functions)
create table public.ai_usage (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  household_id     uuid references public.households(id) on delete set null,
  route_key        text not null,
  provider         text not null check (provider in ('anthropic','openai','google')),
  model            text not null,
  tokens_in        integer not null default 0 check (tokens_in >= 0),
  tokens_out       integer not null default 0 check (tokens_out >= 0),
  cost_usd_micros  bigint not null default 0 check (cost_usd_micros >= 0),
  latency_ms       integer check (latency_ms >= 0),
  status           text not null default 'ok' check (status in ('ok','error','fallback','blocked')), -- Addition
  request_id       text,                                                                      -- Addition: correlates with Sentry
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index ai_usage_user_day_idx on public.ai_usage (user_id, route_key, created_at desc);
create index ai_usage_created_idx on public.ai_usage using brin (created_at);

-- 10.6 ai_model_routes
create table public.ai_model_routes (
  id          uuid primary key default gen_random_uuid(),
  route_key   text not null,
  provider    text not null check (provider in ('anthropic','openai','google')),
  model       text not null,
  params      jsonb not null default '{}'::jsonb,   -- {"max_tokens":4096,"temperature":0.4,"timeout_ms":60000}
  priority    smallint not null default 1 check (priority >= 1),  -- 1 = primary, 2+ = fallbacks
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (route_key, priority)
);

-- 10.7 prompt_templates
create table public.prompt_templates (
  id          uuid primary key default gen_random_uuid(),
  key         text not null check (key ~ '^[a-z0-9_.]+$'),
  version     integer not null check (version >= 1),
  body        text not null,
  variables   jsonb not null default '[]'::jsonb,   -- ["household_summary","locale","tradition"]
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (key, version)
);
create unique index prompt_templates_one_active on public.prompt_templates (key) where is_active;
