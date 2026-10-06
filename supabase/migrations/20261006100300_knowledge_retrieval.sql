-- supabase/migrations/20261006100300_knowledge_retrieval.sql
-- 05 ref: 0019 Islamic knowledge extras, part 0019b (Sprint 2: S2-12, S2-13). Contents:
--   * HNSW index on islamic_sources.embedding (05 section 9.4, deferred from S1-20).
--   * search_islamic_sources() verbatim from 05 section 22.5 (hybrid semantic + lexical, RRF).
--   * Addition: recommendations.embedding vector(1536) + HNSW index (24-sprint-plan S2-12 embeds
--     verified recommendations as well as sources; 05 has no column for it).
--   * Addition: embeddings are cleared when the embedded text changes (13 section 9.3), so
--     `knowledge:embed` re-embeds them and a stale vector is never matched.
--   * Addition: match_knowledge(), the S2-12 name. Semantic-only match over citable sources AND
--     verified recommendations with a tradition filter. search_islamic_sources() stays the
--     agent's hybrid tool over sources (05 maps match_knowledge to it; both exist so the 05
--     contract and the sprint-plan contract hold).
--   * Addition: FR-ISL-05 guard private.enforce_evidence_strength on recommendation_evidence (weak
--     or ungraded-Shia sources may only be `context`; mawdu is never linked).
--   * Addition: recommendation completeness check (FR-ISL-01, S2-13): public.recommendation_completeness()
--     lists gaps for content roles; cron job `recommendation-completeness` sends published
--     recommendations with a blocking gap back to in_review nightly.

-- 9.4 HNSW indexes -------------------------------------------------------------------------------------
create index islamic_sources_embedding_hnsw on public.islamic_sources
  using hnsw (embedding extensions.vector_cosine_ops) with (m = 16, ef_construction = 64);

alter table public.recommendations add column embedding extensions.vector(1536);
create index recommendations_embedding_hnsw on public.recommendations
  using hnsw (embedding extensions.vector_cosine_ops) with (m = 16, ef_construction = 64);

-- Embedding invalidation (13 section 9.3) ---------------------------------------------------------------
-- A write that changes the embedded text and does not also supply a new vector clears the old one.
create or replace function private.clear_stale_embedding()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.embedding::text is not distinct from old.embedding::text then   -- vector has no = under an empty search_path
    new.embedding := null;
  end if;
  return new;
end $$;
create trigger trg_islamic_sources_clear_embedding
  before update of citation_text, topic_tags on public.islamic_sources
  for each row when (new.citation_text is distinct from old.citation_text or new.topic_tags is distinct from old.topic_tags)
  execute function private.clear_stale_embedding();
create trigger trg_recommendations_clear_embedding
  before update of title_i18n, practical_text_i18n, applies_to on public.recommendations
  for each row when (new.title_i18n is distinct from old.title_i18n
                     or new.practical_text_i18n is distinct from old.practical_text_i18n
                     or new.applies_to is distinct from old.applies_to)
  execute function private.clear_stale_embedding();

-- The English translation is part of the embedded text, so a translation edit on the referenced row
-- clears the source's vector too (the edit also opens a re-review round, 0019a).
create or replace function private.clear_source_embedding_on_ref_edit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_kind public.source_kind := case tg_table_name
    when 'quran_references' then 'quran' when 'hadith_references' then 'hadith'
    when 'scholarly_notes' then 'scholarly' else 'imam_narration' end;
begin
  perform set_config('app.verification_sync', 'on', true);   -- validate_islamic_source: status untouched
  update public.islamic_sources s set embedding = null
   where s.kind = v_kind and s.ref_id = new.id and s.embedding is not null;
  perform set_config('app.verification_sync', 'off', true);
  return null;
end $$;
create trigger trg_quran_references_clear_embedding after update of translation_i18n on public.quran_references
  for each row when (new.translation_i18n is distinct from old.translation_i18n)
  execute function private.clear_source_embedding_on_ref_edit();
create trigger trg_hadith_references_clear_embedding after update of translation_i18n on public.hadith_references
  for each row when (new.translation_i18n is distinct from old.translation_i18n)
  execute function private.clear_source_embedding_on_ref_edit();
create trigger trg_imam_narrations_clear_embedding after update of translation_i18n on public.imam_narrations
  for each row when (new.translation_i18n is distinct from old.translation_i18n)
  execute function private.clear_source_embedding_on_ref_edit();
create trigger trg_scholarly_notes_clear_embedding after update of title_i18n, body_i18n on public.scholarly_notes
  for each row when (new.title_i18n is distinct from old.title_i18n or new.body_i18n is distinct from old.body_i18n)
  execute function private.clear_source_embedding_on_ref_edit();

-- 19.5 search_islamic_sources (05 section 22.5, verbatim) ---------------------------------------------
-- Hybrid semantic + lexical retrieval with reciprocal rank fusion (12 section 9). Invoker rights: RLS applies.
create or replace function public.search_islamic_sources(
  p_query_embedding  extensions.vector(1536),
  p_query_text       text,
  p_traditions       public.source_tradition[],
  p_kinds            public.source_kind[] default null,
  p_limit            integer default 8
) returns table (islamic_source_id uuid, code text, kind public.source_kind, tradition public.source_tradition,
                 citation_text text, score double precision)
language sql
stable
security invoker
set search_path = ''
as $$
  with sem as (
    select s.id, row_number() over (order by s.embedding operator(extensions.<=>) p_query_embedding) as r
    from public.citable_islamic_sources s
    where s.tradition = any (p_traditions) and (p_kinds is null or s.kind = any (p_kinds))
    order by s.embedding operator(extensions.<=>) p_query_embedding
    limit 40
  ),
  lex as (
    select s.id, row_number() over (order by ts_rank_cd(s.search_tsv, q) desc) as r
    from public.citable_islamic_sources s, websearch_to_tsquery('simple'::regconfig, coalesce(p_query_text, '')) q
    where s.search_tsv @@ q
      and s.tradition = any (p_traditions) and (p_kinds is null or s.kind = any (p_kinds))
    limit 40
  ),
  fused as (
    select u.id, sum(1.0 / (60 + u.r))::double precision as score
    from (select * from sem union all select * from lex) u
    group by u.id
  )
  select s.id, s.code, s.kind, s.tradition, s.citation_text, f.score
  from fused f join public.citable_islamic_sources s on s.id = f.id
  order by f.score desc
  limit p_limit;
$$;
revoke all on function public.search_islamic_sources(extensions.vector, text, public.source_tradition[], public.source_kind[], integer) from public, anon;
grant execute on function public.search_islamic_sources(extensions.vector, text, public.source_tradition[], public.source_kind[], integer) to authenticated, service_role;

-- Addition: match_knowledge (S2-12) --------------------------------------------------------------------
-- Cosine match over (a) citable_islamic_sources (verified, two approvals, not retracted, embedded) whose
-- tradition is in p_traditions, and (b) verified, embedded recommendations whose tradition_scope overlaps
-- p_traditions. p_traditions is derived from users.tradition_preference by the caller (12 section 4.2):
-- shared -> {shared}; sunni -> {shared,sunni}; shia -> {shared,shia}. Overlap follows 13 section 7.2
-- item 4: the publishing gate only lets 'shared' into tradition_scope when a citable shared source is
-- linked, and such a recommendation reaches every user through that source; a {sunni}-only scope
-- reaches callers whose traditions include sunni and nobody else.
-- p_item_kinds: null = both, or any of {'source','recommendation'}. Invoker rights: RLS also applies.
create or replace function public.match_knowledge(
  p_query_embedding  extensions.vector(1536),
  p_traditions       public.source_tradition[],
  p_match_count      integer default 8,
  p_item_kinds       text[] default null
) returns table (item_kind text, item_id uuid, code text, traditions public.source_tradition[], label text,
                 similarity double precision)
language sql
stable
security invoker
set search_path = ''
as $$
  with lim as (select least(greatest(coalesce(p_match_count, 8), 1), 50) as n),
  src as (
    select 'source'::text as item_kind, s.id as item_id, s.code, array[s.tradition] as traditions,
           s.citation_text as label,
           1 - (s.embedding operator(extensions.<=>) p_query_embedding) as similarity
    from public.citable_islamic_sources s
    where (p_item_kinds is null or 'source' = any (p_item_kinds))
      and s.tradition = any (p_traditions)
    order by s.embedding operator(extensions.<=>) p_query_embedding
    limit (select n from lim)
  ),
  rec as (
    select 'recommendation'::text, r.id, r.code, r.tradition_scope,
           coalesce(r.title_i18n ->> 'en', r.code),
           1 - (r.embedding operator(extensions.<=>) p_query_embedding)
    from public.recommendations r
    where (p_item_kinds is null or 'recommendation' = any (p_item_kinds))
      and r.review_status = 'verified'
      and r.embedding is not null
      and r.tradition_scope && p_traditions
    order by r.embedding operator(extensions.<=>) p_query_embedding
    limit (select n from lim)
  )
  select u.item_kind, u.item_id, u.code, u.traditions, u.label, u.similarity::double precision
  from (select * from src union all select * from rec) u
  order by u.similarity desc
  limit (select n from lim);
$$;
revoke all on function public.match_knowledge(extensions.vector, public.source_tradition[], integer, text[]) from public, anon;
grant execute on function public.match_knowledge(extensions.vector, public.source_tradition[], integer, text[]) to authenticated, service_role;

-- Addition: FR-ISL-05 evidence strength guard ------------------------------------------------------------
-- 13 section 2 principle 2 and section 3.3: daif / daif_shia may only be `context`, mawdu is never
-- linked, and ungraded Shia narrations are `context` only.
create or replace function private.enforce_evidence_strength()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_kind public.source_kind; v_grade public.evidence_grade_hadith;
begin
  if new.islamic_source_id is null then
    return new;
  end if;
  select s.kind, coalesce(h.grade, n.grade) into v_kind, v_grade
    from public.islamic_sources s
    left join public.hadith_references h on s.kind = 'hadith' and h.id = s.ref_id
    left join public.imam_narrations n on s.kind = 'imam_narration' and n.id = s.ref_id
   where s.id = new.islamic_source_id;
  if v_grade = 'mawdu' then
    raise exception 'WEAK_SOURCE_NOT_ALLOWED' using errcode = '23514', detail = 'mawdu';
  end if;
  if new.relationship = 'supports'
     and (v_grade in ('daif','daif_shia') or (v_kind = 'imam_narration' and v_grade = 'ungraded')) then
    raise exception 'WEAK_SOURCE_NOT_ALLOWED' using errcode = '23514', detail = v_grade::text,
      hint = 'link weak or ungraded narrations as context only';
  end if;
  return new;
end $$;
create trigger trg_recommendation_evidence_strength
  before insert or update of islamic_source_id, relationship on public.recommendation_evidence
  for each row execute function private.enforce_evidence_strength();

-- Addition: recommendation completeness check (FR-ISL-01, S2-13) ----------------------------------------
-- One row per gap. `blocking` gaps would fail the publishing gate (0019a) today; non-blocking rows are
-- editorial warnings. Content roles see every recommendation; other callers with a user JWT see nothing.
-- Service role and cron (no JWT) see everything.
create or replace function public.recommendation_completeness()
returns table (recommendation_id uuid, code text, review_status public.verification_status, issue text, blocking boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with r as (
    select r.* from public.recommendations r
    where auth.uid() is null
       or public.has_content_role('content_editor','scholar_reviewer','nutrition_reviewer','content_admin')
  ),
  links as (
    select re.recommendation_id, re.relationship, s.id as source_id, s.tradition,
           (s.verification_status = 'verified' and s.approvals_count >= 2 and s.retracted_at is null) as citable
    from public.recommendation_evidence re
    join public.islamic_sources s on s.id = re.islamic_source_id
  ),
  issues as (
    select r.id, 'missing_practical_text_en'::text as issue, true as blocking
      from r where coalesce(r.practical_text_i18n ->> 'en', '') = ''
    union all
    select r.id, 'missing_practical_text_ur', true
      from r where coalesce(r.practical_text_i18n ->> 'ur', '') = ''
    union all
    select r.id, 'missing_scientific_evidence', true
      from r where not exists (select 1 from public.recommendation_evidence re
                               join public.scientific_evidence e on e.id = re.scientific_evidence_id
                               where re.recommendation_id = r.id and e.retracted_at is null)
    union all
    select r.id, 'linked_scientific_evidence_retracted', false
      from r where exists (select 1 from public.recommendation_evidence re
                           join public.scientific_evidence e on e.id = re.scientific_evidence_id
                           where re.recommendation_id = r.id and e.retracted_at is not null)
    union all
    select r.id, 'missing_islamic_source', true
      from r where not r.science_only
               and not exists (select 1 from links l where l.recommendation_id = r.id and l.relationship in ('supports','context'))
    union all
    select r.id, 'islamic_source_not_citable', true
      from r where not r.science_only
               and exists (select 1 from links l where l.recommendation_id = r.id and l.relationship in ('supports','context'))
               and not exists (select 1 from links l where l.recommendation_id = r.id
                               and l.relationship in ('supports','context') and l.citable)
    union all
    select r.id, 'tradition_gap:' || t::text, true
      from r cross join lateral unnest(r.tradition_scope) as t
     where not r.science_only
       and exists (select 1 from links l where l.recommendation_id = r.id and l.citable)
       and not exists (select 1 from links l where l.recommendation_id = r.id and l.citable
                       and l.relationship in ('supports','context') and (l.tradition = 'shared' or l.tradition = t))
    union all
    select r.id, 'linked_source_not_citable', false
      from r where exists (select 1 from links l where l.recommendation_id = r.id and not l.citable)
  )
  select r.id, r.code, r.review_status, i.issue, i.blocking
  from issues i join r on r.id = i.id
  order by r.code, i.blocking desc, i.issue;
$$;
revoke all on function public.recommendation_completeness() from public, anon;
grant execute on function public.recommendation_completeness() to authenticated, service_role;

-- Nightly job: a published recommendation that has lost what the gate requires (retracted evidence or
-- source, edited translation) goes back to in_review. Returns the number demoted.
create or replace function private.demote_incomplete_recommendations()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  update public.recommendations r set review_status = 'in_review'
   where r.review_status = 'verified'
     and exists (select 1 from public.recommendation_completeness() c
                 where c.recommendation_id = r.id and c.blocking);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

select cron.schedule('recommendation-completeness', '15 20 * * *',          -- 01:15 PKT
  $$select private.demote_incomplete_recommendations()$$);
