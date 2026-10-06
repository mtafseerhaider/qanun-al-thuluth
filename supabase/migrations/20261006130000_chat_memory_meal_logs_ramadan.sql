-- supabase/migrations/20261006130000_chat_memory_meal_logs_ramadan.sql
-- 05 ref: 0007 AI (part 3: chat_sessions, chat_messages, ai_memories), 0009 tracking (part 3: meal_logs,
--         ramadan_plans), 0012 15.12 (chat_touch_session), 0013 16.3.5 / 16.3.7 (part), 0014 (ai-memories-expire),
--         0018c (ai_memories.kind/status, chat_messages column privileges, ai_quota_check), 0021c
--         (ramadan_plans.calc_params, v_qada_balance on ramadan_plans), 0025b (prayer_times_cache and
--         prayer-times-retention). Sprint 5: S5-02.
-- DDL verbatim from 05 sections 10.2 to 10.4, 12.1, 12.5, 15.12, 16.3.5, 16.3.7, 17.5 (ai-memories-expire),
-- 22.4 (18.4 memory columns, 18.5, 18.6), 22.7 (21.1 calc_params, 21.2 view) and 22.11 (25.3, 25.6), except:
--   * Addition (06 section 4.1 "client_message_id unique per session"): chat_messages.client_message_id and
--     finish_reason ('complete','escalated','length','cancelled','error'; null while streaming). ai-chat stores the
--     request's client_message_id on the user row and on the assistant row (unique per session and role), so a
--     replay finds the stored reply, and finish_reason tells a completed reply from a failed one.
--   * chat_messages_select_own_session also requires household membership (05 relies on the chat_sessions
--     policy inside the EXISTS; this states it on the row itself), and client column privileges include the
--     two new columns.
--   * Addition (02 SettingsPrivacy "AI memory on/off", FR-SET-04): users.ai_memory_enabled. ai-chat neither writes
--     nor recalls memories for a user who turned it off.
--   * Addition (12 section 7.2 item 4, FR-CHAT-08): match_ai_memories() (service role) returns the household's
--     active memories ranked by cosine similarity x exp(-age_days / 180).
--   * Addition (FR-CHAT-11, 12 section 7.2 item 5, 16 section 7.2): soft-deleting a chat session withdraws the
--     memories sourced from it; withdrawing the last live ai_processing consent withdraws the memories sourced
--     from that user's chats (soft delete, status 'withdrawn'; purged by soft-delete-purge after 30 days).
--     clear_ai_memories(household) is the "Clear all memories" action (owner and caregiver).
--   * ai_memories: clients may also update status (withdraw or reactivate a fact) besides fact and expires_at.
--   * ramadan_plans: suhoor_time_strategy accepts the 05 values and the 06 section 4.9 contract values
--     (just_before_fajr, after_tahajjud, before_sleep); city_prayer_times_source adds dubai, egyptian,
--     moonsighting and computed_fallback (15 section 5.2 defaults by country, 06 prayer_times_source). Addition
--     (00 section 10): a child_participation entry for a member under 7 on start_date must have mode 'none'
--     (CHILD_RULE:fasting_under_7, S2-03 error style), and every key must be a member of the household.
--   * v_qada_balance: 05 joins ramadan_plans (fasts outside every plan are dropped). Here a Ramadan fast inside a
--     live plan takes the plan's hijri_year and a fast outside every plan falls back to the S4 rule
--     (fasting_logs.hijri_date), so logs made before a household created a plan still count. Same columns.
--   * soft_delete: a linked member may soft-delete their own meal_logs (they can insert and update them under
--     HE+self RLS); body otherwise the S4 version.
--   * Addition: FK indexes (10 section 16 rule 3), FKs deferred by S2 / S3 (safety_events.chat_message_id,
--     plan_recommendations.chat_message_id, 05 sections 22.4 and 11.8).
-- Not here: storage buckets (20261006130200), subscriptions and promos (20261006130100), the 12-month memory
-- deletion after downgrade (17 section 10.3; needs notice copy, S6 with account rights), ai_jobs (0018b).

-- 10.2 chat_sessions (private to the user who started them) ---------------------------------------------------
create table public.chat_sessions (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  user_id           uuid not null references public.users(id) on delete cascade,
  title             text not null default '' check (char_length(title) <= 120),
  context_snapshot  jsonb not null default '{}'::jsonb,
  last_message_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  unique (id, household_id)
);
create index chat_sessions_user_idx on public.chat_sessions (user_id, household_id, last_message_at desc nulls last) where deleted_at is null;
create index chat_sessions_household_idx on public.chat_sessions (household_id);   -- FK index

-- 10.3 chat_messages (written only by ai-chat with service role) -------------------------------------------------
create table public.chat_messages (
  id                 uuid primary key default gen_random_uuid(),
  session_id         uuid not null,
  household_id       uuid not null references public.households(id) on delete cascade,
  role               public.chat_role not null,
  content            text not null default '',
  attachments        jsonb not null default '[]'::jsonb,
                     -- [{"type":"image","path":"{household_id}/{session_id}/{uuid}.jpg","mime":"image/jpeg"},{"type":"audio",...}]
  tool_calls         jsonb not null default '[]'::jsonb,
  tokens_in          integer check (tokens_in >= 0),
  tokens_out         integer check (tokens_out >= 0),
  model              text,
  safety_flags       text[] not null default '{}',
  client_message_id  uuid,                                                   -- Addition: 06 section 4.1 idempotency
  finish_reason      text check (finish_reason in ('complete','escalated','length','cancelled','error')),  -- Addition
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (jsonb_typeof(attachments) = 'array'),
  foreign key (session_id, household_id) references public.chat_sessions(id, household_id) on delete cascade
);
create index chat_messages_session_idx on public.chat_messages (session_id, created_at);
create index chat_messages_household_idx on public.chat_messages (household_id, created_at desc);
create index chat_messages_safety_idx on public.chat_messages using gin (safety_flags) where cardinality(safety_flags) > 0;
create unique index chat_messages_client_message_key on public.chat_messages (session_id, role, client_message_id)
  where client_message_id is not null;

-- 10.4 ai_memories (premium long-term memory) + 18.4 kind and status -------------------------------------------
create table public.ai_memories (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.households(id) on delete cascade,
  family_member_id   uuid,
  fact               text not null check (char_length(fact) between 1 and 500),
  source_message_id  uuid references public.chat_messages(id) on delete set null,
  embedding          extensions.vector(1536) not null,
  confidence         numeric(3,2) not null default 0.80 check (confidence between 0 and 1),
  expires_at         timestamptz,
  kind               text not null default 'context' check (kind in ('preference','routine','context','goal_context')),
  status             text not null default 'active'  check (status in ('active','superseded','withdrawn')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index ai_memories_household_idx on public.ai_memories (household_id, family_member_id) where deleted_at is null;
create index ai_memories_embedding_hnsw on public.ai_memories
  using hnsw (embedding extensions.vector_cosine_ops) with (m = 16, ef_construction = 64);
create index ai_memories_active_idx on public.ai_memories (household_id, kind) where status = 'active' and deleted_at is null;
create index ai_memories_source_idx on public.ai_memories (source_message_id) where source_message_id is not null;   -- FK index
create index ai_memories_member_idx on public.ai_memories (family_member_id) where family_member_id is not null;      -- FK index

-- users.ai_memory_enabled (addition, see header) ------------------------------------------------------------------
alter table public.users add column ai_memory_enabled boolean not null default true;
grant update (ai_memory_enabled) on public.users to authenticated;   -- users_update_self: own row only

-- 12.1 meal_logs: free-form tracking outside a plan ----------------------------------------------------------------
create table public.meal_logs (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references public.households(id) on delete cascade,
  family_member_id      uuid not null,
  eaten_at              timestamptz not null default now(),
  meal_type             public.meal_type not null,
  description           text not null default '' check (char_length(description) <= 2000),
  photo_path            text,                  -- bucket "meal-photos": {household_id}/{family_member_id}/{yyyy}/{mm}/{id}.jpg
  estimated_nutrition   jsonb not null default '{}'::jsonb,
                        -- {"items":[{"label":"chicken karahi","grams":180,"confidence":0.7}],"kcal":640,"protein_g":38,...,"thuluth_feedback":"..."}
  fullness_before       smallint check (fullness_before between 0 and 10),   -- hunger-fullness scale, 0 = starving, 10 = stuffed
  fullness_after        smallint check (fullness_after between 0 and 10),
  source                text not null default 'manual' check (source in ('manual','photo_ai','plan')),
  daily_meal_serving_id uuid references public.daily_meal_servings(id) on delete set null,  -- Addition: when source = 'plan'
  logged_by_user_id     uuid references public.users(id) on delete set null default auth.uid(),  -- Addition
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  check (source <> 'photo_ai' or photo_path is not null),
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index meal_logs_member_time_idx on public.meal_logs (household_id, family_member_id, eaten_at desc) where deleted_at is null;
create index meal_logs_member_idx on public.meal_logs (family_member_id);                                          -- FK index
create index meal_logs_serving_idx on public.meal_logs (daily_meal_serving_id) where daily_meal_serving_id is not null;  -- FK index
create index meal_logs_logged_by_idx on public.meal_logs (logged_by_user_id) where logged_by_user_id is not null;     -- FK index

-- 12.5 ramadan_plans (+ 21.1 calc_params) -------------------------------------------------------------------------------
create table public.ramadan_plans (
  id                        uuid primary key default gen_random_uuid(),
  household_id              uuid not null references public.households(id) on delete cascade,
  hijri_year                smallint not null check (hijri_year between 1440 and 1600),
  start_date                date not null,
  end_date                  date not null,
  meal_plan_id              uuid,
  suhoor_time_strategy      text not null default 'late'
                              check (suhoor_time_strategy in ('late','early','split',
                                                              'just_before_fajr','after_tahajjud','before_sleep')),
  child_participation       jsonb not null default '{}'::jsonb check (jsonb_typeof(child_participation) = 'object'),
                            -- {"<family_member_id>":{"mode":"practice_half_day","days":["sat","sun"]}}; under-7 => "none"
  pregnancy_adjustments     jsonb not null default '{}'::jsonb check (jsonb_typeof(pregnancy_adjustments) = 'object'),
                            -- {"<family_member_id>":{"decision":"fasting"|"not_fasting"|"partial","clinicianConfirmed":false}}
  city_prayer_times_source  text not null default 'aladhan'
                              check (city_prayer_times_source in ('aladhan','manual','umm_al_qura','isna','mwl','karachi',
                                                                  'tehran','jafari','dubai','egyptian','moonsighting',
                                                                  'computed_fallback')),
  prayer_times              jsonb not null default '[]'::jsonb check (jsonb_typeof(prayer_times) = 'array'),
                            -- Addition: cached [{"date":"2027-02-08","fajr":"05:31","maghrib":"17:55"}]
  calc_params               jsonb not null default '{}'::jsonb check (jsonb_typeof(calc_params) = 'object'),
                            -- {"method":"Karachi","madhab":"hanafi","latitude":31.5204,"longitude":74.3587,
                            --  "imsakOffsetMin":10,"iftarOffsetMin":0,"highLatitudeRule":"middle_of_the_night","tradition":"sunni"}
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  deleted_at                timestamptz,
  check (end_date >= start_date and end_date - start_date <= 30),
  foreign key (meal_plan_id, household_id) references public.meal_plans(id, household_id) on delete set null (meal_plan_id)
);
create unique index ramadan_plans_one_per_year on public.ramadan_plans (household_id, hijri_year) where deleted_at is null;
create index ramadan_plans_dates_idx on public.ramadan_plans (household_id, start_date, end_date) where deleted_at is null;
create index ramadan_plans_meal_plan_idx on public.ramadan_plans (meal_plan_id) where meal_plan_id is not null;   -- FK index

-- 25.3 prayer_times_cache: shared Aladhan results per city, method and month (04 section 7, 06 section 4.9) ------------
create table public.prayer_times_cache (
  id            uuid primary key default gen_random_uuid(),
  country_code  char(2) not null check (country_code ~ '^[A-Z]{2}$'),
  city          text not null,
  method        smallint not null,             -- Aladhan method id (1 = Karachi, 0 = Jafari, 4 = Umm al-Qura ...)
  school        smallint not null default 0 check (school in (0, 1)),   -- 0 Shafi'i/standard, 1 Hanafi asr
  year          smallint not null check (year between 2020 and 2100),
  month         smallint not null check (month between 1 and 12),
  timings       jsonb not null check (jsonb_typeof(timings) = 'array'),  -- [{"date":"2027-02-08","fajr":"05:31",...}]
  hijri         jsonb not null default '[]'::jsonb,                     -- Aladhan Hijri dates for the same days
  source        text not null default 'aladhan' check (source in ('aladhan','computed_fallback')),
  fetched_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index prayer_times_cache_key
  on public.prayer_times_cache (country_code, lower(city), method, school, year, month);

-- Deferred foreign keys (S2 safety_events, S3 plan_recommendations) -------------------------------------------------
alter table public.safety_events
  add constraint safety_events_chat_message_id_fkey foreign key (chat_message_id)
    references public.chat_messages(id) on delete set null;
create index safety_events_chat_message_idx on public.safety_events (chat_message_id) where chat_message_id is not null;
alter table public.plan_recommendations
  add constraint plan_recommendations_chat_message_id_fkey foreign key (chat_message_id)
    references public.chat_messages(id) on delete cascade;

-- 15.1 updated_at, 15.8 audit ---------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['chat_sessions','chat_messages','ai_memories','meal_logs','ramadan_plans','prayer_times_cache'] loop
    call private.attach_updated_at(('public.' || t)::regclass);
  end loop;
end $$;
call private.attach_audit('public.ai_memories', 'keys_only');

-- 15.12 chat ----------------------------------------------------------------------------------------------------------
create or replace function private.chat_touch_session()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.chat_sessions set last_message_at = new.created_at
   where id = new.session_id and (last_message_at is null or last_message_at < new.created_at);
  return null;
end $$;
create trigger trg_chat_messages_touch after insert on public.chat_messages
  for each row execute function private.chat_touch_session();

-- Memory withdrawal (FR-CHAT-11, 12 section 7.2 item 5) ------------------------------------------------------------------
create or replace function private.withdraw_session_memories()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.ai_memories m
     set status = 'withdrawn', deleted_at = now()
   where m.deleted_at is null
     and m.source_message_id in (select cm.id from public.chat_messages cm where cm.session_id = new.id);
  return null;
end $$;
create trigger trg_chat_sessions_withdraw_memories
  after update of deleted_at on public.chat_sessions
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function private.withdraw_session_memories();

create or replace function private.withdraw_memories_on_consent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.consents c
              where c.user_id = new.user_id and c.kind = 'ai_processing' and c.withdrawn_at is null) then
    return null;   -- another live ai_processing consent (for example a newer version) still covers the user
  end if;
  update public.ai_memories m
     set status = 'withdrawn', deleted_at = now()
   where m.deleted_at is null
     and m.source_message_id in (select cm.id from public.chat_messages cm
                                   join public.chat_sessions s on s.id = cm.session_id
                                  where s.user_id = new.user_id);
  return null;
end $$;
create trigger trg_consents_withdraw_memories
  after update of withdrawn_at on public.consents
  for each row when (new.kind = 'ai_processing' and old.withdrawn_at is null and new.withdrawn_at is not null)
  execute function private.withdraw_memories_on_consent();

-- Ramadan child participation guard (00 section 10: no fasting under 7) ----------------------------------------------------
create or replace function private.ramadan_plans_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare k text; v_member uuid; v_dob date; v_stage public.life_stage; v_mode text;
begin
  for k in select jsonb_object_keys(new.child_participation) loop
    if k !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'VALIDATION_FAILED' using errcode = '22023',
        detail = json_build_object('field', 'child_participation', 'key', k)::text;
    end if;
    v_member := k::uuid;
    select fm.date_of_birth, fm.life_stage into v_dob, v_stage
      from public.family_members fm
     where fm.id = v_member and fm.household_id = new.household_id and fm.deleted_at is null;
    if not found then
      raise exception 'VALIDATION_FAILED' using errcode = '22023',
        detail = json_build_object('field', 'child_participation', 'family_member_id', k, 'reason', 'not_in_household')::text;
    end if;
    v_mode := coalesce(new.child_participation -> k ->> 'mode', 'none');
    if v_mode <> 'none'
       and ((v_dob is not null and age(new.start_date, v_dob) < interval '7 years')
            or (v_dob is null and v_stage in ('infant','toddler'))) then
      raise exception 'CHILD_RULE:fasting_under_7' using errcode = 'P0001',
        detail = json_build_object('rule', 'no_fasting_under_7', 'family_member_id', k)::text,
        hint = 'Children under 7 join family rituals instead of fasting';
    end if;
  end loop;
  return new;
end $$;
create trigger trg_ramadan_plans_guard
  before insert or update of child_participation, start_date, household_id on public.ramadan_plans
  for each row execute function private.ramadan_plans_guard();

-- 16.3.5 RLS: chat and memory ------------------------------------------------------------------------------------------
alter table public.chat_sessions enable row level security;
create policy chat_sessions_select_own on public.chat_sessions for select to authenticated
  using (deleted_at is null and user_id = auth.uid() and public.is_household_member(household_id));
create policy chat_sessions_insert_own on public.chat_sessions for insert to authenticated
  with check (user_id = auth.uid() and public.is_household_member(household_id));
create policy chat_sessions_update_own on public.chat_sessions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_household_member(household_id));
revoke update, delete on public.chat_sessions from authenticated;
grant update (title) on public.chat_sessions to authenticated;   -- delete through rpc soft_delete('chat_sessions')

alter table public.chat_messages enable row level security;
create policy chat_messages_select_own_session on public.chat_messages for select to authenticated
  using (public.is_household_member(household_id)
         and exists (select 1 from public.chat_sessions s
                      where s.id = session_id and s.user_id = auth.uid() and s.deleted_at is null));
-- no client insert/update/delete: ai-chat (service role) persists both user and assistant turns.
-- 18.5: hide tool_calls, tokens and model from clients (06 section 3.8). A column revoke has no effect while a
-- table-level grant exists, so the grant is replaced by a column list.
revoke all on public.chat_messages from authenticated;
grant select (id, session_id, household_id, role, content, attachments, safety_flags, client_message_id,
              finish_reason, created_at, updated_at)
  on public.chat_messages to authenticated;

alter table public.ai_memories enable row level security;
create policy ai_memories_select_editors on public.ai_memories for select to authenticated
  using (deleted_at is null and public.can_edit_household(household_id));
create policy ai_memories_update_editors on public.ai_memories for update to authenticated
  using (public.can_edit_household(household_id)) with check (public.can_edit_household(household_id));
revoke insert, update, delete on public.ai_memories from authenticated;
grant update (fact, expires_at, status) on public.ai_memories to authenticated;  -- forget via soft_delete; inserts by ai-chat

-- 16.3.7 RLS: tracking ----------------------------------------------------------------------------------------------------
call private.apply_household_rls('public.meal_logs', 'edit_self');
call private.apply_household_rls('public.ramadan_plans', 'edit');

-- 25.3 prayer_times_cache: service role only, admins read --------------------------------------------------------------
alter table public.prayer_times_cache enable row level security;
revoke all on public.prayer_times_cache from authenticated;
create policy prayer_times_cache_admin_read on public.prayer_times_cache for select to authenticated using (public.is_admin());

-- 18.6 ai_quota_check: server-side caps (12 section 17). Verbatim 05 22.4. Service role only. ----------------------------
create or replace function public.ai_quota_check(p_user_id uuid, p_route_key text)
returns table (allowed boolean, remaining integer, degrade_to text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_defaults constant jsonb := '{
    "free":    {"per_day": {"chat.default": 20,  "vision.meal_analysis": 0,  "speech.transcribe": 0,  "plan.adjust": 0},
                "monthly_hard_usd_micros": 500000},
    "premium": {"per_day": {"chat.default": 200, "vision.meal_analysis": 15, "speech.transcribe": 40, "plan.adjust": 20},
                "monthly_hard_usd_micros": 8000000, "degrade_route": "chat.free"}}'::jsonb;
  v_tier       text := case when public.has_premium(p_user_id) then 'premium' else 'free' end;
  v_rules      jsonb;
  v_cap        integer;
  v_tz         text;
  v_day_start  timestamptz;
  v_used       integer;
  v_month_cost bigint;
  v_restricted boolean;
begin
  select coalesce(u.timezone, 'UTC'), u.processing_restricted into v_tz, v_restricted
    from public.users u where u.id = p_user_id;
  if v_restricted is null or v_restricted then          -- unknown user or GDPR restriction
    return query select false, 0, null::text;
    return;
  end if;

  v_rules := (v_defaults -> v_tier)
             || coalesce((select f.rules -> v_tier from public.feature_flags f where f.key = 'ai.caps' and f.enabled), '{}'::jsonb);
  v_cap := (v_rules -> 'per_day' ->> p_route_key)::integer;          -- null = no daily cap for this route
  v_day_start := date_trunc('day', now() at time zone v_tz) at time zone v_tz;

  if p_route_key = 'chat.default' then                               -- chat caps count user messages, not model calls
    select count(*) into v_used
      from public.chat_messages m join public.chat_sessions s on s.id = m.session_id
     where s.user_id = p_user_id and m.role = 'user' and m.created_at >= v_day_start;
  else
    select count(*) into v_used
      from public.ai_usage a
     where a.user_id = p_user_id and a.route_key = p_route_key and a.created_at >= v_day_start and a.status <> 'blocked';
  end if;

  select coalesce(sum(a.cost_usd_micros), 0) into v_month_cost
    from public.ai_usage a
   where a.user_id = p_user_id and a.created_at >= date_trunc('month', now());

  if v_month_cost >= coalesce((v_rules ->> 'monthly_hard_usd_micros')::bigint, 9223372036854775807) then
    if v_tier = 'premium' then
      return query select (v_cap is null or v_used < v_cap), case when v_cap is null then null else greatest(v_cap - v_used, 0) end, v_rules ->> 'degrade_route';
    else
      return query select false, 0, null::text;
    end if;
    return;
  end if;

  return query select (v_cap is null or v_used < v_cap), case when v_cap is null then null else greatest(v_cap - v_used, 0) end, null::text;
end $$;
revoke all on function public.ai_quota_check(uuid, text) from public, anon, authenticated;
grant execute on function public.ai_quota_check(uuid, text) to service_role;

-- match_ai_memories (addition, 12 section 7.2 item 4). Service role only: ai-chat has already checked membership,
-- premium, consent and users.ai_memory_enabled. Exact ranking inside one household (few hundred rows at most).
create or replace function public.match_ai_memories(
  p_household_id     uuid,
  p_query_embedding  extensions.vector(1536),
  p_limit            integer default 6,
  p_family_member_id uuid default null)
returns table (id uuid, family_member_id uuid, fact text, kind text, confidence numeric,
               similarity double precision, score double precision, created_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select x.id, x.family_member_id, x.fact, x.kind, x.confidence, x.similarity,
         x.similarity * exp(-(extract(epoch from now() - x.created_at) / 86400.0) / 180.0) as score,
         x.created_at
  from (
    select m.id, m.family_member_id, m.fact, m.kind, m.confidence, m.created_at,
           (1 - (m.embedding operator(extensions.<=>) p_query_embedding))::double precision as similarity
    from public.ai_memories m
    where m.household_id = p_household_id
      and m.deleted_at is null
      and m.status = 'active'
      and (m.expires_at is null or m.expires_at > now())
      and (p_family_member_id is null or m.family_member_id is null or m.family_member_id = p_family_member_id)
  ) x
  order by score desc, x.id
  limit least(greatest(coalesce(p_limit, 6), 1), 50);
$$;
revoke all on function public.match_ai_memories(uuid, extensions.vector, integer, uuid) from public, anon, authenticated;
grant execute on function public.match_ai_memories(uuid, extensions.vector, integer, uuid) to service_role;

-- clear_ai_memories (addition, 02 SettingsPrivacy "Clear all memories"): owner and caregiver --------------------------------
create or replace function public.clear_ai_memories(p_household_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_n integer;
begin
  if not public.can_edit_household(p_household_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update public.ai_memories set status = 'withdrawn', deleted_at = now()
   where household_id = p_household_id and deleted_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.clear_ai_memories(uuid) from public, anon;
grant execute on function public.clear_ai_memories(uuid) to authenticated, service_role;

-- 14.3 soft_delete: a linked member may soft-delete their own meal log (see header); otherwise the S4 body ----------------
create or replace function public.soft_delete(p_table text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
  v_allowed constant text[] := array[
    'family_members','medical_conditions','allergies','medications','supplements','food_preferences',
    'food_dislikes','nutrition_goals','pregnancy_profiles','sensory_profiles','meal_plans','meal_logs',
    'budget_profiles','grocery_lists','hydration_targets','ramadan_plans','exposure_ladders',
    'chat_sessions','ai_memories','recipes','meals','household_members','pantry_items'];
begin
  if not (p_table = any (v_allowed)) then
    raise exception 'SOFT_DELETE_NOT_ALLOWED' using errcode = '42501', detail = p_table;
  end if;

  execute format('select household_id from public.%I where id = $1 and deleted_at is null', p_table)
    into v_household using p_id;
  if v_household is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_table = 'chat_sessions' then
    if not exists (select 1 from public.chat_sessions where id = p_id and user_id = auth.uid()) then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
  elsif p_table = 'household_members' then
    -- owner may remove others; anyone may leave; the owner row cannot be removed this way
    if exists (select 1 from public.household_members where id = p_id and role = 'owner') then
      raise exception 'OWNER_CANNOT_LEAVE' using errcode = '42501';
    end if;
    if not (public.household_role_of(v_household) = 'owner'
            or exists (select 1 from public.household_members where id = p_id and user_id = auth.uid())) then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
  elsif p_table = 'meal_plans' then
    if not public.can_author_plans(v_household) then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
  elsif p_table = 'meal_logs' then
    if not (public.can_edit_household(v_household)
            or exists (select 1 from public.meal_logs ml
                        where ml.id = p_id and public.is_linked_member(ml.family_member_id))) then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
  elsif not public.can_edit_household(v_household) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  execute format('update public.%I set deleted_at = now() where id = $1', p_table) using p_id;
end;
$$;
revoke execute on function public.soft_delete(text, uuid) from public, anon;
grant execute on function public.soft_delete(text, uuid) to authenticated;

-- 21.2 qada balance per member and Hijri year, now on ramadan_plans (see header) ------------------------------------------
create or replace view public.v_qada_balance with (security_invoker = true) as
with ramadan as (
  select fl.household_id, fl.family_member_id,
         coalesce(p.hijri_year, left(fl.hijri_date, 4)::smallint) as hijri_year,
         fl.completed, fl.exemption_reason
  from public.fasting_logs fl
  left join lateral (
    select r.hijri_year from public.ramadan_plans r
     where r.household_id = fl.household_id and r.deleted_at is null
       and fl.fast_date between r.start_date and r.end_date
     order by r.start_date desc
     limit 1) p on true
  where fl.kind = 'ramadan'
)
select m.household_id,
       m.family_member_id,
       m.hijri_year,
       count(*) filter (where not m.completed or m.exemption_reason is not null) as missed,
       (select count(*) from public.fasting_logs q
         where q.family_member_id = m.family_member_id and q.kind = 'qada'
           and q.completed and q.qada_for_hijri_year = m.hijri_year) as made_up
from ramadan m
where m.hijri_year is not null
group by m.household_id, m.family_member_id, m.hijri_year;
revoke all on public.v_qada_balance from anon;
grant select on public.v_qada_balance to authenticated;

-- 17.5 / 25.6 cron (UTC) -----------------------------------------------------------------------------------------------------
select cron.schedule('ai-memories-expire', '20 19 * * *',                   -- 00:20 PKT
  $$update public.ai_memories set deleted_at = now() where expires_at < now() and deleted_at is null$$);
select cron.schedule('prayer-times-retention', '10 22 1 * *',
  $$delete from public.prayer_times_cache where make_date(year, month, 1) < (now() - interval '18 months')::date$$);
