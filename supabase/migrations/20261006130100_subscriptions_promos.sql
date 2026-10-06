-- supabase/migrations/20261006130100_subscriptions_promos.sql
-- 05 ref: 0023 subscriptions and promos (whole slot), 0011 14.2 (has_premium replaced), 0012 15.6
--         (enforce_plan_entitlement, downgrade). Sprint 5: S5-02, S5-14 (DB side).
-- DDL verbatim from 05 section 22.9 (23.1 to 23.4), except:
--   * has_premium follows 17 section 8 and 10.2 for the lifecycle, keeping 05's tier and webhook-lag rules:
--     tier 'premium', entitlement 'premium', not refunded, and one of
--       'active'    with current_period_end null or later than now() - 3 days (05: clock skew / webhook lag),
--       'cancelled' with current_period_end > now() (paid period still running),
--       'in_grace'  with coalesce(grace_period_expires_at, current_period_end) > now() (17: store grace runs
--                   past the period end, so 05's "period end within 3 days" bound does not apply to it).
--     'in_billing_retry', 'paused' and 'expired' never grant premium (17 section 10.2, AC-SUB7).
--     Sandbox rows: 05 trusts any non-'production' app.environment and treats an unset one as non-production;
--     17 names the flag allow_sandbox_premium. Here a sandbox row counts only when BOTH hold: the flag is
--     enabled and app.environment is explicitly local, development, staging or test (the S3
--     catalog_review_statuses() rule). Unset or unknown environments fail closed.
--   * household_has_premium keeps its 0011 signature (p_household_id) and body: premium follows the household
--     owner (FR-HH-06, 17 section 12). has_premium(user) stays personal: chat quota, voice and memory follow
--     the chatting user's own entitlement (FR-HH-06 acceptance).
--   * get_my_entitlements also returns periodType (05) and householdReadOnly (addition, below).
--   * trial_ending preference (23.5) already landed in S4 (notification kinds) and is not repeated.
--   * Downgrade (FR-SUB-06, 17 section 10.3), addition: data is never deleted on losing premium. A free owner
--     with more than one live household keeps one writable for new plans: the household they chose with
--     keep_household_on_downgrade() (households.downgrade_kept_at, latest wins), else their oldest live
--     household. household_is_read_only(household) is true for the others; enforce_plan_entitlement refuses new
--     or re-activated plans there with PREMIUM_REQUIRED (detail reason 'household_read_only'). Logs (hydration,
--     fasting, meals) stay allowed (17 section 10.3: safety tracking). The 0012 body is otherwise unchanged.
--   * Addition: FK indexes (10 section 16 rule 3); revenuecat_events also revokes from anon.

-- 23.1 subscriptions lifecycle columns (last_event_at already exists from 0010) -----------------------------------------
alter table public.subscriptions
  add column entitlement              text not null default 'premium' check (entitlement in ('premium','coach')),
  add column period_type              text check (period_type in ('trial','intro','normal','promotional')),
  add column grace_period_expires_at  timestamptz,
  add column original_transaction_id  text,
  add column environment              text not null default 'production' check (environment in ('production','sandbox')),
  add column refunded_at              timestamptz,
  add column country_code             char(2) check (country_code ~ '^[A-Z]{2}$');
create unique index subscriptions_user_store_entitlement on public.subscriptions (user_id, store, entitlement);
create index subscriptions_original_txn_idx on public.subscriptions (original_transaction_id) where original_transaction_id is not null;

-- 23.1b has_premium (see header) ------------------------------------------------------------------------------------------
create or replace function public.has_premium(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user_id
      and s.tier = 'premium'
      and s.entitlement = 'premium'
      and s.refunded_at is null
      and (s.environment = 'production'
           or (coalesce(current_setting('app.environment', true), '') in ('local','development','staging','test')
               and exists (select 1 from public.feature_flags f where f.key = 'allow_sandbox_premium' and f.enabled)))
      and (
        (s.status = 'active' and (s.current_period_end is null or s.current_period_end > now() - interval '3 days'))
        or (s.status = 'cancelled' and s.current_period_end > now())
        or (s.status = 'in_grace' and coalesce(s.grace_period_expires_at, s.current_period_end) > now())
      )
  );
$$;
revoke execute on function public.has_premium(uuid) from public, anon;
grant execute on function public.has_premium(uuid) to authenticated, service_role;

-- 23.2 revenuecat_events: webhook idempotency and replay (service role writes) ------------------------------------------
create table public.revenuecat_events (
  event_id         text primary key,             -- RevenueCat event.id
  type             text not null,
  app_user_id      text not null,
  event_timestamp  timestamptz not null,
  environment      text not null check (environment in ('PRODUCTION','SANDBOX')),
  received_at      timestamptz not null default now(),
  processed_at     timestamptz,
  error            text,
  payload          jsonb not null,               -- PII-scrubbed
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index revenuecat_events_user_idx on public.revenuecat_events (app_user_id, event_timestamp desc);
create index revenuecat_events_unprocessed_idx on public.revenuecat_events (received_at) where processed_at is null;
call private.attach_updated_at('public.revenuecat_events');
alter table public.revenuecat_events enable row level security;
revoke all on public.revenuecat_events from authenticated, anon;
create policy revenuecat_events_admin_read on public.revenuecat_events for select to authenticated
  using (public.is_admin());

-- 23.3 Promotional codes for coaches, madrasas and partners (promo-redeem Edge Function) --------------------------------
create table public.promo_campaigns (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  org_kind           text not null check (org_kind in ('coach','madrasa','school','clinic','community','partner','internal')),
  grant_days         smallint not null check (grant_days between 7 and 366),
  max_redemptions    integer not null check (max_redemptions > 0),
  redeemed_count     integer not null default 0 check (redeemed_count >= 0),
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  allowed_countries  char(2)[],
  created_by         uuid references public.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (ends_at > starts_at),
  check (redeemed_count <= max_redemptions)
);
create index promo_campaigns_created_by_idx on public.promo_campaigns (created_by) where created_by is not null;   -- FK index
create table public.promo_codes (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.promo_campaigns(id) on delete cascade,
  code_hash    text not null unique,             -- sha256(upper(code) || pepper)
  single_use   boolean not null default true,
  redeemed_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index promo_codes_campaign_idx on public.promo_codes (campaign_id);
create table public.promo_redemptions (
  id             uuid primary key default gen_random_uuid(),
  promo_code_id  uuid not null references public.promo_codes(id) on delete restrict,
  user_id        uuid not null references public.users(id) on delete cascade,
  granted_until  timestamptz not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (promo_code_id, user_id)
);
create index promo_redemptions_user_idx on public.promo_redemptions (user_id);
call private.attach_updated_at('public.promo_campaigns');
call private.attach_updated_at('public.promo_codes');
call private.attach_updated_at('public.promo_redemptions');
call private.attach_audit('public.promo_campaigns', 'full');
call private.attach_audit('public.promo_redemptions', 'full');

alter table public.promo_campaigns enable row level security;
alter table public.promo_codes enable row level security;
alter table public.promo_redemptions enable row level security;
create policy promo_campaigns_admin on public.promo_campaigns for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy promo_codes_admin on public.promo_codes for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy promo_redemptions_select_own on public.promo_redemptions for select to authenticated
  using (user_id = auth.uid() or public.is_admin());
create policy promo_redemptions_admin_write on public.promo_redemptions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Downgrade: read-only extra households (see header) ------------------------------------------------------------------------
alter table public.households add column downgrade_kept_at timestamptz;

create or replace function public.household_is_read_only(p_household_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select not public.has_premium(h.owner_user_id)
           and h.id <> (select k.id from public.households k
                         where k.owner_user_id = h.owner_user_id and k.deleted_at is null
                         order by k.downgrade_kept_at desc nulls last, k.created_at, k.id
                         limit 1)
    from public.households h
    where h.id = p_household_id and h.deleted_at is null
  ), false);
$$;
revoke all on function public.household_is_read_only(uuid) from public, anon;
grant execute on function public.household_is_read_only(uuid) to authenticated, service_role;

create or replace function public.keep_household_on_downgrade(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.households set downgrade_kept_at = now()
   where id = p_household_id and owner_user_id = auth.uid() and deleted_at is null;
  if not found then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
end $$;
revoke all on function public.keep_household_on_downgrade(uuid) from public, anon;
grant execute on function public.keep_household_on_downgrade(uuid) to authenticated;

-- 15.6 plan entitlement with the downgrade rule; otherwise the S3 body -------------------------------------------------------
create or replace function private.enforce_plan_entitlement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_count integer; v_newly_live boolean;
begin
  if coalesce(current_setting('app.bypass_entitlements', true), '') = 'on'
     or public.household_has_premium(new.household_id) then
    return new;
  end if;
  if new.status in ('generating','active') and new.deleted_at is null then
    if tg_op = 'INSERT' then
      v_newly_live := true;
    else
      v_newly_live := old.status not in ('generating','active') or old.deleted_at is not null;
    end if;
    if v_newly_live and public.household_is_read_only(new.household_id) then
      raise exception 'PREMIUM_REQUIRED' using errcode = 'P0001',
        detail = json_build_object('reason','household_read_only','household_id',new.household_id)::text,
        hint = 'upgrade_required';
    end if;
    if new.week_count > 1 or new.kind not in ('standard','custom') then
      raise exception 'PREMIUM_REQUIRED' using errcode = 'P0001',
        detail = json_build_object('reason','multi_week_or_kind','kind',new.kind,'week_count',new.week_count)::text,
        hint = 'upgrade_required';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('meal_plans:' || new.household_id::text, 0));
    select count(*) into v_count from public.meal_plans mp
     where mp.household_id = new.household_id and mp.deleted_at is null
       and mp.status in ('generating','active') and mp.id <> new.id
       and mp.id is distinct from new.parent_plan_id;   -- an adjustment replaces its parent
    if v_count >= 1 then
      raise exception 'PLAN_ALREADY_ACTIVE' using errcode = 'P0001',
        detail = json_build_object('resource','meal_plans','limit',1,'current',v_count)::text,
        hint = 'upgrade_required';
    end if;
  end if;
  return new;
end $$;

-- 23.4 Client entitlement RPCs -----------------------------------------------------------------------------------------------
create or replace function public.premium_for(p_household uuid default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_premium(auth.uid())
      or (p_household is not null and public.is_household_member(p_household) and public.household_has_premium(p_household));
$$;

create or replace function public.get_my_entitlements(p_household uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'premium',           public.premium_for(p_household),
    'personalPremium',   public.has_premium(auth.uid()),
    'householdPremium',  p_household is not null and public.is_household_member(p_household)
                         and public.household_has_premium(p_household),
    'householdReadOnly', p_household is not null and public.is_household_member(p_household)
                         and public.household_is_read_only(p_household),
    'status',            (select s.status from public.subscriptions s
                           where s.user_id = auth.uid() and s.entitlement = 'premium'
                           order by s.current_period_end desc nulls last limit 1),
    'periodType',        (select s.period_type from public.subscriptions s
                           where s.user_id = auth.uid() and s.entitlement = 'premium'
                           order by s.current_period_end desc nulls last limit 1),
    'currentPeriodEnd',  (select max(s.current_period_end) from public.subscriptions s where s.user_id = auth.uid()),
    'willRenew',         (select coalesce(bool_or(s.will_renew), false) from public.subscriptions s where s.user_id = auth.uid())
  );
$$;
revoke all on function public.premium_for(uuid), public.get_my_entitlements(uuid) from public, anon;
grant execute on function public.premium_for(uuid), public.get_my_entitlements(uuid) to authenticated, service_role;
