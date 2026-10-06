-- supabase/tests/database/rls/090_recipe_catalog.test.sql
-- S2-16 recipe catalog (05 sections 7.6 to 7.11, 15.13, 16.3.3): the 100 seeded recipes all carry
-- per_serving_nutrition that matches recompute_recipe_nutrition(), they wait for dietitian review and
-- are hidden from users until verified, nutrition follows ingredient and servings edits, household
-- recipes are private to the household and only editors write them.
begin;
select plan(20);

select tests.create_user('rc-owner@test.thuluth.app')    as owner \gset
select tests.create_user('rc-viewer@test.thuluth.app')   as viewer \gset
select tests.create_user('rc-outsider@test.thuluth.app') as outsider \gset
select tests.seed_household(:'owner', 'Recipe home') as hid \gset
select tests.add_member(:'hid', :'viewer', 'viewer');

-- ---- seeded catalog ----------------------------------------------------------------------------------
select is((select count(*) from public.recipes where household_id is null and source = 'curated'), 100::bigint,
  '100 curated catalog recipes are seeded');
select is((select count(*) from public.recipes where household_id is null and review_status <> 'in_review'), 0::bigint,
  'every seeded recipe waits for dietitian review');
select is((select count(*) from public.recipes r where r.household_id is null
             and not (r.per_serving_nutrition ?& array['kcal','protein_g','carbs_g','fat_g','fiber_g','sodium_mg','iron_mg','grams'])),
  0::bigint, 'every seeded recipe has per-serving nutrition');
select is((select count(*) from public.recipes r where r.household_id is null
             and not exists (select 1 from public.recipe_ingredients ri where ri.recipe_id = r.id)), 0::bigint,
  'every seeded recipe has ingredients');
select is((select count(*) from public.recipes r where r.household_id is null
             and ((r.per_serving_nutrition ->> 'kcal')::numeric not between 10 and 1200)), 0::bigint,
  'per-serving energy is plausible (10 to 1200 kcal)');
select is((select count(*) from public.recipes r where r.household_id is null and (r.title_i18n ? 'ur')), 0::bigint,
  'no machine Urdu titles are seeded');

-- the stored values equal a fresh recompute (generator and trigger agree)
create temp table before_nut as select id, per_serving_nutrition from public.recipes where household_id is null;
select public.recompute_recipe_nutrition(id) from public.recipes where household_id is null;
select is((select count(*) from public.recipes r join before_nut b using (id) where r.per_serving_nutrition <> b.per_serving_nutrition),
  0::bigint, 'seeded nutrition equals recompute_recipe_nutrition()');

-- nutrition follows edits
select id as daal from public.recipes where household_id is null and title = 'Masoor daal' \gset
select (per_serving_nutrition ->> 'kcal')::numeric as kcal4 from public.recipes where id = :'daal' \gset
update public.recipes set servings = 2 where id = :'daal';
select ok(abs((select (per_serving_nutrition ->> 'kcal')::numeric from public.recipes where id = :'daal') - :kcal4 * 2) <= 0.2,
  'halving servings doubles per-serving energy (within rounding)');
select (per_serving_nutrition ->> 'protein_g')::numeric as prot from public.recipes where id = :'daal' \gset
update public.ingredients set protein_g = protein_g + 10 where name = 'Masoor daal';
select ok((select (per_serving_nutrition ->> 'protein_g')::numeric from public.recipes where id = :'daal') > :prot,
  'an ingredient nutrient edit recomputes recipes that use it');
update public.recipe_ingredients set optional = true
 where recipe_id = :'daal' and ingredient_id = (select id from public.ingredients where name = 'Masoor daal');
select ok((select (per_serving_nutrition ->> 'protein_g')::numeric from public.recipes where id = :'daal') < :prot,
  'optional ingredients are excluded from nutrition');

-- ---- visibility -------------------------------------------------------------------------------------------
select tests.authenticate_as(:'outsider');
select is((select count(*) from public.recipes where household_id is null), 0::bigint, 'in-review catalog recipes are hidden from users');
select is((select count(*) from public.recipe_ingredients), 0::bigint, 'and so are their ingredients');
select tests.clear_authentication();
update public.recipes set review_status = 'verified' where id = :'daal';
select tests.authenticate_as(:'outsider');
select is((select count(*) from public.recipes where household_id is null), 1::bigint, 'a verified catalog recipe is visible');
select ok((select count(*) from public.recipe_ingredients where recipe_id = :'daal') > 0, 'with its ingredients');
select is((select count(*) from public.recipes where household_id = :'hid'), 0::bigint, 'another household''s recipe is invisible');
select is(tests.affected_rows(format($q$update public.recipes set title = 'x' where id = %L$q$, :'daal')), 0::bigint,
  'users cannot edit catalog recipes');
select tests.clear_authentication();

-- ---- household recipes ------------------------------------------------------------------------------------
select tests.authenticate_as(:'viewer');
select is((select count(*) from public.recipes where household_id = :'hid'), 1::bigint, 'a member sees the household recipe');
select throws_ok(format($$insert into public.recipes (household_id, created_by_user_id, title, meal_types, servings, source) values (%L, %L, 'Viewer recipe', '{lunch}', 2, 'user')$$, :'hid', :'viewer'),
  '42501', null, 'a viewer cannot add a household recipe');
select tests.clear_authentication();
select tests.authenticate_as(:'owner');
select id as fam from public.recipes where household_id = :'hid' \gset
select lives_ok(format($$insert into public.recipe_ingredients (recipe_id, ingredient_id, quantity, unit, grams)
                         select %L, id, 1, 'cup', 192 from public.ingredients where name = 'Masoor daal'$$, :'fam'),
  'the owner adds an ingredient to the household recipe');
select ok((select (per_serving_nutrition ->> 'kcal')::numeric from public.recipes where id = :'fam') > 0,
  'household recipe nutrition is computed');
select tests.clear_authentication();

select * from finish();
rollback;
