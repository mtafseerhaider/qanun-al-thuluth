-- supabase/migrations/20261006100000_health_profile_intake.sql
-- 05 ref: 0005 health profile (whole slot), 0007 AI (part 2: ai_assessments), 0009 (part 1:
--         hydration_targets), 0012 triggers 15.8 (health audit) and 15.11 (child goal safety),
--         0013 RLS 16.3.2 / 16.3.5 / 16.3.7 (part), 0020a (households.preferences),
--         0021a (family_members.lifestyle), 0022 (part: consent triggers). Sprint 2: S2-02, S2-03.
--
-- DDL is verbatim from 05-database-schema.md except where a comment says otherwise. Deviations:
--   * S2-03 child goal guard raises `CHILD_RULE:<rule>` (P0001, detail JSON with `rule`), the
--     06 section 3.2 contract and the same prefix style as `LIMIT_REACHED:<resource>`, instead of
--     05's CHILD_WEIGHT_LOSS_GOAL_NOT_ALLOWED / CHILD_CALORIE_TARGET_NOT_ALLOWED (23514). It also
--     rejects `weight_gain` for minors (01 section 7.5, 24-sprint-plan S2-03; 05 only had weight_loss).
--     Messages: CHILD_RULE:weight_loss, CHILD_RULE:weight_gain, CHILD_RULE:kcal_target.
--   * Addition: a family_members DOB change that makes a member a minor while they hold a live
--     weight_loss / weight_gain goal is rejected with the same message (otherwise the guard could be
--     bypassed by writing the goal first and the date of birth second).
--   * Addition: public.set_hydration_target(), a service-role RPC that replaces the member's live
--     hydration target in one transaction (hydration_targets_one_live allows only one live row, and
--     ai-intake-assess would otherwise need two non-atomic PostgREST calls).
-- Not here (see migrations/README.md): 0022b envelope-encrypted notes (household_keys, *_enc
-- columns, guard_encrypted_notes, get_note_kek). The plaintext notes / reaction_notes columns
-- from 0005 stay writable until the health-notes Edge Function exists.

-- 8.1 medical_conditions ----------------------------------------------------------------------------
create table public.medical_conditions (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  family_member_id  uuid not null,
  condition_code    text,                -- SNOMED CT concept id where known, e.g. '44054006' (type 2 diabetes)
  label             text not null check (char_length(label) between 1 and 120),
  diagnosed_on      date,
  notes             text check (char_length(notes) <= 2000),
  on_insulin_or_sulfonylurea boolean not null default false,  -- Addition: drives fasting red flag (00-foundations 10.2)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index medical_conditions_member_idx on public.medical_conditions (household_id, family_member_id) where deleted_at is null;

-- 8.2 allergies ---------------------------------------------------------------------------------------
create table public.allergies (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  family_member_id  uuid not null,
  allergen_id       uuid not null references public.allergens(id) on delete restrict,
  kind              text not null default 'allergy' check (kind in ('allergy','intolerance')),
  severity          public.severity not null,
  reaction_notes    text check (char_length(reaction_notes) <= 2000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create unique index allergies_member_allergen_key on public.allergies (family_member_id, allergen_id) where deleted_at is null;
create index allergies_household_idx on public.allergies (household_id) where deleted_at is null;
create index allergies_allergen_idx on public.allergies (allergen_id);   -- FK index (10 section 16 rule 3)

-- 8.3 medications -------------------------------------------------------------------------------------
create table public.medications (
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid not null references public.households(id) on delete cascade,
  family_member_id       uuid not null,
  name                   text not null check (char_length(name) between 1 and 120),
  dose                   text,
  frequency              text,
  food_interaction_flags text[] not null default '{}',  -- e.g. {'take_with_food','avoid_grapefruit','vitamin_k_consistency','fasting_risk_hypoglycemia'}
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index medications_member_idx on public.medications (household_id, family_member_id) where deleted_at is null;

-- 8.4 supplements -------------------------------------------------------------------------------------
create table public.supplements (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  family_member_id  uuid not null,
  name              text not null check (char_length(name) between 1 and 120),
  dose              text,
  frequency         text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index supplements_member_idx on public.supplements (household_id, family_member_id) where deleted_at is null;

-- 8.5 food_preferences --------------------------------------------------------------------------------
-- recipe_id references recipes, which arrive in the recipe catalog migration (S2-16); the FK is
-- added there.
create table public.food_preferences (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  family_member_id  uuid not null,
  ingredient_id     uuid references public.ingredients(id) on delete restrict,
  recipe_id         uuid,
  label             text not null check (char_length(label) between 1 and 120),
  strength          smallint not null default 2 check (strength between 1 and 3),
  is_safe_food      boolean not null default false,   -- autism / picky "safe food" list
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index food_preferences_member_idx on public.food_preferences (household_id, family_member_id) where deleted_at is null;
create index food_preferences_safe_idx on public.food_preferences (family_member_id) where is_safe_food and deleted_at is null;
create index food_preferences_ingredient_idx on public.food_preferences (ingredient_id) where ingredient_id is not null;

-- 8.6 food_dislikes -----------------------------------------------------------------------------------
create table public.food_dislikes (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  family_member_id  uuid not null,
  ingredient_id     uuid references public.ingredients(id) on delete restrict,
  label             text not null check (char_length(label) between 1 and 120),
  reason            text not null default 'taste' check (reason in ('taste','texture','smell','color','religious','other')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index food_dislikes_member_idx on public.food_dislikes (household_id, family_member_id) where deleted_at is null;
create index food_dislikes_ingredient_idx on public.food_dislikes (ingredient_id) where ingredient_id is not null;

-- 8.7 nutrition_goals ---------------------------------------------------------------------------------
create table public.nutrition_goals (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  family_member_id  uuid not null,
  goal_type         public.goal_type not null,
  target_value      numeric(8,2),
  target_unit       text check (target_unit in ('kg','kg_per_week','cm','mmol_l','mg_dl','ml_per_day','servings_per_day','percent','kcal_per_day')),
  target_date       date,
  is_primary        boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  check ((target_value is null) = (target_unit is null)),
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create unique index nutrition_goals_one_primary on public.nutrition_goals (family_member_id) where is_primary and deleted_at is null;
create index nutrition_goals_member_idx on public.nutrition_goals (household_id, family_member_id) where deleted_at is null;

-- 8.8 pregnancy_profiles ------------------------------------------------------------------------------
create table public.pregnancy_profiles (
  id                    uuid primary key default gen_random_uuid(),
  household_id          uuid not null references public.households(id) on delete cascade,
  family_member_id      uuid not null,
  trimester             smallint check (trimester between 1 and 3),
  due_date              date,
  gestational_diabetes  boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz,
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create unique index pregnancy_profiles_one_live on public.pregnancy_profiles (family_member_id) where deleted_at is null;
create index pregnancy_profiles_household_idx on public.pregnancy_profiles (household_id) where deleted_at is null;

-- 8.9 sensory_profiles --------------------------------------------------------------------------------
create table public.sensory_profiles (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references public.households(id) on delete cascade,
  family_member_id     uuid not null,
  texture_likes        public.texture[] not null default '{}',
  texture_avoids       public.texture[] not null default '{}',
  color_sensitivities  text[] not null default '{}',
  presentation_prefs   jsonb not null default '{}'::jsonb,
                       -- {"separate_foods":true,"same_plate":true,"divided_plate":true,"cut_shapes":["strips","circles"],"sauce_on_side":true}
  temperature_prefs    text[] not null default '{}'
                         check (temperature_prefs <@ array['hot','warm','room','cold']::text[]),
  brand_rigidity       boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  deleted_at           timestamptz,
  check (not (texture_likes && texture_avoids)),
  check (jsonb_typeof(presentation_prefs) = 'object'),
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create unique index sensory_profiles_one_live on public.sensory_profiles (family_member_id) where deleted_at is null;
create index sensory_profiles_household_idx on public.sensory_profiles (household_id) where deleted_at is null;

-- 10.1 ai_assessments (0007, deferred from Sprint 0) ------------------------------------------------
create table public.ai_assessments (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.households(id) on delete cascade,
  family_member_id   uuid,
  kind               text not null check (kind in ('intake','periodic','plan_rationale')),
  summary            text not null,
  energy_targets     jsonb not null default '{}'::jsonb,
                     -- adults: {"kcal_per_day":2100,"method":"mifflin_st_jeor","pal":1.55}
                     -- minors: {"method":"eer_iom_2005","display":false} (never shown, 00-foundations 10.3)
  macro_targets      jsonb not null default '{}'::jsonb,    -- {"protein_g":80,"carbs_pct":50,"fat_pct":30,"fiber_g":30}
  hydration_targets  jsonb not null default '{}'::jsonb,    -- Addition: {"daily_ml":2300,"basis":{...}}
  risk_flags         text[] not null default '{}',           -- 'red_flag.faltering_growth', 'red_flag.ed_signals', ...
  input_snapshot     jsonb not null default '{}'::jsonb,    -- Addition: de-identified intake used for the run
  model_route        text not null,                          -- 'plan.generate'
  model              text,                                   -- Addition: concrete model id actually used
  prompt_version     text not null,                          -- 'intake_assess@3'
  created_by_user_id uuid references public.users(id) on delete set null,  -- Addition
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (id, household_id),
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index ai_assessments_household_idx on public.ai_assessments (household_id, created_at desc);
create index ai_assessments_member_idx on public.ai_assessments (family_member_id, created_at desc) where family_member_id is not null;
create index ai_assessments_created_by_idx on public.ai_assessments (created_by_user_id) where created_by_user_id is not null;

-- 12.2 hydration_targets (0009, first part) ---------------------------------------------------------
create table public.hydration_targets (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  family_member_id  uuid not null,
  daily_ml          integer not null check (daily_ml between 300 and 6000),
  schedule          jsonb not null default '[]'::jsonb,
                    -- [{"window":"pre_breakfast","start":"07:00","ml":250},{"window":"pre_lunch","start":"12:30","ml":250},...]
  basis             jsonb not null default '{}'::jsonb,
                    -- {"age_years":34,"weight_kg":68,"climate_zone":"hot_semi_arid","pregnancy":false,"breastfeeding":false,"fasting":false,"source":"efsa_2010"}
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  check (jsonb_typeof(schedule) = 'array'),
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create unique index hydration_targets_one_live on public.hydration_targets (family_member_id) where deleted_at is null;
create index hydration_targets_household_idx on public.hydration_targets (household_id) where deleted_at is null;

-- 20.1 / 21.1 intake jsonb columns (01 appendix B) ------------------------------------------------
-- households.preferences: cuisines, cooking minutes, equipment, batch cooking, shopping cadence,
-- shared meals, halal strictness (packages/shared HouseholdPreferences; 14's allow_mashbooh,
-- weekday_cook_limit_min, packed_lunches and batch_day keys live in the same object).
alter table public.households
  add column preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(preferences) = 'object');
grant update (preferences) on public.households to authenticated;          -- owner-only via households_update_owner

-- family_members.lifestyle: meal_pattern, eats_out, screens_at_meals, caffeine, sugary_drinks_per_week,
-- fasting_practice, appetite_pattern (packages/shared MemberLifestyle). Red-flag screening answers are
-- NOT stored here: they go to ai-intake-assess in the request; only flags are persisted.
alter table public.family_members
  add column lifestyle jsonb not null default '{}'::jsonb check (jsonb_typeof(lifestyle) = 'object');

-- 15.1 updated_at, 15.8 audit (keys only for health data) --------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['medical_conditions','allergies','medications','supplements','food_preferences',
                           'food_dislikes','nutrition_goals','pregnancy_profiles','sensory_profiles',
                           'ai_assessments','hydration_targets'] loop
    call private.attach_updated_at(('public.' || t)::regclass);
  end loop;
  foreach t in array array['medical_conditions','allergies','medications','supplements','pregnancy_profiles',
                           'nutrition_goals'] loop
    call private.attach_audit(('public.' || t)::regclass, 'keys_only');
  end loop;
end $$;

-- 15.11 child goal safety (00-foundations sections 2.5 and 10.3; S2-03) ------------------------------
-- Error contract (06 section 3.2): P0001, message CHILD_RULE:<rule>, detail {"rule": ...}. The edge
-- error mapper turns it into VALIDATION_FAILED with details.rule. The Zod mirror is
-- packages/shared/src/domain/intake.ts (goalAllowedForAge, which is stricter: an allow-list).
create or replace function private.enforce_child_goal_safety()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_dob date; v_stage public.life_stage;
begin
  if new.deleted_at is not null then
    return new;                                      -- soft-deleting an old goal is always allowed
  end if;
  select date_of_birth, life_stage into v_dob, v_stage
    from public.family_members where id = new.family_member_id;
  if v_stage in ('infant','toddler','child','teen') or public.is_minor(v_dob) then
    if new.goal_type in ('weight_loss','weight_gain') then
      raise exception 'CHILD_RULE:%', new.goal_type using errcode = 'P0001',
        detail = json_build_object('rule', 'no_' || new.goal_type || '_under_18', 'goal_type', new.goal_type)::text,
        hint = 'Members under 18 use child_growth; weight change for a child is clinician-led';
    end if;
    if new.target_unit in ('kcal_per_day','kg_per_week') then
      raise exception 'CHILD_RULE:kcal_target' using errcode = 'P0001',
        detail = json_build_object('rule', 'no_calorie_target_under_18', 'target_unit', new.target_unit)::text;
    end if;
  end if;
  if new.goal_type in ('pregnancy_support','breastfeeding_support') and v_stage in ('infant','toddler','child') then
    raise exception 'MODULE_NOT_APPLICABLE' using errcode = '23514', detail = new.goal_type::text;
  end if;
  return new;
end $$;
create trigger trg_nutrition_goals_child_safety
  before insert or update of goal_type, target_unit, family_member_id, deleted_at on public.nutrition_goals
  for each row execute function private.enforce_child_goal_safety();

-- Addition: the same rule when the date of birth changes under an existing goal.
create or replace function private.enforce_child_goal_safety_on_dob()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_goal public.goal_type;
begin
  if public.is_minor(new.date_of_birth) then
    select g.goal_type into v_goal from public.nutrition_goals g
     where g.family_member_id = new.id and g.deleted_at is null and g.goal_type in ('weight_loss','weight_gain')
     limit 1;
    if v_goal is not null then
      raise exception 'CHILD_RULE:%', v_goal using errcode = 'P0001',
        detail = json_build_object('rule', 'no_' || v_goal || '_under_18', 'goal_type', v_goal)::text;
    end if;
  end if;
  return new;
end $$;
create trigger trg_family_members_child_goal_safety
  after update of date_of_birth on public.family_members
  for each row when (new.date_of_birth is distinct from old.date_of_birth)
  execute function private.enforce_child_goal_safety_on_dob();

-- 22.1 consent enforcement (0022, deferred from Sprint 1 to land with the health tables) -------------
-- End-user writes only: service role, seeds and fixtures (auth.uid() null or
-- app.bypass_entitlements = 'on') are not blocked.
create or replace function private.enforce_child_data_consent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce(current_setting('app.bypass_entitlements', true), '') = 'on' then
    return new;
  end if;
  if public.is_minor(new.date_of_birth)
     and not public.has_active_consent(auth.uid(), 'child_data', new.household_id) then
    raise exception 'CHILD_DATA_CONSENT_REQUIRED' using errcode = 'P0001', hint = 'consent_required';
  end if;
  return new;
end $$;
create trigger trg_family_members_child_consent before insert or update of date_of_birth on public.family_members
  for each row execute function private.enforce_child_data_consent();

create or replace function private.enforce_health_data_consent()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce(current_setting('app.bypass_entitlements', true), '') = 'on' then
    return new;
  end if;
  if not public.has_active_consent(auth.uid(), 'health_data') then
    raise exception 'CONSENT_REQUIRED' using errcode = 'P0001',
      detail = json_build_object('kind', 'health_data')::text, hint = 'consent_required';
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['medical_conditions','medications','allergies','pregnancy_profiles','sensory_profiles'] loop
    execute format('create trigger %I before insert on public.%I for each row execute function private.enforce_health_data_consent()',
                   'trg_' || t || '_health_consent', t);
  end loop;
end $$;

-- Addition: atomic replace of a member's live hydration target (service role; ai-intake-assess S2-09).
create or replace function public.set_hydration_target(
  p_household_id     uuid,
  p_family_member_id uuid,
  p_daily_ml         integer,
  p_schedule         jsonb default '[]'::jsonb,
  p_basis            jsonb default '{}'::jsonb
) returns uuid
language plpgsql
set search_path = ''
as $$
declare v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('hydration_targets:' || p_family_member_id::text, 0));
  update public.hydration_targets
     set daily_ml = p_daily_ml, schedule = coalesce(p_schedule, '[]'::jsonb), basis = coalesce(p_basis, '{}'::jsonb)
   where family_member_id = p_family_member_id and household_id = p_household_id and deleted_at is null
  returning id into v_id;
  if v_id is null then
    insert into public.hydration_targets (household_id, family_member_id, daily_ml, schedule, basis)
    values (p_household_id, p_family_member_id, p_daily_ml, coalesce(p_schedule, '[]'::jsonb), coalesce(p_basis, '{}'::jsonb))
    returning id into v_id;
  end if;
  return v_id;
end $$;
revoke all on function public.set_hydration_target(uuid, uuid, integer, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.set_hydration_target(uuid, uuid, integer, jsonb, jsonb) to service_role;

-- 16.3.2 / 16.3.5 / 16.3.7 RLS --------------------------------------------------------------------------
call private.apply_household_rls('public.medical_conditions', 'edit');
call private.apply_household_rls('public.allergies', 'edit');
call private.apply_household_rls('public.medications', 'edit');
call private.apply_household_rls('public.supplements', 'edit');
call private.apply_household_rls('public.food_preferences', 'edit');
call private.apply_household_rls('public.food_dislikes', 'edit');
call private.apply_household_rls('public.nutrition_goals', 'edit');
call private.apply_household_rls('public.pregnancy_profiles', 'edit');
call private.apply_household_rls('public.sensory_profiles', 'edit');
call private.apply_household_rls('public.ai_assessments', 'service');   -- written by ai-intake-assess, ai-generate-plan
call private.apply_household_rls('public.hydration_targets', 'edit');
