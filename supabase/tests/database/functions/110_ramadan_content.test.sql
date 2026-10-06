-- supabase/tests/database/functions/110_ramadan_content.test.sql
-- S5-16 (DB side) content load: 20 Ramadan recommendations (seed/catalog 125) stay unverified, English-only,
-- evidence-linked and invisible to users; at least 40 global recipes are flagged ramadan_suitable by the
-- generator rule (tooling/scripts/gen-recipe-seed.py ramadan_reasons) and stay in review.
begin;
select plan(9);

select is((select count(*) from public.recommendations where code like 'rec.ramadan.%'), 20::bigint,
  '20 Ramadan recommendations are seeded');
select is((select count(*) from public.recommendations where code like 'rec.ramadan.%'
             and (review_status <> 'unverified' or practical_text_i18n ? 'ur' or title_i18n ? 'ur'
                  or title_i18n ? 'ar' or practical_text_i18n ? 'ar')),
  0::bigint, 'all are unverified and English-only (no invented Urdu or Arabic)');
select is((select count(*) from public.recommendations r where r.code like 'rec.ramadan.%' and not exists (
             select 1 from public.recommendation_evidence re where re.recommendation_id = r.id and re.scientific_evidence_id is not null)),
  0::bigint, 'every Ramadan recommendation links scientific evidence');
select is((select count(*) from public.recommendations where code like 'rec.ramadan.%'
             and not (applies_to -> 'collections' ? 'ramadan')),
  0::bigint, 'all carry the ramadan collection for the planner and tips view');
select is((select count(*) from public.recommendations where code like 'rec.ramadan.%' and science_only
             and tradition_scope <> '{shared,sunni,shia}'::public.source_tradition[]),
  0::bigint, 'science-only rows make no tradition-specific claim');

select tests.create_user('rc-owner@test.thuluth.app') as owner \gset
select tests.seed_household(:'owner', 'Content home') as hid \gset
select tests.authenticate_as(:'owner');
select is((select count(*) from public.recommendations where code like 'rec.ramadan.%'), 0::bigint,
  'users see no unverified Ramadan recommendation');
select tests.clear_authentication();

select ok((select count(*) from public.recipes where household_id is null and ramadan_suitable) >= 40,
  'at least 40 global recipes are ramadan_suitable');
select is((select count(*) from public.recipes where household_id is null and ramadan_suitable and review_status <> 'in_review'),
  0::bigint, 'flagged recipes stay in review (dietitian sign-off pending)');
select is((select count(*) from public.recipes where household_id is null and ramadan_suitable
             and coalesce((per_serving_nutrition ->> 'sodium_mg')::numeric, 0) > 900),
  0::bigint, 'no high-sodium recipe is flagged (rule: sodium at most 900 mg per serving)');

select * from finish();
rollback;
