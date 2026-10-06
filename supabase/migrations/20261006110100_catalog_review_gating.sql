-- supabase/migrations/20261006110100_catalog_review_gating.sql
-- 05 ref: 0004 (part 3: meal catalog keys and review state), 0013 16.3.3 (catalog visibility, replaced).
--         Sprint 3: S3-02 (swap), S3-13, S3-16, internal alpha gating.
-- Additions beyond 05, recorded here and in migrations/README.md (05 needs a docs PR):
--   * meals.code: stable key for global catalog meals ('D001', 'D001-A', ...). The seed upserts on it
--     and the free-tier templates in packages/ai-core reference meals by it.
--   * meals.review_status, portions.review_status, meal_alternatives.review_status: the same
--     verification_status as recipes. Global rows are visible to users only once a dietitian sets
--     them 'verified'. Household rows (household_id not null) keep member visibility.
--   * public.catalog_review_statuses(): {verified}, or {verified,in_review} when the feature flag
--     'catalog.include_in_review' is enabled AND the database setting app.environment is explicitly
--     one of 'local', 'development', 'staging', 'test'. Fails closed: an unset or unknown value
--     behaves like production and the flag is ignored. Used by the recipes, meals, portions and meal_alternatives policies, and by
--     service-role readers (the planning engine) that bypass RLS. It never touches Islamic sources or
--     recommendations: those stay hidden until scholar-verified whatever the flag says.
--     Non-production projects opt in with `alter database postgres set app.environment = 'development'`
--     (thuluth-dev) or 'staging' (thuluth-staging), a one-time deploy step; production needs nothing.
--     seed/local/900_dev_fixtures.sql sets 'local' for the local stack. The flag row is seeded disabled
--     everywhere and enabled by an admin (same rule as allow_sandbox_premium).
--   * daily_meals.swapped_from_meal_id and public.swap_daily_meal(): free single-meal swap from
--     meal_alternatives (06 section 3.3 lets clients update only scheduled_time and notes on
--     daily_meals, so the swap needs an RPC). S3-13.

-- Catalog columns -------------------------------------------------------------------------------------
alter table public.meals
  add column code text check (code ~ '^[A-Z][0-9]{3}(-[AP])?$'),
  add column review_status public.verification_status not null default 'unverified',
  add constraint meals_code_global check (code is null or household_id is null);
create unique index meals_code_key on public.meals (code) where code is not null;
create index meals_catalog_review_idx on public.meals (review_status, meal_type) where household_id is null and deleted_at is null;

alter table public.portions
  add column review_status public.verification_status not null default 'unverified';

alter table public.meal_alternatives
  add column review_status public.verification_status not null default 'unverified';
create index meal_alternatives_meal_idx on public.meal_alternatives (meal_id, reason);

-- Which review states users may see (internal alpha gate) ---------------------------------------------
create or replace function public.catalog_review_statuses()
returns public.verification_status[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce(current_setting('app.environment', true), '') in ('local','development','staging','test')
         and exists (select 1 from public.feature_flags f where f.key = 'catalog.include_in_review' and f.enabled)
      then array['verified','in_review']::public.verification_status[]
    else array['verified']::public.verification_status[]
  end;
$$;
revoke all on function public.catalog_review_statuses() from public, anon;
grant execute on function public.catalog_review_statuses() to authenticated, service_role;

-- 16.3.3 policies, replaced. (select ...) makes the flag lookup an initplan: once per statement.
drop policy recipes_select on public.recipes;
create policy recipes_select on public.recipes for select to authenticated
  using (
    deleted_at is null and (
      (household_id is null and review_status = any ((select public.catalog_review_statuses())::public.verification_status[]))
      or (household_id is not null and public.is_household_member(household_id))
      or public.is_admin()
    ));

drop policy meals_select on public.meals;
create policy meals_select on public.meals for select to authenticated
  using (
    deleted_at is null and (
      (household_id is null and review_status = any ((select public.catalog_review_statuses())::public.verification_status[]))
      or (household_id is not null and public.is_household_member(household_id))
      or public.is_admin()
    ));
-- user meals cannot claim a review state
drop policy meals_insert on public.meals;
create policy meals_insert on public.meals for insert to authenticated
  with check ((household_id is not null and source = 'user' and code is null and review_status = 'unverified'
               and public.can_author_plans(household_id)) or public.is_admin());

-- global portions follow their own review state and the visibility of their meal or recipe (subqueries
-- run under the caller's RLS)
drop policy portions_select on public.portions;
create policy portions_select on public.portions for select to authenticated
  using (
    (household_id is not null and public.is_household_member(household_id))
    or (household_id is null
        and review_status = any ((select public.catalog_review_statuses())::public.verification_status[])
        and (exists (select 1 from public.meals m where m.id = meal_id)
             or exists (select 1 from public.recipes r where r.id = recipe_id)))
    or public.is_admin());

drop policy meal_alternatives_select_all on public.meal_alternatives;
create policy meal_alternatives_select_all on public.meal_alternatives for select to authenticated
  using (
    (review_status = any ((select public.catalog_review_statuses())::public.verification_status[])
     and exists (select 1 from public.meals m where m.id = meal_id)
     and exists (select 1 from public.meals m where m.id = alternative_meal_id))
    or public.is_admin());

-- Free swap (S3-13) ----------------------------------------------------------------------------------
alter table public.daily_meals
  add column swapped_from_meal_id uuid references public.meals(id) on delete set null;
create index daily_meals_swapped_from_idx on public.daily_meals (swapped_from_meal_id) where swapped_from_meal_id is not null;

-- Replaces the slot's meal with a catalog alternative of it, for the whole family. Servings that are
-- still 'planned' move to the new meal's portion for the member's life stage (adult and older adult
-- 'standard', teen 'ideal', child and toddler 'start'). An adapted serving keeps its adaptation and
-- points at the new meal's alternative for the same reason; autism and picky servings without one keep
-- the adaptation with no adapted meal (the planner's safe-food rule), while allergy and pregnancy
-- servings without one block the swap. Logged servings are left alone. Errors: P0002 NOT_FOUND, 42501 FORBIDDEN,
-- P0001 SWAP_NOT_ALLOWED (no visible alternative row, different meal type, closed plan).
create or replace function public.swap_daily_meal(p_daily_meal_id uuid, p_alternative_meal_id uuid)
returns public.daily_meals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dm     public.daily_meals;
  v_status public.plan_status;
  v_alt    public.meals;
  v_ok     public.verification_status[] := public.catalog_review_statuses();
  v_adapted uuid;
  r        record;
begin
  select * into v_dm from public.daily_meals where id = p_daily_meal_id for update;
  if not found or not public.is_household_member(v_dm.household_id) then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;
  if not public.can_author_plans(v_dm.household_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select mp.status into v_status from public.meal_plans mp where mp.id = v_dm.meal_plan_id and mp.deleted_at is null;
  if v_status is null or v_status not in ('draft','active') then
    raise exception 'SWAP_NOT_ALLOWED' using errcode = 'P0001', detail = 'plan_status=' || coalesce(v_status::text, 'deleted');
  end if;

  select * into v_alt from public.meals m
   where m.id = p_alternative_meal_id and m.deleted_at is null
     and ((m.household_id is null and m.review_status = any (v_ok)) or m.household_id = v_dm.household_id);
  if not found
     or v_alt.meal_type <> v_dm.meal_type
     or not exists (select 1 from public.meal_alternatives a
                     where a.meal_id = v_dm.meal_id and a.alternative_meal_id = p_alternative_meal_id
                       and a.review_status = any (v_ok)) then
    raise exception 'SWAP_NOT_ALLOWED' using errcode = 'P0001', detail = 'no_alternative';
  end if;

  update public.daily_meals
     set swapped_from_meal_id = coalesce(swapped_from_meal_id, meal_id), meal_id = p_alternative_meal_id
   where id = v_dm.id
  returning * into v_dm;

  for r in
    select s.id, s.adaptation, fm.life_stage
      from public.daily_meal_servings s
      join public.family_members fm on fm.id = s.family_member_id and fm.household_id = s.household_id
     where s.daily_meal_id = v_dm.id and s.status = 'planned'
  loop
    v_adapted := null;
    if r.adaptation <> 'none' then
      select a.alternative_meal_id into v_adapted from public.meal_alternatives a
       where a.meal_id = p_alternative_meal_id and a.reason = r.adaptation and a.review_status = any (v_ok)
       order by a.created_at limit 1;
      -- an allergy or pregnancy adaptation must never fall back to the family meal
      if v_adapted is null and r.adaptation in ('allergy','pregnancy') then
        raise exception 'SWAP_NOT_ALLOWED' using errcode = 'P0001', detail = 'adaptation_unavailable:' || r.adaptation;
      end if;
    end if;
    update public.daily_meal_servings
       set portion_id = (select p.id from public.portions p
                          where p.meal_id = p_alternative_meal_id and p.life_stage = r.life_stage
                            and p.tier = case r.life_stage when 'teen' then 'ideal' when 'child' then 'start'
                                                           when 'toddler' then 'start' else 'standard' end),
           adapted_meal_id = v_adapted
     where id = r.id;
  end loop;
  return v_dm;
end $$;
revoke all on function public.swap_daily_meal(uuid, uuid) from public, anon;
grant execute on function public.swap_daily_meal(uuid, uuid) to authenticated, service_role;
