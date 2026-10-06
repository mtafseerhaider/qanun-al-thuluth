-- supabase/migrations/20261006140000_growth_exposures_coaching_exports.sql
-- 05 ref: 0006 (part 3: coaching_tips), 0009 tracking (part 4: growth_reference_lms, growth_tracking, food_exposures,
--         exposure_ladders, exposure_ladder_steps), 0010 platform (part 4: exports), 0012 15.8 / 15.10 (growth triggers,
--         audit), 0013 16.3 (part), 0014 (exports-purge-expired), 0015 (part: avatars, exports, recipe-images,
--         storage-orphan-sweep), 0016 (Realtime: exports), 0021d (part), 0025c. Sprint 6: S6-02.
-- DDL verbatim from 05 sections 9.10, 12.6, 12.7, 12.10 to 12.12, 13.8, 15.10, 16.3, 22.7 (21.1 growth columns and
-- growth_age_days, 21.2 growth_dashboard), 22.11 (25.4) and 10 section 6.4, except:
--   * Contract decisions (S6-01, packages/shared/src/contracts): exports.status is the 06 vocabulary
--     (processing, ready, failed, expired; default 'processing') instead of 05's queued/rendering. Exposure contexts
--     and ladder statuses keep 05's base check values; the 0021d extensions ('accepted' status, the extra structured
--     contexts) are NOT applied, so domain/family-modules.ts stays identical to the database.
--     picky_acceptance_summary therefore counts 'completed' ladders as newly accepted foods.
--   * Addition: growth_reference_lms.age_days. The WHO 2006 standards are seeded from WHO's daily (expanded) tables,
--     keyed by age in days as WHO recommends under 5 years; age_months = round(days / 30.4375, 2) keeps 05's unique
--     key. WHO 2007 rows are monthly (age_days null). See seed/catalog/060 and tooling/scripts/gen-growth-lms-seed.py.
--   * growth_tracking: clients write only the raw measurement columns (column grants); z-scores, percentiles, flags,
--     age_months and computed_at are written by growth-compute (service role), so a client cannot forge or clear a
--     safety flag. Addition (00 section 10, 15 section 2): growth_tracking is for members under 20 years (CDC 2000
--     runs to 240 months); older members raise GROWTH_RULE:adult_member (P0001, S2-03 style) and use
--     weight_tracking. growth_age_days also covers members with no date of birth (age_days stays null).
--   * coaching_tips additions: code (idempotent seed key), review_status (publish gate, like recommendations).
--     Users see a tip only when it is active AND verified; content editors and admins see all. A tip may only be
--     verified with a linked, non-retracted scientific_evidence row and en + ur text (enforce_coaching_tip_publish).
--     Child rule (00 section 10.3): a tip whose age band reaches under 18 years may not mention calories, kcal or
--     weight loss (CHILD_RULE:calorie_content).
--   * exports: account_data rows (0025c) have no household; household exports always have one. Clients never write
--     exports (export-pdf and account-export insert with the service role); the requester and household editors read.
--     The exports storage policy also lets the requester (any role, 06 section 4.10) read the object their own
--     exports row points at.
--   * Storage (10 section 6.4): avatars, exports, recipe-images with objects.name qualified (see S5 note), created only
--     when the storage schema exists. avatars insert also checks the member belongs to the household in segment 1.
--   * Cron: exports-purge-expired (05 17.5) and storage-orphan-sweep (10 section 6.4) call export-pdf and
--     account-delete internal actions through invoke_edge_function; objects are removed through the Storage API there.
--   * FK indexes (10 section 16 rule 3).

-- 12.6 growth_reference_lms (global reference data) --------------------------------------------------------------------
create table public.growth_reference_lms (
  id          uuid primary key default gen_random_uuid(),
  reference   text not null check (reference in ('who_2006','who_2007','cdc_2000')),
  indicator   text not null check (indicator in ('wfa','lhfa','bmifa','hcfa')),  -- weight, length/height, BMI, head circumference for age
  sex         public.sex_at_birth not null check (sex in ('female','male')),
  age_months  numeric(6,2) not null check (age_months between 0 and 240),
  age_days    integer check (age_days between 0 and 7305),                    -- Addition: WHO 2006 daily tables
  l           numeric(10,6) not null,
  m           numeric(10,4) not null check (m > 0),
  s           numeric(10,6) not null check (s > 0),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (reference, indicator, sex, age_months)
);
create unique index growth_reference_lms_days_key on public.growth_reference_lms (reference, indicator, sex, age_days)
  where age_days is not null;

-- 12.7 growth_tracking (children) + 21.1 columns -----------------------------------------------------------------------
create table public.growth_tracking (
  id                          uuid primary key default gen_random_uuid(),
  household_id                uuid not null references public.households(id) on delete cascade,
  family_member_id            uuid not null,
  measured_on                 date not null,
  age_months                  numeric(6,2),                 -- Addition: computed by growth-compute
  height_cm                   numeric(5,1) check (height_cm between 30 and 230),
  weight_kg                   numeric(5,2) check (weight_kg between 0.5 and 250),
  bmi                         numeric(5,2) generated always as (public.compute_bmi(weight_kg, height_cm)) stored,
  head_circumference_cm       numeric(4,1) check (head_circumference_cm between 20 and 70),
  height_for_age_z            numeric(5,2) check (height_for_age_z between -10 and 10),
  weight_for_age_z            numeric(5,2) check (weight_for_age_z between -10 and 10),
  bmi_for_age_z               numeric(5,2) check (bmi_for_age_z between -10 and 10),
  head_circumference_for_age_z numeric(5,2) check (head_circumference_for_age_z between -10 and 10),  -- Addition
  height_for_age_percentile   numeric(5,2) check (height_for_age_percentile between 0 and 100),
  weight_for_age_percentile   numeric(5,2) check (weight_for_age_percentile between 0 and 100),
  bmi_for_age_percentile      numeric(5,2) check (bmi_for_age_percentile between 0 and 100),
  head_circumference_for_age_percentile numeric(5,2) check (head_circumference_for_age_percentile between 0 and 100), -- Addition
  reference                   text not null default 'who_2006' check (reference in ('who_2006','who_2007','cdc_2000')),
  flags                       text[] not null default '{}',  -- Addition: 'red_flag.wfa_below_p3', 'red_flag.crossed_two_major_lines'
  computed_at                 timestamptz,                   -- Addition: null until growth-compute has run
  age_days                    integer check (age_days >= 0),                                     -- 21.1
  measurement_position        text check (measurement_position in ('recumbent','standing')),     -- 21.1
  entered_by                  uuid references public.users(id) on delete set null default auth.uid(),  -- 21.1
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  check (num_nonnulls(height_cm, weight_kg, head_circumference_cm) >= 1),
  unique (family_member_id, measured_on),
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index growth_tracking_member_idx on public.growth_tracking (household_id, family_member_id, measured_on desc);
create index growth_tracking_flags_idx on public.growth_tracking using gin (flags) where cardinality(flags) > 0;
create index growth_tracking_entered_by_idx on public.growth_tracking (entered_by) where entered_by is not null;   -- FK index

-- 12.10 food_exposures (picky eater and autism exposure log) ---------------------------------------------------------------
create table public.food_exposures (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  family_member_id  uuid not null,
  ingredient_id     uuid not null references public.ingredients(id) on delete restrict,
  exposed_on        date not null default current_date,
  stage             public.exposure_stage not null,
  acceptance        public.acceptance_score not null,
  context           text check (context in ('family_meal','snack','cooking_together','grocery_trip','play','school','other')),
  ladder_step_id    uuid,
  notes             text check (char_length(notes) <= 2000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index food_exposures_member_idx on public.food_exposures (household_id, family_member_id, exposed_on desc);
create index food_exposures_ingredient_idx on public.food_exposures (family_member_id, ingredient_id, exposed_on desc);
create index food_exposures_ingredient_fk_idx on public.food_exposures (ingredient_id);                                  -- FK index
create index food_exposures_step_idx on public.food_exposures (ladder_step_id) where ladder_step_id is not null;          -- FK index

-- 12.11 exposure_ladders ------------------------------------------------------------------------------------------------
create table public.exposure_ladders (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references public.households(id) on delete cascade,
  family_member_id      uuid not null,
  target_ingredient_id  uuid not null references public.ingredients(id) on delete restrict,
  strategy              text not null check (strategy in ('exposure_ladder','food_chaining')),
  status                text not null default 'active' check (status in ('active','paused','completed','abandoned')),
  current_step          smallint not null default 1 check (current_step >= 1),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  unique (id, household_id),
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index exposure_ladders_member_idx on public.exposure_ladders (household_id, family_member_id, status) where deleted_at is null;
create unique index exposure_ladders_one_active_target
  on public.exposure_ladders (family_member_id, target_ingredient_id) where status = 'active' and deleted_at is null;
create index exposure_ladders_target_idx on public.exposure_ladders (target_ingredient_id);   -- FK index

-- 12.12 exposure_ladder_steps -------------------------------------------------------------------------------------------
create table public.exposure_ladder_steps (
  id                         uuid primary key default gen_random_uuid(),
  ladder_id                  uuid not null,
  household_id               uuid not null references public.households(id) on delete cascade,
  step_no                    smallint not null check (step_no >= 1),
  stage                      public.exposure_stage not null,
  food_label                 text not null check (char_length(food_label) between 1 and 120),
  bridge_from_ingredient_id  uuid references public.ingredients(id) on delete restrict,
  criteria                   text not null check (char_length(criteria) between 1 and 500),
  completed_on               date,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now(),
  unique (ladder_id, step_no),
  unique (id, household_id),
  foreign key (ladder_id, household_id) references public.exposure_ladders(id, household_id) on delete cascade
);
create index exposure_ladder_steps_household_idx on public.exposure_ladder_steps (household_id);
create index exposure_ladder_steps_bridge_idx on public.exposure_ladder_steps (bridge_from_ingredient_id)
  where bridge_from_ingredient_id is not null;   -- FK index

alter table public.food_exposures
  add constraint food_exposures_ladder_step_fkey
  foreign key (ladder_step_id, household_id) references public.exposure_ladder_steps(id, household_id)
  on delete set null (ladder_step_id);

-- 9.10 coaching_tips (+ code, review_status) ----------------------------------------------------------------------------
create table public.coaching_tips (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique check (code ~ '^tip\.[a-z0-9_.]+$'),          -- Addition: seed key
  module          text not null check (module in ('picky','autism','ramadan','general')),
  age_min_months  smallint not null default 0 check (age_min_months >= 0),
  age_max_months  smallint not null default 1200 check (age_max_months <= 1200),
  body_i18n       jsonb not null check (body_i18n ? 'en'),
  evidence_id     uuid references public.scientific_evidence(id) on delete set null,
  is_active       boolean not null default true,                                       -- Addition
  review_status   public.verification_status not null default 'unverified',            -- Addition: publish gate
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (age_max_months >= age_min_months)
);
create index coaching_tips_module_age_idx on public.coaching_tips (module, age_min_months, age_max_months)
  where is_active and review_status = 'verified';
create index coaching_tips_evidence_idx on public.coaching_tips (evidence_id) where evidence_id is not null;   -- FK index

-- 13.8 exports (+ 25.4 account_data) -----------------------------------------------------------------------------------------
create table public.exports (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid references public.households(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
  kind          text not null check (kind in ('meal_plan','grocery_list','nutrition_report','growth_report','ramadan_pack',
                                              'family_summary','account_data')),
  status        text not null default 'processing' check (status in ('processing','ready','failed','expired')),
  params        jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
                -- {"meal_plan_id":"...","locale":"ur","paper":"A4"}
  storage_path  text,          -- bucket "exports": {household_id}/{id}.pdf or account/{user_id}/{id}.zip
  error         text check (char_length(error) <= 2000),
  expires_at    timestamptz not null default now() + interval '7 days',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (status <> 'ready' or storage_path is not null),
  constraint exports_household_required check ((kind = 'account_data') = (household_id is null))
);
create index exports_household_idx on public.exports (household_id, created_at desc) where household_id is not null;
create index exports_user_idx on public.exports (user_id, created_at desc);
create index exports_expiry_idx on public.exports (expires_at) where status = 'ready';

-- updated_at and audit (05 15.8: growth_tracking keys_only, exports full) ---------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['growth_reference_lms','growth_tracking','food_exposures','exposure_ladders',
                           'exposure_ladder_steps','coaching_tips','exports'] loop
    call private.attach_updated_at(('public.' || t)::regclass);
  end loop;
end $$;
call private.attach_audit('public.growth_tracking', 'keys_only');
call private.attach_audit('public.exports', 'full');
call private.attach_audit('public.coaching_tips', 'full');

-- 15.10 growth triggers ----------------------------------------------------------------------------------------------------
-- 21.1 age_days from date_of_birth, plus the adult rule (see header)
create or replace function private.growth_age_days()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_dob date; v_stage public.life_stage;
begin
  select fm.date_of_birth, fm.life_stage into v_dob, v_stage
    from public.family_members fm where fm.id = new.family_member_id;
  new.age_days := case when v_dob is not null then new.measured_on - v_dob end;
  if new.age_days is not null and new.age_days < 0 then
    raise exception 'MEASUREMENT_BEFORE_BIRTH' using errcode = '23514';
  end if;
  if (v_dob is not null and public.age_in_months(v_dob, new.measured_on) >= 240)
     or (v_dob is null and v_stage in ('adult','older_adult')) then
    raise exception 'GROWTH_RULE:adult_member' using errcode = 'P0001',
      detail = json_build_object('rule', 'growth_tracking_under_20', 'family_member_id', new.family_member_id)::text,
      hint = 'Adults log weight through weight_tracking';
  end if;
  return new;
end $$;
create trigger trg_growth_tracking_age_days
  before insert or update of measured_on, family_member_id on public.growth_tracking
  for each row execute function private.growth_age_days();

create or replace function private.growth_reset_computed()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.height_cm, new.weight_kg, new.head_circumference_cm, new.measured_on)
       is distinct from (old.height_cm, old.weight_kg, old.head_circumference_cm, old.measured_on)
     and new.computed_at is not distinct from old.computed_at then
    new.age_months := null;
    new.height_for_age_z := null; new.weight_for_age_z := null;
    new.bmi_for_age_z := null; new.head_circumference_for_age_z := null;
    new.height_for_age_percentile := null; new.weight_for_age_percentile := null;
    new.bmi_for_age_percentile := null; new.head_circumference_for_age_percentile := null;
    new.flags := '{}'; new.computed_at := null;
  end if;
  return new;
end $$;
create trigger trg_growth_tracking_reset before update on public.growth_tracking
  for each row execute function private.growth_reset_computed();

-- private.sync_latest_measurement (S4) already carries the growth_tracking branch
create trigger trg_growth_tracking_sync after insert or update of height_cm, weight_kg on public.growth_tracking
  for each row execute function private.sync_latest_measurement();

-- Coaching tips: publish gate and child content rule (see header) ------------------------------------------------------------
create or replace function private.enforce_coaching_tip_rules()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_text text := lower(coalesce(new.body_i18n ->> 'en', ''));
begin
  if new.age_min_months < 216
     and (v_text ~ '\m(kcal|calorie|calories)\M' or v_text ~ 'weight[- ]?loss|lose weight') then
    raise exception 'CHILD_RULE:calorie_content' using errcode = 'P0001',
      detail = json_build_object('rule', 'no_calorie_or_weight_loss_content_under_18', 'code', new.code)::text,
      hint = 'Tips that reach children never talk about calories or weight loss';
  end if;
  if new.review_status = 'verified' then
    if coalesce(new.body_i18n ->> 'en', '') = '' or coalesce(new.body_i18n ->> 'ur', '') = '' then
      raise exception 'COACHING_TIP_MISSING_TEXT' using errcode = '23514';
    end if;
    if not exists (select 1 from public.scientific_evidence e
                    where e.id = new.evidence_id and e.retracted_at is null) then
      raise exception 'COACHING_TIP_MISSING_EVIDENCE' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger trg_coaching_tips_rules before insert or update on public.coaching_tips
  for each row execute function private.enforce_coaching_tip_rules();

-- 16.3 RLS -----------------------------------------------------------------------------------------------------------------
call private.apply_catalog_rls('public.growth_reference_lms');
call private.apply_household_rls('public.growth_tracking', 'edit');
call private.apply_household_rls('public.food_exposures', 'edit_self');
call private.apply_household_rls('public.exposure_ladders', 'edit');
call private.apply_household_rls('public.exposure_ladder_steps', 'edit');

-- growth_tracking: computed columns are server-only (see header)
revoke insert, update on public.growth_tracking from authenticated;
grant insert (id, household_id, family_member_id, measured_on, height_cm, weight_kg, head_circumference_cm,
              measurement_position)
  on public.growth_tracking to authenticated;
grant update (measured_on, height_cm, weight_kg, head_circumference_cm, measurement_position)
  on public.growth_tracking to authenticated;

-- coaching_tips: verified and active for users; content roles see and edit drafts (as recommendations, 0019a)
call private.apply_catalog_rls('public.coaching_tips', 'is_active and review_status = ''verified''');
create policy coaching_tips_select_content on public.coaching_tips for select to authenticated
  using (public.has_content_role('content_editor','scholar_reviewer','nutrition_reviewer','content_admin'));
create policy coaching_tips_insert_editor on public.coaching_tips for insert to authenticated
  with check (public.has_content_role('content_editor','content_admin') and review_status <> 'verified');
create policy coaching_tips_update_editor on public.coaching_tips for update to authenticated
  using (public.has_content_role('content_editor','content_admin'))
  with check (public.has_content_role('content_editor','content_admin')
              and (review_status <> 'verified' or public.has_content_role('content_admin')));

-- exports: requester and household editors read; service role writes
alter table public.exports enable row level security;
create policy exports_select on public.exports for select to authenticated
  using (user_id = auth.uid() or (household_id is not null and public.can_edit_household(household_id)));
revoke insert, update, delete on public.exports from authenticated;

-- 0016 Realtime: export sheet waits for processing -> ready (10 section 7.3) -------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'exports') then
    alter publication supabase_realtime add table public.exports;
  end if;
end $$;

-- 21.2 growth_dashboard: free tier latest measurement only, safety flags on every tier (invoker rights) ----------------------
create or replace function public.growth_dashboard(p_member uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with m as (
    select fm.id, fm.household_id, fm.name, fm.sex_at_birth, fm.date_of_birth,
           public.household_has_premium(fm.household_id) as premium
    from public.family_members fm
    where fm.id = p_member and fm.deleted_at is null
  ), g as (
    select gt.*, row_number() over (order by gt.measured_on desc) as rn
    from public.growth_tracking gt join m on m.id = gt.family_member_id
  )
  select jsonb_build_object(
    'member', jsonb_build_object('id', m.id, 'name', m.name, 'sex', m.sex_at_birth,
                                 'ageMonths', public.age_in_months(m.date_of_birth)),
    'premium', m.premium,
    'measurements', coalesce((select jsonb_agg(to_jsonb(g) - 'rn' order by g.measured_on)
                              from g where m.premium or g.rn = 1), '[]'::jsonb),
    'openFlags', coalesce((select jsonb_agg(distinct f) from g, unnest(g.flags) as f where g.rn <= 3), '[]'::jsonb)
  )
  from m;
$$;
revoke all on function public.growth_dashboard(uuid) from public, anon;
grant execute on function public.growth_dashboard(uuid) to authenticated, service_role;

-- 21.2 picky_acceptance_summary ('completed' ladders, see header) ----------------------------------------------------------------
create or replace function public.picky_acceptance_summary(p_member uuid, p_days integer default 30)
returns table (accepted_food_count integer, meal_acceptance_rate numeric, exposures integer, new_accepted integer)
language sql
stable
security invoker
set search_path = ''
as $$
  with s as (
    select dms.acceptance
    from public.daily_meal_servings dms
    join public.daily_meals dm on dm.id = dms.daily_meal_id
    where dms.family_member_id = p_member and dm.plan_date >= current_date - p_days and dms.acceptance is not null
  ), e as (
    select fe.ingredient_id, fe.acceptance
    from public.food_exposures fe
    where fe.family_member_id = p_member and fe.exposed_on >= current_date - 60
  )
  select
    ((select count(*) from (select e.ingredient_id from e where e.acceptance >= '4_ate_some'
                            group by e.ingredient_id having count(*) >= 2) a)
     + (select count(*) from public.food_preferences fp
         where fp.family_member_id = p_member and fp.is_safe_food and fp.deleted_at is null))::integer,
    (select round(avg(case when s.acceptance >= '4_ate_some' then 1 else 0 end)::numeric, 3) from s),
    (select count(*) from public.food_exposures fe
      where fe.family_member_id = p_member and fe.exposed_on >= current_date - p_days)::integer,
    (select count(*) from public.exposure_ladders el
      where el.family_member_id = p_member and el.status = 'completed' and el.deleted_at is null
        and el.updated_at >= now() - make_interval(days => p_days))::integer;
$$;
revoke all on function public.picky_acceptance_summary(uuid, integer) from public, anon;
grant execute on function public.picky_acceptance_summary(uuid, integer) to authenticated, service_role;

-- 0015 Storage: avatars, exports, recipe-images (Supabase only) ------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is null or to_regclass('storage.buckets') is null then
    raise notice 'storage schema not present: buckets and storage policies not created';
    return;
  end if;

  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
    ('avatars',       'avatars',       false,  2097152, array['image/webp','image/jpeg','image/png']),
    ('exports',       'exports',       false, 26214400, array['application/pdf','application/zip','application/json']),
    ('recipe-images', 'recipe-images', true,   4194304, array['image/webp','image/jpeg'])
  on conflict (id) do update
    set public = excluded.public,
        file_size_limit = excluded.file_size_limit,
        allowed_mime_types = excluded.allowed_mime_types;

  -- avatars: {household_id}/members/{family_member_id}.webp and users/{user_id}/avatar.webp ----------------------------
  execute $p$
    create policy avatars_select on storage.objects for select to authenticated
      using (bucket_id = 'avatars' and (
        public.is_household_member(public.path_household_id(objects.name))
        or (split_part(objects.name, '/', 1) = 'users'
            and (public.path_segment_uuid(objects.name, 2) = auth.uid()
                 or public.shares_household_with(public.path_segment_uuid(objects.name, 2))))))
  $p$;
  execute $p$
    create policy avatars_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'avatars' and (
        (public.can_edit_household(public.path_household_id(objects.name))
         and split_part(objects.name, '/', 2) = 'members'
         and exists (select 1 from public.family_members fm
                      where fm.id = public.path_segment_uuid(replace(objects.name, '.', '/'), 3)
                        and fm.household_id = public.path_household_id(objects.name)))
        or (split_part(objects.name, '/', 1) = 'users' and public.path_segment_uuid(objects.name, 2) = auth.uid())))
  $p$;
  execute $p$
    create policy avatars_update on storage.objects for update to authenticated
      using (bucket_id = 'avatars' and (
        public.can_edit_household(public.path_household_id(objects.name))
        or (split_part(objects.name, '/', 1) = 'users' and public.path_segment_uuid(objects.name, 2) = auth.uid())))
  $p$;
  execute $p$
    create policy avatars_delete on storage.objects for delete to authenticated
      using (bucket_id = 'avatars' and (
        public.can_edit_household(public.path_household_id(objects.name))
        or (split_part(objects.name, '/', 1) = 'users' and public.path_segment_uuid(objects.name, 2) = auth.uid())))
  $p$;

  -- exports: read-only for clients; written by the service role -----------------------------------------------------------
  execute $p$
    create policy exports_select on storage.objects for select to authenticated
      using (bucket_id = 'exports' and (
        public.can_edit_household(public.path_household_id(objects.name))
        or (split_part(objects.name, '/', 1) = 'account' and public.path_segment_uuid(objects.name, 2) = auth.uid())
        or exists (select 1 from public.exports e
                    where e.storage_path = objects.name and e.user_id = auth.uid() and e.status = 'ready')))
  $p$;

  -- recipe-images: public bucket (reads bypass policies through the public URL); admin writes under catalog/ ------------
  execute $p$
    create policy recipe_images_admin_write on storage.objects for all to authenticated
      using (bucket_id = 'recipe-images' and public.is_admin())
      with check (bucket_id = 'recipe-images' and public.is_admin() and split_part(objects.name, '/', 1) = 'catalog')
  $p$;
end $$;

-- Cron (UTC; PKT = UTC+5) --------------------------------------------------------------------------------------------------------
select cron.schedule('exports-purge-expired', '25 * * * *',
  $$select private.invoke_edge_function('export-pdf', '{"action":"purge_expired"}'::jsonb)
    where exists (select 1 from public.exports where status = 'ready' and expires_at < now())$$);
select cron.schedule('storage-orphan-sweep', '30 20 * * *',                 -- 01:30 PKT
  $$select private.invoke_edge_function('account-delete', '{"action":"sweep_orphans"}'::jsonb)$$);
