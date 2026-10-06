-- supabase/migrations/20261006150500_security_review_hardening.sql
-- 05 ref: addition (S7-03 structured security review; 16 sections 5 and 19). Sprint 7.
-- Findings fixed here (docs/security/s7-security-review.md, IDs in brackets):
--   * [S7-SEC-01] Entitlement and consent helpers are security definer and executable by `authenticated` because
--     RLS policies and triggers call them. They took any user or household id, so a signed-in user could probe
--     whether an arbitrary user is premium or has given `health_data` / `child_data` consent (a health signal),
--     and `household_has_premium` was even executable by `anon`. Each helper now answers only for the caller
--     (or a co-member / their own household) and keeps full access for the service role, cron and triggers
--     that run without a user JWT (auth.uid() is null). Unauthorised calls return false, never raise, so no
--     policy or trigger path changes behaviour for legitimate callers.
--   * [S7-SEC-02] `accept_household_invitation` pinned `search_path = public`; every other definer function pins
--     ''. Its body is fully qualified, so it moves to '' as well.
--   * [S7-SEC-03] Storage: `avatars_update` had no WITH CHECK, so an upsert or move could write any path in the
--     household prefix (the insert policy only allows members/{family_member_id}). The update now enforces the
--     insert shape. The meal-photos self-delete branch now also requires live household membership, so a linked
--     member who left the household cannot delete its photos.
--   * [S7-SEC-04] Supabase's default grants give anon and authenticated TRUNCATE, REFERENCES and TRIGGER on every
--     table. PostgREST never issues them, but TRUNCATE ignores RLS, so they are revoked (defence in depth) on
--     public and analytics, including tables created later by the migration role.
-- Bodies of the replaced functions are unchanged apart from the guard (create or replace keeps the grants).

-- [S7-SEC-01] has_premium ---------------------------------------------------------------------------------------------
create or replace function public.has_premium(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (auth.uid() is null or p_user_id = auth.uid() or public.shares_household_with(p_user_id))
     and exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user_id
      and s.tier = 'premium'
      and s.entitlement = 'premium'
      and s.refunded_at is null
      and (s.environment = 'production'
           or (coalesce(current_setting('app.environment', true), '') in ('local','development','staging','test')
               and exists (select 1 from public.feature_flags f where f.key = 'allow_sandbox_premium' and f.enabled)))
      and (
        (s.status = 'active' and (s.current_period_end is null or s.current_period_end > now() - interval '3 days'))
        or (s.status = 'cancelled' and s.current_period_end > now())
        or (s.status = 'in_grace' and coalesce(s.grace_period_expires_at, s.current_period_end) > now())
      )
  );
$$;

-- [S7-SEC-01] household_has_premium (was executable by anon) ------------------------------------------------------------
create or replace function public.household_has_premium(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (auth.uid() is null or public.is_household_member(p_household_id))
     and coalesce((
    select public.has_premium(h.owner_user_id) from public.households h where h.id = p_household_id
  ), false);
$$;
revoke all on function public.household_has_premium(uuid) from public, anon;
grant execute on function public.household_has_premium(uuid) to authenticated, service_role;

-- [S7-SEC-01] household_is_read_only ---------------------------------------------------------------------------------------
create or replace function public.household_is_read_only(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (auth.uid() is null or public.is_household_member(p_household_id))
     and coalesce((
    select not public.has_premium(h.owner_user_id)
           and h.id <> (select k.id from public.households k
                         where k.owner_user_id = h.owner_user_id and k.deleted_at is null
                         order by k.downgrade_kept_at desc nulls last, k.created_at, k.id
                         limit 1)
    from public.households h
    where h.id = p_household_id and h.deleted_at is null
  ), false);
$$;

-- [S7-SEC-01] has_active_consent: own consents only -------------------------------------------------------------------------
create or replace function public.has_active_consent(p_user uuid, p_kind text, p_household uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (auth.uid() is null or p_user = auth.uid())
     and exists (
    select 1 from public.consents c
    left join public.consent_versions v on v.kind = c.kind
    where c.user_id = p_user and c.kind = p_kind and c.withdrawn_at is null
      and (v.id is null or c.version = v.current_version)
      and (p_household is null or c.household_id = p_household)
  );
$$;

-- [S7-SEC-02] -----------------------------------------------------------------------------------------------------------------
alter function public.accept_household_invitation(uuid, uuid) set search_path = '';

-- [S7-SEC-03] Storage policies (Supabase, or the plain-mode stub) --------------------------------------------------------------
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema not present: storage policies not changed';
    return;
  end if;

  execute 'drop policy if exists avatars_update on storage.objects';
  execute $p$
    create policy avatars_update on storage.objects for update to authenticated
      using (bucket_id = 'avatars' and (
        public.can_edit_household(public.path_household_id(objects.name))
        or (split_part(objects.name, '/', 1) = 'users' and public.path_segment_uuid(objects.name, 2) = auth.uid())))
      with check (bucket_id = 'avatars' and (
        (public.can_edit_household(public.path_household_id(objects.name))
         and split_part(objects.name, '/', 2) = 'members'
         and exists (select 1 from public.family_members fm
                      where fm.id = public.path_segment_uuid(replace(objects.name, '.', '/'), 3)
                        and fm.household_id = public.path_household_id(objects.name)))
        or (split_part(objects.name, '/', 1) = 'users' and public.path_segment_uuid(objects.name, 2) = auth.uid())))
  $p$;

  execute 'drop policy if exists meal_photos_delete on storage.objects';
  execute $p$
    create policy meal_photos_delete on storage.objects for delete to authenticated
      using (bucket_id = 'meal-photos' and (
        public.can_edit_household(public.path_household_id(objects.name))
        or (public.is_household_member(public.path_household_id(objects.name))
            and exists (select 1 from public.family_members fm
                         where fm.id = public.path_segment_uuid(objects.name, 2)
                           and fm.household_id = public.path_household_id(objects.name)
                           and fm.linked_user_id = auth.uid()))))
  $p$;
end $$;

-- [S7-SEC-04] Table privileges client roles never need ------------------------------------------------------------------------
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
revoke truncate, references, trigger on all tables in schema analytics from anon, authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;
alter default privileges in schema analytics revoke truncate, references, trigger on tables from anon, authenticated;
