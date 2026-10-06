-- supabase/tests/database/rls/030_household_isolation.test.sql
-- Cross-household isolation for every household-scoped table (21-testing-strategy.md 6.3 and 6.4,
-- 05 section 21 item 2). Household A is fully seeded; owner, caregiver and viewer of household B
-- and an outsider with no household must read, update and delete zero rows of household A.
-- A statement the role has no privilege for at all (42501) counts as zero rows.
begin;
select plan(578);

select tests.seed_household(tests.create_user('iso-ownerA@test.thuluth.app'), 'Household A') as hid_a \gset
select tests.create_user('iso-ownerB@test.thuluth.app') as owner_b \gset
select tests.seed_household(:'owner_b', 'Household B') as hid_b \gset
select tests.create_user('iso-careB@test.thuluth.app')   as care_b \gset
select tests.create_user('iso-viewerB@test.thuluth.app') as viewer_b \gset
select tests.create_user('iso-outsider@test.thuluth.app') as outsider \gset
select tests.add_member(:'hid_b', :'care_b', 'caregiver');
select tests.add_member(:'hid_b', :'viewer_b', 'viewer');

-- invariant: every public base table with household_id has a fixture row (21 section 6.3)
select is(
  (select array_agg(c.relname::text order by c.relname)
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   join pg_attribute a on a.attrelid = c.oid and a.attname = 'household_id' and not a.attisdropped
   where n.nspname = 'public' and c.relkind in ('r','p') and not c.relispartition
     and c.relname not in (select table_name from tests.rls_fixture_coverage)),
  null,
  'every household-scoped table has an RLS fixture row');

select ok(
  (select bool_and(n > 0) from (
     select (xpath('//n/text()', query_to_xml(format('select count(*) as n from public.%I where household_id = %L',
              t.table_name, :'hid_a'), false, false, '')))[1]::text::int as n
     from tests.rls_fixture_coverage t) x),
  'household A has at least one row in every covered table');

create or replace function tests.count_or_zero(p_sql text)
returns bigint language plpgsql as $$
declare v bigint;
begin
  execute p_sql into v;
  return coalesce(v, 0);
exception when insufficient_privilege then
  return 0;
end $$;

create or replace function tests.assert_isolation(p_target uuid, p_actor uuid, p_label text)
returns setof text language plpgsql as $$
declare t record;
begin
  for t in select table_name from tests.rls_fixture_coverage order by 1 loop
    perform tests.authenticate_as(p_actor);
    return next is(
      tests.count_or_zero(format('select count(*) from public.%I where household_id = %L', t.table_name, p_target)),
      0::bigint, format('%s cannot read %s of another household', p_label, t.table_name));
    return next is(
      tests.count_or_zero(format('with u as (update public.%I set updated_at = now() where household_id = %L returning 1) select count(*) from u',
                                 t.table_name, p_target)),
      0::bigint, format('%s cannot update %s of another household', p_label, t.table_name));
    return next is(
      tests.count_or_zero(format('with d as (delete from public.%I where household_id = %L returning 1) select count(*) from d',
                                 t.table_name, p_target)),
      0::bigint, format('%s cannot delete %s of another household', p_label, t.table_name));
    perform tests.clear_authentication();
  end loop;
end $$;
grant execute on function tests.count_or_zero(text), tests.assert_isolation(uuid, uuid, text) to authenticated;

-- 48 tables x 3 operations x 4 actors = 576
select tests.assert_isolation(:'hid_a', :'owner_b', 'owner of B');
select tests.assert_isolation(:'hid_a', :'care_b', 'caregiver of B');
select tests.assert_isolation(:'hid_a', :'viewer_b', 'viewer of B');
select tests.assert_isolation(:'hid_a', :'outsider', 'outsider');

select * from finish();
rollback;
