-- supabase/migrations/20261006090300_consolidation_helpers.sql
-- 05 ref: 0017 consolidation helpers (whole slot, Sprint 1). Verbatim from 05 section 22.3.
-- Shared helpers for migrations 0018 onward, plus the users columns that several domains read.

-- 17.1 Attach the standard updated_at and audit triggers to tables created after 0012 -------------
create or replace procedure private.attach_updated_at(p_table regclass)
language plpgsql set search_path = '' as $$
declare v_name text := (select relname from pg_class where oid = p_table);
begin
  execute format('create trigger %I before update on %s for each row execute function public.set_updated_at()',
                 'trg_' || v_name || '_updated_at', p_table);
end $$;

-- p_mode: 'full' or 'keys_only' (health data), as in private.audit_row_change() from 0012
create or replace procedure private.attach_audit(p_table regclass, p_mode text)
language plpgsql set search_path = '' as $$
declare v_name text := (select relname from pg_class where oid = p_table);
begin
  execute format('create trigger %I after insert or update or delete on %s for each row execute function private.audit_row_change(%L)',
                 'trg_' || v_name || '_audit', p_table, p_mode);
end $$;

-- 17.2 Role helpers ---------------------------------------------------------------------------
-- From 11-authentication.md section 10.2, aligned with 05 conventions (search_path '', soft-deleted memberships ignored).
create or replace function public.has_household_role(p_household_id uuid, p_roles public.household_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.household_members hm
    where hm.household_id = p_household_id
      and hm.user_id = auth.uid()
      and hm.deleted_at is null
      and hm.role = any (p_roles)
  );
$$;
revoke all on function public.has_household_role(uuid, public.household_role[]) from public, anon;
grant execute on function public.has_household_role(uuid, public.household_role[]) to authenticated, service_role;

-- Knowledge-base admin roles from 13-islamic-knowledge-module.md section 8.1. Claims live in
-- auth.users.raw_app_meta_data as {"role":"content_editor"} or {"roles":["scholar_reviewer","content_editor"]}
-- and are set only with the service role. Platform admins (is_admin) pass every check.
create or replace function public.has_content_role(variadic p_roles text[])
returns boolean
language sql
stable
set search_path = ''
as $$
  select public.is_admin()
      or coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = any (p_roles), false)
      or coalesce((
           select bool_or(r = any (p_roles))
           from jsonb_array_elements_text(
                  case when jsonb_typeof(auth.jwt() -> 'app_metadata' -> 'roles') = 'array'
                       then auth.jwt() -> 'app_metadata' -> 'roles' else '[]'::jsonb end) as r), false);
$$;
revoke all on function public.has_content_role(text[]) from public, anon;
grant execute on function public.has_content_role(text[]) to authenticated, service_role;

-- 17.3 users columns read across domains ----------------------------------------------------
alter table public.users
  add column age_attested_at        timestamptz,                         -- 11 section 13: account holder attests 18+
  add column deletion_scheduled_for timestamptz,                         -- 04, 06 section 4.13: erasure grace period
  add column processing_restricted  boolean not null default false,      -- 16 section 7.4: GDPR restriction, blocks AI and analytics
  add column analytics_opt_out      boolean not null default false,      -- 18 section 14: objection to analytics
  add column is_internal            boolean not null default false;      -- 18: staff and test accounts excluded from metrics
create index users_deletion_due_idx on public.users (deletion_scheduled_for) where deletion_scheduled_for is not null;

-- clients may set the attestation and the analytics toggle; the rest is service-only
grant update (age_attested_at, analytics_opt_out) on public.users to authenticated;
