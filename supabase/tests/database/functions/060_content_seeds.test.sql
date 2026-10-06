-- supabase/tests/database/functions/060_content_seeds.test.sql
-- S2-13 content load v1 (seed/catalog 100 to 120): the hard rules hold for the seeded knowledge base.
-- Nothing is verified or approved, no Urdu or Arabic text is invented, science rows are unreviewed,
-- every recommendation has scientific evidence and the adab set is present.
begin;
select plan(14);

select ok((select count(*) from public.islamic_sources) >= 40, 'about 40 Islamic sources are seeded');
select is((select count(*) from public.islamic_sources where verification_status <> 'unverified' or approvals_count > 0),
  0::bigint, 'no seeded Islamic source is verified, in review or approved');
select is((select count(*) from public.source_verifications where status <> 'unverified' or action = 'approve'),
  0::bigint, 'no seeded approval rows');
select is((select count(*) from public.islamic_sources where embedding is not null), 0::bigint, 'nothing is embedded yet');
select is((select count(*) from public.quran_references where translation_i18n ? 'ur' or arabic_text <> ''), 0::bigint,
  'no Urdu or Arabic Qur''an text is typed into the seed');
select is((select count(*) from public.hadith_references where translation_i18n ? 'ur' or arabic_text <> ''), 0::bigint,
  'no Urdu or Arabic hadith text is typed into the seed');
select is((select count(*) from public.hadith_references where grade in ('daif','daif_shia','mawdu')), 0::bigint,
  'no weak or fabricated hadith is seeded');
select ok((select count(*) from public.scientific_evidence) >= 30, 'about 30 scientific evidence rows are seeded');
select is((select count(*) from public.scientific_evidence where reviewed_by is not null), 0::bigint,
  'seeded science is unreviewed');
select ok((select count(*) from public.recommendations) >= 30, 'about 30 recommendations are seeded');
select is((select count(*) from public.recommendations where review_status <> 'unverified' or practical_text_i18n ? 'ur'), 0::bigint,
  'seeded recommendations are unverified and English-only');
select is((select count(*) from public.recommendations r where not exists (
             select 1 from public.recommendation_evidence re where re.recommendation_id = r.id and re.scientific_evidence_id is not null)),
  0::bigint, 'every seeded recommendation links scientific evidence');
select ok((select count(*) from public.recommendations where applies_to -> 'collections' ? 'adab') >= 6,
  'the adab set (FR-ISL-07) is seeded');
select is((select count(*) from public.recommendation_completeness() where not blocking and issue <> 'linked_source_not_citable'),
  0::bigint, 'no seeded recommendation links retracted science');

select * from finish();
rollback;
