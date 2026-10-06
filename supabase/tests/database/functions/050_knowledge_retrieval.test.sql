-- supabase/tests/database/functions/050_knowledge_retrieval.test.sql
-- S2-12 / S2-13: match_knowledge and search_islamic_sources only ever return citable sources (verified,
-- two approvals, not retracted, embedded) and verified, embedded recommendations, filtered by tradition;
-- the seeded content (all unverified) is never matchable, even with an embedding; embeddings are cleared
-- when the embedded text changes; the FR-ISL-05 evidence-strength guard; the completeness check and its
-- nightly cron job.
begin;
select plan(30);

-- unit vector e_i in 1536 dimensions
create function pg_temp.e(i int) returns extensions.vector language plpgsql as $$
declare a real[] := array_fill(0::real, array[1536]);
begin
  a[i] := 1;
  return a::extensions.vector;
end $$;

select tests.create_user('mk-user@test.thuluth.app')   as uid \gset
select tests.create_user('mk-editor@test.thuluth.app') as editor \gset

insert into public.scholar_reviewers (id, full_name, credentials, traditions)
values ('55555555-5555-4555-8555-0000000000a1', 'Reviewer One', 'Alim course', '{shared,sunni}'),
       ('55555555-5555-4555-8555-0000000000a2', 'Reviewer Two', 'Takhrij', '{shared,sunni}');

-- ---- seeded content is never matchable ----------------------------------------------------------------
update public.islamic_sources set embedding = pg_temp.e(1);
update public.recommendations set embedding = pg_temp.e(1);
select is((select count(*) from public.islamic_sources where verification_status = 'verified'), 0::bigint,
  'no seeded Islamic source is verified');
select is((select count(*) from public.match_knowledge(pg_temp.e(1), '{shared,sunni,shia}', 50)), 0::bigint,
  'embedded but unverified seed content is not matchable (even as postgres)');
select tests.authenticate_as(:'uid');
select is((select count(*) from public.match_knowledge(pg_temp.e(1), '{shared,sunni}', 50)), 0::bigint,
  'a user matches nothing from the unverified seed');
select is((select count(*) from public.search_islamic_sources(pg_temp.e(1), 'dates', '{shared,sunni}')), 0::bigint,
  'search_islamic_sources hides unverified seed sources');
select tests.clear_authentication();

-- ---- verify a shared source and a sunni source ------------------------------------------------------------
create function pg_temp.approve(p_code text) returns void language sql as $$
  insert into public.source_verifications (islamic_source_id, status, action, reviewer_id, reviewer_name, reviewer_credentials, method)
  select s.id, 'verified', 'approve', r.id, r.full_name, r.credentials, 'primary_text_check'
    from public.islamic_sources s, public.scholar_reviewers r
   where s.code = p_code and r.id in ('55555555-5555-4555-8555-0000000000a1', '55555555-5555-4555-8555-0000000000a2');
$$;
select pg_temp.approve('quran.7.31');
select pg_temp.approve('hadith.bukhari.5376');
update public.islamic_sources set embedding = pg_temp.e(2) where code = 'quran.7.31';
update public.islamic_sources set embedding = pg_temp.e(3) where code = 'hadith.bukhari.5376';

-- one approval only: in review, hidden
insert into public.source_verifications (islamic_source_id, status, action, reviewer_id, reviewer_name, reviewer_credentials, method)
select id, 'verified', 'approve', '55555555-5555-4555-8555-0000000000a1', 'Reviewer One', 'x', 'takhrij'
  from public.islamic_sources where code = 'hadith.muslim.2020';
update public.islamic_sources set embedding = pg_temp.e(4) where code = 'hadith.muslim.2020';
-- verified but not embedded: hidden
select pg_temp.approve('hadith.bukhari.5409');
update public.islamic_sources set embedding = null where code = 'hadith.bukhari.5409';

select results_eq($$select code, verification_status::text from public.islamic_sources
                    where code in ('quran.7.31','hadith.bukhari.5376','hadith.muslim.2020','hadith.bukhari.5409') order by code$$,
  $$values ('hadith.bukhari.5376','verified'), ('hadith.bukhari.5409','verified'), ('hadith.muslim.2020','in_review'), ('quran.7.31','verified')$$,
  'fixture sources reach the intended review states');

select tests.authenticate_as(:'uid');
select results_eq($$select code from public.match_knowledge(pg_temp.e(2), '{shared,sunni}', 50) order by code$$,
  $$values ('hadith.bukhari.5376'), ('quran.7.31')$$,
  'only verified, embedded sources are matched (in-review and unembedded are hidden)');
select is((select code from public.match_knowledge(pg_temp.e(3), '{shared,sunni}', 1)), 'hadith.bukhari.5376',
  'the nearest vector ranks first');
select ok((select similarity from public.match_knowledge(pg_temp.e(3), '{shared,sunni}', 1)) > 0.99,
  'similarity is 1 - cosine distance');
select results_eq($$select code from public.match_knowledge(pg_temp.e(3), '{shared,shia}', 50)$$,
  $$values ('quran.7.31')$$, 'a shia caller gets shared sources, never sunni ones');
select results_eq($$select code from public.match_knowledge(pg_temp.e(3), '{shared}', 50)$$,
  $$values ('quran.7.31')$$, 'a shared-only caller gets shared sources only');
select is((select count(*) from public.match_knowledge(pg_temp.e(3), '{shared,sunni}', 1)), 1::bigint,
  'p_match_count limits the result');
select is((select count(*) from public.match_knowledge(pg_temp.e(3), '{shared,sunni}', 50, '{recommendation}')), 0::bigint,
  'p_item_kinds filters out sources');
select results_eq($$select code from public.search_islamic_sources(pg_temp.e(3), 'meal', '{shared,sunni}') order by code$$,
  $$values ('hadith.bukhari.5376'), ('quran.7.31')$$,
  'search_islamic_sources returns the same citable set');
select tests.clear_authentication();

-- retraction hides a verified source
insert into public.source_verifications (islamic_source_id, status, action, reviewer_name, reviewer_credentials, method, notes)
select id, 'verified', 'retract', 'Content admin', 'x', 'scholar_panel', 'test' from public.islamic_sources where code = 'hadith.bukhari.5376';
select tests.authenticate_as(:'uid');
select results_eq($$select code from public.match_knowledge(pg_temp.e(3), '{shared,sunni}', 50)$$,
  $$values ('quran.7.31')$$, 'a retracted source is no longer matched');
select tests.clear_authentication();

-- ---- recommendations ---------------------------------------------------------------------------------------
-- a seeded recommendation published with its shared Qur'anic source (Urdu supplied for the test only)
update public.recommendations
   set practical_text_i18n = practical_text_i18n || '{"ur":"ٹیسٹ"}', tradition_scope = '{shared}'
 where code = 'rec.thuluth.core';
delete from public.recommendation_evidence re using public.recommendations r, public.islamic_sources s
 where re.recommendation_id = r.id and r.code = 'rec.thuluth.core' and re.islamic_source_id = s.id and s.code <> 'quran.7.31';
select lives_ok($$update public.recommendations set review_status = 'verified' where code = 'rec.thuluth.core'$$,
  'a recommendation with a citable source and science publishes');
select is((select embedding from public.recommendations where code = 'rec.thuluth.core'), null::extensions.vector,
  'the text edit cleared the recommendation embedding');
update public.recommendations set embedding = pg_temp.e(5) where code = 'rec.thuluth.core';

select tests.authenticate_as(:'uid');
select results_eq($$select item_kind, code from public.match_knowledge(pg_temp.e(5), '{shared,shia}', 1)$$,
  $$values ('recommendation', 'rec.thuluth.core')$$, 'a verified, embedded recommendation is matched');
select is((select count(*) from public.match_knowledge(pg_temp.e(5), '{shared,sunni}', 50) where item_kind = 'recommendation'),
  1::bigint, 'only the verified recommendation is matched; the 32 unverified seeded ones are not');
select tests.clear_authentication();

-- tradition scope: a {sunni}-only recommendation is not offered to a shia or shared caller
select lives_ok($$update public.recommendations set tradition_scope = '{sunni}' where code = 'rec.thuluth.core'$$,
  'a shared source covers a {sunni} scope at the publishing gate');
select tests.authenticate_as(:'uid');
select is((select count(*) from public.match_knowledge(pg_temp.e(5), '{shared,shia}', 50) where item_kind = 'recommendation'),
  0::bigint, 'a recommendation not scoped to the caller''s tradition is not matched');
select tests.clear_authentication();

-- ---- embedding invalidation ---------------------------------------------------------------------------------
update public.islamic_sources set citation_text = citation_text || ' (edited)' where code = 'quran.7.31';
select is((select embedding from public.islamic_sources where code = 'quran.7.31'), null::extensions.vector,
  'editing the citation clears the source embedding');
update public.islamic_sources set embedding = pg_temp.e(2) where code = 'quran.7.31';
update public.quran_references q set translation_i18n = translation_i18n || '{"en":"edited"}'
  from public.islamic_sources s where s.code = 'quran.7.31' and s.ref_id = q.id;
select is((select embedding from public.islamic_sources where code = 'quran.7.31'), null::extensions.vector,
  'editing the referenced translation clears the source embedding');

-- ---- FR-ISL-05 evidence strength -----------------------------------------------------------------------------
insert into public.hadith_references (id, collection, number, arabic_text, translation_i18n, grade)
values ('66666666-6666-4666-8666-0000000000d1', 'ibn_majah', '99991', '', '{"en":"test weak"}', 'daif'),
       ('66666666-6666-4666-8666-0000000000d2', 'ibn_majah', '99992', '', '{"en":"test fabricated"}', 'mawdu');
insert into public.islamic_sources (id, kind, ref_id, tradition, citation_text, code)
values ('77777777-7777-4777-8777-0000000000d1', 'hadith', '66666666-6666-4666-8666-0000000000d1', 'sunni', 'weak', 'hadith.test.weak'),
       ('77777777-7777-4777-8777-0000000000d2', 'hadith', '66666666-6666-4666-8666-0000000000d2', 'sunni', 'fabricated', 'hadith.test.fabricated');
select throws_ok($$insert into public.recommendation_evidence (recommendation_id, islamic_source_id, relationship)
                   select id, '77777777-7777-4777-8777-0000000000d1', 'supports' from public.recommendations where code = 'rec.thuluth.core'$$,
  '23514', 'WEAK_SOURCE_NOT_ALLOWED', 'a daif hadith cannot be linked as supports');
select lives_ok($$insert into public.recommendation_evidence (recommendation_id, islamic_source_id, relationship)
                  select id, '77777777-7777-4777-8777-0000000000d1', 'context' from public.recommendations where code = 'rec.thuluth.core'$$,
  'a daif hadith may be linked as context');
select throws_ok($$insert into public.recommendation_evidence (recommendation_id, islamic_source_id, relationship)
                   select id, '77777777-7777-4777-8777-0000000000d2', 'context' from public.recommendations where code = 'rec.thuluth.core'$$,
  '23514', 'WEAK_SOURCE_NOT_ALLOWED', 'a mawdu hadith is never linked');

-- ---- completeness check and nightly demotion --------------------------------------------------------------------
select ok(exists (select 1 from public.recommendation_completeness() where code = 'rec.etiquette.eat_together'
                    and issue = 'missing_practical_text_ur' and blocking),
  'completeness lists the missing Urdu text of a seeded recommendation');
select ok(exists (select 1 from public.recommendation_completeness() where code = 'rec.etiquette.eat_together'
                    and issue = 'islamic_source_not_citable'),
  'completeness lists an unverified source as not citable');
select tests.authenticate_as(:'uid');
select is((select count(*) from public.recommendation_completeness()), 0::bigint, 'ordinary users see no completeness rows');
select tests.clear_authentication();
-- quran.7.31 is back in review after the translation edit, so the published recommendation has a blocking gap
select is(private.demote_incomplete_recommendations(), 1, 'the nightly job demotes the recommendation that lost its source');
select is((select count(*) from cron.job where jobname = 'recommendation-completeness'), 1::bigint,
  'the recommendation-completeness cron job is scheduled');

select * from finish();
rollback;
