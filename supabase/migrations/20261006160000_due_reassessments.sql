-- supabase/migrations/20261006160000_due_reassessments.sql
-- 05 ref: addition (launch follow-up to S6-15 / FR-AI-11). Sprint 7 follow-up.
-- `ai-reassess` read every intake and periodic assessment (paged through PostgREST) to find each member's latest
-- one, then filtered in the function. This RPC returns only the members that are due, oldest first, capped:
--
--   due_reassessments(p_before, p_limit, p_household_ids default null)
--     -> setof (id, household_id, family_member_id, kind, created_at, energy_targets, macro_targets,
--               hydration_targets, risk_flags, input_snapshot)
--   One row per live member (family member and household not soft-deleted) whose latest `intake` or `periodic`
--   assessment was created at or before p_before, ordered by created_at, id. The caller passes
--   now() - 28 days (REASSESS_INTERVAL_DAYS), or now() for a forced run on listed households. p_limit is 1 to 1000
--   (the ai-reassess request bound); anything else raises VALIDATION_FAILED (P0001).
--
-- Security invoker with search_path '' (it reads as the caller; only service_role may execute it, so RLS never
-- hides rows from the cron caller). Uses ai_assessments_member_idx (family_member_id, created_at desc).

create or replace function public.due_reassessments(p_before timestamptz, p_limit int,
                                                    p_household_ids uuid[] default null)
returns table (
  id                uuid,
  household_id      uuid,
  family_member_id  uuid,
  kind              text,
  created_at        timestamptz,
  energy_targets    jsonb,
  macro_targets     jsonb,
  hydration_targets jsonb,
  risk_flags        text[],
  input_snapshot    jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
#variable_conflict use_column
begin
  if p_before is null or p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'VALIDATION_FAILED' using errcode = 'P0001',
      detail = jsonb_build_object('function', 'due_reassessments', 'limit', p_limit, 'before', p_before)::text;
  end if;

  return query
  select l.id, l.household_id, l.family_member_id, l.kind, l.created_at, l.energy_targets, l.macro_targets,
         l.hydration_targets, l.risk_flags, l.input_snapshot
  from (
    select distinct on (a.family_member_id)
           a.id, a.household_id, a.family_member_id, a.kind, a.created_at, a.energy_targets, a.macro_targets,
           a.hydration_targets, a.risk_flags, a.input_snapshot
    from public.ai_assessments a
    join public.family_members fm on fm.id = a.family_member_id and fm.household_id = a.household_id
    join public.households h on h.id = a.household_id
    where a.family_member_id is not null
      and a.kind in ('intake', 'periodic')
      and fm.deleted_at is null
      and h.deleted_at is null
      and (p_household_ids is null or a.household_id = any (p_household_ids))
    order by a.family_member_id, a.created_at desc, a.id desc
  ) l
  where l.created_at <= p_before
  order by l.created_at, l.id
  limit p_limit;
end;
$$;

comment on function public.due_reassessments(timestamptz, int, uuid[]) is
  'ai-reassess (FR-AI-11): latest intake/periodic assessment per live member created at or before p_before, '
  'oldest first, at most p_limit (1..1000). Service role only.';

revoke all on function public.due_reassessments(timestamptz, int, uuid[]) from public, anon, authenticated;
grant execute on function public.due_reassessments(timestamptz, int, uuid[]) to service_role;
