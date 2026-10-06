-- supabase/tests/database/functions/100_storage_policies.test.sql
-- S5-02 storage buckets and policies (10 sections 6.1, 6.2, 6.4, 6.5; 16 section 4.4; AC-S2): meal-photos for
-- household members (editors and self-logging linked members write), chat-attachments private to the session
-- owner, voice-notes for premium uploaders and readable by the uploader only, first path segment = household.
-- Path helpers run everywhere; the storage cases run when the storage schema exists (Supabase, or the
-- plain-mode stub in tooling/scripts/pg-stubs) and are skipped otherwise.
begin;
select plan(30);

select is(public.path_household_id('5c1e0000-0000-4000-8000-000000000001/x/y.jpg'), '5c1e0000-0000-4000-8000-000000000001'::uuid,
  'path_household_id reads the first segment');
select is(public.path_household_id('users/5c1e0000-0000-4000-8000-000000000001/avatar.webp'), null::uuid,
  'a non-uuid first segment yields null (matches no household)');
select is(public.path_household_id('../5c1e0000-0000-4000-8000-000000000001/x.jpg'), null::uuid, 'no path tricks');
select is(public.path_segment_uuid('a/5c1e0000-0000-4000-8000-000000000001/b', 2), '5c1e0000-0000-4000-8000-000000000001'::uuid,
  'path_segment_uuid reads segment n');

select tests.create_user('st-owner@test.thuluth.app')    as owner \gset
select tests.create_user('st-care@test.thuluth.app')     as care \gset
select tests.create_user('st-linked@test.thuluth.app')   as linked \gset
select tests.create_user('st-viewer@test.thuluth.app')   as viewer \gset
select tests.create_user('st-outsider@test.thuluth.app') as outsider \gset
select tests.seed_household(:'owner', 'Storage home') as hid \gset
select tests.seed_household(:'outsider', 'Outsider home') as other_hid \gset
select tests.add_member(:'hid', :'care', 'caregiver');
select tests.add_member(:'hid', :'linked', 'viewer');
select tests.add_member(:'hid', :'viewer', 'viewer');
select id as son from public.family_members where household_id = :'hid' and name = 'Son' \gset
select id as owner_session from public.chat_sessions where household_id = :'hid' \gset
set local app.bypass_entitlements = 'on';
insert into public.family_members (household_id, linked_user_id, name, date_of_birth, sex_at_birth)
values (:'hid', :'linked', 'Uncle', current_date - interval '40 years', 'male') returning id as uncle \gset
set local app.bypass_entitlements = 'off';
select set_config('st.hid', :'hid', true), set_config('st.other', :'other_hid', true),
       set_config('st.son', :'son', true), set_config('st.uncle', :'uncle', true),
       set_config('st.session', :'owner_session', true),
       set_config('st.owner', :'owner', true), set_config('st.care', :'care', true),
       set_config('st.linked', :'linked', true), set_config('st.viewer', :'viewer', true),
       set_config('st.outsider', :'outsider', true);

create function pg_temp.storage_cases() returns setof text language plpgsql as $f$
declare
  hid text := current_setting('st.hid');     other text := current_setting('st.other');
  son text := current_setting('st.son');     uncle text := current_setting('st.uncle');
  sess text := current_setting('st.session');
  ins constant text := 'insert into storage.objects (bucket_id, name, owner_id) values (%L, %L, %L)';
begin
  return next is((select count(*) from storage.buckets where id in ('meal-photos','chat-attachments','voice-notes') and not public),
    3::bigint, 'meal-photos, chat-attachments and voice-notes exist and are private');

  -- meal-photos ----------------------------------------------------------------------------------------------------
  perform tests.authenticate_as(current_setting('st.care')::uuid);
  return next lives_ok(format(ins, 'meal-photos', hid || '/' || son || '/2026/10/a.jpg', current_setting('st.care')),
    'meal-photos: a caregiver uploads a child''s meal photo');
  perform tests.authenticate_as(current_setting('st.linked')::uuid);
  return next lives_ok(format(ins, 'meal-photos', hid || '/' || uncle || '/2026/10/b.jpg', current_setting('st.linked')),
    'meal-photos: a linked member uploads their own photo');
  return next throws_ok(format(ins, 'meal-photos', hid || '/' || son || '/2026/10/c.jpg', current_setting('st.linked')),
    '42501', null, 'meal-photos: but not under another member');
  return next throws_ok(format(ins, 'meal-photos', other || '/' || uncle || '/2026/10/d.jpg', current_setting('st.linked')),
    '42501', null, 'meal-photos: nor under another household''s prefix');
  perform tests.authenticate_as(current_setting('st.viewer')::uuid);
  return next throws_ok(format(ins, 'meal-photos', hid || '/' || son || '/2026/10/e.jpg', current_setting('st.viewer')),
    '42501', null, 'meal-photos: an unlinked viewer cannot upload');
  return next is((select count(*) from storage.objects where bucket_id = 'meal-photos' and name like hid || '/%'), 2::bigint,
    'meal-photos: a viewer reads the household''s photos');
  return next is(tests.affected_rows(format($$delete from storage.objects where bucket_id = 'meal-photos' and name like %L$$, hid || '/%')),
    0::bigint, 'meal-photos: a viewer deletes nothing');
  perform tests.authenticate_as(current_setting('st.outsider')::uuid);
  return next is((select count(*) from storage.objects where bucket_id = 'meal-photos' and name like hid || '/%'), 0::bigint,
    'meal-photos: another household reads nothing');
  return next throws_ok(format(ins, 'meal-photos', hid || '/' || son || '/2026/10/f.jpg', current_setting('st.outsider')),
    '42501', null, 'meal-photos: another household cannot upload into this prefix');
  perform tests.authenticate_as(current_setting('st.linked')::uuid);
  return next is(tests.affected_rows(format($$delete from storage.objects where bucket_id = 'meal-photos' and name like %L$$, hid || '/%')),
    1::bigint, 'meal-photos: a linked member deletes only their own photo');
  return next is(tests.affected_rows(format($$update storage.objects set name = name || '.x' where bucket_id = 'meal-photos' and name like %L$$, hid || '/%')),
    0::bigint, 'meal-photos: photos are immutable (no update policy)');

  -- chat-attachments ------------------------------------------------------------------------------------------------
  perform tests.authenticate_as(current_setting('st.owner')::uuid);
  return next lives_ok(format(ins, 'chat-attachments', hid || '/' || sess || '/p.jpg', current_setting('st.owner')),
    'chat-attachments: the session owner uploads');
  return next throws_ok(format(ins, 'chat-attachments', other || '/' || sess || '/q.jpg', current_setting('st.owner')),
    '42501', null, 'chat-attachments: the household segment must match the session');
  return next is((select count(*) from storage.objects where bucket_id = 'chat-attachments'), 1::bigint,
    'chat-attachments: the owner reads their attachment');
  perform tests.authenticate_as(current_setting('st.care')::uuid);
  return next throws_ok(format(ins, 'chat-attachments', hid || '/' || sess || '/r.jpg', current_setting('st.care')),
    '42501', null, 'chat-attachments: a co-member cannot upload into someone else''s session');
  return next is((select count(*) from storage.objects where bucket_id = 'chat-attachments'), 0::bigint,
    'chat-attachments: nor read it, even as owner-level caregiver of the household');
  return next is(tests.affected_rows($$delete from storage.objects where bucket_id = 'chat-attachments'$$), 0::bigint,
    'chat-attachments: nor delete it');
  perform tests.authenticate_as(current_setting('st.owner')::uuid);
  perform public.soft_delete('chat_sessions', sess::uuid);
  return next throws_ok(format(ins, 'chat-attachments', hid || '/' || sess || '/s.jpg', current_setting('st.owner')),
    '42501', null, 'chat-attachments: no uploads into a deleted session');
  return next is((select count(*) from storage.objects where bucket_id = 'chat-attachments'), 0::bigint,
    'chat-attachments: a deleted session''s attachments are no longer readable');

  -- voice-notes -------------------------------------------------------------------------------------------------------
  return next throws_ok(format(ins, 'voice-notes', hid || '/v1.m4a', current_setting('st.owner')),
    '42501', null, 'voice-notes: a free user cannot upload (premium feature)');
  perform tests.clear_authentication();
  insert into public.subscriptions (user_id, tier, status, product_id, store, rc_app_user_id, current_period_end)
  values (current_setting('st.owner')::uuid, 'premium', 'active', 'thuluth_premium_monthly', 'app_store',
          current_setting('st.owner'), now() + interval '30 days');
  perform tests.authenticate_as(current_setting('st.owner')::uuid);
  return next lives_ok(format(ins, 'voice-notes', hid || '/v2.m4a', current_setting('st.owner')),
    'voice-notes: a premium member uploads');
  return next is((select count(*) from storage.objects where bucket_id = 'voice-notes'), 1::bigint,
    'voice-notes: the uploader reads their note');
  perform tests.authenticate_as(current_setting('st.care')::uuid);
  return next is((select count(*) from storage.objects where bucket_id = 'voice-notes'), 0::bigint,
    'voice-notes: a co-member cannot read it');
  return next throws_ok(format(ins, 'voice-notes', hid || '/v3.m4a', current_setting('st.care')),
    '42501', null, 'voice-notes: personal premium is required (household premium does not unlock voice)');
  perform tests.authenticate_as(current_setting('st.outsider')::uuid);
  return next throws_ok(format(ins, 'voice-notes', hid || '/v4.m4a', current_setting('st.outsider')),
    '42501', null, 'voice-notes: a non-member cannot upload into the household prefix');
  perform tests.clear_authentication();
end $f$;

select * from pg_temp.storage_cases() where to_regclass('storage.objects') is not null
union all
select skip('storage schema not present (plain Postgres without the stub)', 26) where to_regclass('storage.objects') is null;

select * from finish();
rollback;
