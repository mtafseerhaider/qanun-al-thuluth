-- supabase/migrations/20261006120100_tracking_logs.sql
-- 05 ref: 0009 tracking (part 2: hydration_logs, fasting_logs, weight_tracking, nutrition_journal),
--         0012 15.8 (weight audit), 15.10 (weight BMI, latest measurement), 15.11 (fasting safety),
--         0013 16.3.7 (part), 0021b (Hijri and qada columns, households.hijri_offset_days, v_qada_balance),
--         0022c (fasting_logs_visible). Sprint 4: S4-02.
-- DDL verbatim from 05 sections 12.3, 12.4, 12.8, 12.9, 15.10, 15.11, 16.3.7, 22.7 (21.1, 21.2) and
-- 22.8 (22.4), except:
--   * Safety errors follow the S2-03 contract (06 section 3.2): P0001, message '<FAMILY>:<rule>', detail
--     JSON with "rule". 05's 23514 codes CHILD_INTERMITTENT_FASTING_NOT_ALLOWED / UNDER_7_FASTING_NOT_ALLOWED
--     become CHILD_RULE:intermittent_fasting / CHILD_RULE:fasting_under_7.
--   * Addition (00 section 10, 15 section 5.8): intermittent fasting is also refused for a member who is
--     pregnant (live pregnancy_profiles row or special module) or breastfeeding: FASTING_RULE:intermittent_not_allowed.
--   * Addition (15 section 5.8 "never more than 24 hours", 5.11 eating_disorder_signal): a logged fast window
--     is at most 24 hours (check fasting_logs_max_24h, every kind).
--   * Addition (00 section 10, 15 section 2.10): weight_tracking is adults only. A member under 18 on
--     measured_on (or with a minor life stage and no date of birth) raises CHILD_RULE:weight_log; children
--     are measured through growth_tracking (S6).
--   * exemption_reason accepts the union of 05 and 15 section 5.1: 05's medical_advice plus 15's postpartum
--     and chronic_condition (15 says permanent exemptions show a fidya note, so they must be storable).
--   * v_qada_balance: 05 joins ramadan_plans, which lands in S5. Until then the Hijri year comes from
--     fasting_logs.hijri_date (left 4 characters) of kind 'ramadan' rows, which the client writes with the
--     Hijri date it already computes (15 section 5.2). Same columns as 05's view; S5 may replace the body.
--   * Fasting 05 12.4 trigger semantics kept: under 7 only a non-fasting row (not completed, no started_at,
--     not a practice fast) may be stored; 7 to 17 may log any kind except intermittent, practice fasts
--     included; is_practice_fast is cleared for adults.
--   * sync_latest_measurement keeps 05's growth_tracking branch; it only fires from weight_tracking until
--     growth_tracking lands (S6).

-- 21.1 households.hijri_offset_days (local moon-sighting adjustment, 15 section 5.2) --------------------
alter table public.households
  add column hijri_offset_days smallint not null default 0 check (hijri_offset_days between -2 and 2);
grant update (hijri_offset_days) on public.households to authenticated;   -- owner-only via households_update_owner

-- 12.3 hydration_logs ------------------------------------------------------------------------------------
create table public.hydration_logs (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  family_member_id  uuid not null,
  logged_at         timestamptz not null default now(),
  volume_ml         integer not null check (volume_ml between 10 and 3000),
  beverage          text not null default 'water' check (beverage in ('water','milk','laban','juice','tea','other')),
  timing            text not null default 'other' check (timing in ('pre_meal','with_meal','post_meal','other')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index hydration_logs_member_time_idx on public.hydration_logs (household_id, family_member_id, logged_at desc);
create index hydration_logs_member_idx on public.hydration_logs (family_member_id, logged_at desc);   -- FK index

-- 12.4 fasting_logs (+ 21.1 hijri_date, qada_for_hijri_year) -----------------------------------------------
create table public.fasting_logs (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references public.households(id) on delete cascade,
  family_member_id     uuid not null,
  fast_date            date not null,
  kind                 public.fast_kind not null,
  started_at           timestamptz,
  ended_at             timestamptz,
  completed            boolean not null default false,
  exemption_reason     text check (exemption_reason in ('illness','travel','menstruation','postpartum','pregnancy',
                                                        'breastfeeding','age','chronic_condition','medical_advice','other')),
  is_practice_fast     boolean not null default false,   -- Addition: child half-day practice fast (7 to puberty)
  notes                text check (char_length(notes) <= 2000),
  hijri_date           text check (hijri_date ~ '^\d{4}-\d{2}-\d{2}$'),               -- 0021: 'YYYY-MM-DD' Hijri
  qada_for_hijri_year  smallint check (qada_for_hijri_year between 1400 and 1600),    -- 0021: which Ramadan this qada makes up
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (ended_at is null or started_at is null or ended_at > started_at),
  constraint fasting_logs_max_24h check (ended_at is null or started_at is null or ended_at - started_at <= interval '24 hours'),
  check (not (completed and exemption_reason is not null)),
  constraint fasting_logs_qada_year_only_for_qada check (qada_for_hijri_year is null or kind = 'qada'),
  unique (family_member_id, fast_date, kind),
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index fasting_logs_member_date_idx on public.fasting_logs (household_id, family_member_id, fast_date desc);
create index fasting_logs_qada_idx on public.fasting_logs (family_member_id, qada_for_hijri_year) where kind = 'qada';

-- 12.8 weight_tracking (adults) -----------------------------------------------------------------------------
create table public.weight_tracking (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references public.households(id) on delete cascade,
  family_member_id  uuid not null,
  measured_on       date not null,
  weight_kg         numeric(5,2) not null check (weight_kg between 20 and 400),
  waist_cm          numeric(5,1) check (waist_cm between 30 and 250),
  bmi               numeric(5,2),          -- set by trigger from family_members.height_cm
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (family_member_id, measured_on),
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index weight_tracking_member_idx on public.weight_tracking (household_id, family_member_id, measured_on desc);

-- 12.9 nutrition_journal --------------------------------------------------------------------------------------
create table public.nutrition_journal (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.households(id) on delete cascade,
  family_member_id   uuid not null,
  journal_date       date not null,
  mood               smallint check (mood between 1 and 5),
  energy             smallint check (energy between 1 and 5),
  digestion          smallint check (digestion between 1 and 5),
  thuluth_adherence  smallint check (thuluth_adherence between 0 and 3),  -- thirds respected today (adults); rhythm score for minors
  notes              text check (char_length(notes) <= 4000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (family_member_id, journal_date),
  foreign key (family_member_id, household_id) references public.family_members(id, household_id) on delete cascade
);
create index nutrition_journal_member_idx on public.nutrition_journal (household_id, family_member_id, journal_date desc);

-- 15.1 updated_at, 15.8 audit (keys only for health data) ------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['hydration_logs','fasting_logs','weight_tracking','nutrition_journal'] loop
    call private.attach_updated_at(('public.' || t)::regclass);
  end loop;
end $$;
call private.attach_audit('public.weight_tracking', 'keys_only');

-- 15.10 measurements ----------------------------------------------------------------------------------------
-- Adults only (00 section 10): checked before BMI so a child row never gets a value.
create or replace function private.weight_tracking_bmi()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_dob date; v_stage public.life_stage; v_height numeric;
begin
  select fm.date_of_birth, fm.life_stage, fm.height_cm into v_dob, v_stage, v_height
    from public.family_members fm where fm.id = new.family_member_id;
  if public.is_minor(v_dob, new.measured_on)
     or (v_dob is null and v_stage in ('infant','toddler','child','teen')) then
    raise exception 'CHILD_RULE:weight_log' using errcode = 'P0001',
      detail = json_build_object('rule', 'no_weight_log_under_18')::text,
      hint = 'Children are measured through growth tracking';
  end if;
  new.bmi := public.compute_bmi(new.weight_kg, v_height);
  return new;
end $$;
create trigger trg_weight_tracking_bmi
  before insert or update of weight_kg, measured_on, family_member_id on public.weight_tracking
  for each row execute function private.weight_tracking_bmi();

create or replace function private.sync_latest_measurement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'growth_tracking' then
    execute $q$
      update public.family_members fm
         set height_cm = coalesce($1, fm.height_cm),
             weight_kg = coalesce($2, fm.weight_kg)
       where fm.id = $3
         and not exists (select 1 from public.growth_tracking g
                          where g.family_member_id = $3 and g.measured_on > $4)$q$
      using (to_jsonb(new) ->> 'height_cm')::numeric, (to_jsonb(new) ->> 'weight_kg')::numeric,
            new.family_member_id, new.measured_on;
  else
    if not exists (select 1 from public.weight_tracking w
                   where w.family_member_id = new.family_member_id and w.measured_on > new.measured_on) then
      update public.family_members set weight_kg = new.weight_kg where id = new.family_member_id;
    end if;
  end if;
  return null;
end $$;
create trigger trg_weight_tracking_sync after insert or update of weight_kg on public.weight_tracking
  for each row execute function private.sync_latest_measurement();

-- 15.11 fasting safety (00 sections 10.3 and 10.4, 15 sections 5.5 and 5.8) -----------------------------------
create or replace function private.enforce_fasting_safety()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_dob date; v_stage public.life_stage; v_modules public.special_module[]; v_minor boolean;
begin
  select fm.date_of_birth, fm.life_stage, fm.special_modules into v_dob, v_stage, v_modules
    from public.family_members fm where fm.id = new.family_member_id;
  v_minor := public.is_minor(v_dob, new.fast_date)
             or (v_dob is null and v_stage in ('infant','toddler','child','teen'));

  if v_minor and new.kind = 'intermittent' then
    raise exception 'CHILD_RULE:intermittent_fasting' using errcode = 'P0001',
      detail = json_build_object('rule', 'no_intermittent_fasting_under_18')::text;
  end if;

  if ((v_dob is not null and age(new.fast_date, v_dob) < interval '7 years')
      or (v_dob is null and v_stage in ('infant','toddler')))
     and (new.completed or new.started_at is not null or new.is_practice_fast) then
    raise exception 'CHILD_RULE:fasting_under_7' using errcode = 'P0001',
      detail = json_build_object('rule', 'no_fasting_under_7')::text,
      hint = 'Children under 7 join family rituals instead of fasting';
  end if;

  if new.kind = 'intermittent'
     and ('pregnancy' = any (v_modules) or 'breastfeeding' = any (v_modules)
          or exists (select 1 from public.pregnancy_profiles pp
                      where pp.family_member_id = new.family_member_id and pp.deleted_at is null)) then
    raise exception 'FASTING_RULE:intermittent_not_allowed' using errcode = 'P0001',
      detail = json_build_object('rule', 'no_intermittent_fasting_pregnancy_breastfeeding')::text;
  end if;

  if new.is_practice_fast and not v_minor then
    new.is_practice_fast := false;
  end if;
  return new;
end $$;
create trigger trg_fasting_logs_safety before insert or update on public.fasting_logs
  for each row execute function private.enforce_fasting_safety();

-- 16.3.7 RLS: household edit plus linked-member self-logging (06 section 3.4) --------------------------------
call private.apply_household_rls('public.hydration_logs', 'edit_self');
call private.apply_household_rls('public.fasting_logs', 'edit_self');
call private.apply_household_rls('public.weight_tracking', 'edit_self');
call private.apply_household_rls('public.nutrition_journal', 'edit_self');

-- 22.4 sensitive field visibility (16 template E): exemption reason only for the member or the owner --------
create view public.fasting_logs_visible with (security_invoker = true) as
select fl.id, fl.household_id, fl.family_member_id, fl.fast_date, fl.kind, fl.started_at, fl.ended_at,
       fl.completed, fl.is_practice_fast, fl.hijri_date, fl.qada_for_hijri_year,
       case when fm.linked_user_id = auth.uid() or public.household_role_of(fl.household_id) = 'owner'
            then fl.exemption_reason end as exemption_reason,
       fl.created_at, fl.updated_at
from public.fasting_logs fl
join public.family_members fm on fm.id = fl.family_member_id;
revoke all on public.fasting_logs_visible from anon;
grant select on public.fasting_logs_visible to authenticated;

-- 21.2 qada balance per member and Hijri year (invoker rights, RLS applies; see header for the S4 body) ------
create view public.v_qada_balance with (security_invoker = true) as
with missed as (
  select fl.household_id, fl.family_member_id, left(fl.hijri_date, 4)::smallint as hijri_year,
         count(*) filter (where not fl.completed or fl.exemption_reason is not null) as missed
  from public.fasting_logs fl
  where fl.kind = 'ramadan' and fl.hijri_date is not null
  group by 1, 2, 3
)
select m.household_id,
       m.family_member_id,
       m.hijri_year,
       m.missed,
       (select count(*) from public.fasting_logs q
         where q.family_member_id = m.family_member_id and q.kind = 'qada'
           and q.completed and q.qada_for_hijri_year = m.hijri_year) as made_up
from missed m;
revoke all on public.v_qada_balance from anon;
grant select on public.v_qada_balance to authenticated;
