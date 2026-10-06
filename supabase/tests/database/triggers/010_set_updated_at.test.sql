-- supabase/tests/database/triggers/010_set_updated_at.test.sql
-- set_updated_at() trigger (00 section 4.1). Rows are inserted with an old updated_at (the
-- trigger is update-only) and must carry now() after an update.
begin;
select plan(6);

select tests.create_user('stamp@test.thuluth.app') as uid \gset
set local app.bypass_entitlements = 'on';
insert into public.households (id, owner_user_id, name, updated_at)
values ('33333333-3333-4333-8333-333333333333', :'uid', 'Stamp home', '2000-01-01');
insert into public.feature_flags (key, updated_at) values ('test.stamp', '2000-01-01');
insert into public.ai_model_routes (route_key, provider, model, priority, updated_at)
values ('test.route', 'anthropic', 'claude-haiku-4-5-20251001', 1, '2000-01-01');

select is((select updated_at from public.households where id = '33333333-3333-4333-8333-333333333333'),
  '2000-01-01'::timestamptz, 'insert keeps the supplied updated_at');

update public.households set name = 'Renamed' where id = '33333333-3333-4333-8333-333333333333';
select is((select updated_at from public.households where id = '33333333-3333-4333-8333-333333333333'), now(),
  'households.updated_at is set on update');

update public.feature_flags set enabled = true where key = 'test.stamp';
select is((select updated_at from public.feature_flags where key = 'test.stamp'), now(), 'feature_flags.updated_at is set on update');

update public.ai_model_routes set enabled = false where route_key = 'test.route';
select is((select updated_at from public.ai_model_routes where route_key = 'test.route'), now(), 'ai_model_routes.updated_at is set on update');

-- a client cannot backdate updated_at either
select tests.authenticate_as(:'uid');
update public.users set display_name = 'Stamped' where id = :'uid';
select tests.clear_authentication();
select is((select updated_at from public.users where id = :'uid'), now(), 'users.updated_at is set on a client update');

update public.households set updated_at = '1999-01-01' where id = '33333333-3333-4333-8333-333333333333';
select is((select updated_at from public.households where id = '33333333-3333-4333-8333-333333333333'), now(),
  'an explicit updated_at in an UPDATE is overridden by the trigger');

select * from finish();
rollback;
