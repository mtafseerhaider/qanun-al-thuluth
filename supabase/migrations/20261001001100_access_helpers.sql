-- supabase/migrations/20261001001100_access_helpers.sql
-- 0011 Access helper functions (05-database-schema.md section 14), verbatim except:
--   * public.is_linked_member(uuid) is deferred to Sprint 1 together with family_members
--     (a SQL function body is validated at creation, so it cannot reference a table that
--     does not exist yet).
-- All helpers are security definer, stable, search_path = '' so they read household_members
-- without re-entering its RLS (no recursion) and cannot be hijacked through search_path.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- 14.1 membership
create or replace function public.is_household_member(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = auth.uid()
      and hm.deleted_at is null
  );
$$;

create or replace function public.household_role_of(p_household_id uuid)
returns public.household_role
language sql
stable
security definer
set search_path = ''
as $$
  select hm.role
  from public.household_members hm
  where hm.household_id = p_household_id
    and hm.user_id = auth.uid()
    and hm.deleted_at is null
  limit 1;
$$;

-- owner or caregiver: may write family data
create or replace function public.can_edit_household(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.household_role_of(p_household_id) in ('owner','caregiver'), false);
$$;

-- Addition: owner, caregiver or coach may author plans and recommendations (coach is Phase 2)
create or replace function public.can_author_plans(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.household_role_of(p_household_id) in ('owner','caregiver','coach'), false);
$$;

-- Addition: used by users RLS so co-members can see each other's display name
create or replace function public.shares_household_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.household_members me
    join public.household_members them on them.household_id = me.household_id
    where me.user_id = auth.uid() and me.deleted_at is null
      and them.user_id = p_user_id and them.deleted_at is null
  );
$$;

-- Addition: set-returning variant for policies that benefit from an initPlan
create or replace function public.my_household_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select hm.household_id from public.household_members hm
  where hm.user_id = auth.uid() and hm.deleted_at is null;
$$;

-- 14.2 entitlements
-- Premium = a premium subscription row that is active, in grace, or cancelled-but-not-yet-expired.
create or replace function public.has_premium(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user_id
      and s.tier = 'premium'
      and (
        s.status in ('active','in_grace')
        or (s.status = 'cancelled' and s.current_period_end > now())
      )
      and (s.current_period_end is null or s.current_period_end > now() - interval '3 days')  -- clock-skew / webhook-lag tolerance
  );
$$;

-- Addition: premium follows the household owner, so caregivers in a premium household get premium features there
create or replace function public.household_has_premium(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select public.has_premium(h.owner_user_id) from public.households h where h.id = p_household_id
  ), false);
$$;

-- 14.3 soft delete RPC (Addition).
-- Why: an UPDATE that sets deleted_at makes the row fail the SELECT policy (deleted_at is null),
-- and PostgREST's filtered UPDATE needs the new row to stay visible, so a plain PATCH fails with 42501.
-- Clients call supabase.rpc('soft_delete', { p_table: 'allergies', p_id }) instead.
-- The allow-list names tables from later sprints; the dynamic SQL only touches them once they exist.
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
    'chat_sessions','ai_memories','recipes','meals','household_members'];
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
  elsif not public.can_edit_household(v_household) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  execute format('update public.%I set deleted_at = now() where id = $1', p_table) using p_id;
end;
$$;

revoke execute on function public.soft_delete(text, uuid) from public, anon;
grant execute on function public.soft_delete(text, uuid) to authenticated;
-- Helper functions are callable by authenticated (RLS needs them); none leak data beyond a boolean or the caller's own role.
revoke execute on function public.has_premium(uuid) from public, anon;
grant execute on function public.has_premium(uuid) to authenticated, service_role;
