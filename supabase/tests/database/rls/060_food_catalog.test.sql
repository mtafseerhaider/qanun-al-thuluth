-- supabase/tests/database/rls/060_food_catalog.test.sql
-- Food catalog (S1-19): authenticated reads, only platform admins write, anon nothing; seed shape
-- (05 section 19 orders 1 to 5) and the households.region_id FK (21-testing-strategy.md 6.1 "Global catalog").
begin;
select plan(30);

select tests.create_user('cat-user@test.thuluth.app') as uid \gset

-- ---- seed shape ------------------------------------------------------------------------------------
select is((select count(*) from public.allergens), 15::bigint, '15 allergen codes (EU-14 + US Big-9 superset)');
select is((select count(*) from public.allergens where eu14), 14::bigint, '14 EU allergens');
select is((select count(*) from public.allergens where us_big9), 9::bigint, '9 US major allergens');
select is((select count(*) from public.budget_categories), 10::bigint, '10 budget categories');
select is((select count(*) from public.regions where country_code = 'PK'), 4::bigint, 'Pakistan regions seeded');
select is((select climate_zone from public.regions where country_code = 'PK' and region_code = 'PB'), 'hot_semi_arid', 'Punjab climate zone');
select ok((select count(*) from public.ingredients) >= 150, 'at least 150 ingredients seeded');
select is((select count(*) from public.ingredients where not (name_i18n ? 'en' and name_i18n ? 'ur')), 0::bigint,
  'every ingredient has en and ur names');
select is((select count(*) from public.ingredients where kcal is null and name <> 'Black seed (kalonji)'), 0::bigint,
  'every ingredient except black seed has nutrients');
select is(
  (select array_agg(name order by name) from public.ingredients
   where is_sunnah_food and name in ('Dates (Aseel)','Honey (shehad)','Olive oil','Whole barley (jau)','Pomegranate (anaar)',
                                     'Figs, fresh (anjeer)','Grapes (angoor)','Cucumber (kheera)','Watermelon (tarbooz)',
                                     'Fresh milk','Vinegar (sirka)','Pumpkin (kaddu)','Black seed (kalonji)')),
  array['Black seed (kalonji)','Cucumber (kheera)','Dates (Aseel)','Figs, fresh (anjeer)','Fresh milk','Grapes (angoor)',
        'Honey (shehad)','Olive oil','Pomegranate (anaar)','Pumpkin (kaddu)','Vinegar (sirka)','Watermelon (tarbooz)',
        'Whole barley (jau)'],
  'the Sunnah foods from 05 section 19 are flagged');
select is((select kcal from public.ingredients where name = 'Onion'), 40.0::numeric, 'Onion kcal matches USDA SR (NDB 11282)');
select ok(exists (select 1 from public.ingredient_allergens ia join public.ingredients i on i.id = ia.ingredient_id
                  join public.allergens a on a.id = ia.allergen_id
                  where i.name = 'Chakki atta (whole wheat flour)' and a.code = 'wheat'),
  'atta is linked to the wheat allergen');
select ok(not exists (select 1 from public.ingredient_allergens ia join public.ingredients i on i.id = ia.ingredient_id
                      where i.name = 'Besan (gram flour)'),
  'besan has no allergen link');
select is((select count(*) from public.ingredients where halal_status = 'depends_on_source' and category in ('meat','poultry')),
  (select count(*) from public.ingredients where category in ('meat','poultry')), 'meat and poultry are halal depends_on_source (zabiha)');

-- ---- RLS -------------------------------------------------------------------------------------------
update public.ingredients set is_active = false where name = 'Brown sugar (shakkar)';
select tests.authenticate_as(:'uid');
select ok((select count(*) from public.allergens) = 15 and (select count(*) from public.budget_categories) = 10
          and (select count(*) from public.regions) >= 4 and (select count(*) from public.ingredient_allergens) > 0,
  'authenticated reads the catalog');
select is((select count(*) from public.ingredients where name = 'Brown sugar (shakkar)'), 0::bigint,
  'retired ingredients are hidden from users');
select throws_ok($$insert into public.allergens (code, name_i18n) values ('fake', '{"en":"x"}')$$, '42501', null, 'users cannot add allergens');
select throws_ok($$insert into public.ingredients (name, category, budget_category_id) select 'Fake', 'fruit', id from public.budget_categories limit 1$$,
  '42501', null, 'users cannot add ingredients');
select is(tests.affected_rows($q$update public.ingredients set kcal = 0$q$), 0::bigint, 'users cannot edit ingredients');
select is(tests.affected_rows($q$delete from public.ingredient_allergens$q$), 0::bigint, 'users cannot delete allergen links');
select is(tests.affected_rows($q$update public.regions set name = 'x'$q$), 0::bigint, 'users cannot edit regions');
select is(tests.affected_rows($q$delete from public.budget_categories$q$), 0::bigint, 'users cannot delete budget categories');
select tests.clear_authentication();

select tests.authenticate_as(:'uid', '{"role":"admin"}');
select is((select count(*) from public.ingredients where name = 'Brown sugar (shakkar)'), 1::bigint, 'admins see retired ingredients');
select is(tests.affected_rows($q$update public.ingredients set color = 'brown' where name = 'Dates (Aseel)'$q$), 1::bigint,
  'platform admin edits an ingredient');
select lives_ok($$insert into public.regions (country_code, region_code, name, climate_zone, default_currency) values ('PK', 'BA', 'Balochistan', 'hot_arid', 'PKR')$$,
  'platform admin adds a region');
select tests.clear_authentication();

set local role anon;
select throws_ok($$select count(*) from public.ingredients$$, '42501', null, 'anon cannot read ingredients');
select throws_ok($$select count(*) from public.allergens$$, '42501', null, 'anon cannot read allergens');
reset role;

-- households.region_id FK
select tests.create_household(:'uid', 'Region home') as hid \gset
select lives_ok(format($$update public.households set region = 'PB', region_id = (select id from public.regions where country_code = 'PK' and region_code = 'PB') where id = %L$$, :'hid'),
  'a household links to a region');
select throws_ok(format($$update public.households set region_id = gen_random_uuid() where id = %L$$, :'hid'),
  '23503', null, 'households.region_id must reference regions');
select is((select extversion is not null from pg_extension where extname = 'pg_trgm'), true, 'pg_trgm is installed for catalog search');

select * from finish();
rollback;
