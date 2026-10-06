-- supabase/migrations/20261006110000_meal_plans.sql
-- 05 ref: 0008 plans (part 2: meal_plans, daily_meals, daily_meal_servings, plan_recommendations),
--         0012 15.6 (enforce_plan_entitlement), 0013 16.3.6 (part), 0016 (Realtime, part), 0020b
--         (leftovers, lunchboxes, weekly themes), 0026 (plan generation queue). Sprint 3: S3-02.
-- DDL verbatim from 05 sections 11.2 to 11.4, 11.8, 15.6, 16.3.6, 22.6 (20.3) and 22.12, except:
--   * plan_recommendations.chat_message_id has no foreign key yet: chat_messages arrives in S5, and
--     that migration adds `plan_recommendations_chat_message_id_fkey ... on delete cascade`.
--   * enforce_plan_entitlement raises the 06 error codes instead of 05's ENTITLEMENT_PLAN_LIMIT:
--     P0001 'PLAN_ALREADY_ACTIVE' (06 sections 2 and 4.3; detail {"resource":"meal_plans","limit":1,
--     "current":n}) and P0001 'PREMIUM_REQUIRED' (detail {"reason":"multi_week_or_kind",...}).
--     Same idea as the Sprint 1 LIMIT_REACHED:<resource> deviation: one error vocabulary end to end.
--   * pgmq is optional. Supabase ships it (Supabase Queues); the plain-Postgres test cluster does not.
--     The queue is created only when the extension is available; the three wrappers always exist and
--     raise P0001 'QUEUE_UNAVAILABLE' when it is not (plpgsql resolves pgmq.* at call time).
--   * No 'plan-generation-sweeper' cron yet: it calls private.invoke_edge_function (pg_net + Vault),
--     which lands in S4. Until then ai-generate-plan runs the worker inline after enqueueing.
--   * Column UPDATE grants follow 06 section 3.3 (clients change only the listed columns; rows are
--     created by Edge Functions with the service role, or by authors through RLS as 05 allows).
--   * Realtime: meal_plans and daily_meal_servings join supabase_realtime (10 section 7.3). The
--     publication is created when missing (plain Postgres); shopping_items, notifications and
--     exports join with their tables in S4 and S6.
-- Not here: ai_jobs (0018b), grocery_lists, shopping_items, budget_entries (S4).

-- 11.2 meal_plans ---------------------------------------------------------------------------------------
create table public.meal_plans (
  id                          uuid primary key default gen_random_uuid(),
  household_id                uuid not null references public.households(id) on delete cascade,
  kind                        public.plan_kind not null default 'standard',
  status                      public.plan_status not null default 'draft',
  title                       text,                                        -- Addition
  start_date                  date not null,
  end_date                    date not null,
  week_count                  smallint not null default 1 check (week_count between 1 and 12),
  generated_by_assessment_id  uuid,
  budget_profile_id           uuid,
  rationale                   text,
  version                     integer not null default 1 check (version >= 1),
  parent_plan_id              uuid,
  failure_reason              text,                                        -- Addition: set when status = 'failed'
  generation_meta             jsonb not null default '{}'::jsonb,          -- Addition: {"route":"plan.generate","model":"...","prompt_version":"...","job_id":"..."}
  created_by_user_id          uuid references public.users(id) on delete set null,  -- Addition
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  deleted_at                  timestamptz,
  unique (id, household_id),
  check (end_date >= start_date),
  check (end_date - start_date + 1 <= week_count * 7),
  check (status <> 'failed' or failure_reason is not null),
  foreign key (generated_by_assessment_id, household_id) references public.ai_assessments(id, household_id) on delete set null (generated_by_assessment_id),
  foreign key (budget_profile_id, household_id) references public.budget_profiles(id, household_id) on delete set null (budget_profile_id),
  foreign key (parent_plan_id, household_id) references public.meal_plans(id, household_id) on delete set null (parent_plan_id)
);
create index meal_plans_household_status_idx on public.meal_plans (household_id, status, start_date desc) where deleted_at is null;
create index meal_plans_parent_idx on public.meal_plans (parent_plan_id) where parent_plan_id is not null;
-- linear version history: at most one non-failed child per parent, so concurrent adjustments cannot fork a plan
create unique index meal_plans_one_child on public.meal_plans (parent_plan_id)
  where parent_plan_id is not null and status <> 'failed' and deleted_at is null;
create index meal_plans_assessment_idx on public.meal_plans (generated_by_assessment_id) where generated_by_assessment_id is not null;  -- FK index
create index meal_plans_budget_idx on public.meal_plans (budget_profile_id) where budget_profile_id is not null;                     -- FK index

-- 11.3 daily_meals: a planned meal slot ---------------------------------------------------------------
create table public.daily_meals (
  id              uuid primary key default gen_random_uuid(),
  meal_plan_id    uuid not null,
  household_id    uuid not null references public.households(id) on delete cascade,
  plan_date       date not null,
  meal_type       public.meal_type not null,
  slot            smallint not null default 1 check (slot between 1 and 4),  -- Addition: allows two snacks a day
  meal_id         uuid not null references public.meals(id) on delete restrict,
  scheduled_time  time,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, household_id),
  unique (meal_plan_id, plan_date, meal_type, slot),
  foreign key (meal_plan_id, household_id) references public.meal_plans(id, household_id) on delete cascade
);
create index daily_meals_household_date_idx on public.daily_meals (household_id, plan_date, meal_type);
create index daily_meals_meal_idx on public.daily_meals (meal_id);

-- 11.4 daily_meal_servings: per-member portion and tracking -------------------------------------------
create table public.daily_meal_servings (
  id                uuid primary key default gen_random_uuid(),
  daily_meal_id     uuid not null,
  household_id      uuid not null references public.households(id) on delete cascade,
  family_member_id  uuid not null,
  portion_id        uuid references public.portions(id) on delete set null,
  adaptation        text not null default 'none' check (adaptation in ('none','autism','picky','allergy','pregnancy')),
  adapted_meal_id   uuid references public.meals(id) on delete restrict,
  status            public.meal_status not null default 'planned',
  acceptance        public.acceptance_score,
  logged_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (daily_meal_id, family_member_id),
  check (adaptation <> 'none' or adapted_meal_id is null),
  check (status = 'planned' or logged_at is not null),
  foreign key (daily_meal_id, household_id) references public.daily_meals(id, household_id) on delete cascade,
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index daily_meal_servings_member_idx on public.daily_meal_servings (household_id, family_member_id, status);
create index daily_meal_servings_meal_idx on public.daily_meal_servings (daily_meal_id);
create index daily_meal_servings_portion_idx on public.daily_meal_servings (portion_id) where portion_id is not null;          -- FK index
create index daily_meal_servings_adapted_idx on public.daily_meal_servings (adapted_meal_id) where adapted_meal_id is not null; -- FK index

-- 11.8 plan_recommendations: recommendation instances shown in a plan or chat ---------------------------
create table public.plan_recommendations (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.households(id) on delete cascade,
  meal_plan_id       uuid,
  chat_message_id    uuid,                                                -- FK to chat_messages added in S5
  recommendation_id  uuid not null references public.recommendations(id) on delete restrict,
  family_member_id   uuid,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (num_nonnulls(meal_plan_id, chat_message_id) >= 1),
  foreign key (meal_plan_id, household_id) references public.meal_plans(id, household_id) on delete cascade,
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index plan_recommendations_plan_idx on public.plan_recommendations (household_id, meal_plan_id);
create index plan_recommendations_msg_idx on public.plan_recommendations (chat_message_id) where chat_message_id is not null;
create index plan_recommendations_rec_idx on public.plan_recommendations (recommendation_id);   -- FK index

-- 20.3 plan columns (0020b) ------------------------------------------------------------------------------
alter table public.daily_meals
  add column batch_multiplier      numeric(3,1) not null default 1.0 check (batch_multiplier between 0.5 and 4.0),
  add column source_daily_meal_id  uuid,                     -- this slot eats the leftovers of that slot
  add column is_lunchbox           boolean not null default false,
  add constraint daily_meals_source_fk foreign key (source_daily_meal_id, household_id)
    references public.daily_meals(id, household_id) on delete set null (source_daily_meal_id),
  add constraint daily_meals_source_not_self check (source_daily_meal_id is distinct from id);
create index daily_meals_source_idx on public.daily_meals (source_daily_meal_id) where source_daily_meal_id is not null;

alter table public.meal_plans
  add column weekly_themes jsonb not null default '[]'::jsonb check (jsonb_typeof(weekly_themes) = 'array');
  -- [{"week":1,"key":"rhythm_bismillah","title_i18n":{...},"body_i18n":{...}}]

-- 26.1 generation progress (0026), shape GenerationProgress in 06 / packages/shared contracts:
-- {phase, completed_weeks, total_weeks, attempt, error_code, escalation}
alter table public.meal_plans
  add column generation_progress jsonb not null default '{}'::jsonb check (jsonb_typeof(generation_progress) = 'object');

-- 15.1 updated_at ---------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['meal_plans','daily_meals','daily_meal_servings','plan_recommendations'] loop
    call private.attach_updated_at(('public.' || t)::regclass);
  end loop;
end $$;

-- 15.6 free tier: one active weekly plan (00-foundations section 8) -------------------------------------
create or replace function private.enforce_plan_entitlement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if coalesce(current_setting('app.bypass_entitlements', true), '') = 'on'
     or public.household_has_premium(new.household_id) then
    return new;
  end if;
  if new.status in ('generating','active') and new.deleted_at is null then
    if new.week_count > 1 or new.kind not in ('standard','custom') then
      raise exception 'PREMIUM_REQUIRED' using errcode = 'P0001',
        detail = json_build_object('reason','multi_week_or_kind','kind',new.kind,'week_count',new.week_count)::text,
        hint = 'upgrade_required';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('meal_plans:' || new.household_id::text, 0));
    select count(*) into v_count from public.meal_plans mp
     where mp.household_id = new.household_id and mp.deleted_at is null
       and mp.status in ('generating','active') and mp.id <> new.id
       and mp.id is distinct from new.parent_plan_id;   -- an adjustment replaces its parent
    if v_count >= 1 then
      raise exception 'PLAN_ALREADY_ACTIVE' using errcode = 'P0001',
        detail = json_build_object('resource','meal_plans','limit',1,'current',v_count)::text,
        hint = 'upgrade_required';
    end if;
  end if;
  return new;
end $$;
create trigger trg_meal_plans_entitlement
  before insert or update of status, week_count, kind, deleted_at on public.meal_plans
  for each row execute function private.enforce_plan_entitlement();

-- 16.3.6 RLS -------------------------------------------------------------------------------------------
call private.apply_household_rls('public.meal_plans', 'plan');
call private.apply_household_rls('public.daily_meals', 'plan');
call private.apply_household_rls('public.plan_recommendations', 'plan');
call private.apply_household_rls('public.daily_meal_servings', 'edit');

-- 06 section 3.3 client operations: rows come from Edge Functions; clients update these columns only.
revoke update on public.meal_plans, public.daily_meals, public.daily_meal_servings, public.plan_recommendations
  from authenticated;
grant update (status, title) on public.meal_plans to authenticated;   -- status via rpc activate_meal_plan
grant update (scheduled_time, notes) on public.daily_meals to authenticated;
grant update (status, acceptance, logged_at, adaptation, adapted_meal_id) on public.daily_meal_servings to authenticated;

-- 0016 Realtime (10 section 7.3, part): plan status and generation progress, serving status ---------------
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;   -- plain Postgres only; Supabase creates it
  end if;
  foreach t in array array['meal_plans','daily_meal_servings'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 26 pgmq queue plan_generation (optional extension, see header) ------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pgmq') then
    create extension if not exists pgmq;
    if not exists (select 1 from pgmq.list_queues() q where q.queue_name = 'plan_generation') then
      perform pgmq.create('plan_generation');
    end if;
  else
    raise notice 'pgmq is not available: queue plan_generation not created (wrappers raise QUEUE_UNAVAILABLE)';
  end if;
end $$;

-- 26.2 queue wrappers for Edge Functions (pgmq is not exposed through PostgREST). Service role only.
create or replace function public.plan_generation_enqueue(p_meal_plan_id uuid, p_attempt integer default 0, p_delay_seconds integer default 0)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare v_id bigint;
begin
  if to_regnamespace('pgmq') is null then
    raise exception 'QUEUE_UNAVAILABLE' using errcode = 'P0001', detail = 'plan_generation';
  end if;
  select s into v_id
    from pgmq.send('plan_generation', jsonb_build_object('meal_plan_id', p_meal_plan_id, 'attempt', p_attempt), p_delay_seconds) s;
  return v_id;
end $$;

create or replace function public.plan_generation_read(p_vt_seconds integer default 300, p_qty integer default 1)
returns table (msg_id bigint, read_ct integer, enqueued_at timestamptz, vt timestamptz, message jsonb)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if to_regnamespace('pgmq') is null then
    raise exception 'QUEUE_UNAVAILABLE' using errcode = 'P0001', detail = 'plan_generation';
  end if;
  return query
    select r.msg_id, r.read_ct, r.enqueued_at, r.vt, r.message from pgmq.read('plan_generation', p_vt_seconds, p_qty) r;
end $$;

create or replace function public.plan_generation_ack(p_msg_id bigint, p_archive boolean default true)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if to_regnamespace('pgmq') is null then
    raise exception 'QUEUE_UNAVAILABLE' using errcode = 'P0001', detail = 'plan_generation';
  end if;
  if p_archive then
    return pgmq.archive('plan_generation', p_msg_id);
  end if;
  return pgmq.delete('plan_generation', p_msg_id);
end $$;

revoke all on function public.plan_generation_enqueue(uuid, integer, integer), public.plan_generation_read(integer, integer),
                       public.plan_generation_ack(bigint, boolean) from public, anon, authenticated;
grant execute on function public.plan_generation_enqueue(uuid, integer, integer), public.plan_generation_read(integer, integer),
                          public.plan_generation_ack(bigint, boolean) to service_role;

-- 26.3 write_plan_week: one validated week from the worker, idempotent on retry. Service role only.
-- p_week = {"week": 1,
--           "days": [{"plan_date":"2026-10-12",
--                     "meals":[{"meal_type":"lunch","slot":1,"meal_id":"...","scheduled_time":"13:30",
--                               "notes":null,"batch_multiplier":1.0,"source_daily_meal_id":null,"is_lunchbox":false,
--                               "servings":[{"family_member_id":"...","portion_id":"...","adaptation":"none","adapted_meal_id":null}]}]}],
--           "recommendations": [{"recommendation_id":"...","family_member_id":null}]}
create or replace function public.write_plan_week(p_meal_plan_id uuid, p_week jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_plan   public.meal_plans;
  d        jsonb;
  m        jsonb;
  s        jsonb;
  v_dm_id  uuid;
  v_rows   integer := 0;
begin
  select * into v_plan from public.meal_plans where id = p_meal_plan_id and deleted_at is null for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_plan.status <> 'generating' then
    raise exception 'CONFLICT' using errcode = 'P0001', detail = 'status=' || v_plan.status;
  end if;

  for d in select value from jsonb_array_elements(coalesce(p_week -> 'days', '[]'::jsonb)) loop
    if (d ->> 'plan_date')::date not between v_plan.start_date and v_plan.end_date then
      raise exception 'PLAN_DATE_OUT_OF_RANGE' using errcode = '22023', detail = d ->> 'plan_date';
    end if;
    for m in select value from jsonb_array_elements(coalesce(d -> 'meals', '[]'::jsonb)) loop
      insert into public.daily_meals (meal_plan_id, household_id, plan_date, meal_type, slot, meal_id, scheduled_time,
                                      notes, batch_multiplier, source_daily_meal_id, is_lunchbox)
      values (v_plan.id, v_plan.household_id, (d ->> 'plan_date')::date, (m ->> 'meal_type')::public.meal_type,
              coalesce((m ->> 'slot')::smallint, 1), (m ->> 'meal_id')::uuid, (m ->> 'scheduled_time')::time,
              m ->> 'notes', coalesce((m ->> 'batch_multiplier')::numeric, 1.0), (m ->> 'source_daily_meal_id')::uuid,
              coalesce((m ->> 'is_lunchbox')::boolean, false))
      on conflict (meal_plan_id, plan_date, meal_type, slot) do update
        set meal_id = excluded.meal_id, scheduled_time = excluded.scheduled_time, notes = excluded.notes,
            batch_multiplier = excluded.batch_multiplier, source_daily_meal_id = excluded.source_daily_meal_id,
            is_lunchbox = excluded.is_lunchbox
      returning id into v_dm_id;
      v_rows := v_rows + 1;

      for s in select value from jsonb_array_elements(coalesce(m -> 'servings', '[]'::jsonb)) loop
        insert into public.daily_meal_servings (daily_meal_id, household_id, family_member_id, portion_id, adaptation, adapted_meal_id)
        values (v_dm_id, v_plan.household_id, (s ->> 'family_member_id')::uuid, (s ->> 'portion_id')::uuid,
                coalesce(s ->> 'adaptation', 'none'), (s ->> 'adapted_meal_id')::uuid)
        on conflict (daily_meal_id, family_member_id) do update
          set portion_id = excluded.portion_id, adaptation = excluded.adaptation, adapted_meal_id = excluded.adapted_meal_id;
      end loop;
    end loop;
  end loop;

  insert into public.plan_recommendations (household_id, meal_plan_id, recommendation_id, family_member_id)
  select v_plan.household_id, v_plan.id, (r ->> 'recommendation_id')::uuid, (r ->> 'family_member_id')::uuid
    from jsonb_array_elements(coalesce(p_week -> 'recommendations', '[]'::jsonb)) as r
   where not exists (select 1 from public.plan_recommendations pr
                      where pr.meal_plan_id = v_plan.id
                        and pr.recommendation_id = (r ->> 'recommendation_id')::uuid
                        and pr.family_member_id is not distinct from (r ->> 'family_member_id')::uuid);

  update public.meal_plans
     set generation_progress = generation_progress
           || jsonb_build_object('phase', 'writing',
                                 'completed_weeks', greatest(coalesce((generation_progress ->> 'completed_weeks')::int, 0),
                                                             coalesce((p_week ->> 'week')::int, 0)),
                                 'total_weeks', v_plan.week_count)
   where id = v_plan.id;
  return v_rows;
end $$;
revoke all on function public.write_plan_week(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.write_plan_week(uuid, jsonb) to service_role;

-- 26.4 activate_meal_plan (06 section 3.3): draft -> active, archiving the previous active plan of the
-- same kind. Invoker rights, so meal_plans RLS (can_author_plans) and the entitlement trigger apply.
create or replace function public.activate_meal_plan(p_meal_plan_id uuid)
returns public.meal_plans
language plpgsql
security invoker
set search_path = ''
as $$
declare v_plan public.meal_plans;
begin
  select * into v_plan from public.meal_plans where id = p_meal_plan_id and deleted_at is null for update;
  if not found then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_plan.status <> 'draft' then
    raise exception 'CONFLICT' using errcode = 'P0001', detail = 'status=' || v_plan.status;
  end if;
  update public.meal_plans set status = 'archived'
   where household_id = v_plan.household_id and status = 'active' and kind = v_plan.kind
     and id <> v_plan.id and deleted_at is null;
  update public.meal_plans set status = 'active' where id = v_plan.id returning * into v_plan;
  if not found then   -- RLS hid the row from the update (viewer): same answer as 05 16.3 gives a PATCH
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return v_plan;
end $$;
revoke all on function public.activate_meal_plan(uuid) from public, anon;
grant execute on function public.activate_meal_plan(uuid) to authenticated, service_role;
