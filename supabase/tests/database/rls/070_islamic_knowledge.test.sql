-- supabase/tests/database/rls/070_islamic_knowledge.test.sql
-- Islamic knowledge (S1-20, 05 sections 9 and 22.5, 00-foundations 10.5, 05 section 21 item 7):
-- unverified or half-reviewed sources are invisible to users through the tables and through
-- islamic_sources_public; a source needs two approvals in the current round (one from a reviewer of
-- its tradition unless it is shared); edits and retractions hide it again; knowledge tables are not
-- writable by ordinary users; the recommendation publishing gate holds.
begin;
select plan(29);

select tests.create_user('isl-user@test.thuluth.app')   as uid \gset
select tests.create_user('isl-editor@test.thuluth.app') as editor \gset

insert into public.scholar_reviewers (id, full_name, credentials, traditions)
values ('55555555-5555-4555-8555-000000000001', 'Reviewer Sunni', 'Alim course, takhrij', '{sunni}'),
       ('55555555-5555-4555-8555-000000000002', 'Reviewer Shared', 'Hafiz, tafsir', '{shared,sunni}');

insert into public.quran_references (id, surah, ayah_start, ayah_end, arabic_text, translation_i18n, translator)
values ('66666666-6666-4666-8666-000000000001', 7, 31, 31, 'test arabic', '{"en":"Eat and drink, but do not be excessive."}', 'test');
insert into public.hadith_references (id, collection, number, arabic_text, translation_i18n, grade)
values ('66666666-6666-4666-8666-000000000002', 'tirmidhi', '2380', 'test arabic', '{"en":"test"}', 'sahih');

insert into public.islamic_sources (id, kind, ref_id, tradition, citation_text, code, verification_status)
values ('77777777-7777-4777-8777-000000000001', 'quran', '66666666-6666-4666-8666-000000000001', 'sunni', 'Qur''an 7:31', 'quran.7.31', 'verified'),
       ('77777777-7777-4777-8777-000000000002', 'hadith', '66666666-6666-4666-8666-000000000002', 'shared', 'Tirmidhi 2380', 'hadith.tirmidhi.2380', 'verified');

select results_eq($$select tradition::text, verification_status::text from public.islamic_sources order by code$$,
  $$values ('sunni','unverified'), ('shared','unverified')$$,
  'inserts are forced to unverified and the tradition is derived from the reference');

select tests.authenticate_as(:'uid');
select is((select count(*) from public.islamic_sources), 0::bigint, 'unverified sources are invisible in islamic_sources');
select is((select count(*) from public.islamic_sources_public), 0::bigint, 'unverified sources are invisible in islamic_sources_public');
select is((select count(*) from public.quran_references), 0::bigint, 'references of unverified sources are invisible');
select tests.clear_authentication();

-- one approval: in review, still hidden
insert into public.source_verifications (islamic_source_id, status, action, reviewer_id, reviewer_name, reviewer_credentials, method)
values ('77777777-7777-4777-8777-000000000001', 'verified', 'approve', '55555555-5555-4555-8555-000000000001', 'Reviewer Sunni', 'x', 'primary_text_check');
select is((select verification_status::text from public.islamic_sources where code = 'quran.7.31'), 'in_review', 'one approval leaves the source in review');
select tests.authenticate_as(:'uid');
select is((select count(*) from public.islamic_sources_public), 0::bigint, 'a source with one approval is not public');
select tests.clear_authentication();

-- second distinct approval: verified and public
insert into public.source_verifications (islamic_source_id, status, action, reviewer_id, reviewer_name, reviewer_credentials, method)
values ('77777777-7777-4777-8777-000000000001', 'verified', 'approve', '55555555-5555-4555-8555-000000000002', 'Reviewer Shared', 'x', 'cross_reference');
select results_eq($$select verification_status::text, approvals_count from public.islamic_sources where code = 'quran.7.31'$$,
  $$values ('verified', 2::smallint)$$, 'two distinct approvals verify a shared source');
select tests.authenticate_as(:'uid');
select is((select array_agg(code) from public.islamic_sources_public), array['quran.7.31'], 'the verified source is public');
select is((select count(*) from public.islamic_sources), 1::bigint, 'the verified source is readable in the base table');
select is((select count(*) from public.quran_references), 1::bigint, 'its Qur''an reference becomes readable');
select is((select count(*) from public.source_verifications where islamic_source_id = '77777777-7777-4777-8777-000000000001'), 2::bigint,
  'approval rows of a verified source are readable');
select is((select count(*) from public.citable_islamic_sources), 0::bigint, 'citable_islamic_sources also needs an embedding');
select tests.clear_authentication();

-- a Sunni hadith with two approvals by reviewers outside a matching tradition stays in review
insert into public.source_verifications (islamic_source_id, status, action, reviewer_name, reviewer_credentials, method)
values ('77777777-7777-4777-8777-000000000002', 'verified', 'approve', 'Anon A', 'x', 'takhrij'),
       ('77777777-7777-4777-8777-000000000002', 'verified', 'approve', 'Anon B', 'x', 'takhrij');
select is((select verification_status::text from public.islamic_sources where code = 'hadith.tirmidhi.2380'), 'in_review',
  'a sunni source needs an approval from a reviewer of that tradition');
insert into public.source_verifications (islamic_source_id, status, action, reviewer_id, reviewer_name, reviewer_credentials, method)
values ('77777777-7777-4777-8777-000000000002', 'verified', 'approve', '55555555-5555-4555-8555-000000000001', 'Reviewer Sunni', 'x', 'takhrij');
select is((select verification_status::text from public.islamic_sources where code = 'hadith.tirmidhi.2380'), 'verified',
  'a qualified approval completes the verification');

-- status is managed by the database
select throws_ok($$update public.islamic_sources set verification_status = 'unverified' where code = 'quran.7.31'$$,
  '42501', 'VERIFICATION_STATUS_MANAGED', 'verification_status cannot be set directly');

-- content edit opens a new review round and hides the source
update public.hadith_references set translation_i18n = '{"en":"edited"}' where id = '66666666-6666-4666-8666-000000000002';
select is((select verification_status::text from public.islamic_sources where code = 'hadith.tirmidhi.2380'), 'in_review',
  'editing a verified hadith sends it back to review');

-- retraction hides a verified source
insert into public.source_verifications (islamic_source_id, status, action, reviewer_name, reviewer_credentials, method, notes)
values ('77777777-7777-4777-8777-000000000001', 'verified', 'retract', 'Content admin', 'x', 'scholar_panel', 'test retraction');
select tests.authenticate_as(:'uid');
select is((select count(*) from public.islamic_sources_public), 0::bigint, 'retracted and re-reviewed sources are not public');
select is((select count(*) from public.hadith_references), 0::bigint, 'the edited hadith is hidden again');
select tests.clear_authentication();

-- ---- writes by ordinary users ---------------------------------------------------------------------------
select tests.authenticate_as(:'uid');
select throws_ok($$insert into public.quran_references (surah, ayah_start, ayah_end, arabic_text, translation_i18n, translator) values (1, 1, 1, 'x', '{"en":"x"}', 'x')$$,
  '42501', null, 'users cannot add Qur''an references');
select throws_ok($$insert into public.hadith_references (collection, number, arabic_text, translation_i18n) values ('muslim', '1', 'x', '{"en":"x"}')$$,
  '42501', null, 'users cannot add hadith references');
select throws_ok($$insert into public.imam_narrations (imam, collection, number, arabic_text, translation_i18n) values ('ali_al_rida', 'al_kafi', '1', 'x', '{"en":"x"}')$$,
  '42501', null, 'users cannot add imam narrations');
select throws_ok($$insert into public.source_verifications (islamic_source_id, status, reviewer_name, reviewer_credentials, method) values ('77777777-7777-4777-8777-000000000001', 'verified', 'me', 'x', 'takhrij')$$,
  '42501', null, 'users cannot verify sources');
select throws_ok($$insert into public.scientific_evidence (code, title, citation, study_type, grade, summary) values ('sci.x', 'x', 'x', 'rct', 'high', 'x')$$,
  '42501', null, 'users cannot add scientific evidence');
select throws_ok($$insert into public.recommendations (code, title_i18n, practical_text_i18n) values ('x.y', '{"en":"x"}', '{"en":"x"}')$$,
  '42501', null, 'users cannot add recommendations');
select is(tests.affected_rows($q$update public.islamic_sources set citation_text = 'x'$q$), 0::bigint, 'users cannot edit islamic_sources');
select tests.clear_authentication();

-- content editors write drafts (0019a content roles); a draft stays invisible to users
select tests.authenticate_as(:'editor', '{"role":"content_editor"}');
select lives_ok($$insert into public.scholarly_notes (id, title_i18n, body_i18n, author_name, author_credentials) values ('66666666-6666-4666-8666-000000000003', '{"en":"Note"}', '{"en":"Body"}', 'A', 'B')$$,
  'a content editor drafts a scholarly note');
select lives_ok($$insert into public.islamic_sources (kind, ref_id, tradition, citation_text, code) values ('scholarly', '66666666-6666-4666-8666-000000000003', 'shared', 'Note', 'scholarly.note1')$$,
  'a content editor indexes it as a source');
select tests.clear_authentication();
select tests.authenticate_as(:'uid');
select is((select count(*) from public.scholarly_notes), 0::bigint, 'the unverified scholarly note is invisible to users');
select tests.clear_authentication();

-- publishing gate
insert into public.recommendations (id, code, title_i18n, practical_text_i18n)
values ('88888888-8888-4888-8888-000000000001', 'test.rec', '{"en":"t"}', '{"en":"Eat slowly","ur":"آہستہ کھائیں"}');
select throws_ok($$update public.recommendations set review_status = 'verified' where code = 'test.rec'$$,
  '23514', 'RECOMMENDATION_MISSING_SCIENTIFIC_EVIDENCE', 'a recommendation cannot be published without scientific evidence');

select * from finish();
rollback;
