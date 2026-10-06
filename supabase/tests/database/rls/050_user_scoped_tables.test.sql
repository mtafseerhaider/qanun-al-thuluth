-- supabase/tests/database/rls/050_user_scoped_tables.test.sql
-- consents (own rows; insert and withdraw only), devices (own rows), audit_log (actor and household
-- owner read; nobody writes or edits through the API; append-only even for postgres), consent_versions
-- (catalog) and has_active_consent (21-testing-strategy.md 6.1 "Personal tables", 05 section 21 item 8).
begin;
select plan(30);

select tests.create_user('us-owner@test.thuluth.app')  as owner \gset
select tests.create_user('us-care@test.thuluth.app')   as care \gset
select tests.create_user('us-viewer@test.thuluth.app') as viewer \gset
select tests.create_user('us-other@test.thuluth.app')  as other \gset
select tests.seed_household(:'owner', 'User scoped home') as hid \gset
select tests.add_member(:'hid', :'care', 'caregiver');
select tests.add_member(:'hid', :'viewer', 'viewer');

-- ---- consents -----------------------------------------------------------------------------------
select tests.authenticate_as(:'care');
select lives_ok(format($$insert into public.consents (user_id, kind, version) values (%L, 'terms', '2026-10')$$, :'care'),
  'a user records their own consent');
select lives_ok(format($$insert into public.consents (user_id, household_id, kind, version) values (%L, %L, 'child_data', '2026-10')$$, :'care', :'hid'),
  'a caregiver records child_data consent for their household');
select throws_ok(format($$insert into public.consents (user_id, kind, version) values (%L, 'terms', '2026-10')$$, :'other'),
  '42501', null, 'a user cannot record consent for someone else');
select is((select count(*) from public.consents), 2::bigint, 'a user reads only their own consents');
select is(tests.affected_rows(format($q$update public.consents set withdrawn_at = now() where user_id = %L and kind = 'terms'$q$, :'care')),
  1::bigint, 'a user withdraws their own consent');
select throws_ok($$update public.consents set version = '2099-01'$$,
  '42501', null, 'consent version is not editable');
select throws_ok($$delete from public.consents$$, '42501', null, 'consents cannot be deleted by clients');
select ok(public.has_active_consent(:'care', 'child_data', :'hid'), 'has_active_consent sees the household child_data consent');
select ok(not public.has_active_consent(:'care', 'terms'), 'a withdrawn consent is not active');
select tests.clear_authentication();

select tests.authenticate_as(:'viewer');
select throws_ok(format($$insert into public.consents (user_id, household_id, kind, version) values (%L, %L, 'child_data', '2026-10')$$, :'viewer', :'hid'),
  '42501', null, 'a viewer cannot record household-scoped consent');
select is((select count(*) from public.consents where user_id = :'care'), 0::bigint, 'a co-member cannot read another member''s consents');
select tests.clear_authentication();

-- consent_versions bumps make older consents inactive
insert into public.consent_versions (kind, current_version, text_hash) values ('child_data', '2027-01', repeat('a', 64));
select ok(not public.has_active_consent(:'care', 'child_data', :'hid'), 'a consent at an old version is not active after a bump');
select tests.authenticate_as(:'care');
select is((select count(*) from public.consent_versions), 1::bigint, 'consent_versions is readable');
select throws_ok($$insert into public.consent_versions (kind, current_version, text_hash) values ('terms', 'x', 'y')$$,
  '42501', null, 'consent_versions is not writable by users');
select tests.clear_authentication();

-- ---- devices -------------------------------------------------------------------------------------
select tests.authenticate_as(:'care');
select lives_ok(format($$insert into public.devices (id, user_id, platform, app_version) values ('44444444-4444-4444-8444-444444444444', %L, 'android', '1.0.0')
                         on conflict (id) do update set last_seen_at = now(), app_version = excluded.app_version$$, :'care'),
  'a user upserts their own device');
select lives_ok(format($$insert into public.devices (id, user_id, platform, app_version) values ('44444444-4444-4444-8444-444444444444', %L, 'android', '1.0.1')
                         on conflict (id) do update set last_seen_at = now(), app_version = excluded.app_version$$, :'care'),
  'the device upsert is repeatable');
select throws_ok(format($$insert into public.devices (user_id, platform, app_version) values (%L, 'ios', '1.0.0')$$, :'other'),
  '42501', null, 'a user cannot register a device for someone else');
select tests.clear_authentication();
select tests.authenticate_as(:'owner');
select is((select count(*) from public.devices), 0::bigint, 'devices of a co-member are invisible');
select is(tests.affected_rows($q$delete from public.devices$q$), 0::bigint, 'a user cannot delete a co-member''s device');
select tests.clear_authentication();

-- ---- audit_log ------------------------------------------------------------------------------------
select ok((select count(*) from public.audit_log where household_id = :'hid' and entity = 'family_members') >= 3,
  'family_members inserts are audited');
-- every update row in one transaction shares `at`, so assert over all of them rather than picking one
select ok(exists (select 1 from public.audit_log where household_id = :'hid' and entity = 'family_members' and action = 'update'
                    and diff = '{"special_modules":"changed"}'::jsonb)
          and not exists (select 1 from public.audit_log a, jsonb_each_text(a.diff) d
                           where a.household_id = :'hid' and a.entity = 'family_members' and a.action = 'update'
                             and d.value <> 'changed'),
  'family_members audit is keys-only (no health values)');
select ok(exists (select 1 from public.audit_log where entity = 'household_invitations' and household_id = :'hid'
                  and not (diff -> 'new' ? 'token_hash')),
  'invitation audit rows redact token_hash');

select tests.authenticate_as(:'owner');
select ok((select count(*) from public.audit_log where household_id = :'hid') > 0, 'the household owner reads the household audit log');
select throws_ok(format($$insert into public.audit_log (household_id, action, entity) values (%L, 'insert', 'forged')$$, :'hid'),
  '42501', null, 'clients cannot write audit_log');
select throws_ok($$update public.audit_log set entity = 'x'$$, '42501', null, 'clients cannot update audit_log');
select throws_ok($$delete from public.audit_log$$, '42501', null, 'clients cannot delete audit_log');
select tests.clear_authentication();

select tests.authenticate_as(:'viewer');
select is((select count(*) from public.audit_log where household_id = :'hid' and actor_user_id is distinct from :'viewer'::uuid), 0::bigint,
  'a viewer cannot read the household audit log');
select tests.clear_authentication();

select throws_ok($$update public.audit_log set entity = 'tampered'$$, '42501', 'AUDIT_LOG_IMMUTABLE',
  'audit_log rows are immutable even for postgres');
select throws_ok($$delete from public.audit_log$$, '42501', 'AUDIT_LOG_IMMUTABLE',
  'audit_log rows cannot be deleted outside the retention job');

-- identity link audit (0022a)
insert into auth.identities (provider_id, user_id, identity_data, provider)
values (:'other', :'other', jsonb_build_object('sub', :'other'), 'google');
select is((select action from public.audit_log where actor_user_id = :'other' and entity = 'auth.identities'),
  'identity.linked', 'linking an identity is audited');

select * from finish();
rollback;
