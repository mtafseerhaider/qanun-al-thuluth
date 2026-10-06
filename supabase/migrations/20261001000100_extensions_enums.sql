-- supabase/migrations/20261001000100_extensions_enums.sql
-- 0001 Extensions and enums (05-database-schema.md section 4).
--
-- Sprint 0 subset of the extensions: only what the Sprint 0 tables need.
--   pgcrypto  gen_random_uuid()/digest() (Supabase installs it into "extensions")
--   citext    users.email
--   pg_cron   monthly analytics_events partition maintenance (0014)
-- Deferred to the sprint whose tables need them (see migrations/README.md):
--   pg_trgm (food catalog search, Sprint 1), vector (ai_memories / islamic_sources, Sprint 2),
--   pg_net (cron -> Edge Function calls, Sprint 4). Each lands as
--   `create extension if not exists ... with schema extensions;` in that sprint's migration.
create extension if not exists pgcrypto  with schema extensions;
create extension if not exists citext    with schema extensions;
create extension if not exists pg_cron;                            -- installs into schema "cron"
-- Supabase Vault (schema "vault") is enabled by default on hosted projects and used for cron secrets.

-- Canonical enums, copied verbatim from 00-foundations section 5. Additive changes only.
create type public.household_role        as enum ('owner','caregiver','viewer','coach');
create type public.sex_at_birth          as enum ('female','male','unspecified');
create type public.blood_group           as enum ('A+','A-','B+','B-','AB+','AB-','O+','O-','unknown');
create type public.activity_level        as enum ('sedentary','light','moderate','active','very_active');
create type public.life_stage            as enum ('infant','toddler','child','teen','adult','older_adult');
create type public.goal_type             as enum ('weight_loss','weight_gain','maintain','child_growth','energy','digestive_health','pregnancy_support','breastfeeding_support','blood_sugar','heart_health');
create type public.special_module        as enum ('pregnancy','breastfeeding','autism','adhd','picky_eater');
create type public.meal_type             as enum ('suhoor','breakfast','lunch','snack','dinner','iftar');
create type public.meal_status           as enum ('planned','eaten','partly_eaten','skipped','swapped');
create type public.plan_status           as enum ('draft','generating','active','completed','archived','failed');
create type public.plan_kind             as enum ('standard','ramadan','growth','weight_management','custom');
create type public.severity              as enum ('mild','moderate','severe','anaphylactic');
create type public.evidence_grade_hadith as enum ('sahih','hasan','daif','mawdu','sahih_shia','muwaththaq','hasan_shia','daif_shia','ungraded');
create type public.evidence_grade_science as enum ('high','moderate','low','very_low','expert_opinion');
create type public.source_tradition      as enum ('shared','sunni','shia');
create type public.source_kind           as enum ('quran','hadith','imam_narration','scholarly');
create type public.verification_status   as enum ('unverified','in_review','verified','rejected');
create type public.subscription_tier     as enum ('free','premium');
create type public.subscription_status   as enum ('active','in_grace','in_billing_retry','cancelled','expired','paused');
create type public.chat_role             as enum ('user','assistant','system','tool');
create type public.notification_channel  as enum ('push','in_app','email');
create type public.texture               as enum ('smooth','soft','crunchy','chewy','crispy','mixed','lumpy','wet','dry');
create type public.exposure_stage        as enum ('tolerate_on_table','look','touch','smell','lick','taste','chew_spit','eat_small','eat_portion');
create type public.acceptance_score      as enum ('0_refused','1_tolerated','2_touched','3_tasted','4_ate_some','5_ate_well');
create type public.fast_kind             as enum ('ramadan','sunnah_monday_thursday','ayyam_al_bid','arafah','ashura','qada','nafl','intermittent');
create type public.price_source          as enum ('seed','user_report','admin','partner_feed');
