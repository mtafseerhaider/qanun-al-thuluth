-- supabase/migrations/20261001001300_rls.sql
-- 0013 Row Level Security (05-database-schema.md section 16), Sprint 0 subset. Verbatim policies
-- for every Sprint 0 table, plus the two policy generator procedures later sprints call.
-- RLS is enabled on every public table; it is deliberately not forced (see 05 section 16.3 notes).

-- 16.3.0 Baseline privileges: anon gets nothing in public; authenticated gets DML gated by RLS.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- Policy generators (kept in schema private, not exposed through PostgREST).
create or replace procedure private.apply_household_rls(p_table regclass, p_write text)
language plpgsql set search_path = '' as $$
declare
  v_soft  boolean;
  v_check text;
  v_name  text := (select relname from pg_class where oid = p_table);
begin
  select exists (select 1 from pg_attribute where attrelid = p_table and attname = 'deleted_at' and not attisdropped)
    into v_soft;
  v_check := case p_write
    when 'edit'      then 'public.can_edit_household(household_id)'
    when 'edit_self' then '(public.can_edit_household(household_id) or public.is_linked_member(family_member_id))'
    when 'plan'      then 'public.can_author_plans(household_id)'
    when 'service'   then null
    else null end;

  execute format('alter table %s enable row level security', p_table);
  execute format(
    'create policy %I on %s for select to authenticated using (%s public.is_household_member(household_id))',
    v_name || '_select_member', p_table, case when v_soft then 'deleted_at is null and' else '' end);

  if v_check is not null then
    execute format('create policy %I on %s for insert to authenticated with check (%s)',
                   v_name || '_insert_' || p_write, p_table, v_check);
    execute format('create policy %I on %s for update to authenticated using (%s) with check (%s)',
                   v_name || '_update_' || p_write, p_table, v_check, v_check);
    if not v_soft then
      execute format('create policy %I on %s for delete to authenticated using (%s)',
                     v_name || '_delete_' || p_write, p_table, v_check);
    end if;
  end if;
end $$;

create or replace procedure private.apply_catalog_rls(p_table regclass, p_select_using text default 'true')
language plpgsql set search_path = '' as $$
declare v_name text := (select relname from pg_class where oid = p_table);
begin
  execute format('alter table %s enable row level security', p_table);
  execute format('create policy %I on %s for select to authenticated using (%s or public.is_admin())',
                 v_name || '_select_all', p_table, p_select_using);
  execute format('create policy %I on %s for insert to authenticated with check (public.is_admin())',
                 v_name || '_insert_admin', p_table);
  execute format('create policy %I on %s for update to authenticated using (public.is_admin()) with check (public.is_admin())',
                 v_name || '_update_admin', p_table);
  execute format('create policy %I on %s for delete to authenticated using (public.is_admin())',
                 v_name || '_delete_admin', p_table);
end $$;

-- 16.3.1 Identity and tenancy -------------------------------------------------------------

alter table public.users enable row level security;
create policy users_select_self_or_comember on public.users for select to authenticated
  using (deleted_at is null and (id = auth.uid() or public.shares_household_with(id)));
create policy users_update_self on public.users for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
-- no insert (trigger on auth.users) and no delete (account-delete Edge Function)
revoke insert, update, delete on public.users from authenticated;
grant update (display_name, avatar_path, locale, country_code, timezone, tradition_preference, units, onboarding_completed_at)
  on public.users to authenticated;

alter table public.households enable row level security;
create policy households_select_member on public.households for select to authenticated
  using (deleted_at is null and (owner_user_id = auth.uid() or public.is_household_member(id)));
  -- owner_user_id branch lets INSERT ... RETURNING see the row before the bootstrap trigger's membership row is visible
create policy households_insert_owner on public.households for insert to authenticated
  with check (owner_user_id = auth.uid());
create policy households_update_owner on public.households for update to authenticated
  using (public.household_role_of(id) = 'owner') with check (public.household_role_of(id) = 'owner');
revoke update on public.households from authenticated;
grant update (name, country_code, region, region_id, city, timezone, currency) on public.households to authenticated;
-- households are soft-deleted only through account-delete or an owner "delete household" Edge Function path

alter table public.household_members enable row level security;
create policy household_members_select on public.household_members for select to authenticated
  using (deleted_at is null and public.is_household_member(household_id));
create policy household_members_insert_owner on public.household_members for insert to authenticated
  with check (public.household_role_of(household_id) = 'owner' and role <> 'owner');
create policy household_members_update_owner on public.household_members for update to authenticated
  using (public.household_role_of(household_id) = 'owner')
  with check (public.household_role_of(household_id) = 'owner' and role <> 'owner');
revoke update on public.household_members from authenticated;
grant update (role) on public.household_members to authenticated;

-- 16.3.5 AI ------------------------------------------------------------------------------
alter table public.ai_usage enable row level security;
create policy ai_usage_select_own on public.ai_usage for select to authenticated
  using (user_id = auth.uid());

alter table public.ai_model_routes enable row level security;
create policy ai_model_routes_admin on public.ai_model_routes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

alter table public.prompt_templates enable row level security;
create policy prompt_templates_admin on public.prompt_templates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 16.3.8 Platform ------------------------------------------------------------------------
alter table public.subscriptions enable row level security;
create policy subscriptions_select_own on public.subscriptions for select to authenticated
  using (user_id = auth.uid());

alter table public.analytics_events enable row level security;
create policy analytics_events_insert_own on public.analytics_events for insert to authenticated
  with check (user_id = auth.uid()
              and (household_id is null or public.is_household_member(household_id))
              and occurred_at between now() - interval '7 days' and now() + interval '5 minutes');
revoke select, update, delete on public.analytics_events from authenticated;

call private.apply_catalog_rls('public.feature_flags');
