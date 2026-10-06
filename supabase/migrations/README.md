# supabase/migrations

Forward-only SQL for the Thuluth database. The reference DDL is `docs/05-database-schema.md`
(05). Rules are in `docs/10-supabase-structure.md` section 16. In short: never edit a file
after it reaches `thuluth-dev`, enum changes are additive only, and every new table ships in the
same PR with its RLS policies, `set_updated_at` trigger and a pgTAP test.

Run locally with `tooling/scripts/db-test.sh`. It uses `supabase db reset && supabase test db`
when the CLI and Docker are available, and otherwise falls back to a throwaway plain-Postgres
cluster.

## Numbering

05 numbers its migrations 0001 to 0026. The file timestamps are `20261001000100` to
`20261001002600`, written as if the whole schema shipped at once. In practice the schema ships
one sprint at a time, so this README treats each 05 number as a **logical label**, not a file
slot:

- **Sprint 0** uses the 05 file names and timestamps for the slots it fills. It carries a subset
  of each slot (the table below says which). Nothing has been deployed yet, so these timestamps
  are safe.
- **Every later migration** is created with `supabase migration new <name>` and gets a real UTC
  timestamp, so it always sorts after the files already applied to `thuluth-dev`. Inserting an
  older timestamp would need `db push --include-all`. Worse, a fresh `db reset` would then run
  the inserted file *before* the helpers it depends on (for example 0011, 0013). Each new file
  states its 05 label on line 2, for example `-- 05 ref: 0003 identity (part 2: family_members)`.
- Within a sprint, apply base DDL (the remaining parts of 0003 to 0016) **before** the
  consolidated additions (0017 onward) for the same tables. Across sprints, 0017+ parts keep the
  reserved order below.

## Sprint 0 (applied)

| File | 05 ref | Contents | Deferred from this slot |
|---|---|---|---|
| `20261001000100_extensions_enums.sql` | 0001 | `pgcrypto`, `citext`, `pg_cron`; all 26 canonical enums | `pg_trgm` (S1), `vector` (S2), `pg_net` (S4) |
| `20261001000200_core_helpers.sql` | 0002 | complete: `set_updated_at`, `life_stage_for_dob` (00 §11 calls it `derive_life_stage`), `age_in_months`, `is_minor`, `compute_bmi`, `is_admin` | none |
| `20261001000300_identity_tenancy.sql` | 0003 | `users`, `households`, `household_members` | `household_invitations`, `family_members` (S1) |
| `20261001000700_ai.sql` | 0007 | `ai_usage`, `ai_model_routes`, `prompt_templates` | `ai_assessments` (S2), `chat_sessions`, `chat_messages`, `ai_memories` (S5) |
| `20261001001000_platform.sql` | 0010 | `subscriptions`, `analytics_events` (partitioned) + default partition, `feature_flags` | `consents`, `audit_log`, `devices` (S1); `notifications`, `notification_preferences` (S4); `exports` (S6) |
| `20261001001100_access_helpers.sql` | 0011 | complete except `is_linked_member` (needs `family_members`, S1) | `is_linked_member` |
| `20261001001200_triggers.sql` | 0012 | `updated_at` loop; timezone validation; household bootstrap; household entitlement; owner protection; `transfer_household_ownership`; `handle_new_auth_user` (users row only); `sync_auth_email` | see "Base DDL still to land" |
| `20261001001300_rls.sql` | 0013 | anon baseline revokes; `apply_household_rls` / `apply_catalog_rls` generators; policies for every Sprint 0 table | policies for later tables ship with them |
| `20261001001400_analytics_cron.sql` | 0014 | `ensure_analytics_partitions`, `drop_old_analytics_partitions`, partitions for the current month plus three; cron jobs `analytics-partitions`, `analytics-retention` | materialized views, retention helpers, `invoke_edge_function`, other cron jobs |

Seeds: `seed/catalog/140_ai_model_routes.sql` and `seed/catalog/160_feature_flags.sql` run in
every environment. `seed/local/000_local_vault.sql` and `seed/local/900_dev_fixtures.sql` run
locally and in CI only.

Sprint 0 additions beyond 00-foundations:

- Route key `chat.free` (Anthropic `claude-haiku-4-5-20251001`, Gemini Flash fallback), enabled.
  It implements the default for open decision 1 (cheapest model for free chat), recorded in
  00 §11.
- Flag `chat.free_route`, enabled.
- Route keys `chat.summarize` and `eval.judge`, from 12 §21.
- `ai-smoke` in `config.toml`.

## Base DDL still to land (05 slots 0003 to 0016)

| Sprint | Story | 05 ref | Objects |
|---|---|---|---|
| S1 | S1-02, S1-03, S1-07 | 0003, 0010, 0011, 0012, 0013 | `household_invitations`, `family_members`, `is_linked_member()`; triggers `family_members_derive`, `family_size_sync`, `enforce_member_entitlement`; `refresh_life_stages()` + cron `refresh-life-stages`; `consents`, `audit_log`, `devices`; `audit_row_change` / `audit_log_immutable` / `request_ip_hash`, plus audit triggers on the Sprint 0 tables (`households`, `household_members`, `subscriptions`, `ai_model_routes`, `prompt_templates`, `feature_flags`); cron `invitations-cleanup` |
| S1 | S1-10 | 0008 | `budget_profiles` (the optional budget in onboarding step 3) |
| S1 | S1-19 | 0001, 0004 | `pg_trgm`; `allergens`, `budget_categories`, `regions`, `ingredients`, `ingredient_allergens`; FK `households.region_id -> regions` |
| S1 | S1-20 | 0006 | `quran_references`, `hadith_references`, `imam_narrations`, `islamic_sources`, `source_verifications`, `scientific_evidence`, `recommendations`, `recommendation_evidence`, `foods_in_narrations`; triggers 15.14, 15.15 |
| S1 | S1 avatars | 0015 (part) | Storage bucket `avatars` and its policies (10 §6.4) |
| S2 | S2-02 | 0005, 0007, 0009 | `medical_conditions`, `allergies`, `medications`, `supplements`, `food_preferences`, `food_dislikes`, `nutrition_goals`, `pregnancy_profiles`, `sensory_profiles`, `ai_assessments`, `hydration_targets`; `enforce_child_goal_safety` (S2-03) |
| S2 | S2-12 | 0001 | `vector` extension, `islamic_sources.embedding` HNSW index |
| S2 | S2-16 | 0004 | `recipes`, `recipe_ingredients`, `meals`, `portions`, `meal_alternatives`, `seasonal_produce`; `recompute_recipe_nutrition` and its trigger |
| S3 | S3-02 | 0008, 0012, 0016 | `meal_plans`, `daily_meals`, `daily_meal_servings`, `plan_recommendations`; `enforce_plan_entitlement`; Realtime publication (0016) |
| S4 | S4-02 | 0004, 0008, 0009, 0010, 0012, 0014 | `price_profiles`, `price_observations` (+ moderation trigger), `grocery_lists`, `shopping_items`, `budget_entries` (+ currency trigger), `hydration_logs`, `fasting_logs` (+ `enforce_fasting_safety`), `weight_tracking` (+ BMI and latest-measurement triggers), `nutrition_journal`, `notifications`, `notification_preferences`; full `handle_new_auth_user` body (default preferences); `pg_net`, `invoke_edge_function`, `mv_ingredient_prices`, `refresh_ingredient_prices`, retention helpers, remaining cron jobs |
| S5 | S5-02 | 0007, 0009, 0012, 0015, 0016b | `chat_sessions`, `chat_messages` (+ `chat_touch_session`), `ai_memories` (HNSW), `meal_logs`, `ramadan_plans`; buckets `chat-attachments`, `meal-photos`, `voice-notes` |
| S6 | S6-02 | 0006, 0009, 0010, 0012 | `growth_reference_lms`, `growth_tracking` (+ reset/sync triggers), `food_exposures`, `exposure_ladders`, `exposure_ladder_steps`, `coaching_tips`, `exports`; bucket `exports` |
| S6 | S6-13 | 0014 | `mv_daily_active_users`, `mv_feature_usage_daily`, `refresh_analytics_views` (superseded by schema `analytics` in 0024) |

## Reserved follow-up migrations

Every "Addition beyond 00-foundations" in docs 04 to 18 is inventoried below. Each one is
already consolidated as DDL in 05 §22 (0017 to 0026), with traceability in 05 §22.15. Per
00 §11 these additions are accepted, and 05 is where they land, so nothing here needs a docs
change.

The reserved order is 0017 → 0026. A slot whose contents span several sprints is split into
parts (a, b, …). Each part ships in the sprint that first needs it, after that sprint's base
DDL.

| Order | 05 slot | Part / sprint | Contents (requested by) |
|---|---|---|---|
| 1 | 0017 consolidation helpers | **S1** (whole slot) | `private.attach_updated_at`, `private.attach_audit` (after the S1 audit functions); `has_household_role(uuid, household_role[])` (11 §18); `has_content_role(text[])` (13 §8.1); `users.age_attested_at` (09, 11), `deletion_scheduled_for` (04, 06), `processing_restricted` (16), `analytics_opt_out`, `is_internal` (18) |
| 2 | 0022 security and privacy | **0022a S1** | `consent_versions`, `has_active_consent()`, consent triggers incl. `child_data` on `family_members` (11 §18, 16 §7.2); `auth.identities` audit trigger, `audit_log.action` values `identity.*` (11 §18) |
| 3 | 0025 platform | **0025a S1** | `idempotency_keys` (04, 06 §2.4), `rate_limit_buckets`, `consume_rate_limit()` (06 §2.7, 16 §20, 00 §11; used by `household-invite` accept), `evaluate_feature_flags()` (09 §12; replaces client-side flag evaluation), `idempotency-gc` and `rate-limit-gc` cron |
| 4 | 0019 Islamic knowledge extras | **0019a S1** (with S1-20) | `scholar_reviewers`, `scholarly_notes`, `quran_text`; `islamic_sources.code`, `approvals_count`, `retracted_at`, `retraction_reason`, `search_tsv`; `hadith_references.also_in`; `imam_narrations.edition`, `chapter`, `also_in`; `source_verifications.reviewer_id`, `round`, `action`, `checklist` and widened `method`; `scientific_evidence.code`, `reviewed_by`, `reviewed_on`, `summary_i18n`, `retracted_at`; `recommendations.version`, `tradition_scope`, `science_only` and the relaxed publishing gate (00 §11); two-reviewer verification, retraction; `citable_islamic_sources`, `v_knowledge_status`; content-role policies (12, 13 §13) |
| 5 | 0019 | **0019b S2** (S2-12) | `search_islamic_sources()` (12 §9; same as S2-12 `match_knowledge()`, which is the 05 name) |
| 6 | 0018 AI jobs and safety | **0018a S2** | `safety_events` (12 §21; intake red flags); `ai_eval_cases`, `ai_eval_runs` (12 §21, 21 §20); `ai_usage.prompt_key`, `prompt_version`, `cache_read_tokens`, `cache_write_tokens` (12 §21) |
| 7 | 0020 meal planning and grocery extras | **0020a S2** (S2-02, S2-16) | `households.preferences` (01 app. B, 14 §22); `ingredients.yield_factors`, `shelf_life_days`, `purchase_units`, `aisle`; `portions.tier` with widened unique keys; recipe nutrition recompute on ingredient edits (14 §22) |
| 8 | 0021 health modules extras | **0021a S2** (S2-02) | `family_members.lifestyle` (01 app. B) |
| 9 | 0022 | **0022b S2** (S2-02) | `household_keys`, `*_enc` / `*_key_version` columns incl. pregnancy notes, `get_note_kek()` (16 §10, 00 §11: no pgsodium, Vault-held KEK) |
| 10 | 0018 | **0018b S3** | `ai_jobs` (12 §21) |
| 11 | 0020 | **0020b S3** | `daily_meals.batch_multiplier`, `source_daily_meal_id`, `is_lunchbox`; `meal_plans.weekly_themes` (14 §22) |
| 12 | 0026 plan generation queue | **S3** (whole slot) | pgmq queue `plan_generation`, `meal_plans.generation_progress`, queue wrappers, `write_plan_week(uuid, jsonb)`, `activate_meal_plan(uuid)`, `plan-generation-sweeper` cron (04 §15, 06 §3.3 and §9, 00 §11) |
| 13 | 0020 | **0020c S4** | `price_observations.unit_grams`, statuses `rejected_outlier` / `rejected_manual` and the outlier screen; `mv_current_prices`; `pantry_items`; `ingredient_substitutions` (14 §22) |
| 14 | 0021 | **0021b S4** | `households.hijri_offset_days`; `fasting_logs.hijri_date`, `qada_for_hijri_year`; `v_qada_balance` (15 §10) |
| 15 | 0022 | **0022c S4** | `fasting_logs_visible` (16 §5) |
| 16 | 0023 subscriptions and promos | **S5** (whole slot) | `subscriptions.entitlement`, `period_type`, `grace_period_expires_at`, `original_transaction_id`, `environment`, `refunded_at`, `country_code`, unique `(user_id, store, entitlement)`; `revenuecat_events`; `promo_campaigns`, `promo_codes`, `promo_redemptions`; `premium_for(uuid)`, `get_my_entitlements(uuid)`; `notification_preferences.kind = 'trial_ending'` (17 §17) |
| 17 | 0018 | **0018c S5** | `ai_memories.kind`, `status`; `chat_messages` column privileges (06 §3.8); `ai_quota_check(uuid, text)` (12 §17; reads `feature_flags['ai.caps']`, already seeded) |
| 18 | 0021 | **0021c S5** | `ramadan_plans.calc_params` (15 §10) |
| 19 | 0025 | **0025b S5** | `prayer_times_cache`, `prayer-times-retention` cron (04, 06 §4.9) |
| 20 | 0021 | **0021d S6** | `growth_tracking.age_days`, `measurement_position`, `entered_by`; `exposure_ladders.status = 'accepted'`, structured `food_exposures.context`; `growth_dashboard(uuid)`, `picky_acceptance_summary(uuid, int)` (15 §10, 18) |
| 21 | 0022 | **0022d S6** | `data_subject_requests`, `deleted_user_ledger` (16 §7.4, §12); erasure executor, `account-delete-executor` cron (04, 06 §4.13) |
| 22 | 0024 analytics | **S6** (whole slot; consider pulling 0024's first block into S1, see note) | `analytics_events.event_id`, `session_id`, `received_at`, `locale`, `country_code`; `analytics_event_catalog`, `track_events(jsonb)`, `analytics_filter_props(text, jsonb)`; schema `analytics` with ten materialized views and `metric_snapshots`; extended `refresh_analytics_views()`; `get_family_insights(uuid, int)` (18 §16) |
| 23 | 0025 | **0025c S6** | `exports.kind = 'account_data'`, nullable `exports.household_id` (04, 06 §4.12) |

Notes:

- **Already covered, not re-added:** 05 §22.13 lists these. Examples: `can_write_household` = `can_edit_household`; `assert_same_household` = composite FKs; `rate_limits` = `rate_limit_buckets`; and the 06 unique index on `notifications (user_id, kind, scheduled_for)`, which is rejected in favour of `dedupe_key`.
- **Not migrations:** route keys (`chat.free`, `chat.summarize`, `eval.judge`) and flag keys are seed rows in `seed/catalog/`. Storage bucket names (04 §15, 10 §17) live in 0015 / 0016b. The `tests` schema is test-only.
- **Phase 2, not reserved:** 05 §22.14 lists these. They include `agent_*` tables (25), `coach_profiles`, `plan_approvals`, `health_integrations`, `packaged_products`, `coaching_programs`, `price_partners`, `households.kind`, `family_members.cohort_size`, the `analytics_reader` role, and `consents.kind = 'partner_access'`.
- **Analytics client contract (S0-13):** until 0024 lands, the client inserts into `analytics_events` directly with `user_id = auth.uid()` (no column default) and `return=minimal` (authenticated has no SELECT). Fields such as `session_id` and `locale` go in `props`. Once 0024 lands, the client switches to `rpc('track_events')`.
- **Generated types:** `analytics_events_default` and the monthly partitions appear as tables in `packages/shared/src/db/database.types.ts`. Their names change every month, so the CI drift check from S0-08 / 10 §16 rule 8 must ignore tables named `analytics_events_default` and `analytics_events_y*m*`.
