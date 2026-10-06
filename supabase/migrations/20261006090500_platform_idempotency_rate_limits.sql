-- supabase/migrations/20261006090500_platform_idempotency_rate_limits.sql
-- 05 ref: 0025 platform, part 0025a (Sprint 1): idempotency_keys, rate_limit_buckets,
--         consume_rate_limit() (household-invite, 06 section 2.7), evaluate_feature_flags()
--         (11 section 9 step 8), idempotency-gc and rate-limit-gc cron. Verbatim from 05 section 22.11
--         (25.1, 25.2, 25.5 and the two jobs of 25.6). prayer_times_cache (0025b, S5) and the
--         account_data export kind (0025c, S6) follow later.

-- 25.1 idempotency_keys (06 section 2.4). Service role only.
create table public.idempotency_keys (
  id             uuid primary key default gen_random_uuid(),
  scope          text not null,                 -- function name, or 'revenuecat'
  user_id        uuid references public.users(id) on delete cascade,   -- null for webhooks
  key            text not null check (char_length(key) between 8 and 128),
  request_hash   text not null,
  status         text not null check (status in ('in_progress','completed','failed')),
  response_code  smallint,
  response_body  jsonb,
  expires_at     timestamptz not null default now() + interval '24 hours',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index idempotency_keys_scope_user_key
  on public.idempotency_keys (scope, coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
create index idempotency_keys_expiry_idx on public.idempotency_keys (expires_at);
create index idempotency_keys_user_idx on public.idempotency_keys (user_id) where user_id is not null;
call private.attach_updated_at('public.idempotency_keys');
alter table public.idempotency_keys enable row level security;
revoke all on public.idempotency_keys from authenticated;
create policy idempotency_keys_admin_read on public.idempotency_keys for select to authenticated using (public.is_admin());

-- 25.2 Rate limiting: the only mechanism (06 section 2.7; 16's rate_limits means this table).
-- Unlogged on purpose: counters may be lost on crash. updated_at is set by consume_rate_limit itself
-- (no trigger on this hot path).
create unlogged table public.rate_limit_buckets (
  bucket_key    text primary key,              -- e.g. 'ai-chat:{user_id}:min'
  window_start  timestamptz not null,
  count         integer not null check (count >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index rate_limit_buckets_window_idx on public.rate_limit_buckets (window_start);
alter table public.rate_limit_buckets enable row level security;
revoke all on public.rate_limit_buckets from authenticated;
create policy rate_limit_buckets_admin_read on public.rate_limit_buckets for select to authenticated using (public.is_admin());

create or replace function public.consume_rate_limit(p_key text, p_limit integer, p_window_seconds integer)
returns table (allowed boolean, remaining integer, reset_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now           timestamptz := now();
  v_window_start  timestamptz;
  v_count         integer;
begin
  if p_limit < 0 or p_window_seconds is null or p_window_seconds <= 0 then
    raise exception 'INVALID_RATE_LIMIT' using errcode = '22023';
  end if;
  -- Deviation from 05: computed after the argument check (05 divides by p_window_seconds first)
  v_window_start := to_timestamp(floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limit_buckets as b (bucket_key, window_start, count)
  values (p_key, v_window_start, 1)
  on conflict (bucket_key) do update
    set count        = case when b.window_start = excluded.window_start then b.count + 1 else 1 end,
        window_start = excluded.window_start,
        updated_at   = v_now
  returning b.count into v_count;
  return query select v_count <= p_limit, greatest(p_limit - v_count, 0), v_window_start + make_interval(secs => p_window_seconds);
end $$;
revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

-- 25.5 evaluate_feature_flags(): {key: boolean} for the caller (09 section 5). Rules keys:
-- user_ids (allow list, wins), countries, tiers, min_app_version (from the X-App-Version header), percent.
create or replace function public.evaluate_feature_flags()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_country  text;
  v_tier     text;
  v_version  text := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb) ->> 'x-app-version';
  v_out      jsonb := '{}'::jsonb;
  f          record;
  v_on       boolean;
begin
  select u.country_code into v_country from public.users u where u.id = v_uid;
  v_tier := case when public.has_premium(v_uid) then 'premium' else 'free' end;
  for f in select ff.key, ff.enabled, ff.rules from public.feature_flags ff loop
    v_on := f.enabled;
    if v_on and f.rules ? 'countries' then
      v_on := coalesce(v_country = any (array(select jsonb_array_elements_text(f.rules -> 'countries'))), false);
    end if;
    if v_on and f.rules ? 'tiers' then
      v_on := v_tier = any (array(select jsonb_array_elements_text(f.rules -> 'tiers')));
    end if;
    if v_on and f.rules ? 'min_app_version' then
      v_on := v_version ~ '^\d+(\.\d+)*$'
              and string_to_array(v_version, '.')::int[] >= string_to_array(f.rules ->> 'min_app_version', '.')::int[];
    end if;
    if v_on and f.rules ? 'percent' then
      v_on := v_uid is not null
              and abs(hashtextextended(f.key || ':' || v_uid::text, 0)) % 100 < (f.rules ->> 'percent')::int;
    end if;
    if f.enabled and v_uid is not null and f.rules ? 'user_ids'
       and v_uid::text in (select jsonb_array_elements_text(f.rules -> 'user_ids')) then
      v_on := true;
    end if;
    v_out := v_out || jsonb_build_object(f.key, coalesce(v_on, false));
  end loop;
  return v_out;
end $$;
revoke all on function public.evaluate_feature_flags() from public, anon;
grant execute on function public.evaluate_feature_flags() to authenticated, service_role;

-- 25.6 Housekeeping jobs (UTC), Sprint 1 subset
select cron.schedule('idempotency-gc', '0 22 * * *',                        -- 03:00 PKT
  $$delete from public.idempotency_keys where expires_at < now()$$);
select cron.schedule('rate-limit-gc', '*/15 * * * *',
  $$delete from public.rate_limit_buckets where window_start < now() - interval '1 day'$$);
