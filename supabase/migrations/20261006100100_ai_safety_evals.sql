-- supabase/migrations/20261006100100_ai_safety_evals.sql
-- 05 ref: 0018 AI jobs and safety, part 0018a (Sprint 2: S2-09 red flags, S2-11 evals). Verbatim
--         from 05 section 22.4 (18.2, 18.3, the ai_usage half of 18.4), except:
--   * safety_events.chat_message_id has no foreign key yet: chat_messages arrives in S5 (0007 part 3),
--     and that migration adds `safety_events_chat_message_id_fkey ... on delete set null`.
-- Not here: ai_jobs (0018b, S3), ai_memories.kind/status, chat_messages column grants and
-- ai_quota_check (0018c, S5).

-- 18.2 safety_events: durable record of red-flag escalations (00-foundations section 10.2) ----------
create table public.safety_events (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  family_member_id  uuid,
  user_id           uuid references public.users(id) on delete set null,
  source            text not null check (source in ('chat','plan_generation','photo','growth','intake')),
  category          text not null check (char_length(category) <= 64),   -- matches escalate_to_clinician.category
  urgency           text not null check (urgency in ('emergency_now','same_day','soon','routine')),
  evidence          text check (char_length(evidence) <= 1000),         -- short text already shown to the user
  chat_message_id   uuid,                                                -- FK to chat_messages added in S5
  resolved_at       timestamptz,
  resolved_by       uuid references public.users(id) on delete set null,
  resolved_note     text check (char_length(resolved_note) <= 1000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (family_member_id, household_id)
    references public.family_members(id, household_id) on delete set null (family_member_id)
);
create index safety_events_household_idx on public.safety_events (household_id, created_at desc);
create index safety_events_open_idx on public.safety_events (household_id) where resolved_at is null;
create index safety_events_member_idx on public.safety_events (family_member_id) where family_member_id is not null;
call private.attach_updated_at('public.safety_events');
call private.attach_audit('public.safety_events', 'keys_only');

alter table public.safety_events enable row level security;
create policy safety_events_select_member on public.safety_events for select to authenticated
  using (public.is_household_member(household_id));
create policy safety_events_resolve_editor on public.safety_events for update to authenticated
  using (public.can_edit_household(household_id))
  with check (public.can_edit_household(household_id) and resolved_by = auth.uid());
revoke insert, update, delete on public.safety_events from authenticated;
grant update (resolved_at, resolved_by, resolved_note) on public.safety_events to authenticated;

-- 18.3 Eval harness (12 section 19, 21 section 20). Deployed everywhere, populated in staging and CI only.
create table public.ai_eval_cases (
  id          uuid primary key default gen_random_uuid(),
  suite       text not null check (suite ~ '^[a-z0-9_.]+$'),
  case_key    text not null,
  fixture     jsonb not null,
  expect      jsonb not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (suite, case_key)
);
create table public.ai_eval_runs (
  id               uuid primary key default gen_random_uuid(),
  suite            text not null,
  git_sha          text,
  case_id          uuid references public.ai_eval_cases(id) on delete cascade,   -- null = suite-level summary row
  prompt_key       text,
  prompt_version   integer,
  route_key        text,
  model            text,
  passed           boolean not null,
  judge_score      numeric(4,2) check (judge_score between 0 and 10),
  output           jsonb,
  prompt_versions  jsonb not null default '{}'::jsonb,   -- summary rows (21): {"chat.system": 7, ...}
  routes           jsonb not null default '{}'::jsonb,
  metrics          jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index ai_eval_runs_suite_idx on public.ai_eval_runs (suite, created_at desc);
create index ai_eval_runs_case_idx on public.ai_eval_runs (case_id, created_at desc) where case_id is not null;
call private.attach_updated_at('public.ai_eval_cases');
call private.attach_updated_at('public.ai_eval_runs');
alter table public.ai_eval_cases enable row level security;
alter table public.ai_eval_runs enable row level security;
create policy ai_eval_cases_admin on public.ai_eval_cases for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy ai_eval_runs_admin on public.ai_eval_runs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 18.4 Metering columns (05 already has ai_usage.request_id and ai_usage.status)
alter table public.ai_usage
  add column prompt_key          text,
  add column prompt_version      integer check (prompt_version >= 1),
  add column cache_read_tokens   integer not null default 0 check (cache_read_tokens >= 0),
  add column cache_write_tokens  integer not null default 0 check (cache_write_tokens >= 0);
create index ai_usage_user_created_idx on public.ai_usage (user_id, created_at desc) include (cost_usd_micros);
