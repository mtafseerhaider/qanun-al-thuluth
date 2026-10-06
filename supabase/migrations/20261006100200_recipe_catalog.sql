-- supabase/migrations/20261006100200_recipe_catalog.sql
-- 05 ref: 0004 food catalog (part 2: recipes, recipe_ingredients, meals, portions, meal_alternatives,
--         seasonal_produce), 0012 15.13 (recipe nutrition), 0013 RLS 16.3.3 (part), 0020a (ingredient
--         yields, shelf life, purchase units and aisle; tiered portions; 20.5 recipe nutrition follows
--         ingredient edits). Sprint 2: S2-16.
-- DDL verbatim from 05 sections 7.6 to 7.11, 15.13, 16.3.3 and 22.6 (20.2, 20.5). Also adds the
-- food_preferences.recipe_id foreign key that the health migration could not create before recipes
-- existed. price_profiles and price_observations follow in S4. Content: supabase/seed/catalog/090_recipes.sql.

-- 7.6 recipes -----------------------------------------------------------------------------------------
create table public.recipes (
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid references public.households(id) on delete cascade,  -- Addition: null = global catalog
  created_by_user_id     uuid references public.users(id) on delete set null,       -- Addition
  title                  text not null check (char_length(title) between 1 and 120),
  title_i18n             jsonb not null default '{}'::jsonb,
  cuisine                text not null default 'pakistani',
  region_tags            text[] not null default '{}',        -- e.g. {'PK-PB','PK','south_asia'}
  meal_types             public.meal_type[] not null check (cardinality(meal_types) > 0),
  servings               smallint not null check (servings between 1 and 50),
  prep_min               smallint not null default 0 check (prep_min between 0 and 1440),
  cook_min               smallint not null default 0 check (cook_min between 0 and 1440),
  steps                  jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
                         -- [{"n":1,"text_i18n":{"en":"..."},"timer_min":10}]
  texture_profile        public.texture[] not null default '{}',
  colors                 text[] not null default '{}',
  kid_friendly           boolean not null default false,
  autism_friendly        boolean not null default false,
  ramadan_suitable       boolean not null default false,
  cost_tier              smallint not null default 2 check (cost_tier between 1 and 3),
  per_serving_nutrition  jsonb not null default '{}'::jsonb,  -- computed by trigger from recipe_ingredients
  image_path             text,                                -- bucket "recipe-images"
  source                 text not null default 'curated' check (source in ('curated','ai_generated','user')),
  review_status          public.verification_status not null default 'unverified',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  -- global rows are curated or AI drafts awaiting review; user rows always belong to a household
  check (source <> 'user' or household_id is not null),
  unique (id, household_id)
);
create index recipes_household_idx on public.recipes (household_id) where household_id is not null and deleted_at is null;
create index recipes_catalog_idx on public.recipes (review_status, cost_tier) where household_id is null and deleted_at is null;
create index recipes_meal_types_gin on public.recipes using gin (meal_types);
create index recipes_region_tags_gin on public.recipes using gin (region_tags);
create index recipes_title_trgm on public.recipes using gin (title extensions.gin_trgm_ops);
create index recipes_flags_idx on public.recipes (kid_friendly, autism_friendly, ramadan_suitable) where deleted_at is null;
create unique index recipes_catalog_title_key on public.recipes (lower(title)) where household_id is null;   -- Addition: idempotent catalog seed key

-- 7.7 recipe_ingredients ------------------------------------------------------------------------------
create table public.recipe_ingredients (
  id             uuid primary key default gen_random_uuid(),
  recipe_id      uuid not null references public.recipes(id) on delete cascade,
  ingredient_id  uuid not null references public.ingredients(id) on delete restrict,
  quantity       numeric(8,2) not null check (quantity > 0),
  unit           text not null,                  -- as written: 'katori', 'tbsp', 'g'
  grams          numeric(8,2) not null check (grams > 0),  -- normalized, used for nutrition
  optional       boolean not null default false,
  prep_note      text,
  sort_order     smallint not null default 0,    -- Addition
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index recipe_ingredients_recipe_idx on public.recipe_ingredients (recipe_id, sort_order);
create index recipe_ingredients_ingredient_idx on public.recipe_ingredients (ingredient_id);

-- 7.8 meals: composed meal usable in plans ------------------------------------------------------------
create table public.meals (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid references public.households(id) on delete cascade,  -- Addition: null = global template
  source        text not null default 'curated' check (source in ('curated','ai_generated','user')), -- Addition
  title         text not null check (char_length(title) between 1 and 160),
  title_i18n    jsonb not null default '{}'::jsonb,                        -- Addition
  meal_type     public.meal_type not null,
  components    jsonb not null check (jsonb_typeof(components) = 'array' and jsonb_array_length(components) > 0),
                -- [{"recipe_id":"uuid","role":"main"},{"label":"Kachumber salad","ingredient_ids":["uuid"],"role":"side"}]
  plate_split   jsonb not null default '{"veg_fruit":0.5,"protein":0.25,"carb":0.25}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  check (
    (plate_split ?& array['veg_fruit','protein','carb'])
    and abs((plate_split->>'veg_fruit')::numeric + (plate_split->>'protein')::numeric
            + (plate_split->>'carb')::numeric - 1) <= 0.05
  ),
  unique (id, household_id)
);
create index meals_household_idx on public.meals (household_id) where household_id is not null and deleted_at is null;
create index meals_catalog_type_idx on public.meals (meal_type) where household_id is null and deleted_at is null;
create index meals_components_gin on public.meals using gin (components jsonb_path_ops);

-- 7.9 portions: guidance per life stage (tier from 0020a; unique keys per tier) ------------------------
create table public.portions (
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid references public.households(id) on delete cascade,  -- Addition: set for portions of household meals
  meal_id           uuid references public.meals(id) on delete cascade,
  recipe_id         uuid references public.recipes(id) on delete cascade,
  life_stage        public.life_stage not null,
  grams             numeric(7,1) not null check (grams > 0),
  household_measure text not null,              -- '1 small roti, half katori daal'
  household_measure_i18n jsonb not null default '{}'::jsonb,                  -- Addition
  kcal              numeric(7,1) check (kcal >= 0),  -- stored for adults; never displayed for minors (UI rule, 15-family-health-modules.md)
  tier              text not null default 'standard' check (tier in ('standard','start','ideal','extra')),  -- 0020a (14 section 6)
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (num_nonnulls(meal_id, recipe_id) = 1)
);
create unique index portions_meal_stage_key   on public.portions (meal_id, life_stage, tier)   where meal_id is not null;
create unique index portions_recipe_stage_key on public.portions (recipe_id, life_stage, tier) where recipe_id is not null;
create index portions_household_idx on public.portions (household_id) where household_id is not null;

-- 7.10 meal_alternatives -----------------------------------------------------------------------------
create table public.meal_alternatives (
  id                   uuid primary key default gen_random_uuid(),
  meal_id              uuid not null references public.meals(id) on delete cascade,
  alternative_meal_id  uuid not null references public.meals(id) on delete cascade,
  reason               text not null check (reason in ('allergy','budget','autism','picky','season','preference')),
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (meal_id <> alternative_meal_id),
  unique (meal_id, alternative_meal_id, reason)
);
create index meal_alternatives_alt_idx on public.meal_alternatives (alternative_meal_id);

-- 7.11 seasonal_produce ------------------------------------------------------------------------------
create table public.seasonal_produce (
  id             uuid primary key default gen_random_uuid(),
  region_id      uuid not null references public.regions(id) on delete cascade,
  ingredient_id  uuid not null references public.ingredients(id) on delete restrict,
  month          smallint not null check (month between 1 and 12),
  availability   text not null check (availability in ('peak','available','scarce')),
  price_index    numeric(4,2) not null default 1.00 check (price_index > 0),  -- 1.00 = annual average price
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (region_id, ingredient_id, month)
);
create index seasonal_produce_region_month_idx on public.seasonal_produce (region_id, month, availability);
create index seasonal_produce_ingredient_idx on public.seasonal_produce (ingredient_id);   -- FK index

-- food_preferences.recipe_id (8.5) now that recipes exist
alter table public.food_preferences
  add constraint food_preferences_recipe_id_fkey foreign key (recipe_id) references public.recipes(id) on delete set null;
create index food_preferences_recipe_idx on public.food_preferences (recipe_id) where recipe_id is not null;

-- 20.2 ingredient catalog columns (0020a) ---------------------------------------------------------------
alter table public.ingredients
  add column yield_factors    jsonb not null default '{}'::jsonb check (jsonb_typeof(yield_factors) = 'object'),
                              -- {"boiled":2.8,"pressure_cooked":2.5,"roasted":0.72}
  add column shelf_life_days  smallint check (shelf_life_days > 0),     -- null = shelf stable (> 90 days)
  add column purchase_units   jsonb not null default '[]'::jsonb check (jsonb_typeof(purchase_units) = 'array'),
                              -- [{"unit":"dozen","grams":660},{"unit":"kg","grams":1000}]
  add column aisle            text check (aisle in ('sabzi','fruit','meat','dairy','dry_goods','spices','other'));

-- 15.1 updated_at -----------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['recipes','recipe_ingredients','meals','portions','meal_alternatives','seasonal_produce'] loop
    call private.attach_updated_at(('public.' || t)::regclass);
  end loop;
end $$;

-- 15.13 recipe nutrition ------------------------------------------------------------------------------
-- Raw-ingredient roll-up per serving (keys mirror the ingredients nutrient columns, plus grams).
-- Optional ingredients are excluded. tooling/scripts/gen-recipe-seed.py computes the same values.
create or replace function public.recompute_recipe_nutrition(p_recipe_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.recipes r
     set per_serving_nutrition = coalesce((
       select jsonb_strip_nulls(jsonb_build_object(
         'kcal',          round(sum(i.kcal          * ri.grams / 100) / r.servings, 1),
         'protein_g',     round(sum(i.protein_g     * ri.grams / 100) / r.servings, 1),
         'carbs_g',       round(sum(i.carbs_g       * ri.grams / 100) / r.servings, 1),
         'fiber_g',       round(sum(i.fiber_g       * ri.grams / 100) / r.servings, 1),
         'sugar_g',       round(sum(i.sugar_g       * ri.grams / 100) / r.servings, 1),
         'fat_g',         round(sum(i.fat_g         * ri.grams / 100) / r.servings, 1),
         'sat_fat_g',     round(sum(i.sat_fat_g     * ri.grams / 100) / r.servings, 1),
         'sodium_mg',     round(sum(i.sodium_mg     * ri.grams / 100) / r.servings, 0),
         'iron_mg',       round(sum(i.iron_mg       * ri.grams / 100) / r.servings, 2),
         'calcium_mg',    round(sum(i.calcium_mg    * ri.grams / 100) / r.servings, 0),
         'zinc_mg',       round(sum(i.zinc_mg       * ri.grams / 100) / r.servings, 2),
         'vitamin_a_mcg', round(sum(i.vitamin_a_mcg * ri.grams / 100) / r.servings, 0),
         'vitamin_c_mg',  round(sum(i.vitamin_c_mg  * ri.grams / 100) / r.servings, 1),
         'vitamin_d_mcg', round(sum(i.vitamin_d_mcg * ri.grams / 100) / r.servings, 2),
         'b12_mcg',       round(sum(i.b12_mcg       * ri.grams / 100) / r.servings, 2),
         'folate_mcg',    round(sum(i.folate_mcg    * ri.grams / 100) / r.servings, 0),
         'potassium_mg',  round(sum(i.potassium_mg  * ri.grams / 100) / r.servings, 0),
         'omega3_g',      round(sum(i.omega3_g      * ri.grams / 100) / r.servings, 3),
         'grams',         round(sum(ri.grams) / r.servings, 0)
       ))
       from public.recipe_ingredients ri
       join public.ingredients i on i.id = ri.ingredient_id
       where ri.recipe_id = r.id and not ri.optional
     ), '{}'::jsonb)
   where r.id = p_recipe_id;
$$;
revoke execute on function public.recompute_recipe_nutrition(uuid) from public, anon, authenticated;

create or replace function private.recipe_nutrition_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'recipes' then
    perform public.recompute_recipe_nutrition(new.id);
  else
    if tg_op in ('INSERT','UPDATE') then perform public.recompute_recipe_nutrition(new.recipe_id); end if;
    if tg_op in ('UPDATE','DELETE') and (tg_op = 'DELETE' or old.recipe_id <> new.recipe_id) then
      perform public.recompute_recipe_nutrition(old.recipe_id);
    end if;
  end if;
  return null;
end $$;
create trigger trg_recipe_ingredients_nutrition after insert or update or delete on public.recipe_ingredients
  for each row execute function private.recipe_nutrition_sync();
create trigger trg_recipes_servings_nutrition after update of servings on public.recipes
  for each row execute function private.recipe_nutrition_sync();

-- 20.5 recipe nutrition follows ingredient nutrient edits (0020a)
create or replace function private.ingredient_nutrition_sync()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select distinct ri.recipe_id from public.recipe_ingredients ri where ri.ingredient_id = new.id loop
    perform public.recompute_recipe_nutrition(r.recipe_id);
  end loop;
  return null;
end $$;
create trigger trg_ingredients_nutrition_sync
  after update of kcal, protein_g, carbs_g, fiber_g, sugar_g, fat_g, sat_fat_g, sodium_mg, iron_mg, calcium_mg,
                  zinc_mg, vitamin_a_mcg, vitamin_c_mg, vitamin_d_mcg, b12_mcg, folate_mcg, potassium_mg, omega3_g
  on public.ingredients
  for each row execute function private.ingredient_nutrition_sync();

-- 16.3.3 RLS --------------------------------------------------------------------------------------------
call private.apply_catalog_rls('public.meal_alternatives');
call private.apply_catalog_rls('public.seasonal_produce');

-- recipes: verified global rows, plus rows private to the caller's households
alter table public.recipes enable row level security;
create policy recipes_select on public.recipes for select to authenticated
  using (
    deleted_at is null and (
      (household_id is null and review_status = 'verified')
      or (household_id is not null and public.is_household_member(household_id))
      or public.is_admin()
    ));
create policy recipes_insert on public.recipes for insert to authenticated
  with check (
    (household_id is not null and source = 'user' and created_by_user_id = auth.uid()
       and review_status = 'unverified' and public.can_edit_household(household_id))
    or public.is_admin());
create policy recipes_update on public.recipes for update to authenticated
  using ((household_id is not null and public.can_edit_household(household_id)) or public.is_admin())
  with check ((household_id is not null and source = 'user' and public.can_edit_household(household_id)) or public.is_admin());
create policy recipes_delete_admin on public.recipes for delete to authenticated using (public.is_admin());

alter table public.recipe_ingredients enable row level security;
-- the subquery runs under the caller's RLS on recipes, so visibility follows the parent recipe
create policy recipe_ingredients_select on public.recipe_ingredients for select to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id));
create policy recipe_ingredients_write on public.recipe_ingredients for all to authenticated
  using (exists (select 1 from public.recipes r where r.id = recipe_id
                 and ((r.household_id is not null and r.source = 'user' and public.can_edit_household(r.household_id)) or public.is_admin())))
  with check (exists (select 1 from public.recipes r where r.id = recipe_id
                 and ((r.household_id is not null and r.source = 'user' and public.can_edit_household(r.household_id)) or public.is_admin())));

alter table public.meals enable row level security;
create policy meals_select on public.meals for select to authenticated
  using (deleted_at is null and (household_id is null or public.is_household_member(household_id) or public.is_admin()));
create policy meals_insert on public.meals for insert to authenticated
  with check ((household_id is not null and source = 'user' and public.can_author_plans(household_id)) or public.is_admin());
create policy meals_update on public.meals for update to authenticated
  using ((household_id is not null and public.can_author_plans(household_id)) or public.is_admin())
  with check ((household_id is not null and public.can_author_plans(household_id)) or public.is_admin());
create policy meals_delete_admin on public.meals for delete to authenticated using (public.is_admin());

alter table public.portions enable row level security;
create policy portions_select on public.portions for select to authenticated
  using (household_id is null or public.is_household_member(household_id) or public.is_admin());
create policy portions_write on public.portions for all to authenticated
  using ((household_id is not null and public.can_author_plans(household_id)) or public.is_admin())
  with check ((household_id is not null and public.can_author_plans(household_id)) or public.is_admin());
