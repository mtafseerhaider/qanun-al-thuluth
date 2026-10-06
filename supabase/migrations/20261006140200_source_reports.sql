-- supabase/migrations/20261006140200_source_reports.sql
-- 05 ref: none (addition, 01 FR-ISL-10, 13 sections 6 and 9 "Report an issue"). Sprint 6: S6-14 (DB side).
-- Neither 05 nor 06 defines a table or endpoint for report-a-source, so this is an addition:
--   * public.source_reports: a signed-in user flags one citation (an Islamic source, a scientific evidence row or a
--     recommendation) with a reason and an optional note. Users insert and read their own reports; admins and content
--     roles triage (status, resolution). One open report per user and target ("independent reports").
--   * FR-ISL-10 threshold: when a verified Islamic source has open reports from 3 distinct users, a trigger opens a new
--     verification round (source_verifications action 'correct', reviewer 'system'), which the 0019a sync turns into
--     verification_status 'in_review' (hidden from users until re-approved by two reviewers). Every report writes
--     audit_log (attach_audit 'full'); admins are notified by the admin console reading the queue view.
--   * public.v_source_report_queue: the admin queue (one row per target with open counts), security invoker, so only
--     admins and content roles see rows (it also filters on has_content_role, so a reporter does not see a
--     summary of their own reports through it).

create table public.source_reports (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid references public.users(id) on delete set null default auth.uid(),
  islamic_source_id       uuid references public.islamic_sources(id) on delete cascade,
  scientific_evidence_id  uuid references public.scientific_evidence(id) on delete cascade,
  recommendation_id       uuid references public.recommendations(id) on delete cascade,
  reason                  text not null check (reason in ('wrong_citation','wrong_translation','wrong_grade',
                                                          'tradition_label','offensive','other')),
  note                    text check (char_length(note) <= 1000),
  status                  text not null default 'open' check (status in ('open','triaged','resolved','dismissed')),
  resolved_at             timestamptz,
  resolved_by             uuid references public.users(id) on delete set null,
  resolution_note         text check (char_length(resolution_note) <= 2000),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  check (num_nonnulls(islamic_source_id, scientific_evidence_id, recommendation_id) = 1),
  check (status not in ('resolved','dismissed') or resolved_at is not null)
);
create unique index source_reports_one_open_per_user on public.source_reports
  (user_id, coalesce(islamic_source_id, scientific_evidence_id, recommendation_id))
  where status in ('open','triaged') and user_id is not null;
create index source_reports_queue_idx on public.source_reports (status, created_at) where status in ('open','triaged');
create index source_reports_source_idx on public.source_reports (islamic_source_id) where islamic_source_id is not null;
create index source_reports_evidence_idx on public.source_reports (scientific_evidence_id) where scientific_evidence_id is not null;
create index source_reports_rec_idx on public.source_reports (recommendation_id) where recommendation_id is not null;
create index source_reports_user_idx on public.source_reports (user_id) where user_id is not null;               -- FK index
create index source_reports_resolved_by_idx on public.source_reports (resolved_by) where resolved_by is not null; -- FK index
call private.attach_updated_at('public.source_reports');
call private.attach_audit('public.source_reports', 'full');

-- Threshold: 3 distinct open reporters on a verified source re-open review ----------------------------------------------------
create or replace function private.source_report_threshold()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.islamic_source_id is null then
    return null;
  end if;
  if (select count(distinct r.user_id) from public.source_reports r
       where r.islamic_source_id = new.islamic_source_id and r.status in ('open','triaged') and r.user_id is not null) >= 3
     and exists (select 1 from public.islamic_sources s
                  where s.id = new.islamic_source_id and s.verification_status = 'verified') then
    insert into public.source_verifications
      (islamic_source_id, status, action, reviewer_name, reviewer_credentials, method, notes)
    values (new.islamic_source_id, 'in_review', 'correct', 'system', 'automatic re-review after user reports',
            'automatic', 'Three independent user reports (FR-ISL-10)');
  end if;
  return null;
end $$;
create trigger trg_source_reports_threshold after insert on public.source_reports
  for each row execute function private.source_report_threshold();

-- RLS ------------------------------------------------------------------------------------------------------------------------
alter table public.source_reports enable row level security;
create policy source_reports_select_own on public.source_reports for select to authenticated
  using (user_id = auth.uid());
create policy source_reports_insert_own on public.source_reports for insert to authenticated
  with check (user_id = auth.uid() and status = 'open');
create policy source_reports_select_content on public.source_reports for select to authenticated
  using (public.has_content_role('content_editor','scholar_reviewer','nutrition_reviewer','content_admin'));
create policy source_reports_triage_content on public.source_reports for update to authenticated
  using (public.has_content_role('content_editor','content_admin'))
  with check (public.has_content_role('content_editor','content_admin'));
revoke insert, update, delete on public.source_reports from authenticated;
grant insert (id, user_id, islamic_source_id, scientific_evidence_id, recommendation_id, reason, note)
  on public.source_reports to authenticated;
grant update (status, resolved_at, resolved_by, resolution_note) on public.source_reports to authenticated;

-- Admin queue view -------------------------------------------------------------------------------------------------------------
create view public.v_source_report_queue with (security_invoker = true) as
select coalesce(r.islamic_source_id, r.scientific_evidence_id, r.recommendation_id) as target_id,
       case when r.islamic_source_id is not null then 'islamic_source'
            when r.scientific_evidence_id is not null then 'scientific_evidence'
            else 'recommendation' end                                   as target_kind,
       coalesce(s.code, e.code, rec.code)                                as target_code,
       s.verification_status                                             as source_status,
       count(*)                                                          as open_reports,
       count(distinct r.user_id)                                         as distinct_reporters,
       array_agg(distinct r.reason order by r.reason)                    as reasons,
       min(r.created_at)                                                 as first_reported_at,
       max(r.created_at)                                                 as last_reported_at
from public.source_reports r
left join public.islamic_sources s on s.id = r.islamic_source_id
left join public.scientific_evidence e on e.id = r.scientific_evidence_id
left join public.recommendations rec on rec.id = r.recommendation_id
where r.status in ('open','triaged')
  and public.has_content_role('content_editor','scholar_reviewer','nutrition_reviewer','content_admin')
group by 1, 2, 3, 4;
revoke all on public.v_source_report_queue from anon;
grant select on public.v_source_report_queue to authenticated, service_role;
