-- supabase/migrations/20261006090400_security_privacy_consents.sql
-- 05 ref: 0022 security and privacy, part 0022a (Sprint 1): consent_versions, has_active_consent(),
--         identity link/unlink audit and the audit_log action values it needs. Verbatim from 05
--         section 22.8 (22.1 and 22.5).
-- Deferred (see migrations/README.md):
--   * private.enforce_child_data_consent / trg_family_members_child_consent (CHILD_DATA_CONSENT_REQUIRED):
--     held back from Sprint 1 by the sprint lead (the under-18 server guard ships with Sprint 2); the
--     app's S1-07 consent screen writes the child_data consent row already.
--   * private.enforce_health_data_consent: its tables arrive in S2-02.
--   * DSAR, deletion ledger, household_keys, *_enc columns, fasting_logs_visible, erasure executor
--     (0022b to 0022d).

-- 22.1 Consent versions and checks ---------------------------------------------------------------
create table public.consent_versions (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null unique check (kind in ('terms','privacy','health_data','child_data','ai_processing','marketing')),
  current_version  text not null,                 -- matches CONSENT_VERSIONS in packages/shared, e.g. '2026-10'
  material         boolean not null default true, -- true = re-consent required on version change
  text_hash        text not null,                 -- sha256 of the published consent text
  published_at     timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
call private.attach_updated_at('public.consent_versions');
call private.attach_audit('public.consent_versions', 'full');
call private.apply_catalog_rls('public.consent_versions');

-- Active = not withdrawn and at the current version (any version while no consent_versions row exists).
-- p_household scopes child_data consent, which 0010 requires to carry a household_id.
create or replace function public.has_active_consent(p_user uuid, p_kind text, p_household uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.consents c
    left join public.consent_versions v on v.kind = c.kind
    where c.user_id = p_user and c.kind = p_kind and c.withdrawn_at is null
      and (v.id is null or c.version = v.current_version)
      and (p_household is null or c.household_id = p_household)
  );
$$;
revoke all on function public.has_active_consent(uuid, text, uuid) from public, anon;
grant execute on function public.has_active_consent(uuid, text, uuid) to authenticated, service_role;

-- 22.5 Identity link and unlink audit (11 section 9) -----------------------------------------------
alter table public.audit_log drop constraint audit_log_action_check;
alter table public.audit_log add constraint audit_log_action_check
  check (action in ('insert','update','delete','soft_delete','restore','role_change','export','login','erasure',
                    'identity.linked','identity.unlinked'));

create or replace function private.audit_identity_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_row jsonb := to_jsonb(coalesce(new, old));
begin
  insert into public.audit_log (actor_user_id, action, entity, entity_id, diff, ip_hash)
  values ((select u.id from public.users u where u.id = (v_row ->> 'user_id')::uuid),
          case when tg_op = 'INSERT' then 'identity.linked' else 'identity.unlinked' end,
          'auth.identities',
          null,
          jsonb_build_object('provider', v_row ->> 'provider'),
          private.request_ip_hash());
  return null;
end $$;
create trigger on_auth_identity_changed after insert or delete on auth.identities
  for each row execute function private.audit_identity_change();
