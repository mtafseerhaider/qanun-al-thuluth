-- supabase/migrations/20261001001000_platform.sql
-- 0010 Platform (05-database-schema.md section 13), Sprint 0 subset:
--   subscriptions     needed by has_premium() (S0-07, FR-SUB-05)
--   analytics_events  S0-13 (range-partitioned by month; partitions created in 0014)
--   feature_flags     S0-13
-- notifications, notification_preferences, devices, consents, audit_log, exports land in
-- later sprints; see migrations/README.md.

-- 13.1 subscriptions (server truth from revenuecat-webhook; see 17-subscription-architecture.md)
create table public.subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  tier                public.subscription_tier not null default 'free',
  status              public.subscription_status not null,
  product_id          text not null,      -- 'thuluth_premium_monthly' | 'thuluth_premium_annual' | promo id
  store               text not null check (store in ('app_store','play_store','promotional')),
  rc_app_user_id      text not null,      -- equals users.id::text (RevenueCat appUserID)
  current_period_end  timestamptz,
  will_renew          boolean not null default false,
  raw_event           jsonb not null default '{}'::jsonb,   -- latest webhook payload (PII-scrubbed)
  last_event_id       text,               -- Addition: RevenueCat event.id for idempotency
  last_event_at       timestamptz,        -- Addition: event.event_timestamp_ms; older events are ignored
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (rc_app_user_id, product_id, store)
);
create index subscriptions_user_active_idx on public.subscriptions (user_id, tier, status, current_period_end desc);
create unique index subscriptions_last_event_key on public.subscriptions (last_event_id) where last_event_id is not null;

-- 13.7 analytics_events (range-partitioned by month on occurred_at)
create table public.analytics_events (
  id           uuid not null default gen_random_uuid(),
  user_id      uuid,                      -- no FK: partitioned, erasure job nulls it (18 retention)
  household_id uuid,                      -- no FK, same reason
  event        text not null check (event ~ '^[a-z][a-z0-9_.]{2,63}$'),   -- 'plan.generated', 'hydration.logged'
  props        jsonb not null default '{}'::jsonb,
  occurred_at  timestamptz not null,
  app_version  text,
  platform     text check (platform in ('ios','android','web','server')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (id, occurred_at)
) partition by range (occurred_at);

create index analytics_events_event_time_idx on public.analytics_events (event, occurred_at);
create index analytics_events_user_time_idx on public.analytics_events (user_id, occurred_at);

create table public.analytics_events_default partition of public.analytics_events default;
-- Monthly partitions (analytics_events_yYYYYmMM) are created by private.ensure_analytics_partitions() in 0014.

-- 13.9 feature_flags
create table public.feature_flags (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique check (key ~ '^[a-z0-9_.]+$'),
  enabled     boolean not null default false,
  rules       jsonb not null default '{}'::jsonb,
              -- {"countries":["PK"],"min_app_version":"1.2.0","percent":25,"tiers":["premium"],"user_ids":[]}
  description text,                                   -- Addition
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
