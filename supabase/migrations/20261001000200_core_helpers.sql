-- supabase/migrations/20261001000200_core_helpers.sql
-- 0002 Core helper functions (05-database-schema.md section 5), verbatim.
-- 00-foundations section 11 calls the life stage function `derive_life_stage()`; in the
-- reference DDL it is `life_stage_for_dob()`. The band boundaries are identical.

-- 5.1 updated_at maintenance (attached to every table in 0012)
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 5.2 Life stage from date of birth.
-- infant < 12 months, toddler 12-35 months, child 3-12 years, teen 13-17,
-- adult 18-64, older_adult >= 65. Boundaries match 15-family-health-modules.md.
create or replace function public.life_stage_for_dob(p_dob date, p_on date default current_date)
returns public.life_stage
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_dob is null then 'adult'::public.life_stage
    when (extract(year from age(p_on, p_dob)) * 12 + extract(month from age(p_on, p_dob))) < 12 then 'infant'
    when extract(year from age(p_on, p_dob)) < 3  then 'toddler'
    when extract(year from age(p_on, p_dob)) < 13 then 'child'
    when extract(year from age(p_on, p_dob)) < 18 then 'teen'
    when extract(year from age(p_on, p_dob)) < 65 then 'adult'
    else 'older_adult'
  end::public.life_stage;
$$;

-- Age in whole months, used by growth-compute and coaching_tips filtering.
create or replace function public.age_in_months(p_dob date, p_on date default current_date)
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select (extract(year from age(p_on, p_dob)) * 12 + extract(month from age(p_on, p_dob)))::integer;
$$;

-- Convenience: is this person a minor on a given date (drives "children are never restricted").
create or replace function public.is_minor(p_dob date, p_on date default current_date)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_dob is not null and age(p_on, p_dob) < interval '18 years';
$$;

-- 5.3 BMI = kg / m^2, rounded to 2 dp. Null-safe, rejects nonsense heights.
create or replace function public.compute_bmi(p_weight_kg numeric, p_height_cm numeric)
returns numeric(5,2)
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_weight_kg is null or p_height_cm is null or p_height_cm < 30 then null
    else round(p_weight_kg / ((p_height_cm / 100.0) ^ 2), 2)
  end::numeric(5,2);
$$;

-- 5.4 Platform admin check (Addition beyond 00-foundations).
-- Admins are users whose auth.users.raw_app_meta_data has {"role":"admin"}; this is
-- set only with the service role (see 16-security-architecture.md). Used by RLS on
-- curated catalog tables so the internal admin console can write through PostgREST.
create or replace function public.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;
