-- supabase/tests/database/rls/130_notifications_feedback.test.sql
-- S4-02 notifications (05 sections 13.2, 13.3, 15.9, 16.3.8; 06 section 4.15) and alpha_feedback (S3-17,
-- S4-18): default preferences at signup and back-fill, the canonical kind vocabulary, safety kinds that
-- cannot be switched off, own-rows RLS, read_at as the only client-writable notification column, dedupe,
-- the inbox Realtime publication, and feedback insert/select own.
begin;
select plan(30);

select tests.create_user('nf-owner@test.thuluth.app') as owner \gset
select tests.create_user('nf-other@test.thuluth.app') as other \gset
select tests.seed_household(:'owner', 'Notify home') as hid \gset
select tests.create_household(:'other', 'Other home') as other_hid \gset
select id as note from public.notifications where user_id = :'owner' \gset

-- ---- signup defaults (05 15.9, criterion 9; kinds and defaults from 06 4.15) ----------------------------
select is((select count(*) from public.notification_preferences where user_id = :'owner'),
  cardinality(public.notification_kinds())::bigint, 'signup creates one preference row per kind');
select is(cardinality(public.notification_kinds()), 23, 'the canonical list has 23 kinds (06 4.15 incl. trial_ending)');
select is((select array_agg(kind order by kind) from public.notification_preferences where user_id = :'owner' and not enabled),
  array['fasting_sunnah_reminder','journal_prompt','marketing','meal_log_prompt','meal_reminder'],
  'opt-in kinds start disabled (marketing, voluntary fasts, meal and journal prompts)');
select ok((select bool_and(enabled) from public.notification_preferences
            where user_id = :'owner' and kind in ('hydration_reminder','plan_ready','growth_alert','allergy_warning','suhoor_reminder')),
  'the default-on kinds start enabled');
select is((select count(*) from public.users u
            where (select count(*) from public.notification_preferences p where p.user_id = u.id) <> cardinality(public.notification_kinds())),
  0::bigint, 'every existing user has the full set (back-fill and dev fixtures)');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'),
  'notifications is in the supabase_realtime publication (inbox)');

-- ---- preferences: own rows -----------------------------------------------------------------------------
select tests.authenticate_as(:'owner');
select is((select count(*) from public.notification_preferences), cardinality(public.notification_kinds())::bigint,
  'a user reads only their own preferences');
select is(tests.affected_rows($$update public.notification_preferences set enabled = false, quiet_hours = '{"start":"22:00","end":"06:30","tz":"Asia/Karachi"}' where kind = 'hydration_reminder'$$),
  1::bigint, 'and switches a kind off with quiet hours');
select is(tests.affected_rows($$update public.notification_preferences set enabled = true, settings = '{"monday_thursday":true,"ashura_companion":"9"}' where kind = 'fasting_sunnah_reminder'$$),
  1::bigint, 'opts in to voluntary fast reminders with settings');
select throws_ok($$update public.notification_preferences set enabled = false where kind = 'growth_alert'$$,
  '23514', null, 'safety kinds cannot be disabled');
select throws_ok($$update public.notification_preferences set settings = '[]' where kind = 'grocery_day'$$,
  '23514', null, 'settings must be an object');
select is(tests.affected_rows(format($$update public.notification_preferences set enabled = false where user_id = %L$$, :'other')),
  0::bigint, 'cannot change another user''s preferences');
select throws_ok(format($$insert into public.notification_preferences (user_id, kind) values (%L, 'marketing')$$, :'other'),
  '42501', null, 'or create them');
select throws_ok($$insert into public.notification_preferences (user_id, kind) values (auth.uid(), 'suhoor_alarm')$$,
  '23514', null, 'kinds outside the canonical list are rejected');

-- ---- notifications: read own, mark read only -----------------------------------------------------------------
select is((select count(*) from public.notifications), 1::bigint, 'a user reads their own notifications');
select is(tests.affected_rows(format($$update public.notifications set read_at = now() where id = %L$$, :'note')),
  1::bigint, 'and marks one read');
select throws_ok(format($$update public.notifications set title = 'x' where id = %L$$, :'note'),
  '42501', null, 'but cannot change its content');
select throws_ok(format($$insert into public.notifications (user_id, kind, title, body) values (%L, 'plan_ready', 't', 'b')$$, :'owner'),
  '42501', null, 'clients cannot create notifications');
select throws_ok(format($$delete from public.notifications where id = %L$$, :'note'), '42501', null, 'or delete them');
select tests.clear_authentication();

select tests.authenticate_as(:'other');
select is((select count(*) from public.notifications), 0::bigint, 'another user sees none of them');
select is(tests.affected_rows(format($$update public.notifications set read_at = now() where id = %L$$, :'note')),
  0::bigint, 'and cannot mark them read');
select tests.clear_authentication();

insert into public.notifications (user_id, kind, title, body, dedupe_key, scheduled_for)
values (:'owner', 'hydration_reminder', 'Water time', 'A glass before lunch', 'hydration:x:2026-10-06T12:30', now());
select throws_ok(format($$insert into public.notifications (user_id, kind, title, body, dedupe_key) values (%L, 'hydration_reminder', 'Water time', 'Again', 'hydration:x:2026-10-06T12:30')$$, :'owner'),
  '23505', null, 'dedupe_key makes materialization idempotent per user');
select throws_ok(format($$insert into public.notifications (user_id, kind, title, body) values (%L, 'grocery_reminder', 't', 'b')$$, :'owner'),
  '23514', null, 'notifications use the same kind vocabulary');

-- ---- alpha_feedback ------------------------------------------------------------------------------------------
select tests.authenticate_as(:'owner');
select lives_ok(format($$insert into public.alpha_feedback (id, household_id, category, message, screen, app_version, platform, locale, client_created_at)
  values ('00000000-0000-4000-8000-0000000fb001', %L, 'bug', 'Ring did not update', 'Hydration', '0.4.0', 'android', 'ur', now())$$, :'hid'),
  'a user sends feedback (user_id defaults to the caller)');
select lives_ok($$insert into public.alpha_feedback (id, category, message, app_version) values ('00000000-0000-4000-8000-0000000fb001', 'bug', 'Ring did not update', '0.4.0') on conflict (id) do nothing$$,
  'an outbox retry with the same id is a no-op');
select is((select count(*) from public.alpha_feedback), 2::bigint, 'and reads their own feedback');
select throws_ok(format($$insert into public.alpha_feedback (user_id, category, message, app_version) values (%L, 'idea', 'Spoofed', '0.4.0')$$, :'other'),
  '42501', null, 'cannot send feedback as another user');
select throws_ok(format($$insert into public.alpha_feedback (household_id, category, message, app_version) values (%L, 'idea', 'Wrong home', '0.4.0')$$, :'other_hid'),
  '42501', null, 'or for a household they do not belong to');
select throws_ok($$insert into public.alpha_feedback (category, message, app_version, status) values ('idea', 'Triage myself', '0.4.0', 'fixed')$$,
  '42501', null, 'or set the triage status');
select tests.clear_authentication();

select tests.authenticate_as(:'other');
select is((select count(*) from public.alpha_feedback), 0::bigint, 'other users cannot read it');
select tests.clear_authentication();

select * from finish();
rollback;
