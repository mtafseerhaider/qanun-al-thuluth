-- supabase/tests/database/functions/070_meal_catalog_and_gating.test.sql
-- S3-02 / S3-16 meal catalog seed (seed/catalog 090, 092, 095) and the internal-alpha review gate
-- (public.catalog_review_statuses(), flag catalog.include_in_review). Checks: seed counts and review
-- state, portion coverage per life stage and tier, children's portions never below the reference
-- serving, plate splits, autism and picky alternatives, seasonal produce, and that the flag opens
-- recipes, meals, portions and alternatives only, never Islamic sources or recommendations, and only
-- when app.environment is explicitly local, development, staging or test (unset, unknown and
-- production fail closed).
begin;
select plan(38);

select tests.create_user('cat-outsider@test.thuluth.app') as outsider \gset
select tests.create_user('cat-owner@test.thuluth.app') as owner \gset
select tests.seed_household(:'owner', 'Catalog home') as hid \gset

-- ---- seed counts and review state -----------------------------------------------------------------------
select is((select count(*) from public.meals where household_id is null and code ~ '^[A-Z][0-9]{3}$'), 147::bigint,
  '147 base family meals are seeded');
select is((select count(*) from public.meals where household_id is null and code ~ '-[AP]$'), 170::bigint,
  '170 adapted variants (autism and picky for every lunch and dinner)');
select is((select count(*) from public.meals where household_id is null and (code is null or review_status <> 'in_review')), 0::bigint,
  'every global meal has a code and waits for dietitian review');
select is((select count(*) from public.portions where household_id is null and review_status <> 'in_review'), 0::bigint,
  'every global portion waits for dietitian review');
select is((select count(*) from public.meal_alternatives where review_status <> 'in_review'), 0::bigint,
  'every meal alternative waits for dietitian review');
select is((select count(*) from public.portions where recipe_id is not null and household_id is null), 998::bigint,
  '998 reference servings (200 recipes x 5 life stages, tea has no child or toddler rows)');
select is((select count(*) from public.portions where meal_id is not null and household_id is null), 2853::bigint,
  '2853 meal portions (317 meals x 9 stage and tier rows)');
select is((select count(*) from public.meal_alternatives where reason = 'autism'), 85::bigint, '85 autism alternatives');
select is((select count(*) from public.meal_alternatives where reason = 'picky'), 85::bigint, '85 picky-eater alternatives');
select ok((select count(*) from public.meal_alternatives where reason = 'budget') >= 10, 'budget alternatives are seeded');
select is((select count(*) from public.meals m where m.household_id is null and m.meal_type in ('lunch','dinner')
             and m.code ~ '^[A-Z][0-9]{3}$'
             and (select count(distinct a.reason) from public.meal_alternatives a
                   where a.meal_id = m.id and a.reason in ('autism','picky')) <> 2), 0::bigint,
  'every base lunch and dinner has an autism and a picky alternative');
select ok((select count(*) from public.seasonal_produce sp join public.regions r on r.id = sp.region_id
            where r.region_code = 'PB') >= 400, 'Punjab seasonal produce is seeded');

-- ---- components and halal -----------------------------------------------------------------------------
select is((select count(*) from public.meals m, jsonb_array_elements(m.components) c
            where m.household_id is null
              and not exists (select 1 from public.recipes r where r.id = (c ->> 'recipe_id')::uuid)
              and not exists (select 1 from public.ingredients i where i.id = (c -> 'ingredient_ids' ->> 0)::uuid)),
  0::bigint, 'every meal component is a catalog recipe or ingredient');
select is((select count(*) from public.recipes r join public.recipe_ingredients ri on ri.recipe_id = r.id
            join public.ingredients i on i.id = ri.ingredient_id
            where r.household_id is null and i.halal_status = 'haram'), 0::bigint,
  'no catalog recipe uses a haram ingredient');
select is((select array_agg(distinct r.title) from public.recipes r join public.recipe_ingredients ri on ri.recipe_id = r.id
            join public.ingredients i on i.id = ri.ingredient_id
            where r.household_id is null and i.halal_status = 'mashbooh' and not ri.optional),
  array['Chicken vegetable soup'],
  'only the Sprint 2 chicken vegetable soup uses a mashbooh ingredient (soy sauce; excluded unless allow_mashbooh)');

-- ---- portions ------------------------------------------------------------------------------------------
select is((select count(*) from public.meals m where m.household_id is null
             and (select array_agg(p.life_stage || ':' || p.tier order by p.life_stage, p.tier) from public.portions p where p.meal_id = m.id)
                 <> array['toddler:extra','toddler:start','child:extra','child:ideal','child:start','teen:extra','teen:ideal',
                          'adult:standard','older_adult:standard']),
  0::bigint, 'every meal has adult and older_adult standard, teen ideal+extra, child start+ideal+extra, toddler start+extra');
select is((select count(*) from public.portions where life_stage = 'infant'), 0::bigint, 'no infant portions');
select is((select count(*) from public.portions where household_id is null and life_stage in ('toddler','child','teen') and kcal is not null),
  0::bigint, 'no kcal is stored on minors'' portions');
select is((select count(*) from public.portions p join public.portions a
             on a.recipe_id = p.recipe_id and a.life_stage = 'adult' and a.tier = 'standard'
            where p.recipe_id is not null and p.household_id is null
              and ((p.life_stage = 'teen' and p.grams < a.grams)
                   or (p.life_stage = 'child' and p.grams < a.grams / 2)
                   or (p.life_stage = 'toddler' and p.grams < a.grams / 4))), 0::bigint,
  'reference servings: teen = adult, child >= 1/2 adult, toddler >= 1/4 adult');
with comp as (
  select m.id as meal_id, (c ->> 'recipe_id')::uuid as recipe_id
    from public.meals m, jsonb_array_elements(m.components) c
   where m.household_id is null and c ? 'recipe_id'),
ref as (
  select comp.meal_id, rp.life_stage, sum(rp.grams) as grams
    from comp join public.portions rp on rp.recipe_id = comp.recipe_id and rp.tier = 'standard'
   group by 1, 2)
select is((select count(*) from public.portions p join ref on ref.meal_id = p.meal_id and ref.life_stage = p.life_stage
            where p.life_stage in ('toddler','child','teen') and p.tier <> 'extra' and p.grams < ref.grams),
  0::bigint, 'children''s meal portions are never below the reference serving of their components');
select is((select count(*) from public.portions p join public.portions s
             on s.meal_id = p.meal_id and s.life_stage = p.life_stage and s.tier = 'start'
            where p.tier = 'ideal' and p.life_stage = 'child' and p.grams < s.grams), 0::bigint,
  'a child''s ideal portion is never smaller than the start portion');
select is((select count(*) from public.meals m where m.household_id is null and m.meal_type in ('lunch','dinner')
             and not ((m.plate_split ->> 'veg_fruit')::numeric between 0.40 and 0.60
                      and (m.plate_split ->> 'protein')::numeric between 0.20 and 0.30
                      and (m.plate_split ->> 'carb')::numeric between 0.20 and 0.30)), 0::bigint,
  'lunch and dinner plate splits are inside the 06 band');

-- ---- review gate --------------------------------------------------------------------------------------
select is(public.catalog_review_statuses(), array['verified']::public.verification_status[],
  'flag off: only verified catalog content is visible');
select tests.authenticate_as(:'outsider');
select is((select count(*) from public.meals where household_id is null) + (select count(*) from public.portions where household_id is null)
          + (select count(*) from public.meal_alternatives) + (select count(*) from public.recipes where household_id is null),
  0::bigint, 'flag off: users see no in-review recipes, meals, portions or alternatives');
select tests.clear_authentication();

update public.feature_flags set enabled = true where key = 'catalog.include_in_review';
-- fail closed: with the flag on, an unset or unknown environment behaves like production
select set_config('app.environment', '', true);
select is(public.catalog_review_statuses(), array['verified']::public.verification_status[],
  'flag on, app.environment unset: the flag is ignored (fails closed)');
select tests.authenticate_as(:'outsider');
select is((select count(*) from public.recipes where household_id is null) + (select count(*) from public.meals where household_id is null),
  0::bigint, 'flag on, app.environment unset: in-review recipes and meals stay hidden');
select tests.clear_authentication();
select set_config('app.environment', 'prod-eu', true);
select is(public.catalog_review_statuses(), array['verified']::public.verification_status[],
  'flag on, unknown app.environment: the flag is ignored');
select set_config('app.environment', 'test', true);
-- a pending scholar review must stay hidden whatever the flag says
update public.recommendations set review_status = 'in_review' where id in (select id from public.recommendations order by id limit 5);
select is(public.catalog_review_statuses(), array['verified','in_review']::public.verification_status[],
  'flag on: in_review catalog content is included');
select tests.authenticate_as(:'outsider');
select is((select count(*) from public.recipes where household_id is null), 200::bigint, 'flag on: the 200 in-review recipes are visible');
select is((select count(*) from public.meals where household_id is null), 317::bigint, 'flag on: the 317 meals are visible');
select is((select count(*) from public.portions where household_id is null), 3851::bigint, 'flag on: their portions are visible');
select is((select count(*) from public.meal_alternatives), 188::bigint, 'flag on: the meal alternatives are visible');
select is((select count(*) from public.islamic_sources) + (select count(*) from public.islamic_sources_public)
          + (select count(*) from public.quran_references) + (select count(*) from public.hadith_references),
  0::bigint, 'flag on: unverified Islamic sources stay hidden');
select is((select count(*) from public.recommendations), 0::bigint, 'flag on: unverified and in-review recommendations stay hidden');
select is((select count(*) from public.meals where household_id = :'hid'), 0::bigint,
  'flag on: another household''s meals stay private');
select tests.clear_authentication();

-- production ignores the flag
select set_config('app.environment', 'production', true);
select is(public.catalog_review_statuses(), array['verified']::public.verification_status[],
  'app.environment = production: the flag is ignored');
select tests.authenticate_as(:'outsider');
select is((select count(*) from public.meals where household_id is null), 0::bigint, 'production: in-review meals stay hidden');
select tests.clear_authentication();
select set_config('app.environment', 'test', true);

-- user meals cannot claim a code or a review state
select tests.authenticate_as(:'owner');
select throws_ok(format($$insert into public.meals (household_id, source, title, meal_type, components, code) values (%L, 'user', 'Mine', 'lunch', '[{"label":"x","role":"main"}]', 'D999')$$, :'hid'),
  '42501', null, 'a user meal cannot take a catalog code');
select tests.clear_authentication();

select * from finish();
rollback;
