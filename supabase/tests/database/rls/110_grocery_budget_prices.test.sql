-- supabase/tests/database/rls/110_grocery_budget_prices.test.sql
-- S4-02 grocery, budget and prices (05 sections 7.12, 7.13, 11.5 to 11.7, 15.16, 16.3, 17.2, 22.6): role
-- matrix inside one household, budget currency guard, crowd price reports (pending, reporter forced,
-- hidden from others), the outlier screen, catalog writes by admins only, the price views and their
-- refresh RPC, pantry soft delete and the Realtime publication. Cross-household isolation is in 030.
begin;
select plan(32);

select tests.create_user('gb-owner@test.thuluth.app')    as owner \gset
select tests.create_user('gb-care@test.thuluth.app')     as care \gset
select tests.create_user('gb-viewer@test.thuluth.app')   as viewer \gset
select tests.create_user('gb-reporter@test.thuluth.app') as reporter \gset
select tests.create_user('gb-admin@test.thuluth.app')    as admin \gset
select tests.seed_household(:'owner', 'Grocery home') as hid \gset
select tests.add_member(:'hid', :'care', 'caregiver');
select tests.add_member(:'hid', :'viewer', 'viewer');
select id as list from public.grocery_lists where household_id = :'hid' \gset
select id as item from public.shopping_items where household_id = :'hid' \gset
select id as budget from public.budget_profiles where household_id = :'hid' \gset
select id as veg from public.budget_categories where code = 'produce_veg' \gset
select id as pantry from public.pantry_items where household_id = :'hid' \gset
select id as onion from public.ingredients where name = 'Onion' \gset
select id as lauki from public.ingredients where name = 'Bottle gourd (lauki)' \gset
select p.id as lahore from public.price_profiles p where p.city = 'Lahore' \gset
select id as region_pb from public.regions where country_code = 'PK' and region_code = 'PB' \gset

-- ---- structure -----------------------------------------------------------------------------------------
select has_column('public', 'price_observations', 'unit_grams', 'price_observations.unit_grams exists (0020)');
select has_column('public', 'grocery_lists', 'price_profile_id', 'grocery_lists.price_profile_id exists');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shopping_items'),
  'shopping_items is in the supabase_realtime publication (10 section 7.3)');
select ok(has_table_privilege('authenticated', 'public.mv_ingredient_prices', 'select')
          and has_table_privilege('authenticated', 'public.mv_current_prices', 'select')
          and not has_table_privilege('anon', 'public.mv_ingredient_prices', 'select'),
  'authenticated (not anon) reads the price views');
select ok(not has_function_privilege('authenticated', 'public.refresh_ingredient_prices()', 'execute')
          and has_function_privilege('service_role', 'public.refresh_ingredient_prices()', 'execute'),
  'refresh_ingredient_prices is service-role only');

-- ---- viewer: read only -----------------------------------------------------------------------------------
select tests.authenticate_as(:'viewer');
select is((select count(*) from public.shopping_items where grocery_list_id = :'list'), 1::bigint, 'a viewer reads the shopping list');
select is((select count(*) from public.budget_entries where household_id = :'hid'), 1::bigint, 'and the budget entries');
select is(tests.affected_rows(format($$update public.shopping_items set is_checked = true where id = %L$$, :'item')),
  0::bigint, 'a viewer cannot check off an item');
select throws_ok(format($$insert into public.shopping_items (grocery_list_id, household_id, label) values (%L, %L, 'Dates')$$, :'list', :'hid'),
  '42501', null, 'a viewer cannot add an item');
select throws_ok(format($$insert into public.budget_entries (household_id, budget_profile_id, amount_minor, currency, category_id) values (%L, %L, 5000, 'PKR', %L)$$, :'hid', :'budget', :'veg'),
  '42501', null, 'a viewer cannot record spend');
select tests.clear_authentication();

-- ---- caregiver: shopping and spend ------------------------------------------------------------------------
select tests.authenticate_as(:'care');
select is(tests.affected_rows(format($$update public.shopping_items set is_checked = true, actual_minor = 34000 where id = %L$$, :'item')),
  1::bigint, 'a caregiver checks off an item with the actual price');
select lives_ok(format($$insert into public.shopping_items (grocery_list_id, household_id, label, quantity, unit, is_fresh) values (%L, %L, 'Dates', 1, 'kg', false)$$, :'list', :'hid'),
  'a caregiver adds a manual item');
select is(tests.affected_rows(format($$delete from public.shopping_items where grocery_list_id = %L and label = 'Dates'$$, :'list')),
  1::bigint, 'and removes it');
select lives_ok(format($$insert into public.budget_entries (household_id, budget_profile_id, amount_minor, currency, category_id, note) values (%L, %L, 52000, 'PKR', %L, 'Sabzi mandi')$$, :'hid', :'budget', :'veg'),
  'a caregiver records spend in the profile currency');
select throws_ok(format($$insert into public.budget_entries (household_id, budget_profile_id, amount_minor, currency, category_id) values (%L, %L, 1000, 'USD', %L)$$, :'hid', :'budget', :'veg'),
  '23514', 'CURRENCY_MISMATCH', 'spend in another currency is rejected');
select lives_ok(format($$insert into public.grocery_lists (household_id, period, starts_on, ends_on, currency) values (%L, 'adhoc', current_date, current_date, 'PKR')$$, :'hid'),
  'a caregiver creates an ad hoc list');
select lives_ok(format($$select public.soft_delete('pantry_items', %L)$$, :'pantry'), 'pantry items are soft-deletable');
select is((select count(*) from public.pantry_items where id = :'pantry'), 0::bigint, 'and then hidden');
select throws_ok(format($$insert into public.price_profiles (region_id, city, currency, effective_from) values (%L, 'Multan', 'PKR', current_date)$$, :'region_pb'),
  '42501', null, 'a user cannot create a price book');
select tests.clear_authentication();

-- ---- crowd price reports (05 16.3.3, 14 section 12) --------------------------------------------------------
select tests.authenticate_as(:'reporter');
select is((select count(*) from public.price_observations where price_profile_id = :'lahore'), 150::bigint,
  'any user reads the accepted Lahore book');
select throws_ok(format($$insert into public.price_observations (price_profile_id, ingredient_id, unit, amount_minor, source) values (%L, %L, 'kg', 9000, 'seed')$$, :'lahore', :'onion'),
  '42501', null, 'a user cannot insert a seed price');
select lives_ok(format($$insert into public.price_observations (price_profile_id, ingredient_id, unit, amount_minor, source, reporter_user_id, observed_on) values (%L, %L, 'kg', 13000, 'user_report', %L, current_date + 3)$$, :'lahore', :'onion', :'reporter'),
  'a user reports a price');
select results_eq(
  format($$select moderation_status, reporter_user_id, observed_on <= current_date, unit_grams::int from public.price_observations where source = 'user_report' and ingredient_id = %L$$, :'onion'),
  format($$values ('pending'::text, %L::uuid, true, 1000)$$, :'reporter'),
  'with one accepted observation the report waits (pending), observed_on is capped at today and unit_grams is filled');
select tests.clear_authentication();
select tests.authenticate_as(:'care');
select is((select count(*) from public.price_observations where source = 'user_report'), 0::bigint,
  'another user does not see a pending report');
select tests.clear_authentication();

-- outlier screen: five accepted admin observations (independent of the seed row's age) for lauki around PKR 160, then reports
select tests.authenticate_as(:'admin', '{"role":"admin"}');
select lives_ok(format($$insert into public.price_observations (price_profile_id, ingredient_id, unit, unit_grams, amount_minor, source, observed_on)
  select %L, %L, 'kg', 1000, a, 'admin', current_date - d from (values (15500, 1), (16000, 2), (16500, 3), (15800, 4), (16100, 5)) v(a, d)$$, :'lahore', :'lauki'),
  'an admin adds market survey prices');
select tests.clear_authentication();
select tests.authenticate_as(:'reporter');
insert into public.price_observations (price_profile_id, ingredient_id, unit, amount_minor, source, reporter_user_id)
values (:'lahore', :'lauki', 'kg', 60000, 'user_report', :'reporter'), (:'lahore', :'lauki', 'kg', 16200, 'user_report', :'reporter');
select tests.clear_authentication();
select results_eq(
  format($$select amount_minor::int, moderation_status from public.price_observations where ingredient_id = %L and source = 'user_report' order by amount_minor$$, :'lauki'),
  $$values (16200, 'accepted'::text), (60000, 'rejected_outlier'::text)$$,
  'with 5+ accepted prices a report near the median is accepted and a far one is rejected_outlier');

-- ---- price views ----------------------------------------------------------------------------------------
set local role service_role;
select lives_ok($$select public.refresh_ingredient_prices()$$, 'the service role refreshes the price views (concurrently once populated)');
reset role;
select ok((select median_minor from public.mv_ingredient_prices where price_profile_id = :'lahore' and ingredient_id = :'lauki' and unit = 'kg') between 15800 and 16200,
  'mv_ingredient_prices takes the median of accepted observations (the outlier is excluded)');
select is((select n_observations from public.mv_ingredient_prices where price_profile_id = :'lahore' and ingredient_id = :'onion' and unit = 'kg'),
  1::bigint, 'pending reports are not in the effective price');
select ok((select price_per_kg_minor from public.mv_current_prices where price_profile_id = :'lahore' and ingredient_id = :'lauki') between 15500 and 16500,
  'mv_current_prices gives a recency-weighted per-kg median');

-- ---- catalog writes ----------------------------------------------------------------------------------------
select tests.authenticate_as(:'admin', '{"role":"admin"}');
select lives_ok(format($$insert into public.ingredient_substitutions (from_ingredient_id, to_ingredient_id, reason, nutrient_similarity, culinary_fit) values (%L, %L, 'season', 0.8, 2)$$, :'lauki', :'onion'),
  'an admin writes substitution rules');
select tests.clear_authentication();
select tests.authenticate_as(:'care');
select is((select count(*) from public.ingredient_substitutions), 1::bigint, 'users read substitution rules');
select tests.clear_authentication();

select * from finish();
rollback;
