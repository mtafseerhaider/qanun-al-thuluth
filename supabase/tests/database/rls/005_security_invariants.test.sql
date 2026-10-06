-- supabase/tests/database/rls/005_security_invariants.test.sql
-- S7-03 security invariants (16 sections 5 and 19, docs/security/s7-security-review.md). These are schema-wide
-- guards: a new table, view, function or bucket that breaks one of them fails CI until it is fixed or
-- deliberately allow-listed here with a reason.
begin;
select plan(18);

-- Schemas the app owns. System and extension schemas are excluded.
create temporary view app_schemas as
  select oid, nspname from pg_namespace
  where nspname in ('public', 'private', 'analytics');

-- 1. Every table in an app schema has RLS, unless no client role can reach it at all.
select is(
  (select array_agg(n.nspname || '.' || c.relname order by n.nspname || '.' || c.relname)
   from pg_class c join app_schemas n on n.oid = c.relnamespace
   where c.relkind in ('r', 'p') and not c.relrowsecurity
     and (has_schema_privilege('authenticated', n.oid, 'usage') or has_schema_privilege('anon', n.oid, 'usage'))),
  null,
  'every table in a schema reachable by client roles has RLS enabled'
);

-- 2. Client roles cannot reach the internal schemas.
select is(
  (select array_agg(nspname::text order by nspname::text) from app_schemas
   where nspname in ('private', 'analytics')
     and (has_schema_privilege('anon', oid, 'usage') or has_schema_privilege('authenticated', oid, 'usage'))),
  null,
  'anon and authenticated have no USAGE on private or analytics'
);

-- 3. Every security definer function outside system schemas pins search_path ...
select is(
  (select array_agg(n.nspname || '.' || p.proname order by n.nspname || '.' || p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.prosecdef
     and n.nspname not in ('pg_catalog', 'information_schema', 'extensions', 'auth', 'storage', 'cron',
                           'vault', 'realtime', 'net', 'pgmq', 'graphql', 'graphql_public', 'supabase_functions',
                           'pgsodium', 'pgbouncer', 'tests')
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%')),
  null,
  'every security definer function pins search_path'
);

-- 4. ... to the empty path, so every object reference must be schema-qualified.
select is(
  (select array_agg(n.nspname || '.' || p.proname order by n.nspname || '.' || p.proname)
   from pg_proc p join app_schemas n on n.oid = p.pronamespace
   where p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg
                     where cfg in ('search_path=""', 'search_path=''''', 'search_path=')) ),
  null,
  'security definer functions in app schemas use search_path = '''''
);

-- 5. anon may execute only the caller-scoped membership helpers (they answer false without a JWT).
select is(
  (select array_agg(p.proname::text order by p.proname::text)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'execute')
     and p.proname not in ('can_author_plans', 'can_edit_household', 'household_role_of', 'is_household_member',
                           'is_linked_member', 'my_household_ids', 'shares_household_with')),
  null,
  'anon executes no security definer function beyond the caller-scoped membership helpers'
);

-- 6. Service-role-only RPCs stay closed to client roles.
select is(
  (select array_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('accept_household_invitation', 'account_deletion_blockers', 'account_export_user_data',
                       'acquire_job_lease', 'release_job_lease', 'ai_quota_check', 'analytics_maintain_partitions',
                       'cancel_account_deletion', 'consume_rate_limit', 'execute_account_erasure',
                       'plan_generation_ack', 'plan_generation_enqueue', 'plan_generation_read',
                       'recompute_recipe_nutrition', 'refresh_analytics_views', 'refresh_ingredient_prices',
                       'request_account_deletion')
     and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  null,
  'service-role-only functions are not executable by anon or authenticated'
);

-- 7. Views in public run with the caller's rights, except the admin views that filter on is_admin() themselves.
select is(
  (select array_agg(c.relname::text order by c.relname::text)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'v'
     and not coalesce('security_invoker=true' = any (c.reloptions), false)
     and not (c.relname like 'v\_admin\_%'
              and 'security_barrier=true' = any (c.reloptions)
              and pg_get_viewdef(c.oid) like '%is_admin()%')),
  null,
  'public views are security_invoker (admin views: security_barrier and is_admin())'
);

-- 8. Materialized views bypass RLS: only the aggregated price views are readable by clients.
select is(
  (select array_agg(n.nspname || '.' || c.relname order by n.nspname || '.' || c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind = 'm'
     and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select'))
     and (n.nspname, c.relname) not in (('public', 'mv_current_prices'), ('public', 'mv_ingredient_prices'))),
  null,
  'no client-readable materialized view beyond the price aggregates'
);

-- 9. Policies are written for authenticated (or service roles), never for PUBLIC or anon.
select is(
  (select array_agg(schemaname || '.' || tablename || '.' || policyname order by schemaname || '.' || tablename || '.' || policyname)
   from pg_policies
   where schemaname in ('public', 'storage', 'analytics')
     and (roles @> array['public']::name[] or roles @> array['anon']::name[])),
  null,
  'no RLS policy applies to PUBLIC or anon'
);

-- 10. authenticated never holds TRUNCATE, REFERENCES or TRIGGER on app tables.
select is(
  (select array_agg(distinct table_name::text order by table_name::text)
   from information_schema.role_table_grants
   where table_schema in ('public', 'analytics') and grantee in ('anon', 'authenticated')
     and privilege_type in ('TRUNCATE', 'REFERENCES', 'TRIGGER')),
  null,
  'client roles hold no TRUNCATE, REFERENCES or TRIGGER privileges'
);

-- Storage (Supabase, or the plain-mode stub) -------------------------------------------------------------------------------
-- 11 to 13 run on the bucket rows; they pass vacuously when the storage schema is absent.
select is(
  (select array_agg(b.id order by b.id) from storage.buckets b
   where b.id in ('meal-photos', 'chat-attachments', 'voice-notes', 'avatars', 'exports', 'recipe-images')
     and (b.file_size_limit is null or b.allowed_mime_types is null or cardinality(b.allowed_mime_types) = 0)),
  null,
  'every app bucket has a size limit and a MIME allow-list'
);

select is(
  (select array_agg(b.id order by b.id) from storage.buckets b where b.public and b.id <> 'recipe-images'),
  null,
  'recipe-images is the only public bucket'
);

select is(
  (select array_agg(policyname::text order by policyname::text) from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE', 'ALL')
     and policyname not in ('avatars_update', 'recipe_images_admin_write')),
  null,
  'storage UPDATE is limited to avatars (upsert) and the admin recipe-image writer'
);

select is(
  (select array_agg(policyname::text order by policyname::text) from pg_policies
   where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE', 'ALL') and with_check is null),
  null,
  'every storage update policy has a WITH CHECK'
);

-- Behaviour of the S7-SEC-01 guards --------------------------------------------------------------------------------------------
select tests.create_user('sec-a@example.com') as a \gset
select tests.create_user('sec-b@example.com') as b \gset
select tests.create_household(:'b', 'Other family') as hb \gset
insert into public.subscriptions (user_id, store, tier, entitlement, status, environment, current_period_end,
                                  product_id, rc_app_user_id)
values (:'b', 'app_store', 'premium', 'premium', 'active', 'production', now() + interval '20 days',
        'thuluth_premium_monthly', :'b');
insert into public.consents (user_id, kind, version, granted_at)
select :'b', 'health_data', coalesce((select current_version from public.consent_versions where kind = 'health_data'), '1'), now();

select ok(public.has_premium(:'b') and public.has_active_consent(:'b', 'health_data'),
  'service context (no JWT) still sees premium and consent');

select tests.authenticate_as(:'a');
select ok(not public.has_premium(:'b'), 'a stranger cannot probe another user''s premium status');
select ok(not public.has_active_consent(:'b', 'health_data'),
  'a stranger cannot probe another user''s health_data consent');
select ok(not public.household_has_premium(:'hb'), 'a stranger cannot probe another household''s premium status');
select tests.clear_authentication();

select * from finish();
rollback;
