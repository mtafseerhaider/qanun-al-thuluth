-- supabase/tests/database/functions/080_price_books_and_cron.test.sql
-- S4-03 price books and regional produce seeds (05 section 19 order 8, 14 sections 15 and 16) and the S4
-- cron plumbing (05 sections 17.3 to 17.5 and 22.12; 10 section 8): counts and coverage of every catalog
-- ingredient, the 14 section 16.2 anchor prices, the city multipliers, the refreshed price view, the
-- Sindh and ICT calendars, invoke_edge_function without pg_net or Vault, and the scheduled jobs.
begin;
select plan(29);

-- ---- price books -------------------------------------------------------------------------------------------
select is((select count(*) from public.price_profiles where effective_from = date '2026-10-01' and currency = 'PKR'),
  3::bigint, 'three PKR price books effective 2026-10-01');
select results_eq(
  $$select p.city, r.region_code from public.price_profiles p join public.regions r on r.id = p.region_id order by p.city$$,
  $$values ('Islamabad'::text, 'IS'::text), ('Karachi', 'SD'), ('Lahore', 'PB')$$,
  'Lahore in Punjab, Karachi in Sindh, Islamabad in ICT');
select ok((select bool_and(label like '%ops review pending%') from public.price_profiles), 'every book is labelled as pending ops review');
select is((select count(*) from public.price_observations po join public.price_profiles p on p.id = po.price_profile_id where p.city = 'Lahore'),
  150::bigint, 'the Lahore book has 150 observations');
select is((select count(*) from public.ingredients i
            where not exists (select 1 from public.price_observations po join public.price_profiles p on p.id = po.price_profile_id
                               where p.city = 'Lahore' and po.ingredient_id = i.id)),
  0::bigint, 'every seeded ingredient has a Lahore price');
select is((select count(*) from public.ingredients i cross join public.price_profiles p
            where not exists (select 1 from public.price_observations po where po.price_profile_id = p.id and po.ingredient_id = i.id)),
  0::bigint, 'and a Karachi and an Islamabad price');
select is((select count(*) from public.price_observations), 450::bigint, '450 seed observations in all');
select ok((select bool_and(source = 'seed' and moderation_status = 'accepted' and observed_on = date '2026-10-01'
                           and unit_grams > 0 and reporter_user_id is null) from public.price_observations),
  'every row is an accepted seed observation dated 2026-10-01 with unit_grams');

create function pg_temp.price(p_city text, p_name text) returns bigint language sql as $$
  select po.amount_minor from public.price_observations po
  join public.price_profiles p on p.id = po.price_profile_id
  join public.ingredients i on i.id = po.ingredient_id
  where p.city = p_city and i.name = p_name;
$$;
select results_eq(
  $$select pg_temp.price('Lahore', 'Onion'), pg_temp.price('Lahore', 'Chicken, whole, with bone'), pg_temp.price('Lahore', 'Eggs, farm'),
           pg_temp.price('Lahore', 'Fresh milk'), pg_temp.price('Lahore', 'Chakki atta (whole wheat flour)'), pg_temp.price('Lahore', 'Desi ghee')$$,
  $$values (12000::bigint, 57000::bigint, 31500::bigint, 21000::bigint, 13500::bigint, 340000::bigint)$$,
  'Lahore anchor prices match 14 section 16.2 (PKR x 100)');
select is((select unit_grams from public.price_observations po join public.ingredients i on i.id = po.ingredient_id
            join public.price_profiles p on p.id = po.price_profile_id where p.city = 'Lahore' and i.name = 'Eggs, farm'),
  660.0::numeric(8,1), 'a dozen eggs is 660 g (14 section 16.2)');
select results_eq(
  $$select pg_temp.price('Karachi', 'Potato'), pg_temp.price('Karachi', 'Tomato'), pg_temp.price('Karachi', 'Banana'),
           pg_temp.price('Karachi', 'Fish, surmai (king mackerel)'), pg_temp.price('Karachi', 'Fresh milk')$$,
  $$values (9700::bigint, 16500::bigint, 16000::bigint, 127500::bigint, 23000::bigint)$$,
  'Karachi = Lahore x 14 section 16.3 multipliers (veg 1.08, Sindh tomato 0.95, bananas 0.90, sea fish 0.85, milk 1.10)');
select results_eq(
  $$select pg_temp.price('Islamabad', 'Potato'), pg_temp.price('Islamabad', 'Apple (saib)'), pg_temp.price('Islamabad', 'Almonds (badam)'),
           pg_temp.price('Islamabad', 'Masoor daal')$$,
  $$values (9900::bigint, 26500::bigint, 353000::bigint, 31000::bigint)$$,
  'Islamabad = Lahore x 14 section 16.3 multipliers (veg 1.10, apples 0.95, dry fruit 0.98, staples 1.04)');
select is((select count(*) from public.mv_ingredient_prices), 450::bigint, 'the seed refreshed mv_ingredient_prices');
select ok(exists (select 1 from pg_matviews where schemaname = 'public' and matviewname = 'mv_current_prices' and ispopulated),
  'mv_current_prices is populated');

-- ---- seasonal produce ------------------------------------------------------------------------------------------
create function pg_temp.season(p_region text, p_name text, p_month int) returns text language sql as $$
  select sp.availability from public.seasonal_produce sp
  join public.regions r on r.id = sp.region_id join public.ingredients i on i.id = sp.ingredient_id
  where r.country_code = 'PK' and r.region_code = p_region and i.name = p_name and sp.month = p_month;
$$;
select is((select count(*) from public.seasonal_produce sp join public.regions r on r.id = sp.region_id where r.region_code = 'PB'),
  420::bigint, 'the Punjab calendar is unchanged (420 rows from Sprint 3)');
select ok((select count(*) from public.seasonal_produce sp join public.regions r on r.id = sp.region_id where r.region_code = 'SD') = 444
          and (select count(*) from public.seasonal_produce sp join public.regions r on r.id = sp.region_id where r.region_code = 'IS') = 420,
  'Sindh and ICT calendars are seeded');
select results_eq(
  $$select pg_temp.season('SD', 'Banana', 6), pg_temp.season('SD', 'Tomato', 1), pg_temp.season('SD', 'Spinach (palak)', 12),
           pg_temp.season('SD', 'Prawns (jhinga)', 10), pg_temp.season('PB', 'Prawns (jhinga)', 10)$$,
  $$values ('peak'::text, 'peak'::text, 'available'::text, 'peak'::text, null::text)$$,
  'Sindh overrides from 14 section 15.3 (bananas all year, tomato in January, leafy greens lower in winter, seafood)');
select results_eq(
  $$select pg_temp.season('IS', 'Apple (saib)', 4), pg_temp.season('PB', 'Apple (saib)', 4), pg_temp.season('IS', 'Guava (amrood)', 10)$$,
  $$values ('available'::text, 'scarce'::text, 'peak'::text)$$,
  'ICT is the Punjab table with apples, apricots and peaches one level higher');

-- ---- cron plumbing ---------------------------------------------------------------------------------------------
select ok(to_regprocedure('private.invoke_edge_function(text,jsonb)') is not null
          and not has_function_privilege('authenticated', 'private.invoke_edge_function(text,jsonb)', 'execute'),
  'private.invoke_edge_function exists and is not callable by clients');
select ok(case when to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
                    or to_regclass('vault.decrypted_secrets') is null
               then private.invoke_edge_function('prices-refresh') is null
               else true end,
  'without pg_net or Vault the invoker skips the call and returns null');
select ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'private' and p.proname = 'invoke_edge_function'
                         and p.prosrc ~* '(sk_|eyJ|secret[''"]?\s*:=\s*''[A-Za-z0-9])'),
  'no secret literal in the invoker (Vault only)');
select results_eq(
  $$select jobname, schedule from cron.job
     where jobname in ('notifications-dispatch','prices-refresh','plan-generation-sweeper') order by jobname$$,
  $$values ('notifications-dispatch'::text, '* * * * *'::text), ('plan-generation-sweeper', '* * * * *'), ('prices-refresh', '15 0 * * *')$$,
  'Edge Function cron jobs are scheduled per 10 section 8');
select ok((select bool_and(command like '%private.invoke_edge_function(%') from cron.job
            where jobname in ('notifications-dispatch','prices-refresh','plan-generation-sweeper'))
          and (select command like '%ai-generate-plan/worker%' from cron.job where jobname = 'plan-generation-sweeper'),
  'they call the Edge Functions through invoke_edge_function (sweeper -> ai-generate-plan/worker)');
select is((select count(*) from cron.job where jobname in ('soft-delete-purge','notifications-retention','ai-usage-retention',
                                                           'audit-retention','cron-history-retention')),
  5::bigint, 'retention jobs are scheduled');

-- ---- job leases (single-run lock for cron functions) -----------------------------------------------------
select ok(not has_function_privilege('authenticated', 'public.acquire_job_lease(text,uuid,integer)', 'execute')
          and has_function_privilege('service_role', 'public.acquire_job_lease(text,uuid,integer)', 'execute'),
  'job leases are service-role only');
set local role service_role;
select ok(public.acquire_job_lease('notifications-dispatch', '00000000-0000-4000-8000-00000000a001', 55), 'a first run acquires the lease');
select ok(not public.acquire_job_lease('notifications-dispatch', '00000000-0000-4000-8000-00000000a002', 55), 'an overlapping run does not');
select public.release_job_lease('notifications-dispatch', '00000000-0000-4000-8000-00000000a001');
select ok(public.acquire_job_lease('notifications-dispatch', '00000000-0000-4000-8000-00000000a002', 55), 'after release the next run acquires it');
reset role;
update private.job_leases set expires_at = now() - interval '1 second' where name = 'notifications-dispatch';
set local role service_role;
select ok(public.acquire_job_lease('notifications-dispatch', '00000000-0000-4000-8000-00000000a003', 55), 'an expired lease can be taken over');
reset role;

select * from finish();
rollback;
