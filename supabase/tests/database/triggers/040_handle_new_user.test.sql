-- supabase/tests/database/triggers/040_handle_new_user.test.sql
-- S1-03: auth.users insert creates public.users with email, display name, locale, country,
-- time zone and units from raw_user_meta_data (10 section 5, 11 sections 3.2 and 9, 01 Q-12),
-- falling back to safe defaults. Plus the 0017 users columns and their client grants.
begin;
select plan(12);

create function pg_temp.signup(p_email text, p_meta jsonb) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, email, aud, role, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  values (v_id, '00000000-0000-0000-0000-000000000000', p_email, 'authenticated', 'authenticated', p_meta, '{}', now(), now());
  return v_id;
end $$;

select pg_temp.signup('us@test.thuluth.app', '{"locale":"en","country_code":"US","timezone":"America/New_York","display_name":"Sara"}') as us \gset
select results_eq(
  format($$select email::text, display_name, locale, country_code::text, timezone, units from public.users where id = %L$$, :'us'),
  $$values ('us@test.thuluth.app', 'Sara', 'en', 'US', 'America/New_York', 'imperial')$$,
  'a US signup gets imperial units (Q-12) and its metadata');

select pg_temp.signup('pk@test.thuluth.app', '{"locale":"ur","country_code":"pk","timezone":"Asia/Karachi","full_name":"Ali Raza"}') as pk \gset
select results_eq(
  format($$select display_name, locale, country_code::text, units from public.users where id = %L$$, :'pk'),
  $$values ('Ali Raza', 'ur', 'PK', 'metric')$$,
  'a Pakistan signup is metric, country code upper-cased, full_name used as display name');

select pg_temp.signup('pref@test.thuluth.app', '{"country_code":"US","units":"metric"}') as pref \gset
select is((select units from public.users where id = :'pref'), 'metric', 'explicit units metadata wins over the country default');

select pg_temp.signup('bad@test.thuluth.app', '{"locale":"xx","country_code":"Pakistan","timezone":"Nowhere/City","units":"furlongs"}') as bad \gset
select results_eq(
  format($$select locale, country_code::text, timezone, units from public.users where id = %L$$, :'bad'),
  $$values ('en', null::text, 'Asia/Karachi', 'metric')$$,
  'malformed metadata falls back to defaults');

select pg_temp.signup('none@test.thuluth.app', null) as none \gset
select results_eq(
  format($$select display_name, locale, timezone, units, tradition_preference::text from public.users where id = %L$$, :'none'),
  $$values ('', 'en', 'Asia/Karachi', 'metric', 'shared')$$,
  'a signup without metadata gets the column defaults');

select pg_temp.signup('fr@test.thuluth.app', '{"locale":"fr","name":"Amina"}') as fr \gset
select results_eq(format($$select locale, display_name from public.users where id = %L$$, :'fr'),
  $$values ('fr', 'Amina')$$, 'any locale allowed by users.locale is kept');

select is((select age_attested_at from public.users where id = :'pk'), null::timestamptz, 'age_attested_at starts null (age gate pending)');

-- client grants on the 0017 columns
select tests.authenticate_as(:'pk');
select is(tests.affected_rows(format($q$update public.users set age_attested_at = now() where id = %L$q$, :'pk')), 1::bigint,
  'the user records the 18+ attestation');
select is(tests.affected_rows(format($q$update public.users set analytics_opt_out = true, units = 'imperial' where id = %L$q$, :'pk')), 1::bigint,
  'the user changes analytics opt-out and units');
select throws_ok(format($$update public.users set is_internal = true where id = %L$$, :'pk'),
  '42501', null, 'is_internal is service-only');
select throws_ok(format($$update public.users set deletion_scheduled_for = now() where id = %L$$, :'pk'),
  '42501', null, 'deletion_scheduled_for is service-only');
select tests.clear_authentication();

update auth.users set email = 'pk2@test.thuluth.app' where id = :'pk';
select is((select email::text from public.users where id = :'pk'), 'pk2@test.thuluth.app', 'email changes still sync');

select * from finish();
rollback;
