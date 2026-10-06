-- supabase/tests/database/rls/000_invariants.test.sql
-- Schema invariants (21-testing-strategy.md 6.3, 05-database-schema.md section 21 items 1 and 11).
begin;
select plan(9);

select is(
  (select array_agg(c.relname::text order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity),
  null,
  'RLS is enabled on every public table and partition'
);

select is(
  (select array_agg(c.relname::text order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r','p') and not c.relispartition
     and not exists (select 1 from pg_policy p where p.polrelid = c.oid)),
  null,
  'every public table (except partitions) has at least one policy'
);

select is(
  (select array_agg(n.nspname || '.' || p.proname order by 1)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','private') and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')),
  null,
  'every security definer function pins search_path'
);

select is(
  (select array_agg(c.relname::text order by c.relname)
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   join pg_attribute a on a.attrelid = c.oid and a.attname = 'updated_at' and not a.attisdropped
   where n.nspname = 'public' and c.relkind in ('r','p') and not c.relispartition
     and c.relname <> 'rate_limit_buckets'   -- 05 22.11: consume_rate_limit sets updated_at itself (hot path, no trigger)
     and not exists (
       select 1 from pg_trigger t
       where t.tgrelid = c.oid and not t.tgisinternal
         and t.tgfoid = 'public.set_updated_at()'::regprocedure)),
  null,
  'every public table with updated_at has the set_updated_at trigger'
);

select is(
  (select array_agg(table_name::text order by table_name)
   from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon'),
  null,
  'anon has no table privileges in public'
);

select is(
  (select array_agg(c.relname::text order by c.relname)
   from pg_inherits i join pg_class c on c.oid = i.inhrelid
   where i.inhparent = 'public.analytics_events'::regclass
     and (has_table_privilege('authenticated', c.oid, 'select')
          or has_table_privilege('authenticated', c.oid, 'insert'))),
  null,
  'authenticated has no direct privileges on analytics_events partitions'
);

select is(
  (select count(*)
   from generate_series(0, 3) m
   where to_regclass(format('public.analytics_events_y%sm%s',
           to_char(date_trunc('month', now() at time zone 'UTC') + make_interval(months => m), 'YYYY'),
           to_char(date_trunc('month', now() at time zone 'UTC') + make_interval(months => m), 'MM'))) is not null),
  4::bigint,
  'analytics_events has partitions for the current month and the next three'
);

select ok(
  exists (select 1 from cron.job where jobname = 'analytics-partitions')
  and exists (select 1 from cron.job where jobname = 'analytics-retention'),
  'partition maintenance cron jobs are scheduled'
);

select enum_has_labels('public', 'household_role', array['owner','caregiver','viewer','coach'],
  'canonical enum household_role matches 00-foundations');

select * from finish();
rollback;
