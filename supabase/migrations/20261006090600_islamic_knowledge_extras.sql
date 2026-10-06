-- supabase/migrations/20261006090600_islamic_knowledge_extras.sql
-- 05 ref: 0019 Islamic knowledge extras, part 0019a (Sprint 1, with S1-20). Verbatim from 05
--         section 22.5 (19.1 to 19.4, the views of 19.5, 19.6), except:
--   * search_islamic_sources() is 0019b (S2-12) and is not created here.
--   * private.sync_source_verification picks the triggering row as the latest action (see comment there).
--   * Addition: view islamic_sources_public (24-sprint-plan S1-20, 01 FR-ISL-02). 05 maps that name to
--     citable_islamic_sources, which also requires an embedding; the public view is the read path for
--     the app before embeddings exist and exposes only citation columns of verified, twice-approved,
--     non-retracted sources.
-- No content is seeded (scholar review pending).

-- 19.1 Reviewers and staging tables -----------------------------------------------------------
create table public.scholar_reviewers (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid unique references public.users(id) on delete set null,   -- admin console account
  full_name            text not null,
  credentials          text not null,
  institution          text,
  traditions           public.source_tradition[] not null check (cardinality(traditions) >= 1),
  competencies         text[] not null default '{}',     -- 'quran','hadith_grading','rijal','arabic_translation','urdu_translation'
  languages            text[] not null default '{ar,en}',
  is_active            boolean not null default true,
  approved_by          uuid references public.users(id) on delete set null,
  agreement_signed_on  date,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Backs islamic_sources.kind = 'scholarly' (short scholarly notes, never fatwas)
create table public.scholarly_notes (
  id                  uuid primary key default gen_random_uuid(),
  title_i18n          jsonb not null check (title_i18n ? 'en'),
  body_i18n           jsonb not null check (body_i18n ? 'en'),
  author_name         text not null,
  author_credentials  text not null,
  tradition           public.source_tradition not null default 'shared',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Staging for Tanzil Arabic and licensed translations; quran_references copy from here
create table public.quran_text (
  id             uuid primary key default gen_random_uuid(),
  surah          smallint not null check (surah between 1 and 114),
  ayah           smallint not null check (ayah >= 1),
  edition        text not null,           -- 'tanzil-uthmani', 'en.khattab', 'ur.jalandhry', 'en.pickthall'
  text           text not null,
  source_sha256  text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (surah, ayah, edition)
);

call private.attach_updated_at('public.scholar_reviewers');
call private.attach_updated_at('public.scholarly_notes');
call private.attach_updated_at('public.quran_text');
call private.attach_audit('public.scholar_reviewers', 'full');

-- 19.2 Column additions on 0006 tables ----------------------------------------------------------
-- islamic_sources: stable citation code, approvals, retraction, lexical search. Migrations run before
-- seeds in every environment, so "not null" on code is safe here.
alter table public.islamic_sources
  add column code               text not null,
  add column approvals_count    smallint not null default 0 check (approvals_count >= 0),
  add column retracted_at       timestamptz,
  add column retraction_reason  text,
  add column search_tsv         tsvector generated always as (
      to_tsvector('simple'::regconfig, coalesce(code, '') || ' ' || coalesce(citation_text, ''))) stored;
alter table public.islamic_sources add constraint islamic_sources_code_key unique (code);
alter table public.islamic_sources add constraint islamic_sources_code_format
  check (code ~ '^(quran|hadith|imam|scholarly)\.[a-z0-9_.]+$');
-- scholarly sources now point at scholarly_notes, so every kind has a ref_id
alter table public.islamic_sources drop constraint islamic_sources_check;
alter table public.islamic_sources add constraint islamic_sources_ref_required check (ref_id is not null);
create index islamic_sources_tsv_idx on public.islamic_sources using gin (search_tsv);
create index islamic_sources_citable_idx on public.islamic_sources (tradition, kind)
  where verification_status = 'verified' and approvals_count >= 2 and retracted_at is null;

-- hadith_references.edition from 13 is the existing numbering_scheme column; only also_in is new
alter table public.hadith_references
  add column also_in jsonb not null default '[]'::jsonb check (jsonb_typeof(also_in) = 'array');
alter table public.imam_narrations
  add column edition  text,
  add column chapter  text,
  add column also_in  jsonb not null default '[]'::jsonb check (jsonb_typeof(also_in) = 'array');

alter table public.source_verifications
  add column reviewer_id  uuid references public.scholar_reviewers(id) on delete restrict,
  add column round        smallint not null default 1 check (round >= 1),
  add column action       text check (action in ('claim','approve','reject','request_changes','correct','retract','reinstate')),
  add column checklist    jsonb not null default '{}'::jsonb check (jsonb_typeof(checklist) = 'object');
-- 13 records several methods comma-separated; accept both vocabularies
alter table public.source_verifications drop constraint source_verifications_method_check;
alter table public.source_verifications add constraint source_verifications_method_check
  check (string_to_array(method, ',') <@ array[
    'primary_text_check','takhrij','scholar_panel','cross_reference',
    'checked_against_printed_edition','checked_against_digital_corpus',
    'grading_confirmed_from_cited_authority','translation_reviewed','needs_verification','automatic']);
create index source_verifications_round_idx on public.source_verifications (islamic_source_id, round, action);
create index source_verifications_reviewer_idx on public.source_verifications (reviewer_id) where reviewer_id is not null;

alter table public.scientific_evidence
  add column code          text not null,
  add column reviewed_by   text,
  add column reviewed_on   date,
  add column summary_i18n  jsonb not null default '{}'::jsonb,
  add column retracted_at  timestamptz;
alter table public.scientific_evidence add constraint scientific_evidence_code_key unique (code);
alter table public.scientific_evidence add constraint scientific_evidence_code_format check (code ~ '^sci\.[a-z0-9_.]+$');

alter table public.recommendations
  add column version          integer not null default 1 check (version >= 1),
  add column tradition_scope  public.source_tradition[] not null default '{shared,sunni,shia}'
                                check (cardinality(tradition_scope) >= 1),
  add column science_only     boolean not null default false;   -- pure nutrition guidance, no Islamic claim (00 section 11)

-- 19.3 Integrity triggers (replace 0012 bodies) --------------------------------------------------
create or replace function private.validate_islamic_source()
returns trigger language plpgsql set search_path = '' as $$
declare v_trad public.source_tradition;
begin
  if new.kind = 'quran' then
    if not exists (select 1 from public.quran_references where id = new.ref_id) then
      raise exception 'ISLAMIC_SOURCE_REF_INVALID' using errcode = '23503';
    end if;
    new.tradition := 'shared';
  elsif new.kind = 'hadith' then
    select tradition into v_trad from public.hadith_references where id = new.ref_id;
    if v_trad is null then raise exception 'ISLAMIC_SOURCE_REF_INVALID' using errcode = '23503'; end if;
    new.tradition := v_trad;
  elsif new.kind = 'imam_narration' then
    if not exists (select 1 from public.imam_narrations where id = new.ref_id) then
      raise exception 'ISLAMIC_SOURCE_REF_INVALID' using errcode = '23503';
    end if;
    new.tradition := 'shia';
  elsif new.kind = 'scholarly' then
    select tradition into v_trad from public.scholarly_notes where id = new.ref_id;
    if v_trad is null then raise exception 'ISLAMIC_SOURCE_REF_INVALID' using errcode = '23503'; end if;
    new.tradition := v_trad;
  end if;

  if coalesce(current_setting('app.verification_sync', true), '') <> 'on' then
    if tg_op = 'INSERT' then
      new.verification_status := 'unverified';
      new.approvals_count := 0;
    elsif new.verification_status is distinct from old.verification_status
       or new.approvals_count is distinct from old.approvals_count then
      raise exception 'VERIFICATION_STATUS_MANAGED' using errcode = '42501',
        hint = 'insert a source_verifications row instead';
    end if;
  end if;
  return new;
end $$;

-- Rounds are managed by the database: 'correct' and 'reinstate' open a new round, everything else
-- is recorded against the current round.
create or replace function private.source_verification_round()
returns trigger language plpgsql set search_path = '' as $$
declare v_round smallint;
begin
  select max(v.round) into v_round from public.source_verifications v where v.islamic_source_id = new.islamic_source_id;
  new.round := case when new.action in ('correct','reinstate') then coalesce(v_round, 0) + 1
                    else coalesce(v_round, 1) end;
  return new;
end $$;
create trigger trg_source_verifications_round before insert on public.source_verifications
  for each row execute function private.source_verification_round();

-- source_verifications_apply (13 section 3.5) replaces the "latest row wins" rule from 0012:
-- verified needs two distinct approvals in the current round, at least one from an active reviewer
-- whose traditions include the source's tradition (any reviewer counts for 'shared'); any reject in
-- the round means rejected; retract sets retracted_at and sends linked recommendations back to review.
create or replace function private.sync_source_verification()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_source     uuid := coalesce(new.islamic_source_id, old.islamic_source_id);
  v_trad       public.source_tradition;
  v_round      smallint;
  v_last       public.source_verifications;
  v_has_rows   boolean;
  v_approvals  smallint;
  v_qualified  boolean;
  v_rejected   boolean;
  v_status     public.verification_status;
begin
  select s.tradition into v_trad from public.islamic_sources s where s.id = v_source;
  if not found then
    return null;                                         -- source itself is being deleted
  end if;

  -- Deviation from 05: rows written in one transaction share created_at, so "latest" falls back to a
  -- random uuid order. The row that fired an INSERT is by definition the latest action; ties otherwise
  -- break on round.
  select v.* into v_last from public.source_verifications v
   where v.islamic_source_id = v_source
   order by (tg_op = 'INSERT' and v.id = new.id) desc, v.round desc, v.created_at desc, v.id desc limit 1;
  v_has_rows := found;
  v_round := coalesce(v_last.round, 1);

  select count(distinct coalesce(v.reviewer_id::text, lower(v.reviewer_name)))::smallint,
         coalesce(bool_or(v_trad = 'shared' or (r.is_active and v_trad = any (r.traditions))), false)
    into v_approvals, v_qualified
    from public.source_verifications v
    left join public.scholar_reviewers r on r.id = v.reviewer_id
   where v.islamic_source_id = v_source and v.round = v_round
     and coalesce(v.action, case when v.status = 'verified' then 'approve' end) = 'approve';

  select exists (select 1 from public.source_verifications v
                  where v.islamic_source_id = v_source and v.round = v_round
                    and coalesce(v.action, case when v.status = 'rejected' then 'reject' end) = 'reject')
    into v_rejected;

  v_status := case
    when not v_has_rows                         then 'unverified'
    when v_rejected                             then 'rejected'
    when v_approvals >= 2 and v_qualified       then 'verified'
    when v_approvals = 0 and v_last.status = 'unverified' then 'unverified'
    else 'in_review' end;

  perform set_config('app.verification_sync', 'on', true);
  update public.islamic_sources s
     set verification_status = v_status,
         approvals_count     = v_approvals,
         retracted_at        = case when v_last.action = 'retract' then coalesce(s.retracted_at, now())
                                    when v_last.action = 'reinstate' then null
                                    else s.retracted_at end,
         retraction_reason   = case when v_last.action = 'retract' then coalesce(v_last.notes, s.retraction_reason)
                                    when v_last.action = 'reinstate' then null
                                    else s.retraction_reason end
   where s.id = v_source;
  perform set_config('app.verification_sync', 'off', true);

  if v_last.action = 'retract' then
    update public.recommendations r set review_status = 'in_review'
     where r.review_status = 'verified'
       and exists (select 1 from public.recommendation_evidence re
                    where re.recommendation_id = r.id and re.islamic_source_id = v_source);
  end if;
  return null;
end $$;

-- Content edits to a verified source open a new 'correct' round (approvals reset), per 13 section 8.4.
create or replace function private.reset_verification_on_edit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_kind public.source_kind := case tg_table_name
    when 'quran_references' then 'quran' when 'hadith_references' then 'hadith'
    when 'scholarly_notes' then 'scholarly' else 'imam_narration' end;
begin
  insert into public.source_verifications
    (islamic_source_id, status, action, reviewer_name, reviewer_credentials, method, notes)
  select s.id, 'in_review', 'correct', 'system', 'automatic re-review after content edit', 'automatic',
         'Content of ' || tg_table_name || ' changed'
    from public.islamic_sources s
   where s.kind = v_kind and s.ref_id = new.id and s.verification_status in ('verified','in_review');
  return null;
end $$;
create trigger trg_scholarly_notes_reverify after update of title_i18n, body_i18n, author_name on public.scholarly_notes
  for each row execute function private.reset_verification_on_edit();

-- 19.4 Publishing gate (replaces the 0012 body; 00-foundations section 11 and 13 section 3.8) ------
-- Always: en and ur practical text, and at least one non-retracted scientific evidence link.
-- Unless science_only: at least one citable Islamic source (verified, two approvals, not retracted)
-- linked as supports/context, and every tradition in tradition_scope covered (a shared source covers all).
create or replace function private.enforce_recommendation_publish()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_gaps public.source_tradition[];
begin
  if coalesce(new.practical_text_i18n ->> 'en', '') = '' or coalesce(new.practical_text_i18n ->> 'ur', '') = '' then
    raise exception 'RECOMMENDATION_MISSING_PRACTICAL_TEXT' using errcode = '23514';
  end if;
  if not exists (select 1 from public.recommendation_evidence re
                 join public.scientific_evidence e on e.id = re.scientific_evidence_id
                 where re.recommendation_id = new.id and e.retracted_at is null) then
    raise exception 'RECOMMENDATION_MISSING_SCIENTIFIC_EVIDENCE' using errcode = '23514';
  end if;
  if new.science_only then
    return new;
  end if;
  if not exists (select 1 from public.recommendation_evidence re
                 join public.islamic_sources s on s.id = re.islamic_source_id
                 where re.recommendation_id = new.id and re.relationship in ('supports','context')
                   and s.verification_status = 'verified' and s.approvals_count >= 2 and s.retracted_at is null) then
    raise exception 'RECOMMENDATION_MISSING_VERIFIED_ISLAMIC_SOURCE' using errcode = '23514';
  end if;
  select array_agg(t) into v_gaps
    from unnest(new.tradition_scope) as t
   where not exists (select 1 from public.recommendation_evidence re
                     join public.islamic_sources s on s.id = re.islamic_source_id
                     where re.recommendation_id = new.id and re.relationship in ('supports','context')
                       and s.verification_status = 'verified' and s.approvals_count >= 2 and s.retracted_at is null
                       and (s.tradition = 'shared' or s.tradition = t));
  if v_gaps is not null then
    raise exception 'RECOMMENDATION_TRADITION_GAP' using errcode = '23514', detail = v_gaps::text;
  end if;
  return new;
end $$;
drop trigger trg_recommendations_publish on public.recommendations;
create trigger trg_recommendations_publish
  before insert or update of review_status, science_only, tradition_scope on public.recommendations
  for each row when (new.review_status = 'verified')
  execute function private.enforce_recommendation_publish();

-- 19.5 Views and retrieval ------------------------------------------------------------------------
create view public.citable_islamic_sources with (security_invoker = true) as
select s.*
from public.islamic_sources s
where s.verification_status = 'verified'
  and s.approvals_count >= 2
  and s.retracted_at is null
  and s.embedding is not null;
grant select on public.citable_islamic_sources to authenticated;

-- Weekly content-operations view (13 section 8.6). Content roles only.
create view public.v_knowledge_status with (security_invoker = true) as
select 'source'::text                   as item,
       s.tradition::text                as tradition,
       s.verification_status::text      as status,
       count(*)                         as n,
       count(*) filter (where s.retracted_at >= now() - interval '90 days') as retracted_90d,
       percentile_cont(0.5) within group (order by extract(epoch from now() - s.updated_at) / 86400.0)
         filter (where s.verification_status = 'in_review')               as median_days_in_review
from public.islamic_sources s
where public.has_content_role('content_editor','scholar_reviewer','nutrition_reviewer','content_admin')
group by s.tradition, s.verification_status
union all
select 'recommendation', t::text, r.review_status::text, count(*), 0, null
from public.recommendations r cross join lateral unnest(r.tradition_scope) as t
where public.has_content_role('content_editor','scholar_reviewer','nutrition_reviewer','content_admin')
group by t, r.review_status;
grant select on public.v_knowledge_status to authenticated;

-- 19.6 RLS ---------------------------------------------------------------------------------------
alter table public.scholar_reviewers enable row level security;
create policy scholar_reviewers_select on public.scholar_reviewers for select to authenticated
  using (user_id = auth.uid() or public.has_content_role('content_admin'));
create policy scholar_reviewers_write_content_admin on public.scholar_reviewers for all to authenticated
  using (public.has_content_role('content_admin')) with check (public.has_content_role('content_admin'));

alter table public.scholarly_notes enable row level security;
create policy scholarly_notes_select on public.scholarly_notes for select to authenticated
  using (public.has_content_role('content_editor','scholar_reviewer','nutrition_reviewer','content_admin')
         or exists (select 1 from public.islamic_sources s
                    where s.kind = 'scholarly' and s.ref_id = scholarly_notes.id));   -- inherits the verified filter

alter table public.quran_text enable row level security;
create policy quran_text_select_content on public.quran_text for select to authenticated
  using (public.has_content_role('content_editor','scholar_reviewer','content_admin'));
create policy quran_text_write_admin on public.quran_text for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Content roles on the knowledge tables, added next to the admin-only policies from 0013.
do $$
declare t text;
begin
  foreach t in array array['quran_references','hadith_references','imam_narrations','islamic_sources',
                           'foods_in_narrations','recommendation_evidence','scholarly_notes','scientific_evidence']
  loop
    execute format('create policy %I on public.%I for select to authenticated using (public.has_content_role(%L,%L,%L,%L))',
                   t || '_select_content', t, 'content_editor', 'scholar_reviewer', 'nutrition_reviewer', 'content_admin');
    execute format('create policy %I on public.%I for insert to authenticated with check (public.has_content_role(%L,%L))',
                   t || '_insert_editor', t, 'content_editor', 'content_admin');
    execute format('create policy %I on public.%I for update to authenticated using (public.has_content_role(%L,%L)) with check (public.has_content_role(%L,%L))',
                   t || '_update_editor', t, 'content_editor', 'content_admin', 'content_editor', 'content_admin');
  end loop;
end $$;
create policy scientific_evidence_update_nutrition on public.scientific_evidence for update to authenticated
  using (public.has_content_role('nutrition_reviewer')) with check (public.has_content_role('nutrition_reviewer'));

create policy recommendations_select_content on public.recommendations for select to authenticated
  using (public.has_content_role('content_editor','scholar_reviewer','nutrition_reviewer','content_admin'));
create policy recommendations_insert_editor on public.recommendations for insert to authenticated
  with check (public.has_content_role('content_editor','content_admin') and review_status <> 'verified');
create policy recommendations_update_editor on public.recommendations for update to authenticated
  using (public.has_content_role('content_editor','content_admin'))
  with check (public.has_content_role('content_editor','content_admin')
              and (review_status <> 'verified' or public.has_content_role('content_admin')));   -- only content_admin publishes

create policy source_verifications_select_content on public.source_verifications for select to authenticated
  using (public.has_content_role('content_editor','scholar_reviewer','nutrition_reviewer','content_admin'));
create policy source_verifications_insert_reviewer on public.source_verifications for insert to authenticated
  with check (public.has_content_role('scholar_reviewer')
              and reviewer_id in (select r.id from public.scholar_reviewers r where r.user_id = auth.uid() and r.is_active));
create policy source_verifications_insert_editor on public.source_verifications for insert to authenticated
  with check ((public.has_content_role('content_editor','content_admin') and action in ('claim','request_changes'))
              or (public.has_content_role('content_admin') and action = 'retract'));

-- Addition: islamic_sources_public, the verified-only read path (S1-20). security_invoker so the caller's
-- RLS on islamic_sources still applies (defence in depth); the WHERE clause filters to sources whose
-- current verification round is approved (verification_status is denormalised from the latest
-- source_verifications rows by private.sync_source_verification), with two approvals and no retraction.
create view public.islamic_sources_public with (security_invoker = true) as
select s.id, s.code, s.kind, s.ref_id, s.tradition, s.citation_text, s.topic_tags, s.updated_at
from public.islamic_sources s
where s.verification_status = 'verified'
  and s.approvals_count >= 2
  and s.retracted_at is null;
revoke all on public.islamic_sources_public from anon;
grant select on public.islamic_sources_public to authenticated, service_role;
