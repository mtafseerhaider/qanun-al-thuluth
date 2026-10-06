-- supabase/migrations/20261006090100_food_catalog.sql
-- 05 ref: 0001 (part: pg_trgm), 0004 food catalog (part 1: allergens, budget_categories, regions,
--         ingredients, ingredient_allergens; FK households.region_id), 0013 RLS (part). Sprint 1: S1-19.
-- DDL verbatim from 05 section 7. recipes, meals, portions, seasonal produce and prices follow in S2/S4.
-- Content is seeded by supabase/seed/catalog/010 to 050.

create extension if not exists pg_trgm with schema extensions;

-- 7.1 allergens: EU-14 + US Big-9 superset
create table public.allergens (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code ~ '^[a-z_]+$'),
  name_i18n   jsonb not null check (name_i18n ? 'en'),
  eu14        boolean not null default false,   -- Addition: regulatory flags
  us_big9     boolean not null default false,   -- Addition
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 7.2 budget_categories
create table public.budget_categories (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (code in (
                'staples','protein_animal','protein_plant','dairy','produce_veg',
                'produce_fruit','oils_fats','spices','beverages','snacks')),
  name_i18n   jsonb not null check (name_i18n ? 'en'),
  sort_order  smallint not null default 0,      -- Addition
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 7.3 regions
create table public.regions (
  id                uuid primary key default gen_random_uuid(),
  country_code      char(2) not null check (country_code ~ '^[A-Z]{2}$'),
  region_code       text not null,               -- ISO 3166-2 subdivision suffix, e.g. 'PB' for Punjab
  name              text not null,
  climate_zone      text not null check (climate_zone in (
                      'hot_arid','hot_semi_arid','humid_subtropical','tropical',
                      'mediterranean','temperate_oceanic','continental','subarctic')),
  default_currency  char(3) not null check (default_currency ~ '^[A-Z]{3}$'),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (country_code, region_code)
);

alter table public.households
  add constraint households_region_id_fkey foreign key (region_id)
  references public.regions(id) on delete set null;
create index households_region_idx on public.households (region_id);

-- 7.4 ingredients (nutrients per 100 g edible portion)
create table public.ingredients (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  name_i18n            jsonb not null default '{}'::jsonb,   -- {"en":"Bottle gourd","ur":"لوکی"}
  category             text not null check (category in (
                         'vegetable','fruit','grain','legume','meat','poultry','fish','egg',
                         'dairy','nut_seed','oil_fat','spice_herb','sweetener','beverage',
                         'condiment','prepared')),
  budget_category_id   uuid not null references public.budget_categories(id) on delete restrict,
  default_unit         text not null default 'g' check (default_unit in (
                         'g','kg','ml','l','piece','dozen','bunch','tsp','tbsp','cup','katori','lot')),
  grams_per_unit       numeric(8,2),                 -- Addition: e.g. 1 dozen eggs = 600 g, 1 roti = 40 g
  kcal                 numeric(7,1) check (kcal >= 0),
  protein_g            numeric(6,2) check (protein_g >= 0),
  carbs_g              numeric(6,2) check (carbs_g >= 0),
  fiber_g              numeric(6,2) check (fiber_g >= 0),
  sugar_g              numeric(6,2) check (sugar_g >= 0),
  fat_g                numeric(6,2) check (fat_g >= 0),
  sat_fat_g            numeric(6,2) check (sat_fat_g >= 0),
  sodium_mg            numeric(8,2) check (sodium_mg >= 0),
  iron_mg              numeric(7,2) check (iron_mg >= 0),
  calcium_mg           numeric(8,2) check (calcium_mg >= 0),
  zinc_mg              numeric(7,2) check (zinc_mg >= 0),
  vitamin_a_mcg        numeric(8,2) check (vitamin_a_mcg >= 0),
  vitamin_c_mg         numeric(7,2) check (vitamin_c_mg >= 0),
  vitamin_d_mcg        numeric(7,2) check (vitamin_d_mcg >= 0),
  b12_mcg              numeric(7,2) check (b12_mcg >= 0),
  folate_mcg           numeric(8,2) check (folate_mcg >= 0),
  potassium_mg         numeric(8,2) check (potassium_mg >= 0),
  omega3_g             numeric(6,3) check (omega3_g >= 0),
  halal_status         text not null default 'halal' check (halal_status in ('halal','haram','mashbooh','depends_on_source')),
  is_sunnah_food       boolean not null default false,
  fdc_id               integer unique,               -- USDA FoodData Central id
  textures             public.texture[] not null default '{}',
  color                text check (color in ('red','orange','yellow','green','purple','blue','white','beige','brown','black','mixed')),
  is_active            boolean not null default true, -- Addition: retire instead of delete
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check (sat_fat_g is null or fat_g is null or sat_fat_g <= fat_g),
  check (sugar_g is null or carbs_g is null or sugar_g <= carbs_g)
);
create unique index ingredients_name_key on public.ingredients (lower(name));
create index ingredients_name_trgm on public.ingredients using gin (name extensions.gin_trgm_ops);
create index ingredients_name_i18n_gin on public.ingredients using gin (name_i18n jsonb_path_ops);
create index ingredients_budget_category_idx on public.ingredients (budget_category_id);
create index ingredients_sunnah_idx on public.ingredients (id) where is_sunnah_food;

-- 7.5 ingredient_allergens
create table public.ingredient_allergens (
  id             uuid primary key default gen_random_uuid(),
  ingredient_id  uuid not null references public.ingredients(id) on delete cascade,
  allergen_id    uuid not null references public.allergens(id) on delete restrict,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (ingredient_id, allergen_id)
);
create index ingredient_allergens_allergen_idx on public.ingredient_allergens (allergen_id);

-- 15.1 updated_at
do $$
declare t text;
begin
  foreach t in array array['allergens','budget_categories','regions','ingredients','ingredient_allergens'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   'trg_' || t || '_updated_at', t);
  end loop;
end $$;

-- 16.3.3 RLS: authenticated reads, platform admins write (CAT pattern)
call private.apply_catalog_rls('public.allergens');
call private.apply_catalog_rls('public.budget_categories');
call private.apply_catalog_rls('public.regions');
call private.apply_catalog_rls('public.ingredients', 'is_active');
call private.apply_catalog_rls('public.ingredient_allergens');
