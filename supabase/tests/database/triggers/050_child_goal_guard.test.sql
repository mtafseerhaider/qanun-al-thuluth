-- supabase/tests/database/triggers/050_child_goal_guard.test.sql
-- S2-03 (00-foundations 2.5 and 10.3, 05 section 15.11, 06 section 3.2): nutrition_goals rejects
-- weight_loss / weight_gain goals and calorie or weekly-weight targets for members under 18 with
-- P0001 CHILD_RULE:<rule> (detail carries the rule), adults are unaffected, a date-of-birth change
-- cannot turn an existing adult weight goal into a child's, and old goals can still be soft-deleted.
begin;
select plan(14);

select tests.create_user('cg-owner@test.thuluth.app') as owner \gset
select tests.seed_household(:'owner', 'Child guard home') as hid \gset
select id as adult from public.family_members where household_id = :'hid' and name = 'Adult' \gset
select id as son from public.family_members where household_id = :'hid' and name = 'Son' \gset
insert into public.family_members (household_id, name, date_of_birth) values (:'hid', 'Teen', current_date - interval '16 years');
select id as teen from public.family_members where household_id = :'hid' and name = 'Teen' \gset

select tests.authenticate_as(:'owner');

select throws_ok(format($$insert into public.nutrition_goals (household_id, family_member_id, goal_type) values (%L, %L, 'weight_loss')$$, :'hid', :'son'),
  'P0001', 'CHILD_RULE:weight_loss', 'a 7-year-old cannot get a weight_loss goal');
select throws_ok(format($$insert into public.nutrition_goals (household_id, family_member_id, goal_type) values (%L, %L, 'weight_gain')$$, :'hid', :'son'),
  'P0001', 'CHILD_RULE:weight_gain', 'a 7-year-old cannot get a weight_gain goal');
select throws_ok(format($$insert into public.nutrition_goals (household_id, family_member_id, goal_type) values (%L, %L, 'weight_loss')$$, :'hid', :'teen'),
  'P0001', 'CHILD_RULE:weight_loss', 'a 16-year-old cannot get a weight_loss goal');
select throws_ok(format($$insert into public.nutrition_goals (household_id, family_member_id, goal_type, target_value, target_unit) values (%L, %L, 'energy', 1400, 'kcal_per_day')$$, :'hid', :'son'),
  'P0001', 'CHILD_RULE:kcal_target', 'a child cannot get a calorie target');
select throws_ok(format($$update public.nutrition_goals set goal_type = 'weight_loss' where family_member_id = %L$$, :'son'),
  'P0001', 'CHILD_RULE:weight_loss', 'an existing child goal cannot be changed to weight_loss');

-- the detail carries the rule for the edge error mapper
create function pg_temp.err_detail(p_sql text) returns jsonb language plpgsql as $$
declare v text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v = pg_exception_detail;
  return v::jsonb;
end $$;
select is(pg_temp.err_detail(format($$insert into public.nutrition_goals (household_id, family_member_id, goal_type) values (%L, %L, 'weight_loss')$$, :'hid', :'son')) ->> 'rule',
  'no_weight_loss_under_18', 'the error detail names the rule');

select lives_ok(format($$insert into public.nutrition_goals (household_id, family_member_id, goal_type) values (%L, %L, 'child_growth')$$, :'hid', :'teen'),
  'a teen gets a child_growth goal');
select lives_ok(format($$insert into public.nutrition_goals (household_id, family_member_id, goal_type, target_value, target_unit) values (%L, %L, 'energy', 6, 'servings_per_day')$$, :'hid', :'son'),
  'a child goal with a non-calorie target is allowed');
select lives_ok(format($$insert into public.nutrition_goals (household_id, family_member_id, goal_type, target_value, target_unit) values (%L, %L, 'weight_loss', 0.5, 'kg_per_week')$$, :'hid', :'adult'),
  'an adult gets a weight_loss goal with a weekly target');
select lives_ok(format($$insert into public.nutrition_goals (household_id, family_member_id, goal_type) values (%L, %L, 'weight_gain')$$, :'hid', :'adult'),
  'an adult gets a weight_gain goal');
select throws_ok(format($$insert into public.nutrition_goals (household_id, family_member_id, goal_type) values (%L, %L, 'pregnancy_support')$$, :'hid', :'son'),
  '23514', 'MODULE_NOT_APPLICABLE', 'a child cannot get a pregnancy goal');

-- date-of-birth change under an existing adult weight goal
select throws_ok(format($$update public.family_members set date_of_birth = current_date - interval '15 years' where id = %L$$, :'adult'),
  'P0001', null, 'a member with a weight goal cannot be re-dated to under 18');
select tests.clear_authentication();

-- a legacy weight goal on a minor (inserted before the guard) can still be soft-deleted
alter table public.nutrition_goals disable trigger trg_nutrition_goals_child_safety;
insert into public.nutrition_goals (household_id, family_member_id, goal_type) values (:'hid', :'son', 'weight_loss');
alter table public.nutrition_goals enable trigger trg_nutrition_goals_child_safety;
select tests.authenticate_as(:'owner');
select id as legacy from public.nutrition_goals where family_member_id = :'son' and goal_type = 'weight_loss' \gset
select lives_ok(format($$select public.soft_delete('nutrition_goals', %L)$$, :'legacy'),
  'a legacy child weight goal can be soft-deleted');
select is((select count(*) from public.nutrition_goals where family_member_id = :'son' and goal_type = 'weight_loss'), 0::bigint,
  'and it is gone from view');
select tests.clear_authentication();

select * from finish();
rollback;
