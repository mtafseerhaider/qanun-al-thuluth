-- supabase/migrations/20261006120000_grocery_budget_prices.sql
-- 05 ref: 0004 food catalog (part 4: price_profiles, price_observations), 0008 plans (part 3:
--         grocery_lists, shopping_items, budget_entries), 0012 15.16 (price moderation, budget currency),
--         0013 16.3.3 / 16.3.6 (part), 0014 17.2 (mv_ingredient_prices, refresh_ingredient_prices),
--         0016 (Realtime, part: shopping_items), 0020c (price screening, mv_current_prices, pantry_items,
--         ingredient_substitutions, soft_delete allow-list). Sprint 4: S4-02.
-- DDL verbatim from 05 sections 7.12, 7.13, 11.5 to 11.7, 15.16, 16.3, 17.2 and 22.6 (20.4, 20.6), except:
--   * price_observation moderation is the 0020 body (05 22.6 20.4) from the start; the 0012 body it
--     replaces is never created.
--   * Addition: unique index price_observations_seed_key (one seed price per profile, ingredient, unit
--     and day) so the price-book seeds are idempotent upserts. User reports and admin rows are unaffected.
--   * Addition: FK indexes (10 section 16 rule 3) where 05 has none.
--   * Realtime private-channel policies for 'grocery-presence:{grocery_list_id}' (10 section 7.3) are
--     created only when the realtime schema exists (Supabase); 05 calls a path_segment_uuid() helper that
--     was never specified, so the topic id is parsed inline and malformed topics simply match nothing.
-- Not here: substitution seed rules (14 section 13.3, content work, no seed yet).

-- 7.12 price_profiles: a regional price book ----------------------------------------------------------
create table public.price_profiles (
  id              uuid primary key default gen_random_uuid(),
  region_id       uuid not null references public.regions(id) on delete restrict,
  city            text,                 -- null = region-wide fallback
  currency        char(3) not null check (currency ~ '^[A-Z]{3}$'),
  effective_from  date not null,
  label           text,                 -- Addition: 'Lahore retail Oct 2026'
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index price_profiles_key on public.price_profiles (region_id, coalesce(city, ''), effective_from);

-- 7.13 price_observations (+ 0020 20.4 unit_grams and widened statuses) ----------------------------------
create table public.price_observations (
  id                 uuid primary key default gen_random_uuid(),
  price_profile_id   uuid not null references public.price_profiles(id) on delete cascade,
  ingredient_id      uuid not null references public.ingredients(id) on delete restrict,
  unit               text not null check (unit in ('g','kg','ml','l','piece','dozen','bunch','lot','bottle','pack')),
  amount_minor       bigint not null check (amount_minor > 0),   -- price per one unit
  observed_on        date not null default current_date,
  source             public.price_source not null,
  reporter_user_id   uuid references public.users(id) on delete set null,
  moderation_status  text not null default 'accepted',
  unit_grams         numeric(8,1) check (unit_grams > 0),         -- 0020: grams represented by unit (1 dozen eggs = 660)
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (source <> 'user_report' or reporter_user_id is not null),
  constraint price_observations_moderation_status_check
    check (moderation_status in ('pending','accepted','rejected','rejected_outlier','rejected_manual'))
);
create index price_observations_lookup_idx
  on public.price_observations (price_profile_id, ingredient_id, observed_on desc)
  where moderation_status = 'accepted';
create index price_observations_reporter_idx on public.price_observations (reporter_user_id) where reporter_user_id is not null;
create index price_observations_pending_idx on public.price_observations (created_at) where moderation_status = 'pending';
create index price_observations_ingredient_idx on public.price_observations (ingredient_id);          -- FK index
create unique index price_observations_seed_key                                                        -- Addition (seed upsert key)
  on public.price_observations (price_profile_id, ingredient_id, unit, observed_on) where source = 'seed';

-- 11.5 grocery_lists ------------------------------------------------------------------------------------
create table public.grocery_lists (
  id                     uuid primary key default gen_random_uuid(),
  household_id           uuid not null references public.households(id) on delete cascade,
  meal_plan_id           uuid,
  period                 text not null default 'weekly' check (period in ('weekly','monthly','adhoc')),
  starts_on              date not null,
  ends_on                date not null,
  estimated_total_minor  bigint not null default 0 check (estimated_total_minor >= 0),
  currency               char(3) not null check (currency ~ '^[A-Z]{3}$'),
  status                 text not null default 'open' check (status in ('open','shopping','done')),
  price_profile_id       uuid references public.price_profiles(id) on delete set null,  -- Addition: price book used for estimates
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz,
  unique (id, household_id),
  check (ends_on >= starts_on),
  foreign key (meal_plan_id, household_id) references public.meal_plans(id, household_id) on delete set null (meal_plan_id)
);
create index grocery_lists_household_idx on public.grocery_lists (household_id, starts_on desc) where deleted_at is null;
create index grocery_lists_plan_idx on public.grocery_lists (meal_plan_id) where meal_plan_id is not null;               -- FK index
create index grocery_lists_profile_idx on public.grocery_lists (price_profile_id) where price_profile_id is not null;   -- FK index

-- 11.6 shopping_items -----------------------------------------------------------------------------------
create table public.shopping_items (
  id                        uuid primary key default gen_random_uuid(),
  grocery_list_id           uuid not null,
  household_id              uuid not null references public.households(id) on delete cascade,
  ingredient_id             uuid references public.ingredients(id) on delete restrict,
  label                     text not null check (char_length(label) between 1 and 160),
  quantity                  numeric(8,2) not null default 1 check (quantity > 0),
  unit                      text not null default 'piece',
  estimated_minor           bigint check (estimated_minor >= 0),
  actual_minor              bigint check (actual_minor >= 0),
  is_checked                boolean not null default false,
  substitution_for_item_id  uuid references public.shopping_items(id) on delete set null,
  aisle                     text,               -- budget_categories.code by default, user-editable
  is_fresh                  boolean not null default true,   -- true = buy weekly, false = monthly staple
  sort_order                smallint not null default 0,     -- Addition
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  check (substitution_for_item_id is distinct from id),
  foreign key (grocery_list_id, household_id) references public.grocery_lists(id, household_id) on delete cascade
);
create index shopping_items_list_idx on public.shopping_items (grocery_list_id, aisle, sort_order);
create index shopping_items_household_idx on public.shopping_items (household_id);
create index shopping_items_ingredient_idx on public.shopping_items (ingredient_id) where ingredient_id is not null;  -- FK index
create index shopping_items_substitution_idx on public.shopping_items (substitution_for_item_id)
  where substitution_for_item_id is not null;                                                                       -- FK index

-- 11.7 budget_entries: actual spend ---------------------------------------------------------------------
create table public.budget_entries (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.households(id) on delete cascade,
  budget_profile_id  uuid not null,
  amount_minor       bigint not null check (amount_minor > 0),
  currency           char(3) not null check (currency ~ '^[A-Z]{3}$'),   -- Addition: explicit, must equal profile currency
  category_id        uuid not null references public.budget_categories(id) on delete restrict,
  spent_on           date not null default current_date,
  grocery_list_id    uuid,
  note               text,                                               -- Addition
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  foreign key (budget_profile_id, household_id) references public.budget_profiles(id, household_id) on delete cascade,
  foreign key (grocery_list_id, household_id) references public.grocery_lists(id, household_id) on delete set null (grocery_list_id)
);
create index budget_entries_household_month_idx on public.budget_entries (household_id, spent_on desc);
create index budget_entries_profile_idx on public.budget_entries (budget_profile_id, category_id, spent_on);
create index budget_entries_category_idx on public.budget_entries (category_id);                                       -- FK index
create index budget_entries_list_idx on public.budget_entries (grocery_list_id) where grocery_list_id is not null;     -- FK index

-- 20.6 pantry_items (household) and ingredient_substitutions (global) ------------------------------------
create table public.pantry_items (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households(id) on delete cascade,
  ingredient_id  uuid references public.ingredients(id) on delete restrict,
  label          text not null check (char_length(label) between 1 and 80),
  grams          numeric(9,1) not null check (grams >= 0),
  expires_on     date,
  updated_by     uuid references public.users(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index pantry_items_household_idx on public.pantry_items (household_id, ingredient_id) where deleted_at is null;
create index pantry_items_ingredient_idx on public.pantry_items (ingredient_id) where ingredient_id is not null;
create index pantry_items_updated_by_idx on public.pantry_items (updated_by) where updated_by is not null;   -- FK index

create table public.ingredient_substitutions (
  id                   uuid primary key default gen_random_uuid(),
  from_ingredient_id   uuid not null references public.ingredients(id) on delete restrict,
  to_ingredient_id     uuid not null references public.ingredients(id) on delete restrict,
  reason               text not null check (reason in ('allergy','budget','season','availability','halal','preference')),
  ratio                numeric(5,3) not null default 1.000 check (ratio > 0),   -- grams of "to" per gram of "from"
  nutrient_similarity  numeric(4,3) not null check (nutrient_similarity between 0 and 1),
  culinary_fit         smallint not null check (culinary_fit between 1 and 3),
  notes_i18n           jsonb not null default '{}'::jsonb,
  region_codes         text[],                                                   -- null = everywhere
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (from_ingredient_id, to_ingredient_id, reason),
  check (from_ingredient_id <> to_ingredient_id)
);
create index ingredient_substitutions_to_idx on public.ingredient_substitutions (to_ingredient_id);

-- 15.1 updated_at ---------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['price_profiles','price_observations','grocery_lists','shopping_items','budget_entries',
                           'pantry_items','ingredient_substitutions'] loop
    call private.attach_updated_at(('public.' || t)::regclass);
  end loop;
end $$;

-- 15.16 / 20.4 price report moderation and screening (0020 body, 05 22.6) ----------------------------------
-- Keeps the user-report rules, fills unit_grams, then applies the modified z-score screen (Iglewicz and
-- Hoaglin, threshold 3.5, hard band 40 to 160 percent of the 60-day median per kg).
create or replace function private.price_report_moderation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_med numeric; v_mad numeric; v_ppk numeric; v_n integer;
begin
  if new.source = 'user_report' and not public.is_admin() then
    new.reporter_user_id := auth.uid();
    new.observed_on := least(new.observed_on, current_date);
  end if;

  new.unit_grams := coalesce(new.unit_grams,
    case new.unit when 'g' then 1 when 'kg' then 1000 when 'ml' then 1 when 'l' then 1000 end,
    (select i.grams_per_unit from public.ingredients i where i.id = new.ingredient_id and new.unit = i.default_unit));

  if new.unit_grams is null then
    new.moderation_status := case when new.source = 'user_report' then 'pending' else new.moderation_status end;
    return new;
  end if;

  v_ppk := new.amount_minor * 1000.0 / new.unit_grams;
  select percentile_cont(0.5) within group (order by po.amount_minor * 1000.0 / po.unit_grams), count(*)
    into v_med, v_n
    from public.price_observations po
   where po.price_profile_id = new.price_profile_id and po.ingredient_id = new.ingredient_id
     and po.moderation_status = 'accepted' and po.unit_grams is not null
     and po.observed_on >= new.observed_on - 60;

  if v_n < 5 then
    if new.source = 'user_report' and not public.is_admin() then
      new.moderation_status := 'pending';
    end if;
    return new;
  end if;

  select percentile_cont(0.5) within group (order by abs(po.amount_minor * 1000.0 / po.unit_grams - v_med))
    into v_mad
    from public.price_observations po
   where po.price_profile_id = new.price_profile_id and po.ingredient_id = new.ingredient_id
     and po.moderation_status = 'accepted' and po.unit_grams is not null
     and po.observed_on >= new.observed_on - 60;

  if (v_mad > 0 and abs(0.6745 * (v_ppk - v_med) / v_mad) > 3.5) or v_ppk > v_med * 1.6 or v_ppk < v_med * 0.4 then
    new.moderation_status := case when new.source = 'admin' then 'accepted' else 'rejected_outlier' end;
  else
    new.moderation_status := 'accepted';
  end if;
  return new;
end $$;
create trigger trg_price_observations_moderation before insert on public.price_observations
  for each row execute function private.price_report_moderation();

create or replace function private.budget_entry_currency()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.currency <> (select currency from public.budget_profiles where id = new.budget_profile_id) then
    raise exception 'CURRENCY_MISMATCH' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger trg_budget_entries_currency before insert or update of currency, budget_profile_id on public.budget_entries
  for each row execute function private.budget_entry_currency();

-- 16.3 RLS ----------------------------------------------------------------------------------------------
call private.apply_catalog_rls('public.price_profiles');
call private.apply_catalog_rls('public.ingredient_substitutions');

alter table public.price_observations enable row level security;
create policy price_observations_select on public.price_observations for select to authenticated
  using (moderation_status = 'accepted' or reporter_user_id = auth.uid() or public.is_admin());
create policy price_observations_insert on public.price_observations for insert to authenticated
  with check ((source = 'user_report' and reporter_user_id = auth.uid()) or public.is_admin());
create policy price_observations_update_admin on public.price_observations for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy price_observations_delete_admin on public.price_observations for delete to authenticated
  using (public.is_admin());

call private.apply_household_rls('public.grocery_lists', 'edit');
call private.apply_household_rls('public.shopping_items', 'edit');
call private.apply_household_rls('public.budget_entries', 'edit');
call private.apply_household_rls('public.pantry_items', 'edit');

-- 17.2 effective prices ----------------------------------------------------------------------------------
-- Median of accepted observations within 90 days of the latest one per (profile, ingredient, unit), so
-- seed prices never disappear just because nobody reported recently.
create materialized view public.mv_ingredient_prices as
with ranked as (
  select po.*,
         max(po.observed_on) over (partition by po.price_profile_id, po.ingredient_id, po.unit) as latest_on
  from public.price_observations po
  where po.moderation_status = 'accepted'
)
select price_profile_id,
       ingredient_id,
       unit,
       percentile_cont(0.5) within group (order by amount_minor)::bigint as median_minor,
       count(*)                                                        as n_observations,
       max(observed_on)                                                as last_observed_on,
       bool_or(source in ('user_report','partner_feed'))               as has_live_data
from ranked
where observed_on >= latest_on - 90
group by price_profile_id, ingredient_id, unit
with no data;
create unique index mv_ingredient_prices_key on public.mv_ingredient_prices (price_profile_id, ingredient_id, unit);

-- 20.4 current recency-weighted median price per kg (14 section 12.4)
create materialized view public.mv_current_prices as
with obs as (
  select po.price_profile_id, po.ingredient_id,
         po.amount_minor * 1000.0 / po.unit_grams as price_per_kg_minor,
         case po.source when 'admin' then 1.0 when 'partner_feed' then 0.9 when 'user_report' then 0.5 else 0.3 end
           * power(0.5, (current_date - po.observed_on) / 21.0) as w
  from public.price_observations po
  where po.moderation_status = 'accepted' and po.unit_grams is not null and po.observed_on >= current_date - 120
),
ranked as (
  select obs.*,
         sum(w) over (partition by price_profile_id, ingredient_id order by price_per_kg_minor
                      rows between unbounded preceding and current row) as cw,
         sum(w) over (partition by price_profile_id, ingredient_id) as tw
  from obs
)
select distinct on (price_profile_id, ingredient_id)
       price_profile_id, ingredient_id,
       round(price_per_kg_minor)::bigint as price_per_kg_minor,
       tw as total_weight,
       now() as refreshed_at
from ranked
where cw >= tw / 2
order by price_profile_id, ingredient_id, price_per_kg_minor
with no data;
create unique index mv_current_prices_pk on public.mv_current_prices (price_profile_id, ingredient_id);

revoke all on public.mv_ingredient_prices, public.mv_current_prices from anon;
grant select on public.mv_ingredient_prices, public.mv_current_prices to authenticated;   -- public price information, no PII

-- RPC for prices-refresh (service role only); 0020 body: both views. The emptiness probe is a separate
-- function so it never runs against a view that is not populated yet.
create or replace function private.matview_has_rows(p_view text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v boolean;
begin
  execute format('select exists (select 1 from public.%I)', p_view) into v;
  return v;
end $$;

create or replace function public.refresh_ingredient_prices()
returns void language plpgsql security definer set search_path = '' as $$
declare v_view text;
begin
  foreach v_view in array array['mv_ingredient_prices','mv_current_prices'] loop
    -- the first population (or an empty view) cannot be refreshed concurrently
    if exists (select 1 from pg_catalog.pg_matviews m
                where m.schemaname = 'public' and m.matviewname = v_view and m.ispopulated)
       and private.matview_has_rows(v_view) then
      execute format('refresh materialized view concurrently public.%I', v_view);
    else
      execute format('refresh materialized view public.%I', v_view);
    end if;
  end loop;
end $$;
revoke execute on function public.refresh_ingredient_prices() from public, anon, authenticated;
grant execute on function public.refresh_ingredient_prices() to service_role;
refresh materialized view public.mv_ingredient_prices;
refresh materialized view public.mv_current_prices;

-- 20.6 soft_delete RPC gains pantry_items; body otherwise unchanged (0011 14.3) -----------------------------
create or replace function public.soft_delete(p_table text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_household uuid;
  v_allowed constant text[] := array[
    'family_members','medical_conditions','allergies','medications','supplements','food_preferences',
    'food_dislikes','nutrition_goals','pregnancy_profiles','sensory_profiles','meal_plans','meal_logs',
    'budget_profiles','grocery_lists','hydration_targets','ramadan_plans','exposure_ladders',
    'chat_sessions','ai_memories','recipes','meals','household_members','pantry_items'];
begin
  if not (p_table = any (v_allowed)) then
    raise exception 'SOFT_DELETE_NOT_ALLOWED' using errcode = '42501', detail = p_table;
  end if;

  execute format('select household_id from public.%I where id = $1 and deleted_at is null', p_table)
    into v_household using p_id;
  if v_household is null then
    raise exception 'NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_table = 'chat_sessions' then
    if not exists (select 1 from public.chat_sessions where id = p_id and user_id = auth.uid()) then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
  elsif p_table = 'household_members' then
    -- owner may remove others; anyone may leave; the owner row cannot be removed this way
    if exists (select 1 from public.household_members where id = p_id and role = 'owner') then
      raise exception 'OWNER_CANNOT_LEAVE' using errcode = '42501';
    end if;
    if not (public.household_role_of(v_household) = 'owner'
            or exists (select 1 from public.household_members where id = p_id and user_id = auth.uid())) then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
  elsif p_table = 'meal_plans' then
    if not public.can_author_plans(v_household) then
      raise exception 'FORBIDDEN' using errcode = '42501';
    end if;
  elsif not public.can_edit_household(v_household) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  execute format('update public.%I set deleted_at = now() where id = $1', p_table) using p_id;
end;
$$;
revoke execute on function public.soft_delete(text, uuid) from public, anon;
grant execute on function public.soft_delete(text, uuid) to authenticated;

-- 0016 Realtime (10 section 7.3, part): shared shopping list ------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;   -- plain Postgres only; Supabase creates it
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shopping_items') then
    alter publication supabase_realtime add table public.shopping_items;
  end if;
end $$;

-- Private presence channel 'grocery-presence:{grocery_list_id}' (10 section 7.3). Supabase only.
do $$
begin
  if to_regclass('realtime.messages') is null or to_regprocedure('realtime.topic()') is null then
    raise notice 'realtime schema not present: grocery-presence policies not created';
    return;
  end if;
  execute $p$
    create policy grocery_presence_read on realtime.messages for select to authenticated
      using (
        realtime.messages.extension in ('presence','broadcast')
        and split_part(realtime.topic(), ':', 1) = 'grocery-presence'
        and exists (
          select 1 from public.grocery_lists gl
          where gl.id::text = split_part(realtime.topic(), ':', 2)
            and gl.deleted_at is null
            and public.is_household_member(gl.household_id)))
  $p$;
  execute $p$
    create policy grocery_presence_write on realtime.messages for insert to authenticated
      with check (
        realtime.messages.extension in ('presence','broadcast')
        and split_part(realtime.topic(), ':', 1) = 'grocery-presence'
        and exists (
          select 1 from public.grocery_lists gl
          where gl.id::text = split_part(realtime.topic(), ':', 2)
            and gl.deleted_at is null
            and public.is_household_member(gl.household_id)))
  $p$;
end $$;
