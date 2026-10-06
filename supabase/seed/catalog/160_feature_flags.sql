-- supabase/seed/catalog/160_feature_flags.sql
-- Initial feature flags (19-deployment-architecture.md section 11, 12-ai-agent-architecture.md
-- section 17, 24-sprint-plan.md section 4.5, 17-subscription-architecture.md).
--
-- Idempotent: a flag is inserted once with its default; re-running only refreshes the
-- description. Per-environment state (enabling a release flag on staging, flipping a kill
-- switch in prod) is changed by an admin and must survive catalog-sync on every deploy.
-- Rules shape: packages/shared flags/evaluate.ts (19 section 11). Rules never contain secrets
-- (feature_flags is readable by every authenticated user).
--
-- Release flags are OFF by default. Kill switches for shipped capabilities are ON.
-- Naming: 24 uses `ramadan_planner` / `photo_meal_analysis`; 19 section 11 lists the Ramadan flag as
-- `ramadan.planner.enabled`. One key per feature: the 24 names are used, 19 should be updated.

insert into public.feature_flags (key, enabled, rules, description) values
  -- config
  ('app.min_supported_version', true,  '{"value":{"ios":"1.0.0","android":"1.0.0"}}',
   'Config. Forced upgrade (UPGRADE_REQUIRED). Owner: lead. Permanent.'),
  ('app.critical_update',       false, '{"value":{"update_group_ids":[]}}',
   'Config. Forces an immediate OTA reload for critical fixes (19 section 4.2). Owner: lead. Permanent.'),
  ('catalog_version',           true,  '{"value":1}',
   'Config. Busts client catalog caches after a seed release. Owner: backend. Permanent.'),
  ('exports.kinds',             true,  '{"value":["meal_plan","grocery_list"]}',
   'Config. Export kinds enabled in export-pdf. Owner: backend. Permanent.'),
  ('ai.caps',                   true,
   '{"free":{"per_day":{"chat.default":20,"vision.meal_analysis":0,"speech.transcribe":0,"plan.adjust":0},"monthly_hard_usd_micros":500000},"premium":{"per_day":{"chat.default":200,"vision.meal_analysis":15,"speech.transcribe":40,"plan.adjust":20},"monthly_hard_usd_micros":8000000,"degrade_route":"chat.free"}}',
   'Config. Per-tier AI caps read by ai_quota_check (12 section 17, 05 section 22.4). Owner: ai. Permanent.'),
  ('chat.free_route',           true,  '{"tiers":["free"],"value":"chat.free"}',
   'Config. Free-tier chat uses route chat.free (cheapest model). Product decision: 00 section 11 open decision #1 default (strict caps + cheapest model). Owner: ai/PO. Revisit after beta.'),
  ('catalog.include_in_review', false, '{}',
   'Config. Internal alpha: users also see in_review recipes, meals, portions and meal alternatives (public.catalog_review_statuses()). Enable in thuluth-dev and thuluth-staging only; counts only when app.environment is local, development, staging or test (unset fails closed). Never affects Islamic sources or recommendations. Owner: backend. Remove once the catalog is dietitian-verified.'),
  ('allow_sandbox_premium',     false, '{}',
   'Config. Sandbox RevenueCat purchases grant premium (enable in thuluth-dev and thuluth-staging only, never prod). 17 section 9. Owner: backend. Permanent.'),
  -- kill switches
  ('app.maintenance',           false, '{}',
   'Kill switch. Maintenance screen; functions return FEATURE_DISABLED. Owner: lead. Permanent.'),
  ('ai.chat.enabled',           true,  '{}',
   'Kill switch. Disable AI chat (curated content fallback). Owner: ai. Permanent.'),
  ('ai.vision.enabled',         true,  '{}',
   'Kill switch. Disable photo meal analysis. Owner: ai. Permanent.'),
  ('ai.voice.enabled',          true,  '{}',
   'Kill switch. Disable voice input. Owner: ai. Permanent.'),
  ('ai.plan.enabled',           true,  '{}',
   'Kill switch. Disable AI plan generation and adjustment (12 section 17). Owner: ai. Permanent.'),
  ('plan.generate.enabled',     true,  '{}',
   'Kill switch. Disable AI plan generation, templates only (19 section 11; overlaps ai.plan.enabled, consolidate in Sprint 3). Owner: ai. Permanent.'),
  -- release flags (dark launch)
  ('ramadan_planner',           false, '{}',
   'Release flag. Ramadan planner (Sprint 5). Enable in prod 6 weeks before Ramadan 1448 (~8 Feb 2027). Owner: PO. Remove within two releases of 100 percent.'),
  ('photo_meal_analysis',       false, '{"tiers":["premium"]}',
   'Release flag. Photo meal analysis, premium only (00 section 8 and 11). Sprint 5. Owner: ai. Remove within two releases of 100 percent.'),
  ('debug_menu',                false, '{}',
   'Release flag. Hidden debug screen (smoke Edge Function call, store inspector). Enable per tester via rules.user_ids; never globally in prod. Owner: lead. Permanent.'),
  -- experiments
  ('paywall.variant',           false, '{"percent":0,"value":"a"}',
   'Experiment. Paywall copy test, sticky by user. Owner: PO. Expires after the test concludes.')
on conflict (key) do update
  set description = excluded.description;
