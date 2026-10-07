-- supabase/tests/database/functions/170_ai_route_prices.test.sql
-- Every enabled AI route carries list prices (seed/catalog/140_ai_model_routes.sql, 12 section 5.3/5.6).
-- A route without prices meters $0 into ai_usage, so the per-user daily caps, the monthly caps, the global
-- daily cap and AI_DAILY_COST_ALERT_USD never trigger. Token routes need input and output prices (embeddings
-- have no output, so only input); Anthropic routes also price cache reads and writes; speech.transcribe is
-- metered per audio minute (pricePerMinuteUsd).
begin;
select plan(6);

create function pg_temp.num(p jsonb, k text) returns numeric language sql immutable as $$
  select case when jsonb_typeof(p -> k) = 'number' then (p ->> k)::numeric end
$$;

select ok((select count(*) from public.ai_model_routes where enabled) >= 20, 'the default routes are seeded');

select is(
  (select array_agg(route_key || '/' || model order by route_key, priority) from public.ai_model_routes
    where enabled and route_key <> 'speech.transcribe'
      and coalesce(pg_temp.num(params, 'priceInPerMTokUsd'), 0) <= 0),
  null::text[], 'every enabled token route has a positive input price');

select is(
  (select array_agg(route_key || '/' || model order by route_key, priority) from public.ai_model_routes
    where enabled and route_key <> 'speech.transcribe' and route_key not like 'embed.%'
      and coalesce(pg_temp.num(params, 'priceOutPerMTokUsd'), 0) <= 0),
  null::text[], 'every enabled generation route has a positive output price');

select is(
  (select array_agg(route_key || '/' || model order by route_key, priority) from public.ai_model_routes
    where enabled and provider = 'anthropic'
      and (coalesce(pg_temp.num(params, 'priceCacheReadPerMTokUsd'), 0) <= 0
           or coalesce(pg_temp.num(params, 'priceCacheWritePerMTokUsd'), 0) <= 0)),
  null::text[], 'every enabled Anthropic route prices cache reads and writes');

select is(
  (select array_agg(route_key || '/' || model order by priority) from public.ai_model_routes
    where enabled and route_key = 'speech.transcribe'
      and coalesce(pg_temp.num(params, 'pricePerMinuteUsd'), 0) <= 0),
  null::text[], 'every enabled transcription route has a per-minute price');

-- The Anthropic prices match the cost simulation (packages/ai-core/scripts/cost-sim.ts PRICES).
select results_eq(
  $$select distinct model, pg_temp.num(params, 'priceInPerMTokUsd'), pg_temp.num(params, 'priceOutPerMTokUsd'),
           pg_temp.num(params, 'priceCacheReadPerMTokUsd'), pg_temp.num(params, 'priceCacheWritePerMTokUsd')
      from public.ai_model_routes where provider = 'anthropic' order by model$$,
  $$values ('claude-haiku-4-5-20251001', 1::numeric, 5::numeric, 0.1::numeric, 1.25::numeric),
           ('claude-opus-5-5', 4::numeric, 20::numeric, 0.2::numeric, 5::numeric),
           ('claude-sonnet-5-5', 2::numeric, 10::numeric, 0.2::numeric, 2.5::numeric)$$,
  'Anthropic route prices match the claude-api list prices');

select * from finish();
rollback;
